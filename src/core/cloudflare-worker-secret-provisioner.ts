import { WorkerSecretStore } from "./worker-secret-store.js";
import { ThemisSecretStore } from "./themis-secret-store.js";
import {
  ManagedAgentPlatformGatewayClient,
  readManagedAgentPlatformGatewayConfig,
} from "./managed-agent-platform-gateway-client.js";

const DEFAULT_CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const DEFAULT_WORKER_SECRET_REF = "cloudflare-readonly-token";
const DEFAULT_WORKER_ENV_NAME = "CLOUDFLARE_API_TOKEN";
const CLOUDFLARE_ZONE_SCOPE = "com.cloudflare.api.account.zone";
const REQUIRED_PERMISSION_GROUP_NAMES = ["Zone Read", "DNS Read"] as const;
const MANAGEMENT_TOKEN_ENV_KEYS = [
  "THEMIS_CLOUDFLARE_MANAGEMENT_TOKEN",
  "THEMIS_CLOUDFLARE_API_TOKEN_MANAGER",
  "CLOUDFLARE_MANAGEMENT_TOKEN",
] as const;
const MANAGEMENT_TOKEN_SECRET_REFS = [
  "cloudflare-management-token",
  "THEMIS_CLOUDFLARE_MANAGEMENT_TOKEN",
  "CLOUDFLARE_MANAGEMENT_TOKEN",
] as const;
const ACCOUNT_ID_ENV_KEYS = [
  "THEMIS_CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;
const ACCOUNT_ID_SECRET_REFS = [
  "cloudflare-account-id",
  "THEMIS_CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;
const WORKER_TOKEN_ENV_KEYS = [
  "THEMIS_CLOUDFLARE_WORKER_TOKEN",
  "CLOUDFLARE_WORKER_TOKEN",
] as const;
const WORKER_TOKEN_SECRET_REFS = [
  DEFAULT_WORKER_SECRET_REF,
  "cloudflare-worker-token",
  "THEMIS_CLOUDFLARE_WORKER_TOKEN",
] as const;
const CLOUDFLARE_TOKEN_NAME_MAX_LENGTH = 120;
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export interface CloudflareWorkerSecretProvisionerOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
  now?: () => Date;
  themisSecretStore?: ThemisSecretStore;
  workerSecretStore?: WorkerSecretStore;
  platformGatewayClient?: Pick<ManagedAgentPlatformGatewayClient, "pushWorkerSecret">;
}

export interface ProvisionCloudflareWorkerSecretInput {
  secretRef?: string;
  envName?: string;
  accountId?: string;
  domains?: string[];
  forceRefresh?: boolean;
  expiresOn?: string;
  dryRun?: boolean;
  targetNodeIds?: string[];
}

export type CloudflareWorkerSecretProvisionStatus =
  | "already_configured"
  | "dry_run_ready"
  | "provisioned";

export type CloudflareWorkerSecretProvisionSource =
  | "worker_secret_store"
  | "themis_worker_token"
  | "cloudflare_management_token";

export interface CloudflareWorkerSecretProvisionZone {
  id: string;
  name: string;
}

export interface CloudflareWorkerSecretProvisionPermissionGroup {
  id: string;
  name: string;
}

export interface CloudflareWorkerSecretProvisionDelivery {
  nodeId: string;
  secretRef: string;
  deliveryId?: string;
  status?: string;
}

export interface CloudflareWorkerSecretProvisionResult {
  status: CloudflareWorkerSecretProvisionStatus;
  source: CloudflareWorkerSecretProvisionSource;
  secretRef: string;
  envName: string;
  workerSecretStorePath: string;
  themisSecretStorePath: string;
  cloudflareTokenEndpoint?: "account";
  accountIdConfigured?: boolean;
  domains: string[];
  zones: CloudflareWorkerSecretProvisionZone[];
  permissionGroups: CloudflareWorkerSecretProvisionPermissionGroup[];
  tokenName?: string;
  tokenId?: string;
  expiresOn?: string;
  targetNodeIds?: string[];
  deliveries?: CloudflareWorkerSecretProvisionDelivery[];
  written: boolean;
}

interface CloudflareEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: Array<{ message?: unknown; code?: unknown }>;
  messages?: Array<{ message?: unknown; code?: unknown }>;
}

interface CloudflarePermissionGroup {
  id?: unknown;
  name?: unknown;
  scopes?: unknown;
}

