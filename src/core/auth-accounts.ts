import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import type { SqliteCodexSessionRegistry, StoredAuthAccountRecord } from "../storage/index.js";

export interface CodexAuthAccountSummary {
  accountId: string;
  label: string;
  accountEmail: string | null;
  codexHome: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CodexCliConfigOverrides = Record<string, string | number | boolean>;

const CODEX_AUTH_CREDENTIALS_STORE_KEY = "cli_auth_credentials_store";
const CODEX_AUTH_CREDENTIALS_STORE_FILE = "file";
const THEMIS_MANAGED_CODEX_CONFIG = [
  "# Managed by Themis for multi-account Codex auth isolation.",
  `${CODEX_AUTH_CREDENTIALS_STORE_KEY} = ${JSON.stringify(CODEX_AUTH_CREDENTIALS_STORE_FILE)}`,
  "",
].join("\n");

export function ensureAuthAccountBootstrap(
  workingDirectory: string,
  registry: SqliteCodexSessionRegistry,
): StoredAuthAccountRecord {
  const accounts = registry.listAuthAccounts();

  if (accounts.length) {
    const active = accounts.find((account) => account.isActive) ?? accounts[0];

    if (active?.isActive) {
      return active;
    }

    if (active) {
      registry.setActiveAuthAccount(active.accountId);
      return registry.getActiveAuthAccount() ?? active;
    }
  }

  const now = new Date().toISOString();
  const record: StoredAuthAccountRecord = {
    accountId: "default",
    label: "默认账号",
    codexHome: resolveDefaultCodexHome(),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  registry.saveAuthAccount(record);
  return record;
}

export function createManagedAuthAccountRecord(
  workingDirectory: string,
  registry: SqliteCodexSessionRegistry,
  input: {
    accountId?: string;
    label: string;
    accountEmail?: string;
    activate?: boolean;
  },
): StoredAuthAccountRecord {
  const accountIdSeed = input.accountEmail || input.accountId || input.label;
  const accountId = buildAuthAccountId(accountIdSeed, registry.listAuthAccounts().map((account) => account.accountId));
  const label = normalizeText(input.label) || normalizeText(input.accountEmail) || accountId;
  const accountEmail = normalizeOptionalEmail(input.accountEmail);
  const now = new Date().toISOString();

  return {
    accountId,
    label,
    ...(accountEmail ? { accountEmail } : {}),
    codexHome: resolveManagedCodexHome(workingDirectory, accountId),
    isActive: input.activate !== false,
    createdAt: now,
    updatedAt: now,
  };
}

export function resolveDefaultCodexHome(): string {
  const explicitHome = normalizeText(process.env.CODEX_HOME);

  if (explicitHome) {
    return resolve(explicitHome);
  }

  return resolve(homedir(), ".codex");
}

export function resolveManagedCodexHome(workingDirectory: string, accountId: string): string {
  return resolve(workingDirectory, "infra/local/codex-auth", accountId);
}

export function isManagedAuthAccountCodexHome(workingDirectory: string, codexHome: string): boolean {
  const managedRoot = resolve(workingDirectory, "infra/local/codex-auth");
  const resolvedHome = resolve(codexHome);

  return resolvedHome === managedRoot || resolvedHome.startsWith(`${managedRoot}${sep}`);
}

export function resolveAuthAccountSkillsDirectory(codexHome: string): string {
  return resolve(codexHome, "skills");
}

export function resolveAuthAccountSkillPath(codexHome: string, skillName: string): string {
  return resolve(resolveAuthAccountSkillsDirectory(codexHome), skillName);
}

export function buildCodexProcessEnv(codexHome: string): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

  env.CODEX_HOME = codexHome;
  return env;
}

export function resolveCodexAuthFilePath(codexHome: string): string {
  return resolve(codexHome, "auth.json");
}

export function ensureCodexHomeDirectory(codexHome: string): void {
  mkdirSync(codexHome, { recursive: true });
}

export function ensureAuthAccountCodexHome(workingDirectory: string, codexHome: string): void {
  ensureCodexHomeDirectory(codexHome);

  if (!isManagedCodexHome(workingDirectory, codexHome)) {
    return;
  }

  const configPath = resolve(codexHome, "config.toml");

  if (existsSync(configPath)) {
    return;
  }

  writeFileSync(configPath, THEMIS_MANAGED_CODEX_CONFIG, "utf8");
}

export function createCodexAuthStorageConfigOverrides(): CodexCliConfigOverrides {
  return {
    [CODEX_AUTH_CREDENTIALS_STORE_KEY]: CODEX_AUTH_CREDENTIALS_STORE_FILE,
  };
}

export function buildCodexCliConfigArgs(configOverrides: CodexCliConfigOverrides | null | undefined): string[] {
  if (!configOverrides) {
    return [];
  }

  return Object.entries(configOverrides).flatMap(([key, value]) => ["-c", `${key}=${formatCodexTomlLiteral(value)}`]);
}

export function copyCodexAuthFile(sourceCodexHome: string, targetCodexHome: string): boolean {
  const sourceAuthPath = resolveCodexAuthFilePath(sourceCodexHome);
  const targetAuthPath = resolveCodexAuthFilePath(targetCodexHome);

  if (!existsSync(sourceAuthPath)) {
    return false;
  }

  if (resolve(sourceAuthPath) === resolve(targetAuthPath)) {
    return true;
  }

  ensureCodexHomeDirectory(targetCodexHome);
  copyFileSync(sourceAuthPath, targetAuthPath);
  return true;
}

export function normalizeAuthAccountSummary(record: StoredAuthAccountRecord): CodexAuthAccountSummary {
  return {
    accountId: record.accountId,
    label: record.label,
    accountEmail: normalizeOptionalEmail(record.accountEmail),
    codexHome: record.codexHome,
    isActive: record.isActive,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function buildAuthAccountId(seed: string, existingIds: string[]): string {
  const base = normalizeAccountId(seed) || "account";
  const normalizedExistingIds = new Set(existingIds.map((value) => normalizeAccountId(value)));

  if (!normalizedExistingIds.has(base)) {
    return base;
  }

  let suffix = 2;

  while (normalizedExistingIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}

function normalizeAccountId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeText(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalEmail(value: string | undefined): string | null {
  const normalized = normalizeText(value);
  return normalized ? normalized.toLowerCase() : null;
}

function isManagedCodexHome(workingDirectory: string, codexHome: string): boolean {
  return isManagedAuthAccountCodexHome(workingDirectory, codexHome);
}

function formatCodexTomlLiteral(value: string | number | boolean): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}
