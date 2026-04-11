import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  normalizePrincipalMcpAuthState,
  normalizePrincipalMcpMaterializationState,
  normalizePrincipalMcpServerName,
  normalizePrincipalMcpServerRecordInput,
} from "./principal-mcp.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

test("normalizePrincipalMcpServerName 只接受安全名称", () => {
  assert.equal(normalizePrincipalMcpServerName("github"), "github");
  assert.equal(normalizePrincipalMcpServerName("demo_server-2"), "demo_server-2");
  assert.equal(normalizePrincipalMcpServerName("bad.name"), null);
  assert.equal(normalizePrincipalMcpServerName(""), null);
});

test("normalizePrincipalMcpMaterializationState 和 authState 只接受允许值", () => {
  assert.equal(normalizePrincipalMcpMaterializationState("synced"), "synced");
  assert.equal(normalizePrincipalMcpMaterializationState("broken"), null);
  assert.equal(normalizePrincipalMcpAuthState("auth_required"), "auth_required");
  assert.equal(normalizePrincipalMcpAuthState("bad"), null);
});

test("normalizePrincipalMcpServerRecordInput 会清理空白并保留合法字段", () => {
  const result = normalizePrincipalMcpServerRecordInput({
    principalId: " principal-local-owner ",
    serverName: " demo_server ",
    transportType: "stdio",
    command: " npx ",
    argsJson: " [\"-y\"] ",
    envJson: " {} ",
    cwd: " /srv/demo ",
    enabled: true,
    sourceType: "manual",
    createdAt: " 2026-04-11T00:00:00.000Z ",
    updatedAt: " 2026-04-11T00:00:00.000Z ",
  });

  assert.deepEqual(result, {
    principalId: "principal-local-owner",
    serverName: "demo_server",
    transportType: "stdio",
    command: "npx",
    argsJson: "[\"-y\"]",
    envJson: "{}",
    cwd: "/srv/demo",
    enabled: true,
    sourceType: "manual",
    createdAt: "2026-04-11T00:00:00.000Z",
    updatedAt: "2026-04-11T00:00:00.000Z",
  });
});

test("registry 可以按 principal 读写 MCP 主记录和物化状态", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-principal-mcp-"));

  try {
    const registry = new SqliteCodexSessionRegistry({
      databaseFile: join(workingDirectory, "infra/local/themis.db"),
    });

    registry.savePrincipal({
      principalId: "principal-local-owner",
      displayName: "Tester",
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });

    registry.savePrincipalMcpServer({
      principalId: "principal-local-owner",
      serverName: "github",
      transportType: "stdio",
      command: "npx",
      argsJson: JSON.stringify(["-y", "@modelcontextprotocol/server-github"]),
      envJson: JSON.stringify({ GITHUB_TOKEN: "secret" }),
      cwd: "/srv/mcp",
      enabled: true,
      sourceType: "manual",
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });

    registry.savePrincipalMcpMaterialization({
      principalId: "principal-local-owner",
      serverName: "github",
      targetKind: "auth-account",
      targetId: "default",
      state: "synced",
      authState: "authenticated",
      lastSyncedAt: "2026-04-11T00:00:01.000Z",
    });

    assert.equal(registry.listPrincipalMcpServers("principal-local-owner").length, 1);
    assert.equal(
      registry.getPrincipalMcpServer("principal-local-owner", "github")?.command,
      "npx",
    );
    assert.equal(
      registry.listPrincipalMcpMaterializations("principal-local-owner", "github")[0]?.authState,
      "authenticated",
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("resetPrincipalState 会清理 principal MCP 主记录和物化状态", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-principal-mcp-reset-"));

  try {
    const registry = new SqliteCodexSessionRegistry({
      databaseFile: join(workingDirectory, "infra/local/themis.db"),
    });

    registry.savePrincipal({
      principalId: "principal-local-owner",
      displayName: "Tester",
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });

    registry.savePrincipalMcpServer({
      principalId: "principal-local-owner",
      serverName: "github",
      transportType: "stdio",
      command: "npx",
      argsJson: JSON.stringify(["-y"]),
      envJson: JSON.stringify({}),
      enabled: true,
      sourceType: "manual",
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });

    registry.savePrincipalMcpMaterialization({
      principalId: "principal-local-owner",
      serverName: "github",
      targetKind: "auth-account",
      targetId: "default",
      state: "synced",
      authState: "authenticated",
      lastSyncedAt: "2026-04-11T00:00:01.000Z",
    });

    registry.resetPrincipalState("principal-local-owner", "2026-04-11T00:00:02.000Z");

    assert.equal(registry.listPrincipalMcpServers("principal-local-owner").length, 0);
    assert.equal(registry.listPrincipalMcpMaterializations("principal-local-owner").length, 0);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("mergePrincipals 会把 source principal 的 MCP 复制到 target principal，并保留 target 冲突项", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-principal-mcp-merge-"));

  try {
    const registry = new SqliteCodexSessionRegistry({
      databaseFile: join(workingDirectory, "infra/local/themis.db"),
    });

    registry.savePrincipal({
      principalId: "principal-source",
      displayName: "Source",
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });
    registry.savePrincipal({
      principalId: "principal-target",
      displayName: "Target",
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });

    registry.savePrincipalMcpServer({
      principalId: "principal-source",
      serverName: "github",
      transportType: "stdio",
      command: "npx",
      argsJson: JSON.stringify(["-y", "@modelcontextprotocol/server-github"]),
      envJson: JSON.stringify({}),
      enabled: true,
      sourceType: "manual",
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });

    registry.savePrincipalMcpMaterialization({
      principalId: "principal-source",
      serverName: "github",
      targetKind: "auth-account",
      targetId: "default",
      state: "synced",
      authState: "authenticated",
      lastSyncedAt: "2026-04-11T00:00:01.000Z",
    });

    registry.savePrincipalMcpServer({
      principalId: "principal-target",
      serverName: "shared",
      transportType: "stdio",
      command: "uvx",
      argsJson: JSON.stringify(["demo"]),
      envJson: JSON.stringify({}),
      enabled: true,
      sourceType: "manual",
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });

    registry.savePrincipalMcpServer({
      principalId: "principal-source",
      serverName: "shared",
      transportType: "stdio",
      command: "npx",
      argsJson: JSON.stringify(["source"]),
      envJson: JSON.stringify({}),
      enabled: true,
      sourceType: "manual",
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });

    registry.mergePrincipals("principal-source", "principal-target", "2026-04-11T00:00:02.000Z");

    assert.equal(registry.getPrincipalMcpServer("principal-target", "github")?.command, "npx");
    assert.equal(registry.getPrincipalMcpServer("principal-target", "shared")?.command, "uvx");
    assert.equal(
      registry.listPrincipalMcpMaterializations("principal-target", "github")[0]?.targetId,
      "default",
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
