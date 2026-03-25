import {
  APPROVAL_POLICIES,
  REASONING_LEVELS,
  SANDBOX_MODES,
  TASK_ACCESS_MODES,
  WEB_SEARCH_MODES,
  type ApprovalPolicy,
  type ReasoningLevel,
  type SandboxMode,
  type SessionTaskSettings,
  type TaskAccessMode,
  type TaskOptions,
  type WebSearchMode,
} from "../types/index.js";

export function normalizeSessionTaskSettings(value: unknown): SessionTaskSettings {
  if (!isRecord(value)) {
    return {};
  }

  const profile = normalizeText(value.profile);
  const accessMode = normalizeEnum<TaskAccessMode>(value.accessMode, TASK_ACCESS_MODES);
  const authAccountId = normalizeText(value.authAccountId);
  const model = normalizeText(value.model);
  const reasoning = normalizeEnum<ReasoningLevel>(value.reasoning, REASONING_LEVELS);
  const approvalPolicy = normalizeEnum<ApprovalPolicy>(value.approvalPolicy, APPROVAL_POLICIES);
  const sandboxMode = normalizeEnum<SandboxMode>(value.sandboxMode, SANDBOX_MODES);
  const webSearchMode = normalizeEnum<WebSearchMode>(value.webSearchMode, WEB_SEARCH_MODES);
  const networkAccessEnabled = normalizeBoolean(value.networkAccessEnabled);
  const thirdPartyProviderId = normalizeText(value.thirdPartyProviderId);
  const thirdPartyModel = normalizeText(value.thirdPartyModel);

  return {
    ...(profile ? { profile } : {}),
    ...(accessMode ? { accessMode } : {}),
    ...(authAccountId ? { authAccountId } : {}),
    ...(model ? { model } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(approvalPolicy ? { approvalPolicy } : {}),
    ...(sandboxMode ? { sandboxMode } : {}),
    ...(webSearchMode ? { webSearchMode } : {}),
    ...(typeof networkAccessEnabled === "boolean" ? { networkAccessEnabled } : {}),
    ...(thirdPartyProviderId ? { thirdPartyProviderId } : {}),
    ...(thirdPartyModel ? { thirdPartyModel } : {}),
  };
}

export function mergeSessionTaskSettings(
  base: SessionTaskSettings,
  patch: Partial<SessionTaskSettings>,
): SessionTaskSettings {
  return normalizeSessionTaskSettings({
    ...base,
    ...patch,
  });
}

export function isSessionTaskSettingsEmpty(settings: SessionTaskSettings | null | undefined): boolean {
  return !settings || Object.keys(settings).length === 0;
}

export function buildTaskOptionsFromSessionTaskSettings(
  settings: SessionTaskSettings | null | undefined,
): TaskOptions | undefined {
  const normalized = normalizeSessionTaskSettings(settings);

  if (isSessionTaskSettingsEmpty(normalized)) {
    return undefined;
  }

  const accessMode = normalized.accessMode === "third-party" ? "third-party" : normalized.accessMode;
  const model = accessMode === "third-party"
    ? normalized.thirdPartyModel || undefined
    : normalized.model || undefined;

  const options: TaskOptions = {
    ...(normalized.profile ? { profile: normalized.profile } : {}),
    ...(accessMode ? { accessMode } : {}),
    ...(normalized.authAccountId ? { authAccountId: normalized.authAccountId } : {}),
    ...(model ? { model } : {}),
    ...(normalized.reasoning ? { reasoning: normalized.reasoning } : {}),
    ...(normalized.approvalPolicy ? { approvalPolicy: normalized.approvalPolicy } : {}),
    ...(normalized.sandboxMode ? { sandboxMode: normalized.sandboxMode } : {}),
    ...(normalized.webSearchMode ? { webSearchMode: normalized.webSearchMode } : {}),
    ...(typeof normalized.networkAccessEnabled === "boolean"
      ? { networkAccessEnabled: normalized.networkAccessEnabled }
      : {}),
    ...(normalized.thirdPartyProviderId ? { thirdPartyProviderId: normalized.thirdPartyProviderId } : {}),
  };

  return Object.keys(options).length ? options : undefined;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text ? text : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const normalized = normalizeText(value);
  return normalized && allowed.includes(normalized as T) ? (normalized as T) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
