import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
