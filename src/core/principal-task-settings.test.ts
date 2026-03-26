import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexTaskRuntime } from "./codex-runtime.js";
import {
  mergePrincipalTaskSettings,
  normalizePrincipalTaskSettings,
} from "./principal-task-settings.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

test("normalizePrincipalTaskSettings 只保留允许字段", () => {
  const result = normalizePrincipalTaskSettings({
    sandboxMode: "workspace-write",
    webSearchMode: "live",
    networkAccessEnabled: true,
    approvalPolicy: "never",
    authAccountId: "acc-1",
    unknown: "ignored",
  });

  assert.deepEqual(result, {
    sandboxMode: "workspace-write",
    webSearchMode: "live",
    networkAccessEnabled: true,
    approvalPolicy: "never",
    authAccountId: "acc-1",
  });
});

test("mergePrincipalTaskSettings 会覆盖已有字段并保留未修改字段", () => {
  const result = mergePrincipalTaskSettings(
    {
      sandboxMode: "workspace-write",
      webSearchMode: "live",
      networkAccessEnabled: true,
    },
    {
      webSearchMode: "disabled",
    },
  );

  assert.deepEqual(result, {
    sandboxMode: "workspace-write",
    webSearchMode: "disabled",
    networkAccessEnabled: true,
  });
});

test("SqliteCodexSessionRegistry 可以按 principal 读写任务默认配置", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-principal-task-settings-"));

  try {
    const registry = new SqliteCodexSessionRegistry({
      databaseFile: join(workingDirectory, "infra/local/themis.db"),
    });

    registry.savePrincipal({
      principalId: "principal-1",
      displayName: "Tester",
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
    });

    registry.savePrincipalTaskSettings({
      principalId: "principal-1",
      settings: {
        sandboxMode: "workspace-write",
        webSearchMode: "live",
        networkAccessEnabled: true,
        approvalPolicy: "never",
        authAccountId: "acc-1",
      },
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
    });

    assert.deepEqual(
      registry.getPrincipalTaskSettings("principal-1")?.settings,
      {
        sandboxMode: "workspace-write",
        webSearchMode: "live",
        networkAccessEnabled: true,
        approvalPolicy: "never",
        authAccountId: "acc-1",
      },
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("CodexTaskRuntime 会把 principal 默认配置并入后续新任务", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-principal-runtime-"));

  try {
    const runtimeStore = new SqliteCodexSessionRegistry({
      databaseFile: join(workingDirectory, "infra/local/themis.db"),
    });
    const runtime = new CodexTaskRuntime({
      workingDirectory,
      runtimeStore,
    });
    const identity = runtime.getIdentityLinkService().ensureIdentity({
      channel: "web",
      channelUserId: "browser-user-1",
      displayName: "Tester",
    });

    runtimeStore.savePrincipalTaskSettings({
      principalId: identity.principalId,
      settings: {
        sandboxMode: "workspace-write",
        webSearchMode: "live",
        networkAccessEnabled: true,
        approvalPolicy: "never",
        authAccountId: "acc-1",
      },
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
    });

    const resolved = runtime.resolveExecutionRequest({
      requestId: "request-1",
      sourceChannel: "web",
      user: {
        userId: "browser-user-1",
        displayName: "Tester",
      },
      goal: "hello",
      channelContext: {
        channelSessionKey: "thread-1",
      },
      createdAt: "2026-03-26T00:00:00.000Z",
    });

    assert.equal(resolved.principalId, identity.principalId);
    assert.equal(resolved.request.options?.sandboxMode, "workspace-write");
    assert.equal(resolved.request.options?.webSearchMode, "live");
    assert.equal(resolved.request.options?.networkAccessEnabled, true);
    assert.equal(resolved.request.options?.approvalPolicy, "never");
    assert.equal(resolved.request.options?.authAccountId, "acc-1");
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