interface CloudflareZone {
  id?: unknown;
  name?: unknown;
}

interface CloudflareCreatedToken {
  id?: unknown;
  value?: unknown;
  name?: unknown;
  expires_on?: unknown;
}

export class CloudflareWorkerSecretProvisioner {
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly now: () => Date;
  private readonly themisSecretStore: ThemisSecretStore;
  private readonly workerSecretStore: WorkerSecretStore;
  private readonly platformGatewayClient: Pick<ManagedAgentPlatformGatewayClient, "pushWorkerSecret"> | undefined;

  constructor(options: CloudflareWorkerSecretProvisionerOptions = {}) {
    const cwd = options.cwd ?? process.cwd();
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBaseUrl = trimTrailingSlash(options.apiBaseUrl ?? DEFAULT_CLOUDFLARE_API_BASE_URL);
    this.now = options.now ?? (() => new Date());
    this.themisSecretStore = options.themisSecretStore ?? new ThemisSecretStore({
      cwd,
      env: this.env,
    });
    this.workerSecretStore = options.workerSecretStore ?? new WorkerSecretStore({
      cwd,
      env: this.env,
    });
    this.platformGatewayClient = options.platformGatewayClient;
  }

  async provisionWorkerSecret(
    input: ProvisionCloudflareWorkerSecretInput = {},
  ): Promise<CloudflareWorkerSecretProvisionResult> {
    const secretRef = normalizeSecretRef(input.secretRef ?? DEFAULT_WORKER_SECRET_REF);
    const envName = normalizeEnvName(input.envName ?? DEFAULT_WORKER_ENV_NAME);
    const domains = normalizeDomains(input.domains ?? []);
    const forceRefresh = input.forceRefresh === true;
    const dryRun = input.dryRun === true;
    const expiresOn = normalizeOptionalText(input.expiresOn);
    const targetNodeIds = normalizeTargetNodeIds(input.targetNodeIds ?? []);
    const workerSnapshot = this.workerSecretStore.readSnapshot();
    const themisSnapshot = this.themisSecretStore.readSnapshot();

    if (!forceRefresh && workerSnapshot.secretRefs.includes(secretRef)) {
      const existingValue = this.workerSecretStore.getSecret(secretRef);
      const deliveries = !dryRun && targetNodeIds.length > 0
        ? await this.deliverWorkerSecretToNodes(secretRef, existingValue, targetNodeIds)
        : [];
      return {
        status: "already_configured",
        source: "worker_secret_store",
        secretRef,
        envName,
        workerSecretStorePath: workerSnapshot.filePath,
        themisSecretStorePath: themisSnapshot.filePath,
        domains,
        zones: [],
        permissionGroups: [],
        ...(expiresOn ? { expiresOn } : {}),
        ...(targetNodeIds.length > 0 ? { targetNodeIds } : {}),
        ...(deliveries.length > 0 ? { deliveries } : {}),
        written: false,
      };
    }

    const existingWorkerToken = this.resolveExistingWorkerToken(secretRef);

    if (existingWorkerToken) {
      if (!dryRun) {
        this.workerSecretStore.setSecret(secretRef, existingWorkerToken);
      }
      const deliveries = !dryRun && targetNodeIds.length > 0
        ? await this.deliverWorkerSecretToNodes(secretRef, existingWorkerToken, targetNodeIds)
        : [];

      return {
        status: dryRun ? "dry_run_ready" : "provisioned",
        source: "themis_worker_token",
        secretRef,
        envName,
        workerSecretStorePath: this.workerSecretStore.getFilePath(),
        themisSecretStorePath: this.themisSecretStore.getFilePath(),
        domains,
        zones: [],
        permissionGroups: [],
        ...(expiresOn ? { expiresOn } : {}),
        ...(targetNodeIds.length > 0 ? { targetNodeIds } : {}),
        ...(deliveries.length > 0 ? { deliveries } : {}),
        written: !dryRun,
      };
    }

    const managementToken = this.resolveManagementToken();

    if (!managementToken) {
      throw new Error(
        "Cloudflare 管理 token 未配置。请把具备 API Tokens Write 权限的 token 放入 "
        + "THEMIS_CLOUDFLARE_MANAGEMENT_TOKEN，或直接在和 Themis 的单聊里把它交给 Themis 保存为 "
        + "密码本 secretRef=cloudflare-management-token；不要从工单正文、contextPacket 或员工报告里回捞 token。",
      );
    }

    if (domains.length === 0) {
      throw new Error("通过 Cloudflare 管理 token 创建 worker 只读 token 时必须传 domains，避免默认生成全账户/全 zone token。");
    }

    const accountId = this.resolveAccountId(input.accountId);

    if (!accountId) {
      throw new Error(
        "Cloudflare accountId 未配置。Account Owned API Token 必须走 /accounts/{account_id}/tokens endpoint；"
        + "请配置 THEMIS_CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_ACCOUNT_ID，或在 Themis 密码本保存 secretRef=cloudflare-account-id。",
      );
    }

    const permissionGroups = await this.fetchRequiredPermissionGroups(managementToken, accountId);
    const zones = await this.resolveZones(managementToken, domains);
    const tokenName = buildTokenName(secretRef, this.now());

    if (dryRun) {
      return {
        status: "dry_run_ready",
        source: "cloudflare_management_token",
        secretRef,
        envName,
        workerSecretStorePath: this.workerSecretStore.getFilePath(),
        themisSecretStorePath: this.themisSecretStore.getFilePath(),
        cloudflareTokenEndpoint: "account",
        accountIdConfigured: true,
        domains,
        zones,
        permissionGroups,
        tokenName,
        ...(expiresOn ? { expiresOn } : {}),
        ...(targetNodeIds.length > 0 ? { targetNodeIds } : {}),
        written: false,
      };
    }

    const createdToken = await this.createCloudflareToken({
      managementToken,
      accountId,
      tokenName,
      zones,
      permissionGroups,
      ...(expiresOn ? { expiresOn } : {}),
    });

    this.workerSecretStore.setSecret(secretRef, createdToken.value);
    const deliveries = targetNodeIds.length > 0
      ? await this.deliverWorkerSecretToNodes(secretRef, createdToken.value, targetNodeIds)
      : [];

    return {
      status: "provisioned",
      source: "cloudflare_management_token",
      secretRef,
      envName,
      workerSecretStorePath: this.workerSecretStore.getFilePath(),
      themisSecretStorePath: this.themisSecretStore.getFilePath(),
      cloudflareTokenEndpoint: "account",
      accountIdConfigured: true,
      domains,
      zones,
      permissionGroups,
      tokenName,
      ...(createdToken.id ? { tokenId: createdToken.id } : {}),
      ...(expiresOn ? { expiresOn } : {}),
      ...(targetNodeIds.length > 0 ? { targetNodeIds } : {}),
      ...(deliveries.length > 0 ? { deliveries } : {}),
      written: true,
    };
  }

