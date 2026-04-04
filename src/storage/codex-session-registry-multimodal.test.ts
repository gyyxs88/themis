import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "./codex-session-registry.js";

test("SqliteCodexSessionRegistry 会保存 turn input envelope 与 compile summary", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-registry-multimodal-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

  try {
    upsertParentTurn(registry, "req-multi-1");

    registry.saveTurnInput({
      requestId: "req-multi-1",
      envelope: {
        envelopeId: "env-1",
        sourceChannel: "web",
        parts: [
          {
            partId: "part-1",
            type: "text",
            role: "user",
            order: 1,
            text: "请看这张图",
          },
          {
            partId: "part-2",
            type: "image",
            role: "user",
            order: 2,
            assetId: "asset-image-1",
          },
        ],
        assets: [
          {
            assetId: "asset-image-1",
            kind: "image",
            mimeType: "image/png",
            localPath: "/workspace/temp/input-assets/shot.png",
            sourceChannel: "web",
            ingestionStatus: "ready",
          },
        ],
        createdAt: "2026-04-01T21:00:00.000Z",
      },
      compileSummary: {
        runtimeTarget: "app-server",
        degradationLevel: "native",
        warnings: [],
        capabilityMatrix: {
          modelCapabilities: {
            nativeTextInput: true,
            nativeImageInput: true,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
          },
          transportCapabilities: {
            nativeTextInput: true,
            nativeImageInput: true,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
          },
          effectiveCapabilities: {
            nativeTextInput: true,
            nativeImageInput: true,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
          },
          assetFacts: [
            {
              assetId: "asset-image-1",
              kind: "image",
              mimeType: "image/png",
              localPathStatus: "ready",
              modelNativeSupport: true,
              transportNativeSupport: true,
              effectiveNativeSupport: true,
              modelMimeTypeSupported: null,
              transportMimeTypeSupported: null,
              effectiveMimeTypeSupported: null,
              handling: "native",
            },
          ],
        },
      },
      createdAt: "2026-04-01T21:00:00.000Z",
    });

    const stored = registry.getTurnInput("req-multi-1");
    assert.equal(stored?.envelope.parts[1]?.type, "image");
    assert.equal(stored?.assets[0]?.assetId, "asset-image-1");
    assert.equal(stored?.compileSummary?.degradationLevel, "native");
    assert.equal(stored?.compileSummary?.capabilityMatrix?.assetFacts[0]?.handling, "native");
    assert.equal(stored?.compileSummary?.capabilityMatrix?.effectiveCapabilities.nativeImageInput, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SqliteCodexSessionRegistry 在 parent turn 不存在时拒绝写入 turn input", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-registry-multimodal-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

  try {
    assert.throws(() => registry.saveTurnInput({
      requestId: "req-orphan-turn-input",
      envelope: {
        envelopeId: "env-orphan",
        sourceChannel: "web",
        parts: [
          {
            partId: "part-orphan-1",
            type: "text",
            role: "user",
            order: 1,
            text: "孤儿输入",
          },
        ],
        assets: [],
        createdAt: "2026-04-01T21:05:00.000Z",
      },
      createdAt: "2026-04-01T21:05:00.000Z",
    }), /parent turn/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SqliteCodexSessionRegistry round-trip 会保留 text 与 caption 的前后空白", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-registry-multimodal-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

  try {
    upsertParentTurn(registry, "req-multi-whitespace");

    registry.saveTurnInput({
      requestId: "req-multi-whitespace",
      envelope: {
        envelopeId: "env-whitespace",
        sourceChannel: "web",
        parts: [
          {
            partId: "part-whitespace-1",
            type: "text",
            role: "user",
            order: 1,
            text: "  请保留前后空白  ",
          },
          {
            partId: "part-whitespace-2",
            type: "image",
            role: "user",
            order: 2,
            assetId: "asset-image-whitespace",
            caption: "  这是图片说明  ",
          },
        ],
        assets: [
          {
            assetId: "asset-image-whitespace",
            kind: "image",
            mimeType: "image/png",
            localPath: "/workspace/temp/input-assets/whitespace.png",
            sourceChannel: "web",
            ingestionStatus: "ready",
          },
        ],
        createdAt: "2026-04-01T21:10:00.000Z",
      },
      createdAt: "2026-04-01T21:10:00.000Z",
    });

    const stored = registry.getTurnInput("req-multi-whitespace");
    assert.equal(stored?.envelope.parts[0]?.type, "text");
    assert.equal(stored?.envelope.parts[0]?.type === "text" ? stored.envelope.parts[0].text : null, "  请保留前后空白  ");
    assert.equal(stored?.envelope.parts[1]?.type, "image");
    assert.equal(stored?.envelope.parts[1]?.type === "image" ? stored.envelope.parts[1].caption : null, "  这是图片说明  ");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SqliteCodexSessionRegistry 在 compile summary 缺失时不会伪造默认值", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-registry-multimodal-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

  try {
    upsertParentTurn(registry, "req-multi-no-compile-summary");

    registry.saveTurnInput({
      requestId: "req-multi-no-compile-summary",
      envelope: {
        envelopeId: "env-no-compile-summary",
        sourceChannel: "web",
        parts: [
          {
            partId: "part-no-compile-summary-1",
            type: "text",
            role: "user",
            order: 1,
            text: "无编译摘要",
          },
        ],
        assets: [],
        createdAt: "2026-04-01T21:15:00.000Z",
      },
      createdAt: "2026-04-01T21:15:00.000Z",
    });

    const stored = registry.getTurnInput("req-multi-no-compile-summary");
    assert.equal(stored?.compileSummary ?? null, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function upsertParentTurn(registry: SqliteCodexSessionRegistry, requestId: string): void {
  registry.upsertTurnFromRequest({
    requestId,
    sourceChannel: "web",
    channelContext: {
      sessionId: "session-registry-multimodal",
    },
    user: {
      userId: "user-registry-multimodal",
    },
    goal: "测试 turn input 持久化",
    createdAt: "2026-04-01T21:00:00.000Z",
  }, `task-${requestId}`);
}
