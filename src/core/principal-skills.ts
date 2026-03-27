export const PRINCIPAL_SKILL_SOURCE_TYPES = [
  "local-path",
  "github-repo-path",
  "github-url",
  "curated",
] as const;

export type PrincipalSkillSourceType = (typeof PRINCIPAL_SKILL_SOURCE_TYPES)[number];

export const PRINCIPAL_SKILL_INSTALL_STATUSES = [
  "ready",
  "syncing",
  "partially_synced",
  "error",
] as const;

export type PrincipalSkillInstallStatus = (typeof PRINCIPAL_SKILL_INSTALL_STATUSES)[number];

export const PRINCIPAL_SKILL_MATERIALIZATION_STATES = [
  "synced",
  "missing",
  "conflict",
  "failed",
] as const;

export type PrincipalSkillMaterializationState = (typeof PRINCIPAL_SKILL_MATERIALIZATION_STATES)[number];

export interface StoredPrincipalSkillRecord {
  principalId: string;
  skillName: string;
  description: string;
  sourceType: PrincipalSkillSourceType;
  sourceRefJson: string;
  managedPath: string;
  installStatus: PrincipalSkillInstallStatus;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredPrincipalSkillMaterializationRecord {
  principalId: string;
  skillName: string;
  targetKind: "auth-account";
  targetId: string;
  targetPath: string;
  state: PrincipalSkillMaterializationState;
  lastSyncedAt?: string;
  lastError?: string;
}

export function normalizePrincipalSkillSourceType(value: unknown): PrincipalSkillSourceType | null {
  return normalizeEnum(value, PRINCIPAL_SKILL_SOURCE_TYPES);
}

export function normalizePrincipalSkillInstallStatus(
  value: unknown,
): PrincipalSkillInstallStatus | null {
  return normalizeEnum(value, PRINCIPAL_SKILL_INSTALL_STATUSES);
}

export function normalizePrincipalSkillMaterializationState(
  value: unknown,
): PrincipalSkillMaterializationState | null {
  return normalizeEnum(value, PRINCIPAL_SKILL_MATERIALIZATION_STATES);
}

export function normalizePrincipalSkillRecordInput(
  value: unknown,
): Partial<StoredPrincipalSkillRecord> {
  if (!isRecord(value)) {
    return {};
  }

  const principalId = normalizeText(value.principalId);
  const skillName = normalizeText(value.skillName);
  const description = normalizeText(value.description);
  const sourceType = normalizePrincipalSkillSourceType(value.sourceType);
  const sourceRefJson = normalizeText(value.sourceRefJson);
  const managedPath = normalizeText(value.managedPath);
  const installStatus = normalizePrincipalSkillInstallStatus(value.installStatus);
  const lastError = normalizeText(value.lastError);
  const createdAt = normalizeText(value.createdAt);
  const updatedAt = normalizeText(value.updatedAt);

  return {
    ...(principalId ? { principalId } : {}),
    ...(skillName ? { skillName } : {}),
    ...(description ? { description } : {}),
    ...(sourceType ? { sourceType } : {}),
    ...(sourceRefJson ? { sourceRefJson } : {}),
    ...(managedPath ? { managedPath } : {}),
    ...(installStatus ? { installStatus } : {}),
    ...(lastError ? { lastError } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

export function normalizePrincipalSkillMaterializationRecordInput(
  value: unknown,
): Partial<StoredPrincipalSkillMaterializationRecord> {
  if (!isRecord(value)) {
    return {};
  }

  const principalId = normalizeText(value.principalId);
  const skillName = normalizeText(value.skillName);
  const targetKind = normalizeText(value.targetKind);
  const targetId = normalizeText(value.targetId);
  const targetPath = normalizeText(value.targetPath);
  const state = normalizePrincipalSkillMaterializationState(value.state);
  const lastSyncedAt = normalizeText(value.lastSyncedAt);
  const lastError = normalizeText(value.lastError);

  return {
    ...(principalId ? { principalId } : {}),
    ...(skillName ? { skillName } : {}),
    ...(targetKind === "auth-account" ? { targetKind } : {}),
    ...(targetId ? { targetId } : {}),
    ...(targetPath ? { targetPath } : {}),
    ...(state ? { state } : {}),
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
