import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const themisCliEntryPath = resolve(repoRoot, "src/cli/main.ts");
const platformCliEntryPath = resolve(repoRoot, "src/cli/platform-main.ts");
const workerNodeCliEntryPath = resolve(repoRoot, "src/cli/worker-node-main.ts");
const tsxBinaryPath = resolve(repoRoot, "node_modules/.bin/tsx");

function createWorkspace(prefix: string): string {
  const workspace = resolve(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

function runEntry(entryPath: string, args: string[], cwd: string): {
  code: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(tsxBinaryPath, [entryPath, ...args], {
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

test("themis-platform help 只暴露平台相关命令", () => {
  const workspace = createWorkspace("themis-platform-help");

  try {
    const result = runEntry(platformCliEntryPath, ["help"], workspace);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Themis Platform CLI/);
    assert.match(result.stdout, /auth platform list/);
    assert.match(result.stdout, /doctor worker-fleet/);
    assert.match(result.stdout, /worker-fleet <drain\|offline\|reclaim>/);
    assert.doesNotMatch(result.stdout, /auth web list/);
    assert.doesNotMatch(result.stdout, /worker-node run/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis-worker-node help 只暴露 Worker Node 相关命令", () => {
  const workspace = createWorkspace("themis-worker-node-help");

  try {
    const result = runEntry(workerNodeCliEntryPath, ["help"], workspace);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Themis Worker Node CLI/);
    assert.match(result.stdout, /doctor worker-node/);
    assert.match(result.stdout, /worker-node run/);
    assert.doesNotMatch(result.stdout, /worker-fleet/);
    assert.doesNotMatch(result.stdout, /auth platform list/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis auth platform 兼容入口会提示迁往 themis-platform", () => {
  const workspace = createWorkspace("themis-auth-platform-compat");

  try {
    const result = runEntry(themisCliEntryPath, ["auth", "platform", "list"], workspace);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Themis 平台服务令牌/);
    assert.match(result.stderr, /迁往 \.\/themis-platform/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
