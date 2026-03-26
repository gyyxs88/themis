import {
  APPROVAL_POLICIES,
  SANDBOX_MODES,
  WEB_SEARCH_MODES,
  type ApprovalPolicy,
  type PrincipalTaskSettings,
  type SandboxMode,
  type WebSearchMode,
} from "../types/index.js";

export function normalizePrincipalTaskSettings(value: unknown): PrincipalTaskSettings {
  if (!isRecord(value)) {
    return {};
  }

  const authAccountId = normalizeText(value.authAccountId);
  const sandboxMode = normalizeEnum<SandboxMode>(value.sandboxMode, SANDBOX_MODES);
  const webSearchMode = normalizeEnum<WebSearchMode>(value.webSearchMode, WEB_SEARCH_MODES);
  const approvalPolicy = normalizeEnum<ApprovalPolicy>(value.approvalPolicy, APPROVAL_POLICIES);
  const networkAccessEnabled = typeof value.networkAccessEnabled === "boolean" ? value.networkAccessEnabled : null;

  return {
    ...(authAccountId ? { authAccountId } : {}),
    ...(sandboxMode ? { sandboxMode } : {}),
    ...(webSearchMode ? { webSearchMode } : {}),
    ...(approvalPolicy ? { approvalPolicy } : {}),
    ...(typeof networkAccessEnabled === "boolean" ? { networkAccessEnabled } : {}),
  };
}

export function mergePrincipalTaskSettings(
  base: PrincipalTaskSettings,
  patch: Partial<PrincipalTaskSettings>,
): PrincipalTaskSettings {
  return normalizePrincipalTaskSettings({
    ...base,
    ...patch,
  });
}

export function isPrincipalTaskSettingsEmpty(settings: PrincipalTaskSettings | null | undefined): boolean {
  return !settings || Object.keys(settings).length === 0;
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
