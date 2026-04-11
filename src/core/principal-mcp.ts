export const PRINCIPAL_MCP_TRANSPORT_TYPES = [
  "stdio",
] as const;

export type PrincipalMcpTransportType = (typeof PRINCIPAL_MCP_TRANSPORT_TYPES)[number];

export const PRINCIPAL_MCP_SOURCE_TYPES = [
  "manual",
  "themis-managed",
] as const;

export type PrincipalMcpSourceType = (typeof PRINCIPAL_MCP_SOURCE_TYPES)[number];

export const PRINCIPAL_MCP_MATERIALIZATION_TARGET_KINDS = [
  "auth-account",
  "managed-agent",
] as const;

export type PrincipalMcpMaterializationTargetKind = (typeof PRINCIPAL_MCP_MATERIALIZATION_TARGET_KINDS)[number];

export const PRINCIPAL_MCP_MATERIALIZATION_STATES = [
  "synced",
  "missing",
  "failed",
] as const;

export type PrincipalMcpMaterializationState = (typeof PRINCIPAL_MCP_MATERIALIZATION_STATES)[number];

export const PRINCIPAL_MCP_AUTH_STATES = [
  "unknown",
  "authenticated",
  "auth_required",
  "unsupported",
] as const;

export type PrincipalMcpAuthState = (typeof PRINCIPAL_MCP_AUTH_STATES)[number];

export interface StoredPrincipalMcpServerRecord {
  principalId: string;
  serverName: string;
  transportType: PrincipalMcpTransportType;
  command: string;
  argsJson: string;
  envJson: string;
  cwd?: string;
  enabled: boolean;
  sourceType: PrincipalMcpSourceType;
  createdAt: string;
  updatedAt: string;
}

export interface StoredPrincipalMcpMaterializationRecord {
  principalId: string;
  serverName: string;
  targetKind: PrincipalMcpMaterializationTargetKind;
  targetId: string;
  state: PrincipalMcpMaterializationState;
  authState: PrincipalMcpAuthState;
  lastSyncedAt?: string;
  lastError?: string;
}

export function normalizePrincipalMcpTransportType(value: unknown): PrincipalMcpTransportType | null {
  return normalizeEnum(value, PRINCIPAL_MCP_TRANSPORT_TYPES);
}

export function normalizePrincipalMcpSourceType(value: unknown): PrincipalMcpSourceType | null {
  return normalizeEnum(value, PRINCIPAL_MCP_SOURCE_TYPES);
}

export function normalizePrincipalMcpMaterializationTargetKind(
  value: unknown,
): PrincipalMcpMaterializationTargetKind | null {
  return normalizeEnum(value, PRINCIPAL_MCP_MATERIALIZATION_TARGET_KINDS);
}

export function normalizePrincipalMcpMaterializationState(
  value: unknown,
): PrincipalMcpMaterializationState | null {
  return normalizeEnum(value, PRINCIPAL_MCP_MATERIALIZATION_STATES);
}

export function normalizePrincipalMcpAuthState(value: unknown): PrincipalMcpAuthState | null {
  return normalizeEnum(value, PRINCIPAL_MCP_AUTH_STATES);
}

export function normalizePrincipalMcpServerName(value: unknown): string | null {
  const normalized = normalizeText(value);

  if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    return null;
  }

  return normalized;
}

export function normalizePrincipalMcpServerRecordInput(
  value: unknown,
): Partial<StoredPrincipalMcpServerRecord> {
  if (!isRecord(value)) {
    return {};
  }

  const principalId = normalizeText(value.principalId);
  const serverName = normalizePrincipalMcpServerName(value.serverName);
  const transportType = normalizePrincipalMcpTransportType(value.transportType);
  const command = normalizeText(value.command);
  const argsJson = normalizeText(value.argsJson);
  const envJson = normalizeText(value.envJson);
  const cwd = normalizeText(value.cwd);
  const sourceType = normalizePrincipalMcpSourceType(value.sourceType);
  const createdAt = normalizeText(value.createdAt);
  const updatedAt = normalizeText(value.updatedAt);
  const enabled = typeof value.enabled === "boolean" ? value.enabled : undefined;

  return {
    ...(principalId ? { principalId } : {}),
    ...(serverName ? { serverName } : {}),
    ...(transportType ? { transportType } : {}),
    ...(command ? { command } : {}),
    ...(argsJson ? { argsJson } : {}),
    ...(envJson ? { envJson } : {}),
    ...(cwd ? { cwd } : {}),
    ...(typeof enabled === "boolean" ? { enabled } : {}),
    ...(sourceType ? { sourceType } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

export function normalizePrincipalMcpMaterializationRecordInput(
  value: unknown,
): Partial<StoredPrincipalMcpMaterializationRecord> {
  if (!isRecord(value)) {
    return {};
  }

  const principalId = normalizeText(value.principalId);
  const serverName = normalizePrincipalMcpServerName(value.serverName);
  const targetKind = normalizePrincipalMcpMaterializationTargetKind(value.targetKind);
  const targetId = normalizeText(value.targetId);
  const state = normalizePrincipalMcpMaterializationState(value.state);
  const authState = normalizePrincipalMcpAuthState(value.authState);
  const lastSyncedAt = normalizeText(value.lastSyncedAt);
  const lastError = normalizeText(value.lastError);

  return {
    ...(principalId ? { principalId } : {}),
    ...(serverName ? { serverName } : {}),
    ...(targetKind ? { targetKind } : {}),
    ...(targetId ? { targetId } : {}),
    ...(state ? { state } : {}),
    ...(authState ? { authState } : {}),
    ...(lastSyncedAt ? { lastSyncedAt } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text ? text : null;
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const normalized = normalizeText(value);
  return normalized && allowed.includes(normalized as T) ? (normalized as T) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
