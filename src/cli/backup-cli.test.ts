import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const cliEntryPath = resolve(repoRoot, "src/cli/main.ts");
const tsxBinaryPath = resolve(repoRoot, "node_modules/.bin/tsx");

function createWorkspace(): string {
  const workspace = resolve(tmpdir(), `themis-backup-cli-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

function runCli(args: string[], cwd: string): {
  code: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(tsxBinaryPath, [cliEntryPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
    },
  });

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

test("themis backup create / restore 最小闭环", () => {
  const workspace = createWorkspace();
  const databaseFile = resolve(workspace, "infra/local/themis.db");
  const backupPath = resolve(workspace, "custom/themis-snapshot.db");

  try {
    const registry = new SqliteCodexSessionRegistry({ databaseFile });
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "初始负责人",
      createdAt: "2026-04-12T16:00:00.000Z",
      updatedAt: "2026-04-12T16:00:00.000Z",
    });

    const createResult = runCli(["backup", "create", "--output", backupPath], workspace);

    assert.equal(createResult.code, 0);
    assert.match(createResult.stdout, /Themis SQLite 备份已创建/);
    assert.match(createResult.stdout, /custom\/themis-snapshot\.db/);
    assert.equal(existsSync(backupPath), true);

    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "已漂移负责人",
      createdAt: "2026-04-12T16:00:00.000Z",
      updatedAt: "2026-04-12T16:01:00.000Z",
    });

    const restoreResult = runCli(["backup", "restore", "--input", backupPath, "--yes"], workspace);

    assert.equal(restoreResult.code, 0);
    assert.match(restoreResult.stdout, /Themis SQLite 已从备份恢复/);
    assert.match(restoreResult.stdout, /previousBackupPath：/);

    const restoredRegistry = new SqliteCodexSessionRegistry({ databaseFile });
    assert.equal(restoredRegistry.getPrincipal("principal-owner")?.displayName, "初始负责人");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis backup restore 缺少 --yes 会报错", () => {
  const workspace = createWorkspace();

  try {
    const result = runCli(["backup", "restore", "--input", "/tmp/themis-snapshot.db"], workspace);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /backup restore/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
