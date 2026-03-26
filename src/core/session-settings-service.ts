import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { SessionTaskSettings } from "../types/index.js";
import {
  isSessionTaskSettingsEmpty,
  mergeSessionTaskSettings,
  normalizeSessionTaskSettings,
} from "./session-task-settings.js";
import { validateWorkspacePath } from "./session-workspace.js";

const SESSION_WORKSPACE_LOCKED_ERROR = "当前会话已经执行过任务，不能再修改工作区；请先新建会话。";

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
  const mergedSettings = clearRequested
    ? {}
    : mergeSessionTaskSettings(existing?.settings ?? {}, normalizedPatch);
  const normalizedSettings = normalizeWorkspaceField(mergedSettings);

  if (workspaceChanged(existing?.settings?.workspacePath, normalizedSettings.workspacePath)
    && store.hasSessionTurn({ sessionId: normalizedSessionId })) {
    throw new Error(SESSION_WORKSPACE_LOCKED_ERROR);
  }

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export { SESSION_WORKSPACE_LOCKED_ERROR };
