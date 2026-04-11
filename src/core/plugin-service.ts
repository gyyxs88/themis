import { resolve } from "node:path";
import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import {
  buildCodexProcessEnv,
  createCodexAuthStorageConfigOverrides,
  ensureAuthAccountCodexHome,
  type CodexAuthAccountSummary,
  type CodexCliConfigOverrides,
} from "./auth-accounts.js";
import { CodexAppServerSession } from "./codex-app-server.js";

export interface PluginServiceOptions {
  workingDirectory: string;
  registry: SqliteCodexSessionRegistry;
}

interface PluginManagementSession {
  initialize(): Promise<void>;
  request(method: string, params: unknown): Promise<unknown>;
  close(): Promise<void>;
}

export interface PluginRuntimeTarget {
  targetKind: "auth-account";
  targetId: string;
}

export interface PluginCreateSessionInput {
  env?: Record<string, string>;
  configOverrides: CodexCliConfigOverrides;
  target: PluginRuntimeTarget;
}

export interface PluginRuntimeOptions {
  cwd?: string;
  activeAuthAccount?: Pick<CodexAuthAccountSummary, "accountId" | "codexHome"> | null;
  forceRemoteSync?: boolean;
  createSession?: (
    input: PluginCreateSessionInput,
  ) => Promise<PluginManagementSession> | PluginManagementSession;
}

export type PluginInstallPolicy = "NOT_AVAILABLE" | "AVAILABLE" | "INSTALLED_BY_DEFAULT" | "UNKNOWN";
export type PluginAuthPolicy = "ON_INSTALL" | "ON_USE" | "UNKNOWN";

export interface PluginMarketplaceInterface {
  displayName: string | null;
}

export interface PluginInterface {
  displayName: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  developerName: string | null;
  category: string | null;
  capabilities: string[];
  websiteUrl: string | null;
  privacyPolicyUrl: string | null;
  termsOfServiceUrl: string | null;
  defaultPrompt: string[] | null;
  brandColor: string | null;
  composerIcon: string | null;
  logo: string | null;
  screenshots: string[];
}

export interface PluginSummary {
  id: string;
  name: string;
  sourceType: "local" | "unknown";
  sourcePath: string | null;
  installed: boolean;
  enabled: boolean;
  installPolicy: PluginInstallPolicy;
  authPolicy: PluginAuthPolicy;
  interface: PluginInterface | null;
}

export interface PluginMarketplace {
  name: string;
  path: string;
  interface: PluginMarketplaceInterface | null;
  plugins: PluginSummary[];
}

export interface PluginMarketplaceLoadError {
  marketplacePath: string;
  message: string;
}

export interface PluginSkillSummary {
  name: string;
  description: string;
  shortDescription: string | null;
  path: string | null;
  enabled: boolean;
}

export interface PluginAppSummary {
  id: string;
  name: string;
  description: string | null;
  installUrl: string | null;
  needsAuth: boolean;
}

export interface PluginDetail {
  marketplaceName: string;
  marketplacePath: string;
  summary: PluginSummary;
  description: string | null;
  skills: PluginSkillSummary[];
  apps: PluginAppSummary[];
  mcpServers: string[];
}

export interface PluginListResult {
  target: PluginRuntimeTarget;
  marketplaces: PluginMarketplace[];
  marketplaceLoadErrors: PluginMarketplaceLoadError[];
  remoteSyncError: string | null;
  featuredPluginIds: string[];
}

export interface PluginReadResult {
  target: PluginRuntimeTarget;
  plugin: PluginDetail;
}

export interface PluginInstallResult {
  target: PluginRuntimeTarget;
  pluginName: string;
  marketplacePath: string;
  authPolicy: PluginAuthPolicy;
  appsNeedingAuth: PluginAppSummary[];
  plugin: PluginDetail | null;
}

export interface PluginUninstallResult {
  target: PluginRuntimeTarget;
  pluginId: string;
}

export interface PluginReadInput {
  marketplacePath: string;
  pluginName: string;
}

export interface PluginInstallInput extends PluginReadInput {
  forceRemoteSync?: boolean;
}

export interface PluginUninstallInput {
  pluginId: string;
  forceRemoteSync?: boolean;
}

export class PluginService {
  private readonly workingDirectory: string;
  private readonly registry: SqliteCodexSessionRegistry;

  constructor(options: PluginServiceOptions) {
    this.workingDirectory = resolve(options.workingDirectory);
    this.registry = options.registry;
  }

