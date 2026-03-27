import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const cliEntryPath = resolve(repoRoot, "src/cli/main.ts");
const tsxBinaryPath = resolve(repoRoot, "node_modules/.bin/tsx");
const cliPrincipalId = "principal-local-owner";

function createWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "themis-skill-cli-workspace-"));
}

function runCli(args: string[], cwd: string): {
  code: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(
    tsxBinaryPath,
    [cliEntryPath, ...args],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        FORCE_COLOR: "0",
      },
    },
  );

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function createLocalSkillFixture(input: {
  skillName: string;
  description: string;
}): string {
  const root = mkdtempSync(join(tmpdir(), "themis-skill-cli-fixture-"));
  const skillDir = resolve(root, input.skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    resolve(skillDir, "SKILL.md"),
    [
      "---",
      `name: ${input.skillName}`,
      `description: ${input.description}`,
      "---",
      "",
      "# Demo",
      "",
    ].join("\n"),
    "utf8",
  );
  return skillDir;
}

test("themis skill list 会输出当前 principal 的 skills", () => {
  const workspace = createWorkspace();

  try {
    const result = runCli(["skill", "list"], workspace);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /当前 principal：principal-local-owner/);
    assert.match(result.stdout, /暂无已安装 skill/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis skill list 遇到额外参数会报错并非 0 退出", () => {
  const workspace = createWorkspace();
  const dbPath = resolve(workspace, "infra/local/themis.db");

  try {
    const result = runCli(["skill", "list", "extra"], workspace);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /用法：themis skill list/);
    assert.equal(existsSync(dbPath), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis skill install local 会校验绝对路径并避免落库", () => {
  const workspace = createWorkspace();
  const dbPath = resolve(workspace, "infra/local/themis.db");

  try {
    const result = runCli(["skill", "install", "local", "relative/path"], workspace);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /绝对路径/);
    assert.equal(existsSync(dbPath), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("无效 skill 子命令会非 0 退出且不创建本地数据库", () => {
  const workspace = createWorkspace();
  const dbPath = resolve(workspace, "infra/local/themis.db");

  try {
    const result = runCli(["skill", "nope"], workspace);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /skill 子命令仅支持 list \/ curated \/ install \/ remove \/ sync/);
    assert.equal(existsSync(dbPath), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis skill sync <name> --force 会正确解析 flag", () => {
  const workspace = createWorkspace();
  const dbPath = resolve(workspace, "infra/local/themis.db");
  const managedPath = resolve(workspace, "infra/local/principals", cliPrincipalId, "skills", "demo-skill");
  const registry = new SqliteCodexSessionRegistry({ databaseFile: dbPath });
  const now = "2026-03-27T00:00:00.000Z";

  try {
    mkdirSync(managedPath, { recursive: true });
    registry.savePrincipal({
      principalId: cliPrincipalId,
      createdAt: now,
      updatedAt: now,
    });
    registry.savePrincipalSkill({
      principalId: cliPrincipalId,
      skillName: "demo-skill",
      description: "demo skill",
      sourceType: "local-path",
      sourceRefJson: JSON.stringify({ absolutePath: "/tmp/demo-skill" }),
      managedPath,
      installStatus: "ready",
      createdAt: now,
      updatedAt: now,
    });

    const result = runCli(["skill", "sync", "demo-skill", "--force"], workspace);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /已重同步 skill：demo-skill/);
    assert.match(result.stdout, /同步结果：0\/0 成功/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis skill install local <absolute-path> 能走通最小安装路径", () => {
  const workspace = createWorkspace();
  const skillDir = createLocalSkillFixture({
    skillName: "demo-skill",
    description: "demo skill",
  });

  try {
    const result = runCli(["skill", "install", "local", skillDir], workspace);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /已安装 skill：demo-skill/);
    assert.match(result.stdout, /来源：本地目录/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(resolve(skillDir, ".."), { recursive: true, force: true });
  }
});

test("themis skill list 会输出每个 skill 的账号槽位同步摘要", () => {
  const workspace = createWorkspace();
  const dbPath = resolve(workspace, "infra/local/themis.db");
  const registry = new SqliteCodexSessionRegistry({ databaseFile: dbPath });
  const now = "2026-03-27T00:00:00.000Z";
  const managedPath = resolve(workspace, "infra/local/principals", cliPrincipalId, "skills", "demo-skill");

  try {
    mkdirSync(managedPath, { recursive: true });
    registry.savePrincipal({
      principalId: cliPrincipalId,
      createdAt: now,
      updatedAt: now,
    });
    registry.saveAuthAccount({
      accountId: "default",
      label: "default",
      codexHome: resolve(workspace, "infra/local/codex-auth/default"),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    registry.saveAuthAccount({
      accountId: "backup",
      label: "backup",
      codexHome: resolve(workspace, "infra/local/codex-auth/backup"),
      isActive: false,
      createdAt: now,
      updatedAt: now,
    });
    registry.savePrincipalSkill({
      principalId: cliPrincipalId,
      skillName: "demo-skill",
      description: "demo skill",
      sourceType: "local-path",
      sourceRefJson: JSON.stringify({ absolutePath: "/tmp/demo-skill" }),
      managedPath,
      installStatus: "partially_synced",
      createdAt: now,
      updatedAt: now,
    });
    registry.savePrincipalSkillMaterialization({
      principalId: cliPrincipalId,
      skillName: "demo-skill",
      targetKind: "auth-account",
      targetId: "default",
      targetPath: resolve(workspace, "infra/local/codex-auth/default/skills/demo-skill"),
      state: "synced",
      lastSyncedAt: now,
    });
    registry.savePrincipalSkillMaterialization({
      principalId: cliPrincipalId,
      skillName: "demo-skill",
      targetKind: "auth-account",
      targetId: "backup",
      targetPath: resolve(workspace, "infra/local/codex-auth/backup/skills/demo-skill"),
      state: "failed",
      lastError: "backup failed",
    });

    const result = runCli(["skill", "list"], workspace);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /已同步：1\/2/);
    assert.match(result.stdout, /冲突 0，失败 1/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