  private async deliverWorkerSecretToNodes(
    secretRef: string,
    value: string | null,
    targetNodeIds: string[],
  ): Promise<CloudflareWorkerSecretProvisionDelivery[]> {
    if (!value) {
      throw new Error(`worker secret store 中存在 ${secretRef}，但无法读取有效值，不能下发到 worker node。`);
    }

    const client = this.resolvePlatformGatewayClient();
    const deliveries: CloudflareWorkerSecretProvisionDelivery[] = [];

    for (const nodeId of targetNodeIds) {
      const result = await client.pushWorkerSecret({
        nodeId,
        secretRef,
        value,
      });
      deliveries.push({
        nodeId: result.delivery.nodeId,
        secretRef: result.delivery.secretRef,
        deliveryId: result.delivery.deliveryId,
        status: result.delivery.status,
      });
    }

    return deliveries;
  }

  private resolvePlatformGatewayClient(): Pick<ManagedAgentPlatformGatewayClient, "pushWorkerSecret"> {
    if (this.platformGatewayClient) {
      return this.platformGatewayClient;
    }

    const config = readManagedAgentPlatformGatewayConfig(this.env);

    if (!config) {
      throw new Error(
        "需要下发 worker secret 到指定 node，但未配置 THEMIS_PLATFORM_BASE_URL / "
        + "THEMIS_PLATFORM_OWNER_PRINCIPAL_ID / THEMIS_PLATFORM_WEB_ACCESS_TOKEN。",
      );
    }

    return new ManagedAgentPlatformGatewayClient({
      ...config,
      fetchImpl: this.fetchImpl,
    });
  }

