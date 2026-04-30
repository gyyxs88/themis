export const MANAGED_AGENT_READ_ONLY_FACT_SOURCE_PACK_IDS = [
  "cloudflare_readonly",
  "operations_ledger_readonly",
  "feishu_base_readonly",
] as const;

export type ManagedAgentReadOnlyFactSourcePackId =
  typeof MANAGED_AGENT_READ_ONLY_FACT_SOURCE_PACK_IDS[number];

export interface ManagedAgentSecretEnvRef {
  envName: string;
  secretRef: string;
  required?: boolean;
}

export interface ManagedAgentReadOnlyFactSource {
  id: ManagedAgentReadOnlyFactSourcePackId;
  label: string;
  mode: "read_only";
  access: string;
  requiresNetworkAccess: boolean;
  instructions: string[];
  expectedInputs?: string[];
  toolNames?: string[];
  secretEnvRefs?: ManagedAgentSecretEnvRef[];
}

export interface ApplyManagedAgentReadOnlyFactSourcePacksInput {
  readOnlyFactSourcePacks?: ManagedAgentReadOnlyFactSourcePackId[];
  contextPacket?: unknown;
  runtimeProfileSnapshot?: Record<string, unknown>;
}

export interface ApplyManagedAgentReadOnlyFactSourcePacksResult {
  contextPacket?: unknown;
  runtimeProfileSnapshot?: Record<string, unknown>;
  appliedFactSources: ManagedAgentReadOnlyFactSource[];
}

const READ_ONLY_SAFETY_MARKER = "read_only_only_no_writes";

const READ_ONLY_FACT_SOURCE_PACKS: Record<ManagedAgentReadOnlyFactSourcePackId, ManagedAgentReadOnlyFactSource> = {
  cloudflare_readonly: {
    id: "cloudflare_readonly",
    label: "Cloudflare / DNS 只读事实源",
    mode: "read_only",
    access: "worker_secret_env:CLOUDFLARE_API_TOKEN",
    requiresNetworkAccess: true,
    expectedInputs: ["domains", "zone names", "dns record names"],
    secretEnvRefs: [{
      envName: "CLOUDFLARE_API_TOKEN",
      secretRef: "cloudflare-readonly-token",
      required: true,
    }],
    instructions: [
      "只读取 Cloudflare zone、DNS 记录、代理状态和相关只读配置，不创建、不修改、不删除。",
      "如果 worker 缺少 cloudflare-readonly-token，报告缺失 secretRef，并让 Themis 先调用 provision_cloudflare_worker_secret。",
      "优先产出已一致、漂移、待确认三类结论，并附可复核证据。",
    ],
  },
  operations_ledger_readonly: {
    id: "operations_ledger_readonly",
    label: "运营中枢只读账本",
    mode: "read_only",
    access: "themis_operations_mcp",
    requiresNetworkAccess: false,
    toolNames: [
      "list_operation_objects",
      "list_operation_edges",
      "query_operation_graph",
      "get_operations_boss_view",
    ],
    instructions: [
      "只读取 Asset、Decision、Risk、Cadence、Commitment、OperationEdge、BossView 事实。",
      "巡检工单只提出台账更新建议，不直接写回运营账本。",
      "把外部观察结果和账本对象按对象 id、名称或证据引用对齐。",
    ],
  },
  feishu_base_readonly: {
    id: "feishu_base_readonly",
    label: "飞书 Base 只读事实源",
    mode: "read_only",
    access: "feishu_open_platform:bitable_read",
    requiresNetworkAccess: true,
    expectedInputs: ["base app token or URL", "table ids or table names", "view names"],
    secretEnvRefs: [
      {
        envName: "FEISHU_APP_ID",
        secretRef: "feishu-app-id",
        required: true,
      },
      {
        envName: "FEISHU_APP_SECRET",
        secretRef: "feishu-app-secret",
        required: true,
      },
    ],
    instructions: [
      "只读取飞书多维表记录、字段和值，不新增、不更新、不删除记录。",
      "如果 app token、table id 或只读应用凭据缺失，明确报告缺口，不把巡检结果伪装成完整。",
      "输出时标明来自飞书 Base 的表名、字段和记录标识，方便人工复核。",
    ],
  },
};