  async listPlugins(options: PluginRuntimeOptions = {}): Promise<PluginListResult> {
    const { target, createSession, discoveryCwd } = this.buildRuntimeSessionFactory(options);
    const session = await createSession();

    try {
      await session.initialize();
      const response = await session.request("plugin/list", {
        cwds: [discoveryCwd],
        ...(options.forceRemoteSync === true ? { forceRemoteSync: true } : {}),
      });

      return {
        target,
        marketplaces: normalizePluginMarketplaces(readObjectValue(response, "marketplaces")),
        marketplaceLoadErrors: normalizeMarketplaceLoadErrors(readObjectValue(response, "marketplaceLoadErrors")),
        remoteSyncError: normalizeOptionalText(readObjectValue(response, "remoteSyncError")) ?? null,
        featuredPluginIds: normalizeStringArray(readObjectValue(response, "featuredPluginIds")),
      };
    } finally {
      await session.close();
    }
  }

  async readPlugin(input: PluginReadInput, options: PluginRuntimeOptions = {}): Promise<PluginReadResult> {
    const marketplacePath = normalizeRequiredText(input.marketplacePath, "plugin marketplacePath 不能为空。");
    const pluginName = normalizeRequiredText(input.pluginName, "plugin 名称不能为空。");
    const { target, createSession } = this.buildRuntimeSessionFactory(options);
    const session = await createSession();

    try {
      await session.initialize();
      const response = await session.request("plugin/read", {
        marketplacePath,
        pluginName,
      });

      return {
        target,
        plugin: normalizePluginDetail(readObjectValue(response, "plugin"), marketplacePath, pluginName),
      };
    } finally {
      await session.close();
    }
  }

  async installPlugin(
    input: PluginInstallInput,
    options: PluginRuntimeOptions = {},
  ): Promise<PluginInstallResult> {
    const marketplacePath = normalizeRequiredText(input.marketplacePath, "plugin marketplacePath 不能为空。");
    const pluginName = normalizeRequiredText(input.pluginName, "plugin 名称不能为空。");
    const { target, createSession } = this.buildRuntimeSessionFactory(options);
    const session = await createSession();

    try {
      await session.initialize();
      const response = await session.request("plugin/install", {
        marketplacePath,
        pluginName,
        ...((input.forceRemoteSync ?? options.forceRemoteSync) === true ? { forceRemoteSync: true } : {}),
      });

      let plugin: PluginDetail | null = null;

      try {
        const detailResponse = await session.request("plugin/read", {
          marketplacePath,
          pluginName,
        });
        plugin = normalizePluginDetail(readObjectValue(detailResponse, "plugin"), marketplacePath, pluginName);
      } catch {
        plugin = null;
      }

      return {
        target,
        pluginName,
        marketplacePath,
        authPolicy: normalizePluginAuthPolicy(readObjectValue(response, "authPolicy")),
        appsNeedingAuth: normalizePluginAppSummaries(readObjectValue(response, "appsNeedingAuth")),
        plugin,
      };
    } finally {
      await session.close();
    }
  }

  async uninstallPlugin(
    input: PluginUninstallInput,
    options: PluginRuntimeOptions = {},
  ): Promise<PluginUninstallResult> {
    const pluginId = normalizeRequiredText(input.pluginId, "pluginId 不能为空。");
    const { target, createSession } = this.buildRuntimeSessionFactory(options);
    const session = await createSession();

    try {
      await session.initialize();
      await session.request("plugin/uninstall", {
        pluginId,
        ...((input.forceRemoteSync ?? options.forceRemoteSync) === true ? { forceRemoteSync: true } : {}),
      });

      return {
        target,
        pluginId,
      };
    } finally {
      await session.close();
    }
  }

  private buildRuntimeSessionFactory(options: PluginRuntimeOptions): {
    target: PluginRuntimeTarget;
    createSession: () => Promise<PluginManagementSession>;
    discoveryCwd: string;
  } {
    const fallbackActiveAccount = this.registry.getActiveAuthAccount();
    const activeAuthAccount = options.activeAuthAccount ?? (
      fallbackActiveAccount
        ? {
          accountId: fallbackActiveAccount.accountId,
          codexHome: fallbackActiveAccount.codexHome,
        }
        : null
    );
    const target: PluginRuntimeTarget = {
      targetKind: "auth-account",
      targetId: normalizeOptionalText(activeAuthAccount?.accountId) ?? "default",
    };
    const configOverrides = activeAuthAccount
      ? createCodexAuthStorageConfigOverrides()
      : {};
    const env = activeAuthAccount
      ? buildManagedSessionEnv(this.workingDirectory, activeAuthAccount.codexHome)
      : undefined;
    const discoveryCwd = normalizeDiscoveryCwd(options.cwd, this.workingDirectory);

    return {
      target,
      discoveryCwd,
      createSession: async () => {
        if (options.createSession) {
          return await options.createSession({
            ...(env ? { env } : {}),
            configOverrides,
            target,
          });
        }

        return new CodexAppServerSession(this.workingDirectory, {
          ...(env ? { env } : {}),
          configOverrides,
        });
      },
    };
  }
}