  private resolveExistingWorkerToken(secretRef: string): string | null {
    for (const key of WORKER_TOKEN_ENV_KEYS) {
      const value = normalizeOptionalText(this.env[key]);

      if (value) {
        return value;
      }
    }

    const workerSecretEnvKey = `THEMIS_WORKER_SECRET_${normalizeSecretRefEnvSuffix(secretRef)}`;
    const workerSecretEnvValue = normalizeOptionalText(this.env[workerSecretEnvKey]);

    if (workerSecretEnvValue) {
      return workerSecretEnvValue;
    }

    for (const ref of [secretRef, ...WORKER_TOKEN_SECRET_REFS]) {
      const value = this.themisSecretStore.getSecret(ref);

      if (value) {
        return value;
      }
    }

    return null;
  }

  private resolveManagementToken(): string | null {
    for (const key of MANAGEMENT_TOKEN_ENV_KEYS) {
      const value = normalizeOptionalText(this.env[key]);

      if (value) {
        return value;
      }
    }

    for (const ref of MANAGEMENT_TOKEN_SECRET_REFS) {
      const value = this.themisSecretStore.getSecret(ref);

      if (value) {
        return value;
      }
    }

    return null;
  }

  private resolveAccountId(inputAccountId?: string): string | null {
    const explicit = normalizeOptionalText(inputAccountId);

    if (explicit) {
      return normalizeCloudflareAccountId(explicit);
    }

    for (const key of ACCOUNT_ID_ENV_KEYS) {
      const value = normalizeOptionalText(this.env[key]);

      if (value) {
        return normalizeCloudflareAccountId(value);
      }
    }

    for (const ref of ACCOUNT_ID_SECRET_REFS) {
      const value = this.themisSecretStore.getSecret(ref);

      if (value) {
        return normalizeCloudflareAccountId(value);
      }
    }

    return null;
  }

  private async fetchRequiredPermissionGroups(
    managementToken: string,
    accountId: string,
  ): Promise<CloudflareWorkerSecretProvisionPermissionGroup[]> {
    const envelope = await this.callCloudflare<CloudflarePermissionGroup[]>(
      managementToken,
      `/accounts/${encodeURIComponent(accountId)}/tokens/permission_groups`,
      { method: "GET" },
    );
    const groups = Array.isArray(envelope.result) ? envelope.result : [];
    const resolved = REQUIRED_PERMISSION_GROUP_NAMES.map((name) => {
      const group = groups.find((candidate) =>
        candidate.name === name
        && Array.isArray(candidate.scopes)
        && candidate.scopes.includes(CLOUDFLARE_ZONE_SCOPE)
        && typeof candidate.id === "string"
      );

      if (!group || typeof group.id !== "string" || typeof group.name !== "string") {
        throw new Error(`Cloudflare permission group 不可用：${name}。请确认管理 token 具备 API Tokens Read/Write 权限。`);
      }

      return {
        id: group.id,
        name: group.name,
      };
    });

    return resolved;
  }

  private async resolveZones(
    managementToken: string,
    domains: string[],
  ): Promise<CloudflareWorkerSecretProvisionZone[]> {
    const zones: CloudflareWorkerSecretProvisionZone[] = [];

    for (const domain of domains) {
      const envelope = await this.callCloudflare<CloudflareZone[]>(
        managementToken,
        `/zones?name=${encodeURIComponent(domain)}&per_page=50`,
        { method: "GET" },
      );
      const candidates = Array.isArray(envelope.result) ? envelope.result : [];
      const zone = candidates.find((candidate) =>
        candidate.name === domain
        && typeof candidate.id === "string"
      );

      if (!zone || typeof zone.id !== "string" || typeof zone.name !== "string") {
        throw new Error(`Cloudflare zone 未找到或当前管理 token 无权读取：${domain}`);
      }

      zones.push({
        id: zone.id,
        name: zone.name,
      });
    }

    return zones;
  }

