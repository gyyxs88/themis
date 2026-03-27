import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type {
  SqliteCodexSessionRegistry,
  StoredAuthAccountRecord,
} from "../storage/index.js";
import {
  ensureAuthAccountCodexHome,
  isManagedAuthAccountCodexHome,
  resolveAuthAccountSkillPath,
  resolveAuthAccountSkillsDirectory,
} from "./auth-accounts.js";
import type {
  StoredPrincipalSkillMaterializationRecord,
  StoredPrincipalSkillRecord,
} from "./principal-skills.js";

export interface ValidatedSkillDirectory {
  sourcePath: string;
  skillName: string;
  description: string;
  skillFilePath: string;
}

export interface PrincipalSkillsServiceOptions {
  workingDirectory: string;
  registry: SqliteCodexSessionRegistry;
}

export interface PrincipalSkillSyncSummary {
  totalAccounts: number;
  syncedCount: number;
  conflictCount: number;
  failedCount: number;
}

export interface PrincipalSkillInstallResult {
  skill: StoredPrincipalSkillRecord;
  materializations: StoredPrincipalSkillMaterializationRecord[];
  summary: PrincipalSkillSyncSummary;
}

interface SyncAuthAccountOptions {
  force?: boolean;
}

interface SkillMaterializationOutcome {
  record: StoredPrincipalSkillMaterializationRecord;
  issueMessage: string | null;
}

export class PrincipalSkillsService {
  private readonly workingDirectory: string;
  private readonly registry: SqliteCodexSessionRegistry;

  constructor(options: PrincipalSkillsServiceOptions) {
    this.workingDirectory = resolve(options.workingDirectory);
    this.registry = options.registry;
  }

  async validateLocalSkillDirectory(skillPath: string): Promise<ValidatedSkillDirectory> {
    const sourcePath = resolveAbsoluteSkillDirectory(skillPath);
    const sourceLstat = lstatSync(sourcePath);

    if (sourceLstat.isSymbolicLink()) {
      throw new Error("技能来源目录不能是 symlink。");
    }

    const stat = statSync(sourcePath);

    if (!stat.isDirectory()) {
      throw new Error("技能来源路径必须是目录。");
    }

    const skillFilePath = join(sourcePath, "SKILL.md");

    if (!existsSync(skillFilePath)) {
      throw new Error("技能目录缺少 SKILL.md。");
    }

    const { name, description } = parseSkillFrontmatter(readFileSync(skillFilePath, "utf8"));
    assertManagedSkillName(name);

    return {
      sourcePath,
      skillName: name,
      description,
      skillFilePath,
    };
  }