function normalizePluginMarketplaces(value: unknown): PluginMarketplace[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => normalizePluginMarketplace(item))
    .filter((item): item is PluginMarketplace => item !== null);
}

function normalizePluginMarketplace(value: unknown): PluginMarketplace | null {
  const name = normalizeOptionalText(readObjectValue(value, "name"));
  const path = normalizeOptionalText(readObjectValue(value, "path"));

  if (!name || !path) {
    return null;
  }

  return {
    name,
    path,
    interface: normalizePluginMarketplaceInterface(readObjectValue(value, "interface")),
    plugins: normalizePluginSummaries(readObjectValue(value, "plugins")),
  };
}

function normalizePluginMarketplaceInterface(value: unknown): PluginMarketplaceInterface | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return {
    displayName: normalizeOptionalText(readObjectValue(value, "displayName")) ?? null,
  };
}

function normalizePluginSummaries(value: unknown): PluginSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => normalizePluginSummary(item))
    .filter((item): item is PluginSummary => item !== null);
}

function normalizePluginSummary(value: unknown): PluginSummary | null {
  const id = normalizeOptionalText(readObjectValue(value, "id"));
  const name = normalizeOptionalText(readObjectValue(value, "name"));

  if (!id || !name) {
    return null;
  }

  const source = readObjectValue(value, "source");
  const sourceType = normalizeOptionalText(readObjectValue(source, "type"));

  return {
    id,
    name,
    sourceType: sourceType === "local" ? "local" : "unknown",
    sourcePath: normalizeOptionalText(readObjectValue(source, "path")) ?? null,
    installed: readBooleanValue(value, "installed"),
    enabled: readBooleanValue(value, "enabled"),
    installPolicy: normalizePluginInstallPolicy(readObjectValue(value, "installPolicy")),
    authPolicy: normalizePluginAuthPolicy(readObjectValue(value, "authPolicy")),
    interface: normalizePluginInterface(readObjectValue(value, "interface")),
  };
}

function normalizePluginInterface(value: unknown): PluginInterface | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const defaultPrompt = readObjectValue(value, "defaultPrompt");
  const screenshots = readObjectValue(value, "screenshots");

  return {
    displayName: normalizeOptionalText(readObjectValue(value, "displayName")) ?? null,
    shortDescription: normalizeOptionalText(readObjectValue(value, "shortDescription")) ?? null,
    longDescription: normalizeOptionalText(readObjectValue(value, "longDescription")) ?? null,
    developerName: normalizeOptionalText(readObjectValue(value, "developerName")) ?? null,
    category: normalizeOptionalText(readObjectValue(value, "category")) ?? null,
    capabilities: normalizeStringArray(readObjectValue(value, "capabilities")),
    websiteUrl: normalizeOptionalText(readObjectValue(value, "websiteUrl")) ?? null,
    privacyPolicyUrl: normalizeOptionalText(readObjectValue(value, "privacyPolicyUrl")) ?? null,
    termsOfServiceUrl: normalizeOptionalText(readObjectValue(value, "termsOfServiceUrl")) ?? null,
    defaultPrompt: Array.isArray(defaultPrompt) ? normalizeStringArray(defaultPrompt) : null,
    brandColor: normalizeOptionalText(readObjectValue(value, "brandColor")) ?? null,
    composerIcon: normalizeOptionalText(readObjectValue(value, "composerIcon")) ?? null,
    logo: normalizeOptionalText(readObjectValue(value, "logo")) ?? null,
    screenshots: Array.isArray(screenshots) ? normalizeStringArray(screenshots) : [],
  };
}