const READ_ONLY_FACT_SOURCE_PACK_ID_SET = new Set<string>(MANAGED_AGENT_READ_ONLY_FACT_SOURCE_PACK_IDS);

export function normalizeManagedAgentReadOnlyFactSourcePackIds(
  value: unknown,
  fieldName = "readOnlyFactSourcePacks",
): ManagedAgentReadOnlyFactSourcePackId[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }

  const result: ManagedAgentReadOnlyFactSourcePackId[] = [];
  const seen = new Set<string>();
  const unsupported: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error(`${fieldName} items must be non-empty strings.`);
    }

    const normalized = entry.trim();
    if (!READ_ONLY_FACT_SOURCE_PACK_ID_SET.has(normalized)) {
      unsupported.push(normalized);
      continue;
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized as ManagedAgentReadOnlyFactSourcePackId);
    }
  }

  if (unsupported.length > 0) {
    throw new Error(`Unsupported read-only fact source pack(s): ${unsupported.join(", ")}.`);
  }

  return result;
}

export function getManagedAgentReadOnlyFactSourcePacks(
  packIds: readonly ManagedAgentReadOnlyFactSourcePackId[],
): ManagedAgentReadOnlyFactSource[] {
  return packIds.map((packId) => cloneFactSource(READ_ONLY_FACT_SOURCE_PACKS[packId]));
}

export function applyManagedAgentReadOnlyFactSourcePacks(
  input: ApplyManagedAgentReadOnlyFactSourcePacksInput,
): ApplyManagedAgentReadOnlyFactSourcePacksResult {
  const factSources = getManagedAgentReadOnlyFactSourcePacks(input.readOnlyFactSourcePacks ?? []);

  if (factSources.length === 0) {
    return {
      ...(input.contextPacket !== undefined ? { contextPacket: input.contextPacket } : {}),
      ...(input.runtimeProfileSnapshot !== undefined ? { runtimeProfileSnapshot: input.runtimeProfileSnapshot } : {}),
      appliedFactSources: [],
    };
  }

  return {
    contextPacket: mergeFactSourcesIntoContextPacket(input.contextPacket, factSources),
    runtimeProfileSnapshot: mergeFactSourcesIntoRuntimeProfile(input.runtimeProfileSnapshot, factSources),
    appliedFactSources: factSources,
  };
}

function mergeFactSourcesIntoContextPacket(
  contextPacket: unknown,
  factSources: ManagedAgentReadOnlyFactSource[],
): Record<string, unknown> {
  if (contextPacket !== undefined && !isPlainRecord(contextPacket)) {
    throw new Error("contextPacket must be an object when readOnlyFactSourcePacks are used.");
  }

  const context = contextPacket === undefined ? {} : { ...contextPacket };
  const existingFactSources = normalizeExistingFactSources(context.readOnlyFactSources);
  const existingIds = new Set(existingFactSources.map((entry) => normalizeFactSourceId(entry)).filter(Boolean));
  const nextFactSources = [...existingFactSources];

  for (const factSource of factSources) {
    if (!existingIds.has(factSource.id)) {
      nextFactSources.push(toContextFactSource(factSource));
      existingIds.add(factSource.id);
    }
  }

  context.readOnlyFactSources = nextFactSources;
  context.readOnlyFactSourcePackIds = nextFactSources
    .map((entry) => normalizeFactSourceId(entry))
    .filter(Boolean);

  if (context.safety === undefined) {
    context.safety = READ_ONLY_SAFETY_MARKER;
  } else if (context.safety !== READ_ONLY_SAFETY_MARKER) {
    context.readOnlySafety = READ_ONLY_SAFETY_MARKER;
  }

  return context;
}

