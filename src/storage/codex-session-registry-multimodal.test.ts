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
      },
      createdAt: "2026-04-01T21:00:00.000Z",
    });

    const stored = registry.getTurnInput("req-multi-1");
    assert.equal(stored?.envelope.parts[1]?.type, "image");
    assert.equal(stored?.assets[0]?.assetId, "asset-image-1");
    assert.equal(stored?.compileSummary.degradationLevel, "native");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
