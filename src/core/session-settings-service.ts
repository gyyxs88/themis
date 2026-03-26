import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { SessionTaskSettings } from "../types/index.js";
import {
  isSessionTaskSettingsEmpty,
  mergeSessionTaskSettings,
  normalizeSessionTaskSettings,
} from "./session-task-settings.js";
import { validateWorkspacePath } from "./session-workspace.js";

const SESSION_WORKSPACE_LOCKED_ERROR = "当前会话已经执行过任务，不能再修改工作区；请先新建会话。";
const SESSION_STRING_SETTING_KEYS: ReadonlyArray<keyof SessionTaskSettings> = [
  "profile",
  "accessMode",
  "workspacePath",
  "authAccountId",
  "model",
  "reasoning",
  "approvalPolicy",
  "sandboxMode",
  "webSearchMode",
  "thirdPartyProviderId",
  "thirdPartyModel",
];

export interface PersistSessionTaskSettingsResult {
  sessionId: string;
  cleared: boolean;
  settings: SessionTaskSettings | null;
  createdAt: string | null;
  updatedAt: string;
}

export function persistSessionTaskSettings(
  store: SqliteCodexSessionRegistry,
  sessionId: string,
  patch: unknown,
  now: string,
): PersistSessionTaskSettingsResult {
  const normalizedSessionId = sessionId.trim();

  if (!normalizedSessionId) {
    throw new Error("Session id is required.");
  }

  const existing = store.getSessionTaskSettings(normalizedSessionId);
  const clearRequested = patch === null || (isRecord(patch) && Object.keys(patch).length === 0);
  const normalizedPatch = normalizeSessionTaskSettings(patch);
  const baseSettings = clearRequested
    ? {}
    : applyExplicitStringFieldClears(existing?.settings ?? {}, patch);
  const mergedSettings = clearRequested
    ? {}
    : mergeSessionTaskSettings(baseSettings, normalizedPatch);

  if (workspaceChanged(existing?.settings?.workspacePath, mergedSettings.workspacePath)
    && store.hasSessionTurn({ sessionId: normalizedSessionId })) {
    throw new Error(SESSION_WORKSPACE_LOCKED_ERROR);
  }

  const normalizedSettings = normalizeWorkspaceField(mergedSettings);

  if (isSessionTaskSettingsEmpty(normalizedSettings)) {
    store.deleteSessionTaskSettings(normalizedSessionId);
    return {
      sessionId: normalizedSessionId,
      cleared: true,
      settings: null,
      createdAt: existing?.createdAt ?? null,
      updatedAt: now,
    };
  }

  store.saveSessionTaskSettings({
    sessionId: normalizedSessionId,
    settings: normalizedSettings,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  return {
    sessionId: normalizedSessionId,
    cleared: false,
    settings: normalizedSettings,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function normalizeWorkspaceField(settings: SessionTaskSettings): SessionTaskSettings {
  if (!settings.workspacePath) {
    return settings;
  }

  return {
    ...settings,
    workspacePath: validateWorkspacePath(settings.workspacePath),
  };
}

function workspaceChanged(previous?: string, next?: string): boolean {
  const normalizedPrevious = normalizeWorkspaceValue(previous);
  const normalizedNext = normalizeWorkspaceValue(next);
  return normalizedPrevious !== normalizedNext;
}

function normalizeWorkspaceValue(value: string | undefined): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || "";
}

function applyExplicitStringFieldClears(
  base: SessionTaskSettings,
  patch: unknown,
): SessionTaskSettings {
  if (!isRecord(patch)) {
    return base;
  }

  let next = base;

  for (const key of SESSION_STRING_SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) {
      continue;
    }

    const rawValue = patch[key];

    if (typeof rawValue !== "string" || rawValue.trim() !== "") {
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      continue;
    }

    const mutable: SessionTaskSettings = { ...next };
    delete (mutable as Record<string, unknown>)[key];
    next = mutable;
  }

  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export { SESSION_WORKSPACE_LOCKED_ERROR };
