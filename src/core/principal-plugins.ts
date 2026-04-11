import type {
  PluginAuthPolicy,
  PluginInstallPolicy,
  PluginInterface,
} from "./plugin-service.js";

export const PRINCIPAL_PLUGIN_SOURCE_TYPES = [
  "marketplace",
  "repo-local",
  "home-local",
  "unknown",
] as const;

export type PrincipalPluginSourceType = (typeof PRINCIPAL_PLUGIN_SOURCE_TYPES)[number];

export const PRINCIPAL_PLUGIN_MATERIALIZATION_STATES = [
  "installed",
  "available",
  "missing",
  "auth_required",
  "failed",
] as const;

export type PrincipalPluginMaterializationState =
  (typeof PRINCIPAL_PLUGIN_MATERIALIZATION_STATES)[number];

export interface PrincipalPluginSourceRef {
  sourceType?: PrincipalPluginSourceType;
  marketplaceName?: string;
  marketplacePath?: string;
  pluginName?: string;
  pluginId?: string;
  sourcePath?: string;
  workspaceFingerprint?: string;
}

export interface StoredPrincipalPluginRecord {
  principalId: string;
  pluginId: string;
  pluginName: string;
  marketplaceName: string;
  marketplacePath: string;
  sourceType: PrincipalPluginSourceType;
  sourceRefJson: string;
  sourcePath?: string;
  interfaceJson: string;
  installPolicy: PluginInstallPolicy;
  authPolicy: PluginAuthPolicy;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface StoredPrincipalPluginMaterializationRecord {
  principalId: string;
  pluginId: string;
  targetKind: "auth-account";
  targetId: string;
  workspaceFingerprint: string;
  state: PrincipalPluginMaterializationState;
  lastSyncedAt?: string;
  lastError?: string;
}

export function normalizePrincipalPluginSourceType(value: unknown): PrincipalPluginSourceType | null {
  return normalizeEnum(value, PRINCIPAL_PLUGIN_SOURCE_TYPES);
}

export function normalizePrincipalPluginMaterializationState(
  value: unknown,
): PrincipalPluginMaterializationState | null {
  return normalizeEnum(value, PRINCIPAL_PLUGIN_MATERIALIZATION_STATES);
}

export function normalizePrincipalPluginInstallPolicy(value: unknown): PluginInstallPolicy | null {
  const normalized = normalizeText(value);

  switch (normalized) {
    case "NOT_AVAILABLE":
    case "AVAILABLE":
    case "INSTALLED_BY_DEFAULT":
    case "UNKNOWN":
      return normalized;
    default:
      return null;
  }
}

export function normalizePrincipalPluginAuthPolicy(value: unknown): PluginAuthPolicy | null {
  const normalized = normalizeText(value);

  switch (normalized) {
    case "ON_INSTALL":
    case "ON_USE":
    case "UNKNOWN":
      return normalized;
    default:
      return null;
  }
}

export function normalizePrincipalPluginRecordInput(
  value: unknown,
): Partial<StoredPrincipalPluginRecord> {
  if (!isRecord(value)) {
    return {};
  }

  const principalId = normalizeText(value.principalId);
  const pluginId = normalizeText(value.pluginId);
  const pluginName = normalizeText(value.pluginName);
  const marketplaceName = normalizeText(value.marketplaceName);
  const marketplacePath = normalizeText(value.marketplacePath);
  const sourceType = normalizePrincipalPluginSourceType(value.sourceType);
  const sourceRefJson = normalizeText(value.sourceRefJson);
  const sourcePath = normalizeText(value.sourcePath);
  const interfaceJson = normalizeInterfaceJson(value.interfaceJson);
  const installPolicy = normalizePrincipalPluginInstallPolicy(value.installPolicy);
  const authPolicy = normalizePrincipalPluginAuthPolicy(value.authPolicy);
  const enabled = typeof value.enabled === "boolean" ? value.enabled : undefined;
  const createdAt = normalizeText(value.createdAt);
  const updatedAt = normalizeText(value.updatedAt);
  const lastError = normalizeText(value.lastError);

  return {
    ...(principalId ? { principalId } : {}),
    ...(pluginId ? { pluginId } : {}),
    ...(pluginName ? { pluginName } : {}),
    ...(marketplaceName ? { marketplaceName } : {}),
    ...(marketplacePath ? { marketplacePath } : {}),
    ...(sourceType ? { sourceType } : {}),
    ...(sourceRefJson ? { sourceRefJson } : {}),
    ...(sourcePath ? { sourcePath } : {}),
    ...(interfaceJson ? { interfaceJson } : {}),
    ...(installPolicy ? { installPolicy } : {}),
    ...(authPolicy ? { authPolicy } : {}),
    ...(typeof enabled === "boolean" ? { enabled } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

export function normalizePrincipalPluginMaterializationRecordInput(
  value: unknown,
): Partial<StoredPrincipalPluginMaterializationRecord> {
  if (!isRecord(value)) {
    return {};
  }

  const principalId = normalizeText(value.principalId);
  const pluginId = normalizeText(value.pluginId);
  const targetKind = normalizeText(value.targetKind);
  const targetId = normalizeText(value.targetId);
  const workspaceFingerprint = normalizeText(value.workspaceFingerprint);
  const state = normalizePrincipalPluginMaterializationState(value.state);
  const lastSyncedAt = normalizeText(value.lastSyncedAt);
  const lastError = normalizeText(value.lastError);

  return {
    ...(principalId ? { principalId } : {}),
    ...(pluginId ? { pluginId } : {}),
    ...(targetKind === "auth-account" ? { targetKind } : {}),
    ...(targetId ? { targetId } : {}),
    ...(workspaceFingerprint ? { workspaceFingerprint } : {}),
    ...(state ? { state } : {}),
    ...(lastSyncedAt ? { lastSyncedAt } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

export function parseStoredPrincipalPluginInterface(interfaceJson: string): PluginInterface | null {
  const normalized = normalizeText(interfaceJson);

  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;

    if (!isRecord(parsed)) {
      return null;
    }

    return {
      displayName: normalizeText(parsed.displayName) ?? null,
      shortDescription: normalizeText(parsed.shortDescription) ?? null,
      longDescription: normalizeText(parsed.longDescription) ?? null,
      developerName: normalizeText(parsed.developerName) ?? null,
      category: normalizeText(parsed.category) ?? null,
      capabilities: normalizeStringArray(parsed.capabilities),
      websiteUrl: normalizeText(parsed.websiteUrl) ?? null,
      privacyPolicyUrl: normalizeText(parsed.privacyPolicyUrl) ?? null,
      termsOfServiceUrl: normalizeText(parsed.termsOfServiceUrl) ?? null,
      defaultPrompt: Array.isArray(parsed.defaultPrompt)
        ? normalizeStringArray(parsed.defaultPrompt)
        : null,
      brandColor: normalizeText(parsed.brandColor) ?? null,
      composerIcon: normalizeText(parsed.composerIcon) ?? null,
      logo: normalizeText(parsed.logo) ?? null,
      screenshots: normalizeStringArray(parsed.screenshots),
    };
  } catch {
    return null;
  }
}

export function parseStoredPrincipalPluginSourceRef(sourceRefJson: string): PrincipalPluginSourceRef | null {
  const normalized = normalizeText(sourceRefJson);

  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;

    if (!isRecord(parsed)) {
      return null;
    }

    const sourceType = normalizePrincipalPluginSourceType(parsed.sourceType);
    const marketplaceName = normalizeText(parsed.marketplaceName);
    const marketplacePath = normalizeText(parsed.marketplacePath);
    const pluginName = normalizeText(parsed.pluginName);
    const pluginId = normalizeText(parsed.pluginId);
    const sourcePath = normalizeText(parsed.sourcePath);
    const workspaceFingerprint = normalizeText(parsed.workspaceFingerprint);

    return {
      ...(sourceType ? { sourceType } : {}),
      ...(marketplaceName ? { marketplaceName } : {}),
      ...(marketplacePath ? { marketplacePath } : {}),
      ...(pluginName ? { pluginName } : {}),
      ...(pluginId ? { pluginId } : {}),
      ...(sourcePath ? { sourcePath } : {}),
      ...(workspaceFingerprint ? { workspaceFingerprint } : {}),
    };
  } catch {
    return null;
  }
}

function normalizeInterfaceJson(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return JSON.stringify(parsed ?? {});
  } catch {
    return null;
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text ? text : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const normalized = normalizeText(value);
  return normalized && allowed.includes(normalized as T) ? (normalized as T) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
