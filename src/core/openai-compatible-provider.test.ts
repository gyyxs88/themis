import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import {
  addOpenAICompatibleProvider,
  addOpenAICompatibleProviderModel,
  buildOpenAICompatibleProviderEndpointPool,
  readOpenAICompatibleProviderConfigs,
  writeOpenAICompatibleProviderPreferredEndpoint,
} from "./openai-compatible-provider.js";

test("第三方模型能力字段会完整写入并从配置里读回", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-provider-capabilities-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });

  try {
    addOpenAICompatibleProvider(workingDirectory, {
      id: "gateway",
      name: "Gateway",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      endpointCandidates: [
        "https://gateway-a.example.com/v1",
        "https://gateway-b.example.com/v1",
      ],
      wireApi: "responses",
      supportsWebsockets: false,
    }, registry);

    addOpenAICompatibleProviderModel(workingDirectory, {
      providerId: "gateway",
      model: "gpt-5.4",
      setAsDefault: true,
      capabilities: {
        supportsCodexTasks: true,
        imageInput: true,
        supportsReasoningSummaries: true,
        supportsVerbosity: true,
        supportsParallelToolCalls: true,
        supportsSearchTool: true,
        supportsImageDetailOriginal: true,
      },
    }, registry);

    const provider = readOpenAICompatibleProviderConfigs(workingDirectory, registry).find((entry) => entry.id === "gateway");

    assert.ok(provider, "expected provider to exist");
    assert.equal(provider?.wireApi, "responses");
    assert.equal(provider?.supportsWebsockets, false);
    assert.equal(provider?.defaultModel, "gpt-5.4");
    assert.deepEqual(provider?.endpointCandidates, [
      "https://gateway-a.example.com/v1",
      "https://gateway-b.example.com/v1",
    ]);
    assert.deepEqual(provider?.models[0]?.profile?.capabilities, {
      textInput: true,
      imageInput: true,
      supportsCodexTasks: true,
      supportsReasoningSummaries: true,
      supportsVerbosity: true,
      supportsParallelToolCalls: true,
      supportsSearchTool: true,
      supportsImageDetailOriginal: true,
    });
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("写回第三方主端点时会把原主地址降级为候选端点", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-provider-endpoints-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });

  try {
    addOpenAICompatibleProvider(workingDirectory, {
      id: "gateway",
      name: "Gateway",
      baseUrl: "https://primary.example.com/v1",
      apiKey: "sk-test",
      endpointCandidates: [
        "https://candidate-a.example.com/v1",
        "https://candidate-b.example.com/v1",
      ],
    }, registry);

    const nextProvider = writeOpenAICompatibleProviderPreferredEndpoint(
      workingDirectory,
      "gateway",
      "https://candidate-b.example.com/v1",
      registry,
    );

    assert.equal(nextProvider.baseUrl, "https://candidate-b.example.com/v1");
    assert.deepEqual(nextProvider.endpointCandidates, [
      "https://primary.example.com/v1",
      "https://candidate-a.example.com/v1",
    ]);
    assert.deepEqual(buildOpenAICompatibleProviderEndpointPool(nextProvider), [
      "https://candidate-b.example.com/v1",
      "https://primary.example.com/v1",
      "https://candidate-a.example.com/v1",
    ]);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
