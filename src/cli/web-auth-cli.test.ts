import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const cliEntryPath = resolve(repoRoot, "src/cli/main.ts");
const tsxBinaryPath = resolve(repoRoot, "node_modules/.bin/tsx");

function createWorkspace(): string {
  const workspace = resolve(tmpdir(), `themis-web-auth-cli-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

function runCli(args: string[], cwd: string, input?: string): {
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
    input,
  });

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

test("themis auth web 最小闭环", () => {
  const workspace = createWorkspace();
  const dbPath = resolve(workspace, "infra/local/themis.db");

  try {
    const addResult = runCli(
      ["auth", "web", "add", "alpha"],
      workspace,
      "alpha-secret\nalpha-secret\n",
    );

    assert.equal(addResult.code, 0);
    assert.match(addResult.stdout, /alpha/);
    assert.match(addResult.stdout, /已添加|新增/);
    assert.equal(existsSync(dbPath), true);

    const listResult = runCli(["auth", "web", "list"], workspace);

    assert.equal(listResult.code, 0);
    assert.match(listResult.stdout, /alpha/);
    assert.match(listResult.stdout, /状态：active/);
    assert.match(listResult.stdout, /最近使用/);

    const renameResult = runCli(["auth", "web", "rename", "alpha", "beta"], workspace);

    assert.equal(renameResult.code, 0);
    assert.match(renameResult.stdout, /beta/);

    const renamedListResult = runCli(["auth", "web", "list"], workspace);

    assert.equal(renamedListResult.code, 0);
    assert.match(renamedListResult.stdout, /beta/);
    assert.match(renamedListResult.stdout, /状态：active/);

    const removeResult = runCli(["auth", "web", "remove", "beta"], workspace);

    assert.equal(removeResult.code, 0);
    assert.match(removeResult.stdout, /beta/);
    assert.match(removeResult.stdout, /已移除|已撤销|已删除/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
