import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { CodexAuthRuntime } from "./codex-auth.js";
import {
  addOpenAICompatibleProvider,
  addOpenAICompatibleProviderModel,
} from "./openai-compatible-provider.js";

test("CodexAuthRuntime 可以立即读到新增的第三方 provider 摘要", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-auth-third-party-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });
  const authRuntime = new CodexAuthRuntime({
    workingDirectory,
    registry,
  });

  try {
    assert.equal(authRuntime.readThirdPartyProviderProfile(), null);

    addOpenAICompatibleProvider(workingDirectory, {
      id: "gateway",
      name: "Gateway",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
    }, registry);

    assert.deepEqual(authRuntime.readThirdPartyProviderProfile(), {
      id: "gateway",
      type: "openai-compatible",
      name: "Gateway",
      baseUrl: "https://example.com/v1",
      model: null,
      source: "db",
      lockedModel: false,
    });

    addOpenAICompatibleProviderModel(workingDirectory, {
      providerId: "gateway",
      model: "gpt-5.4",
      setAsDefault: true,
    }, registry);

    assert.deepEqual(authRuntime.readThirdPartyProviderProfile(), {
      id: "gateway",
      type: "openai-compatible",
      name: "Gateway",
      baseUrl: "https://example.com/v1",
      model: "gpt-5.4",
      source: "db",
      lockedModel: false,
    });
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("CodexAuthRuntime 会在自动创建受管认证账号后触发 onManagedAccountReady", async () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-auth-managed-ready-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });
  const calls: string[] = [];
  const authRuntime = new CodexAuthRuntime({
    workingDirectory,
    registry,
    onManagedAccountReady: async (account) => {
      calls.push(account.accountId);
    },
  });

  try {
    const created = await (authRuntime as unknown as {
      createAuthenticatedManagedAccount: (
        sourceCodexHome: string,
        accountEmail: string,
        accountLabel: string,
      ) => Promise<{ accountId: string }>;
    }).createAuthenticatedManagedAccount(
      resolve(workingDirectory, ".codex-source"),
      "demo@example.com",
      "demo@example.com",
    );

    assert.deepEqual(calls, [created.accountId]);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