  private async createCloudflareToken(input: {
    managementToken: string;
    accountId: string;
    tokenName: string;
    zones: CloudflareWorkerSecretProvisionZone[];
    permissionGroups: CloudflareWorkerSecretProvisionPermissionGroup[];
    expiresOn?: string;
  }): Promise<{ id: string | null; value: string }> {
    const resources = Object.fromEntries(input.zones.map((zone) => [
      `${CLOUDFLARE_ZONE_SCOPE}.${zone.id}`,
      "*",
    ]));
    const body: Record<string, unknown> = {
      name: input.tokenName,
      policies: [{
        effect: "allow",
        resources,
        permission_groups: input.permissionGroups.map((group) => ({
          id: group.id,
          name: group.name,
        })),
      }],
    };

    if (input.expiresOn) {
      body.expires_on = input.expiresOn;
    }

    const envelope = await this.callCloudflare<CloudflareCreatedToken>(
      input.managementToken,
      `/accounts/${encodeURIComponent(input.accountId)}/tokens`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    const result = envelope.result;

    if (!result || typeof result !== "object" || typeof result.value !== "string") {
      throw new Error("Cloudflare 已创建 token，但响应中没有一次性 token value；无法写入 worker secret store。");
    }

    return {
      id: typeof result.id === "string" ? result.id : null,
      value: result.value,
    };
  }

  private async callCloudflare<T>(
    token: string,
    path: string,
    init: RequestInit,
  ): Promise<CloudflareEnvelope<T>> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    });
    const text = await response.text();
    const parsed = parseJson(text);
    const envelope = isRecord(parsed) ? parsed as CloudflareEnvelope<T> : {};

    if (!response.ok) {
      throw new Error(`Cloudflare API 请求失败：HTTP ${response.status} ${extractCloudflareMessages(envelope)}`);
    }

    if (envelope.success === false) {
      throw new Error(`Cloudflare API 请求失败：${extractCloudflareMessages(envelope)}`);
    }

    return envelope;
  }
}

function buildTokenName(secretRef: string, now: Date): string {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const name = `themis-worker-${secretRef}-${timestamp}`;
  return name.length > CLOUDFLARE_TOKEN_NAME_MAX_LENGTH
    ? name.slice(0, CLOUDFLARE_TOKEN_NAME_MAX_LENGTH)
    : name;
}

function normalizeSecretRef(value: string): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    throw new Error("secretRef 不能为空。");
  }

  if (/\s/.test(normalized)) {
    throw new Error("secretRef 不能包含空白字符。");
  }

  if (normalized.length > 160) {
    throw new Error("secretRef 过长。");
  }

  return normalized;
}

function normalizeEnvName(value: string): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized || !ENV_NAME_PATTERN.test(normalized)) {
    throw new Error("envName 必须匹配 ^[A-Z_][A-Z0-9_]*$。");
  }

  return normalized;
}

function normalizeCloudflareAccountId(value: string): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized || !/^[a-fA-F0-9]{32}$/.test(normalized)) {
    throw new Error("Cloudflare accountId 必须是 32 位十六进制字符串。");
  }

  return normalized.toLowerCase();
}

function normalizeDomains(values: string[]): string[] {
  const domains: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const domain = normalizeDomain(value);

    if (!domain || seen.has(domain)) {
      continue;
    }

    seen.add(domain);
    domains.push(domain);
  }

  return domains;
}

function normalizeTargetNodeIds(values: string[]): string[] {
  const nodeIds: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const nodeId = normalizeOptionalText(value);

    if (!nodeId || seen.has(nodeId)) {
      continue;
    }

    if (/\s/.test(nodeId)) {
      throw new Error(`无效的 worker nodeId：${value}`);
    }

    seen.add(nodeId);
    nodeIds.push(nodeId);
  }

  return nodeIds;
}

function normalizeDomain(value: string): string | null {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return null;
  }

  const host = extractHost(normalized).toLowerCase().replace(/\.$/, "");

  if (
    !host
    || host.length > 253
    || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)
  ) {
    throw new Error(`无效的 Cloudflare zone/domain：${value}`);
  }

  return host;
}

function extractHost(value: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return new URL(value).hostname;
  }

  return value.split("/")[0]?.split(":")[0] ?? value;
}

function normalizeSecretRefEnvSuffix(secretRef: string): string {
  return secretRef
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseJson(text: string): unknown {
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractCloudflareMessages(envelope: CloudflareEnvelope<unknown>): string {
  const entries = [
    ...(Array.isArray(envelope.errors) ? envelope.errors : []),
    ...(Array.isArray(envelope.messages) ? envelope.messages : []),
  ];
  const messages = entries
    .map((entry) => normalizeOptionalText(entry.message))
    .filter((message): message is string => Boolean(message));

  return messages.length > 0 ? messages.join("; ") : "无详细错误信息";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