function normalizeMarketplaceLoadErrors(value: unknown): PluginMarketplaceLoadError[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const marketplacePath = normalizeOptionalText(readObjectValue(item, "marketplacePath"));
      const message = normalizeOptionalText(readObjectValue(item, "message"));

      if (!marketplacePath || !message) {
        return null;
      }

      return {
        marketplacePath,
        message,
      };
    })
    .filter((item): item is PluginMarketplaceLoadError => item !== null);
}

function normalizePluginDetail(
  value: unknown,
  fallbackMarketplacePath: string,
  fallbackPluginName: string,
): PluginDetail {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      marketplaceName: "unknown",
      marketplacePath: fallbackMarketplacePath,
      summary: {
        id: fallbackPluginName,
        name: fallbackPluginName,
        sourceType: "unknown",
        sourcePath: null,
        installed: false,
        enabled: false,
        installPolicy: "UNKNOWN",
        authPolicy: "UNKNOWN",
        interface: null,
      },
      description: null,
      skills: [],
      apps: [],
      mcpServers: [],
    };
  }

  return {
    marketplaceName: normalizeOptionalText(readObjectValue(value, "marketplaceName")) ?? "unknown",
    marketplacePath: normalizeOptionalText(readObjectValue(value, "marketplacePath")) ?? fallbackMarketplacePath,
    summary: normalizePluginSummary(readObjectValue(value, "summary")) ?? {
      id: fallbackPluginName,
      name: fallbackPluginName,
      sourceType: "unknown",
      sourcePath: null,
      installed: false,
      enabled: false,
      installPolicy: "UNKNOWN",
      authPolicy: "UNKNOWN",
      interface: null,
    },
    description: normalizeOptionalText(readObjectValue(value, "description")) ?? null,
    skills: normalizePluginSkillSummaries(readObjectValue(value, "skills")),
    apps: normalizePluginAppSummaries(readObjectValue(value, "apps")),
    mcpServers: normalizeStringArray(readObjectValue(value, "mcpServers")),
  };
}

function normalizePluginSkillSummaries(value: unknown): PluginSkillSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const name = normalizeOptionalText(readObjectValue(item, "name"));
      const description = normalizeOptionalText(readObjectValue(item, "description"));

      if (!name || !description) {
        return null;
      }

      return {
        name,
        description,
        shortDescription: normalizeOptionalText(readObjectValue(item, "shortDescription")) ?? null,
        path: normalizeOptionalText(readObjectValue(item, "path")) ?? null,
        enabled: readBooleanValue(item, "enabled"),
      };
    })
    .filter((item): item is PluginSkillSummary => item !== null);
}

function normalizePluginAppSummaries(value: unknown): PluginAppSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const id = normalizeOptionalText(readObjectValue(item, "id"));
      const name = normalizeOptionalText(readObjectValue(item, "name"));

      if (!id || !name) {
        return null;
      }

      return {
        id,
        name,
        description: normalizeOptionalText(readObjectValue(item, "description")) ?? null,
        installUrl: normalizeOptionalText(readObjectValue(item, "installUrl")) ?? null,
        needsAuth: readBooleanValue(item, "needsAuth"),
      };
    })
    .filter((item): item is PluginAppSummary => item !== null);
}

function normalizePluginInstallPolicy(value: unknown): PluginInstallPolicy {
  const normalized = normalizeOptionalText(value);

  switch (normalized) {
    case "NOT_AVAILABLE":
    case "AVAILABLE":
    case "INSTALLED_BY_DEFAULT":
      return normalized;
    default:
      return "UNKNOWN";
  }
}

function normalizePluginAuthPolicy(value: unknown): PluginAuthPolicy {
  const normalized = normalizeOptionalText(value);

  switch (normalized) {
    case "ON_INSTALL":
    case "ON_USE":
      return normalized;
    default:
      return "UNKNOWN";
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeRequiredText(value: unknown, errorMessage: string): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    throw new Error(errorMessage);
  }

  return normalized;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeDiscoveryCwd(value: string | undefined, fallbackWorkingDirectory: string): string {
  const normalized = normalizeOptionalText(value);
  return normalized ? resolve(normalized) : fallbackWorkingDirectory;
}

function buildManagedSessionEnv(workingDirectory: string, codexHome: string): Record<string, string> {
  ensureAuthAccountCodexHome(workingDirectory, codexHome);
  return buildCodexProcessEnv(codexHome);
}

function readObjectValue(input: unknown, key: string): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  return (input as Record<string, unknown>)[key];
}

function readBooleanValue(input: unknown, key: string): boolean {
  return readObjectValue(input, key) === true;
}
