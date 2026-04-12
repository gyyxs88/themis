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

test("themis auth web add 两次输入不一致会报错", () => {
  const workspace = createWorkspace();

  try {
    const result = runCli(["auth", "web", "add", "alpha"], workspace, "alpha-secret\nbeta-secret\n");

    assert.equal(result.code, 1);
    assert.match(result.stderr, /两次输入的口令不一致/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis auth web add 额外第三行非空内容会报错", () => {
  const workspace = createWorkspace();

  try {
    const result = runCli(
      ["auth", "web", "add", "alpha"],
      workspace,
      "alpha-secret\nalpha-secret\nextra-secret\n",
    );

    assert.equal(result.code, 1);
    assert.match(result.stderr, /额外|多余|stdin/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis auth platform 最小闭环，并与 auth web list 隔离", () => {
  const workspace = createWorkspace();
  const dbPath = resolve(workspace, "infra/local/themis.db");

  try {
    const addResult = runCli(
      ["auth", "platform", "add", "gateway-alpha", "--role", "gateway", "--owner-principal", "principal-owner"],
      workspace,
      "platform-secret\nplatform-secret\n",
    );

    assert.equal(addResult.code, 0);
    assert.match(addResult.stdout, /gateway-alpha/);
    assert.match(addResult.stdout, /role：gateway/);
    assert.match(addResult.stdout, /ownerPrincipalId：principal-owner/);
    assert.equal(existsSync(dbPath), true);

    const listResult = runCli(["auth", "platform", "list"], workspace);

    assert.equal(listResult.code, 0);
    assert.match(listResult.stdout, /gateway-alpha/);
    assert.match(listResult.stdout, /状态：active/);
    assert.match(listResult.stdout, /role：gateway/);
    assert.match(listResult.stdout, /ownerPrincipalId：principal-owner/);

    const webListResult = runCli(["auth", "web", "list"], workspace);

    assert.equal(webListResult.code, 0);
    assert.match(webListResult.stdout, /暂无 Web 访问口令/);

    const renameResult = runCli(["auth", "platform", "rename", "gateway-alpha", "gateway-beta"], workspace);

    assert.equal(renameResult.code, 0);
    assert.match(renameResult.stdout, /gateway-beta/);
    assert.match(renameResult.stdout, /role：gateway/);

    const renamedListResult = runCli(["auth", "platform", "list"], workspace);

    assert.equal(renamedListResult.code, 0);
    assert.match(renamedListResult.stdout, /gateway-beta/);
    assert.doesNotMatch(renamedListResult.stdout, /gateway-alpha/);

    const removeResult = runCli(["auth", "platform", "remove", "gateway-beta"], workspace);

    assert.equal(removeResult.code, 0);
    assert.match(removeResult.stdout, /gateway-beta/);
    assert.match(removeResult.stdout, /role：gateway/);
    assert.match(removeResult.stdout, /状态：revoked/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis auth platform add 缺少 role 或 ownerPrincipalId 会报错", () => {
  const workspace = createWorkspace();

  try {
    const missingRole = runCli(
      ["auth", "platform", "add", "gateway-alpha", "--owner-principal", "principal-owner"],
      workspace,
      "platform-secret\nplatform-secret\n",
    );

    assert.equal(missingRole.code, 1);
    assert.match(missingRole.stderr, /auth platform add/);

    const missingOwner = runCli(
      ["auth", "platform", "add", "gateway-alpha", "--role", "gateway"],
      workspace,
      "platform-secret\nplatform-secret\n",
    );

    assert.equal(missingOwner.code, 1);
    assert.match(missingOwner.stderr, /auth platform add/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
