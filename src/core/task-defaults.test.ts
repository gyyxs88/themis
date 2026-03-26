import assert from "node:assert/strict";
import test from "node:test";
import type { CodexRuntimeCatalog } from "./codex-app-server.js";
import {
  THEMIS_GLOBAL_TASK_DEFAULTS,
  applyThemisGlobalDefaultsToRuntimeCatalog,
  applyThemisGlobalDefaultsToTaskOptions,
} from "./task-defaults.js";

test("TaskOptions 会补齐 Themis 全局默认配置", () => {
  assert.deepEqual(
    applyThemisGlobalDefaultsToTaskOptions(undefined),
    THEMIS_GLOBAL_TASK_DEFAULTS,
  );
});

test("显式 TaskOptions 会覆盖 Themis 全局默认配置", () => {
  assert.deepEqual(
    applyThemisGlobalDefaultsToTaskOptions({
      sandboxMode: "danger-full-access",
      webSearchMode: "disabled",
      networkAccessEnabled: false,
      approvalPolicy: "on-request",
    }),
    {
      sandboxMode: "danger-full-access",
      webSearchMode: "disabled",
      networkAccessEnabled: false,
      approvalPolicy: "on-request",
    },
  );
});

test("运行时目录会补齐 Themis 全局默认配置", () => {
  const catalog: CodexRuntimeCatalog = {
    models: [],
    defaults: {
      profile: null,
      model: "gpt-5.4",
      reasoning: "high",
      approvalPolicy: null,
      sandboxMode: null,
      webSearchMode: null,
      networkAccessEnabled: null,
    },
    provider: null,
    accessModes: [],
    thirdPartyProviders: [],
    personas: [],
  };

  assert.deepEqual(
    applyThemisGlobalDefaultsToRuntimeCatalog(catalog).defaults,
    {
      profile: null,
      model: "gpt-5.4",
      reasoning: "high",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      webSearchMode: "live",
      networkAccessEnabled: true,
    },
  );
});