function mergeFactSourcesIntoRuntimeProfile(
  runtimeProfileSnapshot: Record<string, unknown> | undefined,
  factSources: ManagedAgentReadOnlyFactSource[],
): Record<string, unknown> {
  const runtimeProfile = { ...(runtimeProfileSnapshot ?? {}) };

  if (runtimeProfile.sandboxMode === undefined) {
    runtimeProfile.sandboxMode = "read-only";
  } else if (runtimeProfile.sandboxMode !== "read-only") {
    throw new Error("readOnlyFactSourcePacks require runtimeProfileSnapshot.sandboxMode=read-only.");
  }

  if (factSources.some((factSource) => factSource.requiresNetworkAccess)) {
    if (runtimeProfile.networkAccessEnabled === undefined) {
      runtimeProfile.networkAccessEnabled = true;
    } else if (runtimeProfile.networkAccessEnabled !== true) {
      throw new Error("readOnlyFactSourcePacks that need network access require runtimeProfileSnapshot.networkAccessEnabled=true.");
    }
  }

  const mergedSecretEnvRefs = mergeSecretEnvRefs(
    Array.isArray(runtimeProfile.secretEnvRefs)
      ? runtimeProfile.secretEnvRefs as ManagedAgentSecretEnvRef[]
      : [],
    factSources.flatMap((factSource) => factSource.secretEnvRefs ?? []),
  );

  if (mergedSecretEnvRefs.length > 0) {
    runtimeProfile.secretEnvRefs = mergedSecretEnvRefs;
  }

  return runtimeProfile;
}

function mergeSecretEnvRefs(
  existing: ManagedAgentSecretEnvRef[],
  incoming: ManagedAgentSecretEnvRef[],
): ManagedAgentSecretEnvRef[] {
  const byEnvName = new Map<string, ManagedAgentSecretEnvRef>();

  for (const ref of [...existing, ...incoming]) {
    const previous = byEnvName.get(ref.envName);

    if (!previous) {
      byEnvName.set(ref.envName, { ...ref });
      continue;
    }

    if (previous.secretRef !== ref.secretRef) {
      throw new Error(
        `readOnlyFactSourcePacks cannot merge conflicting secretEnvRefs for ${ref.envName}: `
        + `${previous.secretRef} vs ${ref.secretRef}.`,
      );
    }

    const required = previous.required === true || ref.required === true ? true : previous.required;
    byEnvName.set(ref.envName, {
      ...previous,
      ...(required !== undefined ? { required } : {}),
    });
  }

  return [...byEnvName.values()];
}

function normalizeExistingFactSources(value: unknown): Record<string, unknown>[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("contextPacket.readOnlyFactSources must be an array when readOnlyFactSourcePacks are used.");
  }

  return value.map((entry) => {
    if (!isPlainRecord(entry)) {
      throw new Error("contextPacket.readOnlyFactSources items must be objects.");
    }

    return { ...entry };
  });
}

function toContextFactSource(factSource: ManagedAgentReadOnlyFactSource): Record<string, unknown> {
  return {
    id: factSource.id,
    label: factSource.label,
    mode: factSource.mode,
    access: factSource.access,
    requiresNetworkAccess: factSource.requiresNetworkAccess,
    instructions: [...factSource.instructions],
    ...(factSource.expectedInputs ? { expectedInputs: [...factSource.expectedInputs] } : {}),
    ...(factSource.toolNames ? { toolNames: [...factSource.toolNames] } : {}),
    ...(factSource.secretEnvRefs
      ? { secretEnvRefs: factSource.secretEnvRefs.map((ref) => ({ ...ref })) }
      : {}),
  };
}

function cloneFactSource(factSource: ManagedAgentReadOnlyFactSource): ManagedAgentReadOnlyFactSource {
  return {
    ...factSource,
    instructions: [...factSource.instructions],
    ...(factSource.expectedInputs ? { expectedInputs: [...factSource.expectedInputs] } : {}),
    ...(factSource.toolNames ? { toolNames: [...factSource.toolNames] } : {}),
    ...(factSource.secretEnvRefs
      ? { secretEnvRefs: factSource.secretEnvRefs.map((ref) => ({ ...ref })) }
      : {}),
  };
}

function normalizeFactSourceId(value: Record<string, unknown>): string | null {
  return typeof value.id === "string" && value.id.trim() ? value.id.trim() : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
