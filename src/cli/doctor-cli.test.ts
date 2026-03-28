import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const cliEntryPath = resolve(repoRoot, "src/cli/main.ts");
const tsxBinaryPath = resolve(repoRoot, "node_modules/.bin/tsx");

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

test("themis doctor context 会输出 README/AGENTS 状态", () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-"));

  try {
    mkdirSync(resolve(workspace, "memory", "project"), { recursive: true });
    mkdirSync(resolve(workspace, "memory", "architecture"), { recursive: true });
    writeFileSync(resolve(workspace, "README.md"), "# demo\n", "utf8");
    writeFileSync(resolve(workspace, "memory/project/overview.md"), "# project\n", "utf8");
    writeFileSync(resolve(workspace, "memory/architecture/overview.md"), "# architecture\n", "utf8");

    const result = runCli(["doctor", "context"], workspace);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /README\.md：ok/);
    assert.match(result.stdout, /AGENTS\.md：missing/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis doctor mcp 会输出 mcp server 摘要", () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-mcp-"));

  try {
    const result = runCli(["doctor", "mcp"], workspace);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Themis 诊断 - mcp/);
    assert.match(result.stdout, /serverCount：\d+/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function join(...parts: string[]): string {
  return resolve(...parts);
}
