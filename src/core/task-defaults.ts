import type { CodexRuntimeCatalog } from "./codex-app-server.js";
import type { SessionTaskSettings, TaskOptions } from "../types/index.js";

export const THEMIS_GLOBAL_TASK_DEFAULTS = {
  sandboxMode: "workspace-write",
  webSearchMode: "live",
  networkAccessEnabled: true,
  approvalPolicy: "never",
} as const satisfies Pick<TaskOptions, "sandboxMode" | "webSearchMode" | "networkAccessEnabled" | "approvalPolicy">;

export function applyThemisGlobalDefaultsToTaskOptions(options: TaskOptions | null | undefined): TaskOptions {
  return {
    ...THEMIS_GLOBAL_TASK_DEFAULTS,
    ...(options ?? {}),
  };
}

export function applyThemisGlobalDefaultsToSessionTaskSettings(
  settings: SessionTaskSettings | null | undefined,
): SessionTaskSettings {
  return {
    ...THEMIS_GLOBAL_TASK_DEFAULTS,
    ...(settings ?? {}),
  };
}

export function applyThemisGlobalDefaultsToRuntimeCatalog(runtimeCatalog: CodexRuntimeCatalog): CodexRuntimeCatalog {
  return {
    ...runtimeCatalog,
    defaults: {
      ...runtimeCatalog.defaults,
      approvalPolicy: runtimeCatalog.defaults.approvalPolicy ?? THEMIS_GLOBAL_TASK_DEFAULTS.approvalPolicy,
      sandboxMode: runtimeCatalog.defaults.sandboxMode ?? THEMIS_GLOBAL_TASK_DEFAULTS.sandboxMode,
      webSearchMode: runtimeCatalog.defaults.webSearchMode ?? THEMIS_GLOBAL_TASK_DEFAULTS.webSearchMode,
      networkAccessEnabled: typeof runtimeCatalog.defaults.networkAccessEnabled === "boolean"
        ? runtimeCatalog.defaults.networkAccessEnabled
        : THEMIS_GLOBAL_TASK_DEFAULTS.networkAccessEnabled,
    },
  };
}
