import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { PrincipalSkillsService } from "./principal-skills-service.js";

const PRINCIPAL_ID = "principal-local-owner";

function createService(): { service: PrincipalSkillsService; workingDirectory: string; registry: SqliteCodexSessionRegistry } {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-principal-skills-service-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });

  return {
    service: new PrincipalSkillsService({
      workingDirectory,
      registry,
    }),
    workingDirectory,
    registry,
  };
}

function createServiceWithAccounts(accountIds: string[]): {
  service: PrincipalSkillsService;
  workingDirectory: string;
  registry: SqliteCodexSessionRegistry;
} {
  const context = createService();
  const now = "2026-03-27T00:00:00.000Z";

  context.registry.savePrincipal({
    principalId: PRINCIPAL_ID,
    displayName: "Tester",
    createdAt: now,
    updatedAt: now,
  });

  for (const [index, accountId] of accountIds.entries()) {
    context.registry.saveAuthAccount({
      accountId,
      label: accountId,
      codexHome: resolve(context.workingDirectory, "infra/local/codex-auth", accountId),
      isActive: index === 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  return context;
}

function createLocalSkillFixture(input: {
  dirName: string;
  skillName: string;
  description: string;
}): string {
  const root = mkdtempSync(join(tmpdir(), "themis-local-skill-"));
  const skillDir = resolve(root, input.dirName);
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

function createSymlinkedLocalSkillFixture(input: {
  dirName: string;
  linkName: string;
  skillName: string;
  description: string;
}): { realDirectory: string; linkedDirectory: string } {
  const realDirectory = createLocalSkillFixture({
    dirName: input.dirName,
    skillName: input.skillName,
    description: input.description,
  });
  const linkedDirectory = resolve(dirname(realDirectory), input.linkName);
  symlinkSync(realDirectory, linkedDirectory, "dir");

  return {
    realDirectory,
    linkedDirectory,
  };
}

test("validateLocalSkillDirectory 会读取 SKILL.md frontmatter 并返回 canonical skill name", async () => {
  const { service, workingDirectory } = createService();
  const skillDir = createLocalSkillFixture({
    dirName: "local-dir-name",
    skillName: "canonical-skill",
    description: "demo skill",
  });

  try {
    const result = await service.validateLocalSkillDirectory(skillDir);

    assert.equal(result.sourcePath, skillDir);
    assert.equal(result.skillName, "canonical-skill");
    assert.equal(result.description, "demo skill");
    assert.equal(result.skillFilePath, resolve(skillDir, "SKILL.md"));
  } finally {
    rmSync(skillDir, { recursive: true, force: true });
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("validateLocalSkillDirectory 会拒绝 .system skill", async () => {
  const { service, workingDirectory } = createService();
  const skillDir = createLocalSkillFixture({
    dirName: "bad",
    skillName: ".system/demo",
    description: "bad",
  });

  try {
    await assert.rejects(
      () => service.validateLocalSkillDirectory(skillDir),
      /不允许接管 .*\.system/i,
    );
  } finally {
    rmSync(skillDir, { recursive: true, force: true });
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("validateLocalSkillDirectory 会拒绝来源目录本身是 symlink", async () => {
  const { service, workingDirectory } = createService();
  const skillFixture = createSymlinkedLocalSkillFixture({
    dirName: "real-demo",
    linkName: "demo-link",
    skillName: "demo-skill",
    description: "demo",
  });

  try {
    await assert.rejects(
      () => service.validateLocalSkillDirectory(skillFixture.linkedDirectory),
      /技能来源目录不能是 symlink/i,
    );
  } finally {
    rmSync(skillFixture.linkedDirectory, { force: true });
    rmSync(skillFixture.realDirectory, { recursive: true, force: true });
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("installFromLocalPath 会写入 principal 受管目录并给全部账号创建 symlink", async () => {
  const { service, registry, workingDirectory } = createServiceWithAccounts(["default", "backup"]);
  const skillDir = createLocalSkillFixture({
    dirName: "demo",
    skillName: "demo-skill",
    description: "demo",
  });

  try {
    const result = await service.installFromLocalPath({
      principalId: PRINCIPAL_ID,
      absolutePath: skillDir,
    });

    assert.equal(result.skill.skillName, "demo-skill");
    assert.equal(result.skill.installStatus, "ready");
    assert.equal(result.summary.totalAccounts, 2);
    assert.equal(result.summary.syncedCount, 2);
    assert.equal(registry.listPrincipalSkills(PRINCIPAL_ID).length, 1);
    assert.equal(
      lstatSync(resolve(workingDirectory, "infra/local/codex-auth/default/skills/demo-skill")).isSymbolicLink(),
      true,
    );
    assert.equal(
      lstatSync(resolve(workingDirectory, "infra/local/codex-auth/backup/skills/demo-skill")).isSymbolicLink(),
      true,
    );
  } finally {
    rmSync(skillDir, { recursive: true, force: true });
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("syncAllSkillsToAuthAccount 会把已安装 skill 补同步到新账号槽位", async () => {
  const { service, registry, workingDirectory } = createServiceWithAccounts(["default"]);
  const skillDir = createLocalSkillFixture({
    dirName: "demo",
    skillName: "demo-skill",
    description: "demo",
  });

  try {
    await service.installFromLocalPath({
      principalId: PRINCIPAL_ID,
      absolutePath: skillDir,
    });

    registry.saveAuthAccount({
      accountId: "backup",
      label: "backup",
      codexHome: resolve(workingDirectory, "infra/local/codex-auth", "backup"),
      isActive: false,
      createdAt: "2026-03-27T00:00:00.000Z",
      updatedAt: "2026-03-27T00:00:00.000Z",
    });

    await service.syncAllSkillsToAuthAccount(PRINCIPAL_ID, "backup");

    assert.equal(
      lstatSync(resolve(workingDirectory, "infra/local/codex-auth/backup/skills/demo-skill")).isSymbolicLink(),
      true,
    );
  } finally {
    rmSync(skillDir, { recursive: true, force: true });
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("syncAllSkillsToAuthAccount 不会把单账号补同步结果误写成全局 ready", async () => {
  const { service, registry, workingDirectory } = createServiceWithAccounts(["default", "backup"]);
  const conflictPath = resolve(workingDirectory, "infra/local/codex-auth/backup/skills/demo-skill");
  const skillDir = createLocalSkillFixture({
    dirName: "demo",
    skillName: "demo-skill",
    description: "demo",
  });

  mkdirSync(dirname(conflictPath), { recursive: true });
  writeFileSync(conflictPath, "conflict\n", "utf8");

  try {
    const installed = await service.installFromLocalPath({
      principalId: PRINCIPAL_ID,
      absolutePath: skillDir,
    });

    assert.equal(installed.skill.installStatus, "partially_synced");

    await service.syncAllSkillsToAuthAccount(PRINCIPAL_ID, "default");

    assert.equal(
      registry.getPrincipalSkill(PRINCIPAL_ID, "demo-skill")?.installStatus,
      "partially_synced",
    );
  } finally {
    rmSync(skillDir, { recursive: true, force: true });
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("syncSkillToAuthAccount 会把 symlink 指向 principal 受管目录", async () => {
  const { service, workingDirectory } = createServiceWithAccounts(["default"]);
  const skillDir = createLocalSkillFixture({
    dirName: "demo",
    skillName: "demo-skill",
    description: "demo",
  });

  try {
    await service.installFromLocalPath({
      principalId: PRINCIPAL_ID,
      absolutePath: skillDir,
    });

    const linkPath = resolve(workingDirectory, "infra/local/codex-auth/default/skills/demo-skill");
    assert.equal(
      readlinkSync(linkPath),
      resolve(workingDirectory, "infra/local/principals/principal-local-owner/skills/demo-skill"),
    );
  } finally {
    rmSync(skillDir, { recursive: true, force: true });
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("installFromLocalPath 只会同步到受管认证账号槽位，不会接管外部 CODEX_HOME", async () => {
  const { service, registry, workingDirectory } = createServiceWithAccounts(["default"]);
  const externalRoot = mkdtempSync(join(tmpdir(), "themis-external-codex-home-"));
  const externalCodexHome = resolve(externalRoot, ".codex-external");
  const externalSkillPath = resolve(externalCodexHome, "skills", "demo-skill");
  const skillDir = createLocalSkillFixture({
    dirName: "demo",
    skillName: "demo-skill",
    description: "demo",
  });

  registry.saveAuthAccount({
    accountId: "external",
    label: "external",
    codexHome: externalCodexHome,
    isActive: false,
    createdAt: "2026-03-27T00:00:00.000Z",
    updatedAt: "2026-03-27T00:00:00.000Z",
  });

  try {
    const result = await service.installFromLocalPath({
      principalId: PRINCIPAL_ID,
      absolutePath: skillDir,
    });

    assert.equal(result.summary.totalAccounts, 1);
    assert.equal(result.summary.syncedCount, 1);
    assert.equal(
      registry.listPrincipalSkillMaterializations(PRINCIPAL_ID, "demo-skill").some((record) => record.targetId === "external"),
      false,
    );
    assert.equal(existsSync(externalSkillPath), false);
  } finally {
    rmSync(skillDir, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