  async installFromLocalPath(input: {
    principalId: string;
    absolutePath: string;
    replace?: boolean;
  }): Promise<PrincipalSkillInstallResult> {
    const principalId = normalizeRequiredText(input.principalId, "principalId 不能为空。");
    const stagingRoot = this.createSkillInstallStagingRoot();
    const stagedSkillPath = join(stagingRoot, basename(resolveAbsoluteSkillDirectory(input.absolutePath)));

    try {
      cpSync(resolveAbsoluteSkillDirectory(input.absolutePath), stagedSkillPath, { recursive: true });

      const validated = await this.validateLocalSkillDirectory(stagedSkillPath);
      const managedPath = this.resolveManagedSkillPath(principalId, validated.skillName);
      const existing = this.registry.getPrincipalSkill(principalId, validated.skillName);
      const now = new Date().toISOString();

      this.prepareManagedSkillTarget(principalId, validated.skillName, input.replace === true);
      cpSync(validated.sourcePath, managedPath, { recursive: true });

      this.registry.savePrincipalSkill({
        principalId,
        skillName: validated.skillName,
        description: validated.description,
        sourceType: "local-path",
        sourceRefJson: JSON.stringify({ absolutePath: resolveAbsoluteSkillDirectory(input.absolutePath) }),
        managedPath,
        installStatus: "syncing",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });

      return await this.syncSkillToAllAuthAccounts(principalId, validated.skillName, {
        force: input.replace === true,
      });
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
  }

  async syncAllSkillsToAuthAccount(
    principalId: string,
    accountId: string,
    options: SyncAuthAccountOptions = {},
  ): Promise<void> {
    const normalizedPrincipalId = normalizeRequiredText(principalId, "principalId 不能为空。");
    const normalizedAccountId = normalizeRequiredText(accountId, "accountId 不能为空。");

    for (const skill of this.registry.listPrincipalSkills(normalizedPrincipalId)) {
      await this.syncSkillToSpecificAccounts(skill, [normalizedAccountId], options);
    }
  }

  private async syncSkillToAllAuthAccounts(
    principalId: string,
    skillName: string,
    options: SyncAuthAccountOptions = {},
  ): Promise<PrincipalSkillInstallResult> {
    const skill = this.registry.getPrincipalSkill(principalId, skillName);

    if (!skill) {
      throw new Error(`技能 ${skillName} 不存在。`);
    }

    return this.syncSkillToSpecificAccounts(
      skill,
      this.listManagedAuthAccounts().map((account) => account.accountId),
      options,
    );
  }

  private async syncSkillToSpecificAccounts(
    skill: StoredPrincipalSkillRecord,
    accountIds: string[],
    options: SyncAuthAccountOptions = {},
  ): Promise<PrincipalSkillInstallResult> {
    const managedAccounts = this.resolveManagedAuthAccounts(accountIds);
    const allManagedAccounts = this.listManagedAuthAccounts();
    const seen = new Set<string>();

    for (const account of managedAccounts) {
      const normalizedAccountId = normalizeRequiredText(account.accountId, "accountId 不能为空。");

      if (seen.has(normalizedAccountId)) {
        continue;
      }

      seen.add(normalizedAccountId);
      await this.syncSkillToAuthAccount(skill, normalizedAccountId, options);
    }

    const materializations = this.registry.listPrincipalSkillMaterializations(skill.principalId, skill.skillName);
    const summary = summarizeMaterializations(allManagedAccounts, materializations);
    const installStatus = resolveInstallStatus(summary);
    const lastError = pickFirstIssue(materializations);
    const updatedAt = new Date().toISOString();

    this.registry.savePrincipalSkill({
      principalId: skill.principalId,
      skillName: skill.skillName,
      description: skill.description,
      sourceType: skill.sourceType,
      sourceRefJson: skill.sourceRefJson,
      managedPath: skill.managedPath,
      installStatus,
      createdAt: skill.createdAt,
      updatedAt,
      ...(lastError ? { lastError } : {}),
    });

    const updatedSkill = this.registry.getPrincipalSkill(skill.principalId, skill.skillName);

    if (!updatedSkill) {
      throw new Error(`技能 ${skill.skillName} 状态更新失败。`);
    }

    return {
      skill: updatedSkill,
      materializations,
      summary,
    };
  }

  private async syncSkillToAuthAccount(
    skill: StoredPrincipalSkillRecord,
    accountId: string,
    options: SyncAuthAccountOptions = {},
  ): Promise<StoredPrincipalSkillMaterializationRecord> {
    const account = this.registry.getAuthAccount(accountId);

    if (!account) {
      throw new Error(`认证账号 ${accountId} 不存在。`);
    }

    const outcome = this.materializeSkillForAuthAccount(skill, account, options);
    this.registry.savePrincipalSkillMaterialization(outcome.record);
    return outcome.record;
  }

  private materializeSkillForAuthAccount(
    skill: StoredPrincipalSkillRecord,
    account: StoredAuthAccountRecord,
    options: SyncAuthAccountOptions,
  ): SkillMaterializationOutcome {
    const targetPath = resolveAuthAccountSkillPath(account.codexHome, skill.skillName);
    const managedPath = resolve(skill.managedPath);
    const now = new Date().toISOString();

    try {
      if (!existsSync(managedPath) || !statSync(managedPath).isDirectory()) {
        throw new Error(`受管技能目录不存在：${managedPath}`);
      }

      ensureAuthAccountCodexHome(this.workingDirectory, account.codexHome);
      mkdirSync(resolveAuthAccountSkillsDirectory(account.codexHome), { recursive: true });

      if (!existsSync(targetPath)) {
        symlinkSync(managedPath, targetPath, "dir");
      } else if (!isExpectedSkillSymlink(targetPath, managedPath)) {
        if (options.force !== true) {
          return {
            record: {
              principalId: skill.principalId,
              skillName: skill.skillName,
              targetKind: "auth-account",
              targetId: account.accountId,
              targetPath,
              state: "conflict",
              lastError: `账号槽位 ${account.accountId} 下的 skill 路径存在冲突。`,
            },
            issueMessage: `账号槽位 ${account.accountId} 下的 skill 路径存在冲突。`,
          };
        }

        rmSync(targetPath, { recursive: true, force: true });
        symlinkSync(managedPath, targetPath, "dir");
      }

      return {
        record: {
          principalId: skill.principalId,
          skillName: skill.skillName,
          targetKind: "auth-account",
          targetId: account.accountId,
          targetPath,
          state: "synced",
          lastSyncedAt: now,
        },
        issueMessage: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return {
        record: {
          principalId: skill.principalId,
          skillName: skill.skillName,
          targetKind: "auth-account",
          targetId: account.accountId,
          targetPath,
          state: "failed",
          lastError: message,
        },
        issueMessage: message,
      };
    }
  }

  private listManagedAuthAccounts(): StoredAuthAccountRecord[] {
    return this.registry
      .listAuthAccounts()
      .filter((account) => isManagedAuthAccountCodexHome(this.workingDirectory, account.codexHome));
  }

  private resolveManagedAuthAccounts(accountIds: string[]): StoredAuthAccountRecord[] {
    if (accountIds.length === 0) {
      return this.listManagedAuthAccounts();
    }

    const requested = new Set(accountIds.map((accountId) => normalizeRequiredText(accountId, "accountId 不能为空。")));
    return this.listManagedAuthAccounts().filter((account) => requested.has(account.accountId));
  }

  private createSkillInstallStagingRoot(): string {
    const stagingBase = resolve(this.workingDirectory, "infra/local/principal-skill-staging");
    mkdirSync(stagingBase, { recursive: true });
    return mkdtempSync(join(stagingBase, "install-"));
  }

  private resolveManagedSkillPath(principalId: string, skillName: string): string {
    return resolve(this.workingDirectory, "infra/local/principals", principalId, "skills", skillName);
  }

  private prepareManagedSkillTarget(principalId: string, skillName: string, replace: boolean): void {
    const managedPath = this.resolveManagedSkillPath(principalId, skillName);
    const existingRecord = this.registry.getPrincipalSkill(principalId, skillName);

    if (existingRecord && !replace) {
      throw new Error(`技能 ${skillName} 已安装，如需覆盖请显式 replace。`);
    }

    if (existsSync(managedPath)) {
      if (!existingRecord) {
        throw new Error(`技能 ${skillName} 的受管目录已存在，但主记录缺失，请先修复本地状态。`);
      }

      rmSync(managedPath, { recursive: true, force: true });
    }

    mkdirSync(dirname(managedPath), { recursive: true });
  }
}

function resolveAbsoluteSkillDirectory(skillPath: string): string {
  const normalized = typeof skillPath === "string" ? skillPath.trim() : "";

  if (!normalized || !normalized.startsWith("/")) {
    throw new Error("技能来源路径必须是服务器本机绝对路径。");
  }

  return resolve(normalized);
}

function parseSkillFrontmatter(markdown: string): { name: string; description: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!match) {
    throw new Error("SKILL.md 缺少 frontmatter。");
  }

  const frontmatter = match[1] ?? "";
  const name = normalizeFrontmatterValue(frontmatter.match(/^name:\s*(.+)$/m)?.[1]);
  const description = normalizeFrontmatterValue(frontmatter.match(/^description:\s*(.+)$/m)?.[1]);

  if (!name || !description) {
    throw new Error("SKILL.md frontmatter 必须包含 name 和 description。");
  }

  return { name, description };
}

function normalizeFrontmatterValue(value: string | undefined): string {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    return "";
  }

