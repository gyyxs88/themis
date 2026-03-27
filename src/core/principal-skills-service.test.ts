import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { PrincipalSkillsService } from "./principal-skills-service.js";

const PRINCIPAL_ID = "principal-local-owner";
const requireFromHere = createRequire(import.meta.url);
type ScriptExec = (
  command: string[],
  options?: { cwd?: string; env?: Record<string, string> },
) => Promise<string>;

function createService(options: { execScript?: ScriptExec } = {}): {
  service: PrincipalSkillsService;
  workingDirectory: string;
  registry: SqliteCodexSessionRegistry;
} {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-principal-skills-service-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });

  return {
    service: new PrincipalSkillsService({
      workingDirectory,
      registry,
      ...(options.execScript ? { execScript: options.execScript } : {}),
    }),
    workingDirectory,
    registry,
  };
}

function createServiceWithAccounts(
  accountIds: string[],
  options: { execScript?: ScriptExec } = {},
): {
  service: PrincipalSkillsService;
  workingDirectory: string;
  registry: SqliteCodexSessionRegistry;
} {
  const context = createService(options);
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

function resolveInstallerDest(command: string[]): string {
  const destIndex = command.indexOf("--dest");

  if (destIndex === -1 || !command[destIndex + 1]) {
    throw new Error(`installer command missing --dest: ${command.join(" ")}`);
  }

  return command[destIndex + 1]!;
}

function writeInstalledSkillFromCommand(
  command: string[],
  input: { directoryName: string; skillName: string; description: string },
): void {
  const destRoot = resolveInstallerDest(command);
  const skillDir = resolve(destRoot, input.directoryName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    resolve(skillDir, "SKILL.md"),
    [
      "---",
      `name: ${input.skillName}`,
      `description: ${input.description}`,
      "---",
      "",
      "# Installed",
      "",
    ].join("\n"),
    "utf8",
  );
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

test("listCuratedSkills 会按 principal 已安装记录计算 installed", async () => {
  const { service, registry, workingDirectory } = createService({
    execScript: async (command, options) => {
      assert.match(command.join(" "), /list-skills\.py/);
      assert.equal(command.includes("--format"), true);
      assert.equal(command.includes("json"), true);
      assert.equal(typeof options?.env?.CODEX_HOME, "string");
      return JSON.stringify([
        { name: "python-setup", installed: false },
        { name: "shell-setup", installed: true },
      ]);
    },
  });
  const now = "2026-03-27T00:00:00.000Z";

  try {
    registry.savePrincipal({
      principalId: PRINCIPAL_ID,
      displayName: "Tester",
      createdAt: now,
      updatedAt: now,
    });
    registry.savePrincipalSkill({
      principalId: PRINCIPAL_ID,
      skillName: "python-setup",
      description: "installed by principal",
      sourceType: "curated",
      sourceRefJson: JSON.stringify({ repo: "openai/skills", path: "skills/.curated/python-setup" }),
      managedPath: resolve(workingDirectory, "infra/local/principals", PRINCIPAL_ID, "skills", "python-setup"),
      installStatus: "ready",
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.listCuratedSkills(PRINCIPAL_ID);

    assert.deepEqual(result, [
      { name: "python-setup", installed: true },
      { name: "shell-setup", installed: false },
    ]);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("installFromCurated 会调用 install-skill-from-github.py 安装到 staging 再转成 principal 受管 skill", async () => {
  const { service, workingDirectory } = createServiceWithAccounts(["default"], {
    execScript: async (command) => {
      assert.match(command.join(" "), /install-skill-from-github\.py/);
      assert.equal(command.includes("--repo"), true);
      assert.equal(command.includes("openai/skills"), true);
      assert.equal(command.includes("--path"), true);
      assert.equal(command.includes("skills/.curated/python-setup"), true);
      writeInstalledSkillFromCommand(command, {
        directoryName: "python-setup",
        skillName: "python-setup",
        description: "python curated skill",
      });
      return "";
    },
  });

  try {
    const result = await service.installFromCurated({
      principalId: PRINCIPAL_ID,
      skillName: "python-setup",
    });

    assert.equal(result.skill.skillName, "python-setup");
    assert.equal(result.skill.sourceType, "curated");
    assert.equal(
      result.skill.sourceRefJson,
      JSON.stringify({ repo: "openai/skills", path: "skills/.curated/python-setup" }),
    );
    assert.equal(result.summary.syncedCount, 1);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("installFromGithub 会支持 repo/path 安装并记录来源", async () => {
  const { service, workingDirectory } = createServiceWithAccounts(["default"], {
    execScript: async (command) => {
      assert.match(command.join(" "), /install-skill-from-github\.py/);
      assert.equal(command.includes("--repo"), true);
      assert.equal(command.includes("demo/repo"), true);
      assert.equal(command.includes("--path"), true);
      assert.equal(command.includes("skills/github-demo"), true);
      assert.equal(command.includes("--ref"), true);
      assert.equal(command.includes("feature-branch"), true);
      writeInstalledSkillFromCommand(command, {
        directoryName: "github-demo",
        skillName: "github-demo",
        description: "github repo skill",
      });
      return "";
    },
  });

  try {
    const result = await service.installFromGithub({
      principalId: PRINCIPAL_ID,
      repo: "demo/repo",
      path: "skills/github-demo",
      ref: "feature-branch",
    });

    assert.equal(result.skill.skillName, "github-demo");
    assert.equal(result.skill.sourceType, "github-repo-path");
    assert.equal(
      result.skill.sourceRefJson,
      JSON.stringify({ repo: "demo/repo", path: "skills/github-demo", ref: "feature-branch" }),
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("installFromGithub 在 URL 已显式带 ref 时会拒绝额外传 ref", async () => {
  const { service, workingDirectory } = createServiceWithAccounts(["default"], {
    execScript: async () => {
      throw new Error("不应调用 installer 脚本");
    },
  });

  try {
    await assert.rejects(
      () => service.installFromGithub({
        principalId: PRINCIPAL_ID,
        url: "https://github.com/demo/repo/tree/main/skills/url-demo",
        ref: "release-2026",
      }),
      /URL 已经显式包含 GitHub ref.*不能再额外传 ref/i,
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("installFromGithub 只会在 URL 不带 ref 时透传额外 ref 并记录来源", async () => {
  const { service, workingDirectory } = createServiceWithAccounts(["default"], {
    execScript: async (command) => {
      assert.match(command.join(" "), /install-skill-from-github\.py/);
      assert.equal(command.includes("--url"), true);
      assert.equal(command.includes("https://github.com/demo/repo/skills/url-demo"), true);
      assert.equal(command.includes("--ref"), true);
      assert.equal(command.includes("release-2026"), true);
      assert.equal(command.includes("--repo"), false);
      writeInstalledSkillFromCommand(command, {
        directoryName: "url-demo",
        skillName: "url-demo",
        description: "github url skill",
      });
      return "";
    },
  });

  try {
    const result = await service.installFromGithub({
      principalId: PRINCIPAL_ID,
      url: "https://github.com/demo/repo/skills/url-demo",
      ref: "release-2026",
    });

    assert.equal(result.skill.skillName, "url-demo");
    assert.equal(result.skill.sourceType, "github-url");
    assert.equal(
      result.skill.sourceRefJson,
      JSON.stringify({ url: "https://github.com/demo/repo/skills/url-demo", ref: "release-2026" }),
    );
  } finally {
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

test("installFromLocalPath replace=true 在切换阶段第二次 rename 失败时会恢复旧受管目录", async () => {
  const { service, workingDirectory } = createServiceWithAccounts(["default"]);
  const originalSkillDir = createLocalSkillFixture({
    dirName: "demo-old",
    skillName: "demo-skill",
    description: "old demo",
  });
  const replacementSkillDir = createLocalSkillFixture({
    dirName: "demo-new",
    skillName: "demo-skill",
    description: "new demo",
  });
  const managedSkillFilePath = resolve(
    workingDirectory,
    "infra/local/principals",
    PRINCIPAL_ID,
    "skills",
    "demo-skill",
    "SKILL.md",
  );
  const serviceWithRenameHook = service as unknown as {
    renameManagedSkillPath: ((fromPath: string, toPath: string) => void) | undefined;
  };
  const originalRenameManagedSkillPath = serviceWithRenameHook.renameManagedSkillPath;
  let renameCount = 0;
  serviceWithRenameHook.renameManagedSkillPath = (fromPath: string, toPath: string) => {
    renameCount += 1;

    if (renameCount === 2) {
      throw new Error("managed rename failed");
    }

    originalRenameManagedSkillPath?.call(service, fromPath, toPath);
  };

  try {
    await service.installFromLocalPath({
      principalId: PRINCIPAL_ID,
      absolutePath: originalSkillDir,
    });

    await assert.rejects(
      () =>
        service.installFromLocalPath({
          principalId: PRINCIPAL_ID,
          absolutePath: replacementSkillDir,
          replace: true,
        }),
      /managed rename failed/,
    );

    assert.equal(existsSync(managedSkillFilePath), true);
    assert.equal(readFileSync(managedSkillFilePath, "utf8").includes("description: old demo"), true);
  } finally {
    serviceWithRenameHook.renameManagedSkillPath = originalRenameManagedSkillPath;
    rmSync(originalSkillDir, { recursive: true, force: true });
    rmSync(replacementSkillDir, { recursive: true, force: true });
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("installFromLocalPath replace=true 在切换成功后 cleanup 失败也不会阻止 metadata 更新", async () => {
  const { service, registry, workingDirectory } = createServiceWithAccounts(["default"]);
  const originalSkillDir = createLocalSkillFixture({
    dirName: "demo-old",
    skillName: "demo-skill",
    description: "old demo",
  });
  const replacementSkillDir = createLocalSkillFixture({
    dirName: "demo-new",
    skillName: "demo-skill",
    description: "new demo",
  });
  const commonJsFs = requireFromHere("node:fs") as typeof import("node:fs");
  const originalRmSync = commonJsFs.rmSync;
  let injected = false;

  commonJsFs.rmSync = ((targetPath: Parameters<typeof rmSync>[0], options?: Parameters<typeof rmSync>[1]) => {
    if (!injected && typeof targetPath === "string" && targetPath.includes(".backup-")) {
      injected = true;
      throw new Error("backup cleanup failed");
    }

    return originalRmSync(targetPath, options);
  }) as typeof commonJsFs.rmSync;
  syncBuiltinESMExports();

  try {
    await service.installFromLocalPath({
      principalId: PRINCIPAL_ID,
      absolutePath: originalSkillDir,
    });

    const result = await service.installFromLocalPath({
      principalId: PRINCIPAL_ID,
      absolutePath: replacementSkillDir,
      replace: true,
    });

    assert.equal(result.skill.description, "new demo");
    assert.equal(
      registry.getPrincipalSkill(PRINCIPAL_ID, "demo-skill")?.description,
      "new demo",
    );
  } finally {
    commonJsFs.rmSync = originalRmSync;
    syncBuiltinESMExports();
    rmSync(originalSkillDir, { recursive: true, force: true });
    rmSync(replacementSkillDir, { recursive: true, force: true });
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

test("listPrincipalSkills 会返回受管账号同步摘要和 materializations", async () => {
  const { service, workingDirectory } = createServiceWithAccounts(["default", "backup"]);
  const conflictPath = resolve(workingDirectory, "infra/local/codex-auth/backup/skills/demo-skill");
  const skillDir = createLocalSkillFixture({
    dirName: "demo",
    skillName: "demo-skill",
    description: "demo",
  });

  mkdirSync(dirname(conflictPath), { recursive: true });
  writeFileSync(conflictPath, "conflict\n", "utf8");

  try {
    await service.installFromLocalPath({
      principalId: PRINCIPAL_ID,
      absolutePath: skillDir,
    });

    const [skill] = service.listPrincipalSkills(PRINCIPAL_ID) as Array<{
      skillName: string;
      summary?: {
        totalAccounts: number;
        syncedCount: number;
        conflictCount: number;
        failedCount: number;
      };
      materializations?: Array<{
        targetId: string;
        state: string;
      }>;
    }>;

    assert.equal(skill?.skillName, "demo-skill");
    assert.deepEqual(skill?.summary, {
      totalAccounts: 2,
      syncedCount: 1,
      conflictCount: 1,
      failedCount: 0,
    });
    assert.deepEqual(
      skill?.materializations?.map((item) => ({ targetId: item.targetId, state: item.state })),
      [
        { targetId: "backup", state: "conflict" },
        { targetId: "default", state: "synced" },
      ],
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

test("installFromLocalPath 返回结果和 lastError 不会被外部账号脏 materialization 污染", async () => {
  const { service, registry, workingDirectory } = createServiceWithAccounts(["default"]);
  const externalRoot = mkdtempSync(join(tmpdir(), "themis-external-codex-home-dirty-"));
  const skillDir = createLocalSkillFixture({
    dirName: "demo",
    skillName: "demo-skill",
    description: "demo",
  });

  registry.saveAuthAccount({
    accountId: "external",
    label: "external",
    codexHome: resolve(externalRoot, ".codex-external"),
    isActive: false,
    createdAt: "2026-03-27T00:00:00.000Z",
    updatedAt: "2026-03-27T00:00:00.000Z",
  });

  try {
    await service.installFromLocalPath({
      principalId: PRINCIPAL_ID,
      absolutePath: skillDir,
    });

    registry.savePrincipalSkillMaterialization({
      principalId: PRINCIPAL_ID,
      skillName: "demo-skill",
      targetKind: "auth-account",
      targetId: "external",
      targetPath: "/tmp/external-demo-skill",
      state: "failed",
      lastError: "external dirty error",
    });

    const result = await service.installFromLocalPath({
      principalId: PRINCIPAL_ID,
      absolutePath: skillDir,
      replace: true,
    });

    assert.equal(result.skill.installStatus, "ready");
    assert.equal(result.skill.lastError, undefined);
    assert.deepEqual(
      result.materializations.map((record) => record.targetId),
      ["default"],
    );
  } finally {
    rmSync(skillDir, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
