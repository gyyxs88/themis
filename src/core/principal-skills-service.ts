import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
  SqliteCodexSessionRegistry,
  StoredAuthAccountRecord,
} from "../storage/index.js";
import {
  buildCodexProcessEnv,
  ensureAuthAccountCodexHome,
  isManagedAuthAccountCodexHome,
  resolveAuthAccountSkillPath,
  resolveAuthAccountSkillsDirectory,
  resolveDefaultCodexHome,
} from "./auth-accounts.js";
import type {
  PrincipalSkillSourceType,
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
  execScript?: ScriptExec;
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

export interface CuratedSkillListItem {
  name: string;
  installed: boolean;
}

interface ScriptExecOptions {
  cwd?: string;
  env?: Record<string, string>;
}

type ScriptExec = (command: string[], options?: ScriptExecOptions) => Promise<string>;

interface SyncAuthAccountOptions {
  force?: boolean;
}

interface SkillMaterializationOutcome {
  record: StoredPrincipalSkillMaterializationRecord;
  issueMessage: string | null;
}

interface InstallValidatedSkillInput {
  principalId: string;
  sourcePath: string;
  replace: boolean;
  sourceType: PrincipalSkillSourceType;
  sourceRefJson: string;
}

interface InstallFromValidatedStagingInput {
  principalId: string;
  stagingRoot: string;
  replace: boolean;
  sourceType: PrincipalSkillSourceType;
  sourceRefJson: string;
}

const SYSTEM_SKILL_INSTALLER_ROOT = resolve(
  homedir(),
  ".codex",
  "skills",
  ".system",
  "skill-installer",
  "scripts",
);
const CURATED_SKILLS_REPO = "openai/skills";
const CURATED_SKILLS_PATH = "skills/.curated";
const DEFAULT_GITHUB_REF = "main";

export class PrincipalSkillsService {
  private readonly workingDirectory: string;
  private readonly registry: SqliteCodexSessionRegistry;
  private readonly execScript: ScriptExec;

  constructor(options: PrincipalSkillsServiceOptions) {
    this.workingDirectory = resolve(options.workingDirectory);
    this.registry = options.registry;
    this.execScript = options.execScript ?? defaultExecScript;
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

  async listCuratedSkills(principalId: string): Promise<CuratedSkillListItem[]> {
    const normalizedPrincipalId = normalizeRequiredText(principalId, "principalId 不能为空。");
    const output = await this.execScript(
      [
        "python3",
        this.resolveSystemSkillInstallerScript("list-skills.py"),
        "--format",
        "json",
      ],
      {
        env: buildCodexProcessEnv(this.resolveCliCodexHome()),
      },
    );
    const installedSkillNames = new Set(
      this.registry.listPrincipalSkills(normalizedPrincipalId).map((skill) => skill.skillName),
    );

    return normalizeCuratedSkillList(JSON.parse(output), installedSkillNames);
  }

  async installFromLocalPath(input: {
    principalId: string;
    absolutePath: string;
    replace?: boolean;
  }): Promise<PrincipalSkillInstallResult> {
    const principalId = normalizeRequiredText(input.principalId, "principalId 不能为空。");
    const absolutePath = resolveAbsoluteSkillDirectory(input.absolutePath);
    const stagingRoot = this.createSkillInstallStagingRoot();
    const stagedSkillPath = join(stagingRoot, basename(absolutePath));

    try {
      cpSync(absolutePath, stagedSkillPath, { recursive: true });

      return await this.installFromValidatedStaging({
        principalId,
        stagingRoot,
        replace: input.replace === true,
        sourceType: "local-path",
        sourceRefJson: JSON.stringify({ absolutePath }),
      });
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
  }

  async installFromCurated(input: {
    principalId: string;
    skillName: string;
    replace?: boolean;
  }): Promise<PrincipalSkillInstallResult> {
    const principalId = normalizeRequiredText(input.principalId, "principalId 不能为空。");
    const skillName = normalizeRequiredText(input.skillName, "skillName 不能为空。");

    assertManagedSkillName(skillName);
    const stagingRoot = this.createSkillInstallStagingRoot();
    const repoPath = `${CURATED_SKILLS_PATH}/${skillName}`;

    try {
      await this.execScript(
        [
          "python3",
          this.resolveSystemSkillInstallerScript("install-skill-from-github.py"),
          "--repo",
          CURATED_SKILLS_REPO,
          "--path",
          repoPath,
          "--dest",
          stagingRoot,
        ],
        {
          env: buildCodexProcessEnv(this.resolveCliCodexHome()),
        },
      );

      return await this.installFromValidatedStaging({
        principalId,
        stagingRoot,
        replace: input.replace === true,
        sourceType: "curated",
        sourceRefJson: JSON.stringify({ repo: CURATED_SKILLS_REPO, path: repoPath }),
      });
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
  }

  async installFromGithub(input: {
    principalId: string;
    repo?: string;
    path?: string;
    url?: string;
    ref?: string;
    replace?: boolean;
  }): Promise<PrincipalSkillInstallResult> {
    const principalId = normalizeRequiredText(input.principalId, "principalId 不能为空。");
    const url = normalizeOptionalText(input.url);
    const repo = normalizeOptionalText(input.repo);
    const path = normalizeOptionalText(input.path);
    const ref = normalizeOptionalText(input.ref);
    const stagingRoot = this.createSkillInstallStagingRoot();
    const command = [
      "python3",
      this.resolveSystemSkillInstallerScript("install-skill-from-github.py"),
      "--dest",
      stagingRoot,
    ];

    if (url) {
      if (repo || path) {
        throw new Error("GitHub URL 安装模式下不能再传 repo/path。");
      }

      if (ref && githubUrlContainsExplicitRef(url)) {
        throw new Error("GitHub URL 已经显式包含 GitHub ref，不能再额外传 ref。");
      }

      command.push("--url", url);

      if (ref) {
        command.push("--ref", ref);
      }
    } else {
      const normalizedRepo = normalizeRequiredText(repo ?? "", "repo 不能为空。");
      const normalizedPath = normalizeRequiredText(path ?? "", "path 不能为空。");
      command.push("--repo", normalizedRepo, "--path", normalizedPath);

      if (ref) {
        command.push("--ref", ref);
      }
    }

    try {
      await this.execScript(command, {
        env: buildCodexProcessEnv(this.resolveCliCodexHome()),
      });

      return await this.installFromValidatedStaging({
        principalId,
        stagingRoot,
        replace: input.replace === true,
        sourceType: url ? "github-url" : "github-repo-path",
        sourceRefJson: JSON.stringify(
          url
            ? {
              url,
              ...(ref ? { ref } : {}),
            }
            : {
              repo: repo!,
              path: path!,
              ref: ref ?? DEFAULT_GITHUB_REF,
            },
        ),
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
    const managedMaterializations = filterMaterializations(allManagedAccounts, materializations);
    const summary = summarizeMaterializations(allManagedAccounts, managedMaterializations);
    const installStatus = resolveInstallStatus(summary);
    const lastError = pickFirstIssue(managedMaterializations);
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
      materializations: managedMaterializations,
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

  private async installFromValidatedStaging(
    input: InstallFromValidatedStagingInput,
  ): Promise<PrincipalSkillInstallResult> {
    return this.installValidatedSkill({
      principalId: input.principalId,
      sourcePath: resolveSingleSkillDirectory(input.stagingRoot),
      replace: input.replace,
      sourceType: input.sourceType,
      sourceRefJson: input.sourceRefJson,
    });
  }

  private async installValidatedSkill(input: InstallValidatedSkillInput): Promise<PrincipalSkillInstallResult> {
    const validated = await this.validateLocalSkillDirectory(input.sourcePath);
    const managedPath = this.resolveManagedSkillPath(input.principalId, validated.skillName);
    const existing = this.registry.getPrincipalSkill(input.principalId, validated.skillName);
    const now = new Date().toISOString();

    this.prepareManagedSkillTarget(input.principalId, validated.skillName, input.replace);
    this.writeManagedSkillDirectory(validated.sourcePath, managedPath, input.replace);

    this.registry.savePrincipalSkill({
      principalId: input.principalId,
      skillName: validated.skillName,
      description: validated.description,
      sourceType: input.sourceType,
      sourceRefJson: input.sourceRefJson,
      managedPath,
      installStatus: "syncing",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    return this.syncSkillToAllAuthAccounts(input.principalId, validated.skillName, {
      force: input.replace,
    });
  }

  private resolveManagedSkillPath(principalId: string, skillName: string): string {
    return resolve(this.workingDirectory, "infra/local/principals", principalId, "skills", skillName);
  }

  private resolveSystemSkillInstallerScript(scriptName: string): string {
    return resolve(SYSTEM_SKILL_INSTALLER_ROOT, scriptName);
  }

  private resolveCliCodexHome(): string {
    return resolveDefaultCodexHome();
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
    }

    mkdirSync(dirname(managedPath), { recursive: true });
  }

  private writeManagedSkillDirectory(sourcePath: string, managedPath: string, replace: boolean): void {
    const managedParentPath = dirname(managedPath);
    const incomingRoot = mkdtempSync(join(managedParentPath, `${basename(managedPath)}.incoming-`));
    const incomingPath = join(incomingRoot, basename(managedPath));
    const backupPath = `${managedPath}.backup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let movedExisting = false;
    let switchedToManaged = false;

    try {
      cpSync(sourcePath, incomingPath, { recursive: true });

      if (existsSync(managedPath)) {
        if (!replace) {
          throw new Error(`技能 ${basename(managedPath)} 已安装，如需覆盖请显式 replace。`);
        }

        this.renameManagedSkillPath(managedPath, backupPath);
        movedExisting = true;
      }

      this.renameManagedSkillPath(incomingPath, managedPath);
      switchedToManaged = true;

      if (movedExisting && existsSync(backupPath)) {
        this.cleanupManagedSkillPath(backupPath, switchedToManaged);
      }
    } catch (error) {
      if (movedExisting && !existsSync(managedPath) && existsSync(backupPath)) {
        this.renameManagedSkillPath(backupPath, managedPath);
      }

      throw error;
    } finally {
      this.cleanupManagedSkillPath(incomingRoot, switchedToManaged);
    }
  }

  private renameManagedSkillPath(fromPath: string, toPath: string): void {
    renameSync(fromPath, toPath);
  }

  private cleanupManagedSkillPath(targetPath: string, bestEffort: boolean): void {
    try {
      rmSync(targetPath, { recursive: true, force: true });
    } catch (error) {
      if (!bestEffort) {
        throw error;
      }
    }
  }
}

function resolveAbsoluteSkillDirectory(skillPath: string): string {
  const normalized = typeof skillPath === "string" ? skillPath.trim() : "";

  if (!normalized || !normalized.startsWith("/")) {
    throw new Error("技能来源路径必须是服务器本机绝对路径。");
  }

  return resolve(normalized);
}

function resolveSingleSkillDirectory(stagingRoot: string): string {
  const entries = readdirSync(stagingRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());

  if (entries.length !== 1) {
    throw new Error("staging 目录必须且只能包含一个技能目录。");
  }

  return resolve(stagingRoot, entries[0]!.name);
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

function normalizeCuratedSkillList(value: unknown, installedSkillNames: ReadonlySet<string>): CuratedSkillListItem[] {
  if (!Array.isArray(value)) {
    throw new Error("curated skills 输出必须是数组。");
  }

  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error("curated skill 条目格式不合法。");
    }

    const name = normalizeOptionalText(item.name);

    if (!name) {
      throw new Error("curated skill 条目缺少 name。");
    }

    return {
      name,
      installed: installedSkillNames.has(name),
    };
  });
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

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function githubUrlContainsExplicitRef(url: string): boolean {
  try {
    const parsed = new URL(url);

    if (parsed.hostname !== "github.com") {
      return false;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts.length >= 4 && (parts[2] === "tree" || parts[2] === "blob");
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function filterMaterializations(
  accounts: StoredAuthAccountRecord[],
  materializations: StoredPrincipalSkillMaterializationRecord[],
): StoredPrincipalSkillMaterializationRecord[] {
  const targetAccountIds = new Set(accounts.map((account) => account.accountId));
  return materializations.filter((materialization) => targetAccountIds.has(materialization.targetId));
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

function defaultExecScript(command: string[], options: ScriptExecOptions = {}): Promise<string> {
  if (command.length === 0) {
    return Promise.reject(new Error("script command 不能为空。"));
  }

  return new Promise((resolvePromise, reject) => {
    const [file, ...args] = command;
    const child = spawn(file!, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: string | Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: string | Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout.trim());
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `脚本执行失败：${command.join(" ")}`));
    });
  });
}