  if (
    (normalized.startsWith("\"") && normalized.endsWith("\""))
    || (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return normalized.slice(1, -1).trim();
  }

  return normalized;
}

function assertManagedSkillName(skillName: string): void {
  if (skillName === ".system" || skillName.startsWith(".system/")) {
    throw new Error("不允许接管 .system 名称空间。");
  }

  if (!/^[A-Za-z0-9._-]+$/.test(skillName)) {
    throw new Error("skill name 必须是单一路径段。");
  }
}

function normalizeRequiredText(value: string, message: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function isExpectedSkillSymlink(targetPath: string, expectedPath: string): boolean {
  try {
    if (!lstatSync(targetPath).isSymbolicLink()) {
      return false;
    }

    const linkTarget = readlinkSync(targetPath);
    const resolvedTarget = resolve(dirname(targetPath), linkTarget);
    return resolvedTarget === resolve(expectedPath);
  } catch {
    return false;
  }
}

function summarizeMaterializations(
  accounts: StoredAuthAccountRecord[],
  materializations: StoredPrincipalSkillMaterializationRecord[],
): PrincipalSkillSyncSummary {
  const targetAccountIds = new Set(accounts.map((account) => account.accountId));
  let syncedCount = 0;
  let conflictCount = 0;
  let failedCount = 0;

  for (const materialization of materializations) {
    if (!targetAccountIds.has(materialization.targetId)) {
      continue;
    }

    if (materialization.state === "synced") {
      syncedCount += 1;
      continue;
    }

    if (materialization.state === "conflict") {
      conflictCount += 1;
      continue;
    }

    if (materialization.state === "failed") {
      failedCount += 1;
    }
  }

  return {
    totalAccounts: targetAccountIds.size,
    syncedCount,
    conflictCount,
    failedCount,
  };
}

function resolveInstallStatus(summary: PrincipalSkillSyncSummary): StoredPrincipalSkillRecord["installStatus"] {
  if (summary.totalAccounts === 0 || summary.syncedCount === summary.totalAccounts) {
    return "ready";
  }

  if (summary.syncedCount > 0) {
    return "partially_synced";
  }

  return "error";
}

function pickFirstIssue(materializations: StoredPrincipalSkillMaterializationRecord[]): string | undefined {
  for (const materialization of materializations) {
    if (
      (materialization.state === "conflict" || materialization.state === "failed")
      && materialization.lastError
    ) {
      return materialization.lastError;
    }
  }

  return undefined;
}
