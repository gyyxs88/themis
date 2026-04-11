import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  normalizePrincipalPluginMaterializationState,
  normalizePrincipalPluginRecordInput,
  normalizePrincipalPluginSourceType,
  parseStoredPrincipalPluginInterface,
} from "./principal-plugins.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

test("normalizePrincipalPluginSourceType 和 materialization state 只接受允许值", () => {
  assert.equal(normalizePrincipalPluginSourceType("repo-local"), "repo-local");
  assert.equal(normalizePrincipalPluginSourceType("bad"), null);
  assert.equal(normalizePrincipalPluginMaterializationState("installed"), "installed");
  assert.equal(normalizePrincipalPluginMaterializationState("bad"), null);
});

test("normalizePrincipalPluginRecordInput 会清理空白并保留合法字段", () => {
  const result = normalizePrincipalPluginRecordInput({
    principalId: " principal-owner ",
    pluginId: " github@openai-curated ",
    pluginName: " github ",
    marketplaceName: " OpenAI Curated ",
    marketplacePath: " /tmp/openai-curated/marketplace.json ",
    sourceType: "marketplace",
    sourceRefJson: "{\"pluginId\":\"github@openai-curated\"}",
    sourcePath: " /tmp/plugins/github ",
    interfaceJson: "{\"displayName\":\"GitHub\"}",
    installPolicy: "AVAILABLE",
    authPolicy: "ON_INSTALL",
    enabled: true,
    createdAt: "2026-04-11T00:00:00.000Z",
    updatedAt: "2026-04-11T00:00:00.000Z",
  });

  assert.equal(result.principalId, "principal-owner");
  assert.equal(result.pluginId, "github@openai-curated");
  assert.equal(result.pluginName, "github");
  assert.equal(result.sourceType, "marketplace");
  assert.equal(parseStoredPrincipalPluginInterface(result.interfaceJson ?? "")?.displayName, "GitHub");
});

test("registry 支持保存和读取 principal plugins 与 materializations", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-principal-plugins-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });
    registry.savePrincipalPlugin({
      principalId: "principal-owner",
      pluginId: "github@openai-curated",
      pluginName: "github",
      marketplaceName: "openai-curated",
      marketplacePath: "/tmp/openai-curated/marketplace.json",
      sourceType: "marketplace",
      sourceRefJson: "{\"pluginId\":\"github@openai-curated\"}",
      interfaceJson: "{\"displayName\":\"GitHub\"}",
      installPolicy: "AVAILABLE",
      authPolicy: "ON_INSTALL",
      enabled: true,
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });
    registry.savePrincipalPluginMaterialization({
      principalId: "principal-owner",
      pluginId: "github@openai-curated",
      targetKind: "auth-account",
      targetId: "default",
      workspaceFingerprint: "/srv/repos/demo",
      state: "installed",
      lastSyncedAt: "2026-04-11T00:00:00.000Z",
    });

    assert.equal(registry.listPrincipalPlugins("principal-owner").length, 1);
    assert.equal(registry.getPrincipalPlugin("principal-owner", "github@openai-curated")?.pluginName, "github");
    assert.equal(
      registry.listPrincipalPluginMaterializations("principal-owner", "github@openai-curated")[0]?.workspaceFingerprint,
      "/srv/repos/demo",
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
