import { resolve } from "node:path";
import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import {
  PluginService,
  type PluginDetail,
  type PluginMarketplace,
  type PluginReadInput,
  type PluginRuntimeOptions,
  type PluginRuntimeTarget,
  type PluginSummary,
} from "./plugin-service.js";
import {
  parseStoredPrincipalPluginSourceRef,
  parseStoredPrincipalPluginInterface,
  type PrincipalPluginMaterializationState,
  type PrincipalPluginSourceRef,
  type PrincipalPluginSourceType,
  type StoredPrincipalPluginMaterializationRecord,
  type StoredPrincipalPluginRecord,
} from "./principal-plugins.js";

export interface PrincipalPluginsServiceOptions {
  workingDirectory: string;
  registry: SqliteCodexSessionRegistry;
  runtimePluginService?: PluginService;
}

export interface PrincipalPluginsRuntimeOptions extends PluginRuntimeOptions {
  now?: string;
}

export interface PrincipalPluginSummary extends PluginSummary {
  owned: boolean;
  runtimeInstalled: boolean;
  runtimeState: PrincipalPluginMaterializationState;
}

export type PrincipalPluginSourceScope =
  "marketplace"
  | "workspace-current"
  | "workspace-other"
  | "host-local"
  | "unknown";

export type PrincipalPluginRepairAction =
  "none"
  | "sync"
  | "retry_sync"
  | "switch_workspace"
  | "reauth"
  | "check_workspace_source"
  | "check_host_source"
  | "inspect_error";

export interface PrincipalPluginMarketplace extends Omit<PluginMarketplace, "plugins"> {
  plugins: PrincipalPluginSummary[];
}

export interface PrincipalPluginListItem {
  pluginId: string;
  pluginName: string;
  marketplaceName: string;
  marketplacePath: string;
  sourceType: PrincipalPluginSourceType;
  sourceScope?: PrincipalPluginSourceScope;
  sourcePath: string | null;
  sourceRef?: PrincipalPluginSourceRef | null;
  summary: PrincipalPluginSummary;
  materializations: StoredPrincipalPluginMaterializationRecord[];
  currentMaterialization?: StoredPrincipalPluginMaterializationRecord | null;
  runtimeAvailable: boolean;
  lastError?: string | null;
  repairAction?: PrincipalPluginRepairAction;
  repairHint?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrincipalPluginDetail extends Omit<PluginDetail, "summary"> {
  summary: PrincipalPluginSummary;
  sourceType?: PrincipalPluginSourceType;
  sourceScope?: PrincipalPluginSourceScope;
  sourcePath?: string | null;
  sourceRef?: PrincipalPluginSourceRef | null;
  currentMaterialization?: StoredPrincipalPluginMaterializationRecord | null;
  lastError?: string | null;
  repairAction?: PrincipalPluginRepairAction;
  repairHint?: string | null;
}

export interface PrincipalPluginListResult {
  target: PluginRuntimeTarget;
  principalPlugins: PrincipalPluginListItem[];
  marketplaces: PrincipalPluginMarketplace[];
  marketplaceLoadErrors: Array<{ marketplacePath: string; message: string }>;
  remoteSyncError: string | null;
  featuredPluginIds: string[];
}

export interface PrincipalPluginReadResult {
  target: PluginRuntimeTarget;
  plugin: PrincipalPluginDetail;
}

export interface PrincipalPluginInstallResult {
  target: PluginRuntimeTarget;
  pluginName: string;
  marketplacePath: string;
  authPolicy: PrincipalPluginSummary["authPolicy"];
  appsNeedingAuth: Array<{
    id: string;
    name: string;
    description: string | null;
    installUrl: string | null;
    needsAuth: boolean;
  }>;
  plugin: PrincipalPluginDetail | null;
}

export interface PrincipalPluginUninstallResult {
  target: PluginRuntimeTarget;
  pluginId: string;
  removedDefinition: boolean;
  removedMaterializations: number;
  runtimeAction: "uninstalled" | "skipped";
}

export interface PrincipalPluginSyncItem {
  pluginId: string;
  pluginName: string;
  marketplaceName: string;
  marketplacePath: string;
  previousState: PrincipalPluginMaterializationState;
  nextState: PrincipalPluginMaterializationState;
  action: "installed" | "already_installed" | "auth_required" | "missing" | "failed";
  lastError: string | null;
}

export interface PrincipalPluginSyncResult {
  target: PluginRuntimeTarget;
  syncedAt: string;
  total: number;
  installedCount: number;
  alreadyInstalledCount: number;
  authRequiredCount: number;
  missingCount: number;
  failedCount: number;
  plugins: PrincipalPluginSyncItem[];
}

export class PrincipalPluginsService {
  private readonly workingDirectory: string;
  private readonly registry: SqliteCodexSessionRegistry;
  private readonly runtimePluginService: PluginService;

  constructor(options: PrincipalPluginsServiceOptions) {
    this.workingDirectory = resolve(options.workingDirectory);
    this.registry = options.registry;
    this.runtimePluginService = options.runtimePluginService ?? new PluginService({
      workingDirectory: this.workingDirectory,
      registry: this.registry,
    });
  }

  async listPrincipalPlugins(
    principalId: string,
    options: PrincipalPluginsRuntimeOptions = {},
  ): Promise<PrincipalPluginListResult> {
    const normalizedPrincipalId = normalizeRequiredText(principalId, "principalId 不能为空。");
    const runtimeResult = await this.runtimePluginService.listPlugins(options);
    const runtimeSummaries = indexRuntimePluginSummaries(runtimeResult.marketplaces);
    const context = this.buildCurrentContext(options, runtimeResult.target);
    const principalRecords = this.registry.listPrincipalPlugins(normalizedPrincipalId);

    for (const record of principalRecords) {
      const runtimeSummary = runtimeSummaries.get(record.pluginId) ?? null;
      const currentMaterialization = this.findCurrentMaterialization(
        normalizedPrincipalId,
        record.pluginId,
        context,
      );
      const nextState = resolveListedRuntimeState(runtimeSummary, currentMaterialization?.state);

      this.registry.savePrincipalPluginMaterialization({
        principalId: normalizedPrincipalId,
        pluginId: record.pluginId,
        targetKind: context.target.targetKind,
        targetId: context.target.targetId,
        workspaceFingerprint: context.workspaceFingerprint,
        state: nextState,
        lastSyncedAt: normalizeNow(options.now),
        ...(shouldPreserveMaterializationError(nextState, currentMaterialization)
          ? { lastError: currentMaterialization.lastError }
          : {}),
      });
    }

    const principalPlugins = this.registry
      .listPrincipalPlugins(normalizedPrincipalId)
      .map((record) => this.buildPrincipalPluginListItem(normalizedPrincipalId, record, runtimeSummaries, context));

    const stateByPluginId = new Map(
      principalPlugins.map((item) => [item.pluginId, item.summary.runtimeState]),
    );
    const ownedPluginIds = new Set(principalPlugins.map((item) => item.pluginId));

    return {
      target: runtimeResult.target,
      principalPlugins,
      marketplaces: runtimeResult.marketplaces.map((marketplace) => ({
        ...marketplace,
        plugins: marketplace.plugins.map((plugin) => ({
          ...plugin,
          owned: ownedPluginIds.has(plugin.id),
          runtimeInstalled: plugin.installed,
          runtimeState: ownedPluginIds.has(plugin.id)
            ? (stateByPluginId.get(plugin.id) ?? deriveRuntimeState(plugin))
            : deriveRuntimeState(plugin),
        })),
      })),
      marketplaceLoadErrors: runtimeResult.marketplaceLoadErrors,
      remoteSyncError: runtimeResult.remoteSyncError,
      featuredPluginIds: runtimeResult.featuredPluginIds,
    };
  }

  async readPrincipalPlugin(
    principalId: string,
    input: PluginReadInput,
    options: PrincipalPluginsRuntimeOptions = {},
  ): Promise<PrincipalPluginReadResult> {
    const normalizedPrincipalId = normalizeRequiredText(principalId, "principalId 不能为空。");
    const fallbackContext = this.buildCurrentContext(options);

    try {
      const result = await this.runtimePluginService.readPlugin(input, options);
      const context = this.buildCurrentContext(options, result.target);
      const storedRecord = this.registry.getPrincipalPlugin(normalizedPrincipalId, result.plugin.summary.id);
      const materialization = storedRecord
        ? this.findCurrentMaterialization(normalizedPrincipalId, storedRecord.pluginId, context)
        : null;

      return {
        target: result.target,
        plugin: buildPrincipalPluginDetail(
          result.plugin,
          storedRecord,
          materialization?.state ?? deriveRuntimeState(result.plugin.summary),
          materialization,
          context,
        ),
      };
    } catch (error) {
      const storedRecord = this.findStoredPrincipalPluginByReference(normalizedPrincipalId, input);

      if (!storedRecord) {
        throw error;
      }

      const materialization = this.findCurrentMaterialization(
        normalizedPrincipalId,
        storedRecord.pluginId,
        fallbackContext,
      );

      return {
        target: fallbackContext.target,
        plugin: buildStoredPrincipalPluginDetail(storedRecord, materialization, fallbackContext),
      };
    }
  }

  async installPrincipalPlugin(
    principalId: string,
    input: PluginReadInput & { forceRemoteSync?: boolean },
    options: PrincipalPluginsRuntimeOptions = {},
  ): Promise<PrincipalPluginInstallResult> {
    const normalizedPrincipalId = normalizeRequiredText(principalId, "principalId 不能为空。");
    const result = await this.runtimePluginService.installPlugin(input, options);
    const context = this.buildCurrentContext(options, result.target);
    const pluginDetail = await this.resolvePluginDetailForInstall(input, options, result.plugin);
    const now = normalizeNow(options.now);

    if (!pluginDetail) {
      throw new Error("plugin 已安装，但暂时无法读取详情，无法纳入 principal。");
    }

    const authRequiredMessage = buildPluginAuthRequiredMessage(result.appsNeedingAuth);
    const storedRecord = this.buildStoredPrincipalPluginRecord(
      normalizedPrincipalId,
      pluginDetail,
      context.workspaceFingerprint,
      now,
      {
        lastError: authRequiredMessage,
      },
    );
    const nextState = result.appsNeedingAuth.length > 0 ? "auth_required" : "installed";

    this.registry.savePrincipalPlugin(storedRecord);
    this.registry.savePrincipalPluginMaterialization({
      principalId: normalizedPrincipalId,
      pluginId: storedRecord.pluginId,
      targetKind: context.target.targetKind,
      targetId: context.target.targetId,
      workspaceFingerprint: context.workspaceFingerprint,
      state: nextState,
      lastSyncedAt: now,
      ...(authRequiredMessage ? { lastError: authRequiredMessage } : {}),
    });

    return {
      target: result.target,
      pluginName: result.pluginName,
      marketplacePath: result.marketplacePath,
      authPolicy: result.authPolicy,
      appsNeedingAuth: result.appsNeedingAuth,
      plugin: buildPrincipalPluginDetail(pluginDetail, storedRecord, nextState),
    };
  }

  async uninstallPrincipalPlugin(
    principalId: string,
    pluginId: string,
    options: PrincipalPluginsRuntimeOptions = {},
  ): Promise<PrincipalPluginUninstallResult> {
    const normalizedPrincipalId = normalizeRequiredText(principalId, "principalId 不能为空。");
    const normalizedPluginId = normalizeRequiredText(pluginId, "pluginId 不能为空。");
    const storedRecord = this.registry.getPrincipalPlugin(normalizedPrincipalId, normalizedPluginId);

    if (!storedRecord) {
      throw new Error(`plugin ${normalizedPluginId} 不属于当前 principal。`);
    }

    const context = this.buildCurrentContext(options);
    const currentMaterialization = this.findCurrentMaterialization(
      normalizedPrincipalId,
      normalizedPluginId,
      context,
    );

    let runtimeAction: PrincipalPluginUninstallResult["runtimeAction"] = "skipped";
    let target = context.target;

    if (!currentMaterialization || currentMaterialization.state !== "missing") {
      const runtimeResult = await this.runtimePluginService.uninstallPlugin({
        pluginId: normalizedPluginId,
        ...(options.forceRemoteSync === true ? { forceRemoteSync: true } : {}),
      }, options);
      runtimeAction = "uninstalled";
      target = runtimeResult.target;
    }

    const removedMaterializations = this.registry.deletePrincipalPluginMaterializations(
      normalizedPrincipalId,
      normalizedPluginId,
    );
    const removedDefinition = this.registry.deletePrincipalPlugin(normalizedPrincipalId, normalizedPluginId);

    return {
      target,
      pluginId: normalizedPluginId,
      removedDefinition,
      removedMaterializations,
      runtimeAction,
    };
  }

  async syncPrincipalPlugins(
    principalId: string,
    options: PrincipalPluginsRuntimeOptions = {},
  ): Promise<PrincipalPluginSyncResult> {
    const normalizedPrincipalId = normalizeRequiredText(principalId, "principalId 不能为空。");
    const runtimeResult = await this.runtimePluginService.listPlugins(options);
    const runtimeSummaries = indexRuntimePluginSummaries(runtimeResult.marketplaces);
    const context = this.buildCurrentContext(options, runtimeResult.target);
    const principalRecords = this.registry.listPrincipalPlugins(normalizedPrincipalId);
    const syncedAt = normalizeNow(options.now);
    const plugins: PrincipalPluginSyncItem[] = [];

    for (const record of principalRecords) {
      const runtimeSummary = runtimeSummaries.get(record.pluginId) ?? null;
      const currentMaterialization = this.findCurrentMaterialization(
        normalizedPrincipalId,
        record.pluginId,
        context,
      );
      const previousState = currentMaterialization?.state ?? deriveRuntimeState(runtimeSummary);

      if (!runtimeSummary) {
        this.savePrincipalPluginRecordError(record, syncedAt, null);
        this.registry.savePrincipalPluginMaterialization({
          principalId: normalizedPrincipalId,
          pluginId: record.pluginId,
          targetKind: context.target.targetKind,
          targetId: context.target.targetId,
          workspaceFingerprint: context.workspaceFingerprint,
          state: "missing",
          lastSyncedAt: syncedAt,
        });
        plugins.push(buildSyncItem(record, previousState, "missing", "missing"));
        continue;
      }

      if (runtimeSummary.installed) {
        this.savePrincipalPluginRecordError(record, syncedAt, null);
        this.registry.savePrincipalPluginMaterialization({
          principalId: normalizedPrincipalId,
          pluginId: record.pluginId,
          targetKind: context.target.targetKind,
          targetId: context.target.targetId,
          workspaceFingerprint: context.workspaceFingerprint,
          state: "installed",
          lastSyncedAt: syncedAt,
        });
        plugins.push(buildSyncItem(record, previousState, "installed", "already_installed"));
        continue;
      }

      if (runtimeSummary.installPolicy === "NOT_AVAILABLE") {
        const lastError = "当前 runtime 标记该 plugin 不可安装。";
        this.savePrincipalPluginRecordError(record, syncedAt, lastError);
        this.registry.savePrincipalPluginMaterialization({
          principalId: normalizedPrincipalId,
          pluginId: record.pluginId,
          targetKind: context.target.targetKind,
          targetId: context.target.targetId,
          workspaceFingerprint: context.workspaceFingerprint,
          state: "failed",
          lastSyncedAt: syncedAt,
          lastError,
        });
        plugins.push(buildSyncItem(record, previousState, "failed", "failed", lastError));
        continue;
      }

      try {
        const installResult = await this.runtimePluginService.installPlugin({
          marketplacePath: record.marketplacePath,
          pluginName: record.pluginName,
          ...(options.forceRemoteSync === true ? { forceRemoteSync: true } : {}),
        }, options);
        const pluginDetail = await this.resolvePluginDetailForInstall({
          marketplacePath: record.marketplacePath,
          pluginName: record.pluginName,
        }, options, installResult.plugin);

        if (pluginDetail) {
          const authRequiredMessage = buildPluginAuthRequiredMessage(installResult.appsNeedingAuth);
          this.registry.savePrincipalPlugin(
            this.buildStoredPrincipalPluginRecord(
              normalizedPrincipalId,
              pluginDetail,
              context.workspaceFingerprint,
              syncedAt,
              {
                lastError: authRequiredMessage,
              },
            ),
          );
        } else {
          this.savePrincipalPluginRecordError(
            record,
            syncedAt,
            buildPluginAuthRequiredMessage(installResult.appsNeedingAuth),
          );
        }

        const nextState = installResult.appsNeedingAuth.length > 0 ? "auth_required" : "installed";
        const authRequiredMessage = buildPluginAuthRequiredMessage(installResult.appsNeedingAuth);

        this.registry.savePrincipalPluginMaterialization({
          principalId: normalizedPrincipalId,
          pluginId: record.pluginId,
          targetKind: context.target.targetKind,
          targetId: context.target.targetId,
          workspaceFingerprint: context.workspaceFingerprint,
          state: nextState,
          lastSyncedAt: syncedAt,
          ...(authRequiredMessage ? { lastError: authRequiredMessage } : {}),
        });
        plugins.push(buildSyncItem(
          record,
          previousState,
          nextState,
          nextState === "auth_required" ? "auth_required" : "installed",
          authRequiredMessage,
        ));
      } catch (error) {
        const lastError = error instanceof Error ? error.message : String(error);
        this.savePrincipalPluginRecordError(record, syncedAt, lastError);
        this.registry.savePrincipalPluginMaterialization({
          principalId: normalizedPrincipalId,
          pluginId: record.pluginId,
          targetKind: context.target.targetKind,
          targetId: context.target.targetId,
          workspaceFingerprint: context.workspaceFingerprint,
          state: "failed",
          lastSyncedAt: syncedAt,
          lastError,
        });
        plugins.push(buildSyncItem(record, previousState, "failed", "failed", lastError));
      }
    }

    return {
      target: runtimeResult.target,
      syncedAt,
      total: plugins.length,
      installedCount: countSyncActions(plugins, "installed"),
      alreadyInstalledCount: countSyncActions(plugins, "already_installed"),
      authRequiredCount: countSyncActions(plugins, "auth_required"),
      missingCount: countSyncActions(plugins, "missing"),
      failedCount: countSyncActions(plugins, "failed"),
      plugins,
    };
  }

  private buildPrincipalPluginListItem(
    principalId: string,
    record: StoredPrincipalPluginRecord,
    runtimeSummaries: Map<string, PluginSummary>,
    context: CurrentPluginContext,
  ): PrincipalPluginListItem {
    const materializations = this.registry.listPrincipalPluginMaterializations(principalId, record.pluginId);
    const currentMaterialization = this.findMatchingMaterialization(materializations, context);
    const runtimeSummary = runtimeSummaries.get(record.pluginId) ?? null;
    const runtimeState = currentMaterialization?.state ?? deriveRuntimeState(runtimeSummary);
    const storedSummary = buildStoredSummary(record, runtimeState);
    const sourceRef = parseStoredPrincipalPluginSourceRef(record.sourceRefJson);
    const sourceScope = derivePrincipalPluginSourceScope(record, sourceRef, context);
    const effectiveSummary = runtimeSummary
      ? {
        ...runtimeSummary,
        owned: true,
        runtimeInstalled: runtimeSummary.installed,
        runtimeState,
      }
      : storedSummary;

    return {
      pluginId: record.pluginId,
      pluginName: record.pluginName,
      marketplaceName: record.marketplaceName,
      marketplacePath: record.marketplacePath,
      sourceType: record.sourceType,
      sourceScope,
      sourcePath: record.sourcePath ?? null,
      sourceRef,
      summary: effectiveSummary,
      materializations,
      currentMaterialization,
      runtimeAvailable: runtimeSummary !== null,
      lastError: resolvePrincipalPluginLastError(record, currentMaterialization),
      ...derivePrincipalPluginRepair(record, sourceScope, runtimeState, currentMaterialization),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private buildStoredPrincipalPluginRecord(
    principalId: string,
    plugin: PluginDetail,
    workspaceFingerprint: string,
    now: string,
    options: {
      lastError?: string | null;
    } = {},
  ): StoredPrincipalPluginRecord {
    const existing = this.registry.getPrincipalPlugin(principalId, plugin.summary.id);
    const sourcePath = normalizeOptionalText(plugin.summary.sourcePath);
    const sourceType = inferPrincipalPluginSourceType(sourcePath, workspaceFingerprint);

    return {
      principalId,
      pluginId: plugin.summary.id,
      pluginName: plugin.summary.name,
      marketplaceName: normalizeOptionalText(plugin.marketplaceName) ?? existing?.marketplaceName ?? "unknown",
      marketplacePath: normalizeRequiredText(plugin.marketplacePath, "marketplacePath 不能为空。"),
      sourceType,
      sourceRefJson: JSON.stringify({
        marketplaceName: plugin.marketplaceName,
        marketplacePath: plugin.marketplacePath,
        pluginName: plugin.summary.name,
        pluginId: plugin.summary.id,
        sourceType,
        workspaceFingerprint,
        ...(sourcePath ? { sourcePath } : {}),
      }),
      ...(sourcePath ? { sourcePath } : {}),
      interfaceJson: JSON.stringify(plugin.summary.interface ?? {}),
      installPolicy: plugin.summary.installPolicy,
      authPolicy: plugin.summary.authPolicy,
      enabled: plugin.summary.enabled,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(typeof options.lastError === "string" && options.lastError.trim().length > 0
        ? { lastError: options.lastError }
        : {}),
    };
  }

  private async resolvePluginDetailForInstall(
    input: PluginReadInput,
    options: PrincipalPluginsRuntimeOptions,
    plugin: PluginDetail | null,
  ): Promise<PluginDetail | null> {
    if (plugin) {
      return plugin;
    }

    try {
      const detail = await this.runtimePluginService.readPlugin(input, options);
      return detail.plugin;
    } catch {
      const list = await this.runtimePluginService.listPlugins(options);
      const marketplace = list.marketplaces.find((item) => item.path === input.marketplacePath);
      const summary = marketplace?.plugins.find((item) => item.name === input.pluginName);

      if (!marketplace || !summary) {
        return null;
      }

      return {
        marketplaceName: marketplace.name,
        marketplacePath: marketplace.path,
        summary,
        description: summary.interface?.longDescription ?? summary.interface?.shortDescription ?? null,
        skills: [],
        apps: [],
        mcpServers: [],
      };
    }
  }

  private findCurrentMaterialization(
    principalId: string,
    pluginId: string,
    context: CurrentPluginContext,
  ): StoredPrincipalPluginMaterializationRecord | null {
    return this.findMatchingMaterialization(
      this.registry.listPrincipalPluginMaterializations(principalId, pluginId),
      context,
    );
  }

  private findMatchingMaterialization(
    materializations: StoredPrincipalPluginMaterializationRecord[],
    context: CurrentPluginContext,
  ): StoredPrincipalPluginMaterializationRecord | null {
    for (const materialization of materializations) {
      if (
        materialization.targetKind === context.target.targetKind
        && materialization.targetId === context.target.targetId
        && materialization.workspaceFingerprint === context.workspaceFingerprint
      ) {
        return materialization;
      }
    }

    return null;
  }

  private savePrincipalPluginRecordError(
    record: StoredPrincipalPluginRecord,
    updatedAt: string,
    lastError: string | null,
  ): void {
    this.registry.savePrincipalPlugin({
      ...record,
      updatedAt,
      ...(lastError ? { lastError } : {}),
    });
  }

  private findStoredPrincipalPluginByReference(
    principalId: string,
    input: PluginReadInput,
  ): StoredPrincipalPluginRecord | null {
    const marketplacePath = normalizeRequiredText(input.marketplacePath, "plugin marketplacePath 不能为空。");
    const pluginName = normalizeRequiredText(input.pluginName, "plugin 名称不能为空。");

    return this.registry
      .listPrincipalPlugins(principalId)
      .find((record) => record.marketplacePath === marketplacePath && record.pluginName === pluginName)
      ?? null;
  }

  private buildCurrentContext(
    options: PrincipalPluginsRuntimeOptions,
    target?: PluginRuntimeTarget,
  ): CurrentPluginContext {
    const activeAccount = options.activeAuthAccount ?? this.registry.getActiveAuthAccount();
    return {
      target: target ?? {
        targetKind: "auth-account",
        targetId: normalizeOptionalText(activeAccount?.accountId) ?? "default",
      },
      workspaceFingerprint: resolveWorkspaceFingerprint(options.cwd, this.workingDirectory),
    };
  }
}

interface CurrentPluginContext {
  target: PluginRuntimeTarget;
  workspaceFingerprint: string;
}

function buildPrincipalPluginDetail(
  plugin: PluginDetail,
  storedRecord: StoredPrincipalPluginRecord | null,
  runtimeState: PrincipalPluginMaterializationState,
  currentMaterialization: StoredPrincipalPluginMaterializationRecord | null = null,
  context: CurrentPluginContext | null = null,
): PrincipalPluginDetail {
  const sourceRef = storedRecord ? parseStoredPrincipalPluginSourceRef(storedRecord.sourceRefJson) : null;
  const sourceScope = storedRecord && context
    ? derivePrincipalPluginSourceScope(storedRecord, sourceRef, context)
    : undefined;
  const repair = storedRecord
    ? derivePrincipalPluginRepair(storedRecord, sourceScope ?? "unknown", runtimeState, currentMaterialization)
    : {};

  return {
    ...plugin,
    summary: {
      ...plugin.summary,
      owned: storedRecord !== null,
      runtimeInstalled: plugin.summary.installed,
      runtimeState,
      interface: plugin.summary.interface ?? parseStoredPrincipalPluginInterface(storedRecord?.interfaceJson ?? ""),
    },
    ...(storedRecord
      ? {
        sourceType: storedRecord.sourceType,
        ...(sourceScope ? { sourceScope } : {}),
        sourcePath: storedRecord.sourcePath ?? null,
        sourceRef,
      }
      : {}),
    currentMaterialization,
    lastError: resolvePrincipalPluginLastError(storedRecord, currentMaterialization),
    ...repair,
  };
}

function buildStoredPrincipalPluginDetail(
  record: StoredPrincipalPluginRecord,
  currentMaterialization: StoredPrincipalPluginMaterializationRecord | null,
  context: CurrentPluginContext,
): PrincipalPluginDetail {
  const runtimeState = currentMaterialization?.state ?? "missing";
  const storedInterface = parseStoredPrincipalPluginInterface(record.interfaceJson);
  const sourceRef = parseStoredPrincipalPluginSourceRef(record.sourceRefJson);
  const sourceScope = derivePrincipalPluginSourceScope(record, sourceRef, context);
  const repair = derivePrincipalPluginRepair(record, sourceScope, runtimeState, currentMaterialization);

  return {
    marketplaceName: record.marketplaceName,
    marketplacePath: record.marketplacePath,
    summary: buildStoredSummary(record, runtimeState),
    description: storedInterface?.longDescription
      ?? storedInterface?.shortDescription
      ?? null,
    skills: [],
    apps: [],
    mcpServers: [],
    sourceType: record.sourceType,
    sourceScope,
    sourcePath: record.sourcePath ?? null,
    sourceRef,
    currentMaterialization,
    lastError: resolvePrincipalPluginLastError(record, currentMaterialization),
    ...repair,
  };
}

function buildStoredSummary(
  record: StoredPrincipalPluginRecord,
  runtimeState: PrincipalPluginMaterializationState,
): PrincipalPluginSummary {
  return {
    id: record.pluginId,
    name: record.pluginName,
    sourceType: record.sourcePath ? "local" : "unknown",
    sourcePath: record.sourcePath ?? null,
    installed: false,
    enabled: record.enabled,
    installPolicy: record.installPolicy,
    authPolicy: record.authPolicy,
    interface: parseStoredPrincipalPluginInterface(record.interfaceJson),
    owned: true,
    runtimeInstalled: false,
    runtimeState,
  };
}

function resolvePrincipalPluginLastError(
  record: StoredPrincipalPluginRecord | null,
  materialization: StoredPrincipalPluginMaterializationRecord | null,
): string | null {
  if (materialization?.lastError) {
    return materialization.lastError;
  }

  if (materialization) {
    return null;
  }

  return record?.lastError ?? null;
}

function derivePrincipalPluginSourceScope(
  record: StoredPrincipalPluginRecord,
  sourceRef: PrincipalPluginSourceRef | null,
  context: CurrentPluginContext,
): PrincipalPluginSourceScope {
  switch (record.sourceType) {
    case "marketplace":
      return "marketplace";
    case "home-local":
      return "host-local";
    case "repo-local": {
      const sourceWorkspace = normalizeOptionalText(sourceRef?.workspaceFingerprint)
        ?? inferWorkspaceFingerprintFromSourcePath(record.sourcePath);

      if (!sourceWorkspace) {
        return "workspace-other";
      }

      return sourceWorkspace === context.workspaceFingerprint ? "workspace-current" : "workspace-other";
    }
    default:
      return "unknown";
  }
}

function derivePrincipalPluginRepair(
  record: StoredPrincipalPluginRecord,
  sourceScope: PrincipalPluginSourceScope,
  runtimeState: PrincipalPluginMaterializationState,
  currentMaterialization: StoredPrincipalPluginMaterializationRecord | null,
): {
  repairAction?: PrincipalPluginRepairAction;
  repairHint?: string | null;
} {
  const lastError = resolvePrincipalPluginLastError(record, currentMaterialization);
  const sourceRef = parseStoredPrincipalPluginSourceRef(record.sourceRefJson);
  const sourcePath = normalizeOptionalText(record.sourcePath) ?? normalizeOptionalText(sourceRef?.sourcePath);
  const sourceWorkspace = normalizeOptionalText(sourceRef?.workspaceFingerprint);

  switch (runtimeState) {
    case "installed":
      return {
        repairAction: "none",
        repairHint: null,
      };
    case "available":
      return {
        repairAction: "sync",
        repairHint: "可直接执行“同步到当前环境”，把这个 principal plugin 落到当前 runtime。",
      };
    case "auth_required":
      return {
        repairAction: "reauth",
        repairHint: lastError
          ? `${lastError}；完成认证后再执行“同步到当前环境”。`
          : "先完成相关 app 认证，再执行“同步到当前环境”。",
      };
    case "missing":
      switch (sourceScope) {
        case "marketplace":
          return {
            repairAction: "sync",
            repairHint: "当前 marketplace 仍可作为来源；可直接执行“同步到当前环境”。",
          };
        case "workspace-other":
          return {
            repairAction: "switch_workspace",
            repairHint: sourceWorkspace
              ? `这是绑定工作区 ${sourceWorkspace} 的 repo-local plugin；切回该工作区后再查看或同步。`
              : "这是 repo-local plugin；请切回原工作区后再查看或同步。",
          };
        case "workspace-current":
          return {
            repairAction: "check_workspace_source",
            repairHint: sourcePath
              ? `当前工作区应包含 ${sourcePath}；请检查路径是否仍存在，然后重试同步。`
              : "当前工作区没有解析到该 repo-local plugin；请检查插件路径后再重试同步。",
          };
        case "host-local":
          return {
            repairAction: "check_host_source",
            repairHint: sourcePath
              ? `请检查宿主机路径 ${sourcePath} 是否仍存在，然后重试同步。`
              : "请检查宿主机本地 plugin 路径是否仍存在，然后重试同步。",
          };
        default:
          return {
            repairAction: "inspect_error",
            repairHint: lastError ?? "当前环境无法解析该 plugin；建议先查看来源和最近问题。",
          };
      }
    case "failed":
      if (sourceScope === "workspace-other" && sourceWorkspace) {
        return {
          repairAction: "switch_workspace",
          repairHint: `这个 repo-local plugin 原本绑定工作区 ${sourceWorkspace}；切回该工作区后再重试同步。`,
        };
      }

      if (sourceScope === "host-local") {
        return {
          repairAction: "check_host_source",
          repairHint: sourcePath
            ? `请先检查宿主机路径 ${sourcePath}，修复后再重试同步。`
            : "请先检查宿主机本地 plugin 路径，修复后再重试同步。",
        };
      }

      if (lastError?.includes("认证")) {
        return {
          repairAction: "reauth",
          repairHint: `${lastError}；补完认证后再重试同步。`,
        };
      }

      return {
        repairAction: "retry_sync",
        repairHint: lastError
          ? `${lastError}；修复后可重试“同步到当前环境”。`
          : "当前同步失败；修复来源或环境问题后可重试“同步到当前环境”。",
      };
    default:
      return {
        repairAction: "inspect_error",
        repairHint: lastError ?? null,
      };
  }
}

function indexRuntimePluginSummaries(marketplaces: PluginMarketplace[]): Map<string, PluginSummary> {
  const indexed = new Map<string, PluginSummary>();

  for (const marketplace of marketplaces) {
    for (const plugin of marketplace.plugins) {
      if (!indexed.has(plugin.id)) {
        indexed.set(plugin.id, plugin);
      }
    }
  }

  return indexed;
}

function deriveRuntimeState(plugin: PluginSummary | null): PrincipalPluginMaterializationState {
  if (!plugin) {
    return "missing";
  }

  return plugin.installed ? "installed" : "available";
}

function resolveListedRuntimeState(
  plugin: PluginSummary | null,
  currentState: PrincipalPluginMaterializationState | undefined,
): PrincipalPluginMaterializationState {
  if (!plugin) {
    return "missing";
  }

  if (plugin.installed) {
    return "installed";
  }

  if (currentState === "auth_required" || currentState === "failed") {
    return currentState;
  }

  return "available";
}

function shouldPreserveMaterializationError(
  nextState: PrincipalPluginMaterializationState,
  materialization: StoredPrincipalPluginMaterializationRecord | null,
): materialization is StoredPrincipalPluginMaterializationRecord & { lastError: string } {
  return Boolean(
    materialization?.lastError
    && materialization.state === nextState
    && (nextState === "auth_required" || nextState === "failed"),
  );
}

function buildSyncItem(
  record: StoredPrincipalPluginRecord,
  previousState: PrincipalPluginMaterializationState,
  nextState: PrincipalPluginMaterializationState,
  action: PrincipalPluginSyncItem["action"],
  lastError: string | null = null,
): PrincipalPluginSyncItem {
  return {
    pluginId: record.pluginId,
    pluginName: record.pluginName,
    marketplaceName: record.marketplaceName,
    marketplacePath: record.marketplacePath,
    previousState,
    nextState,
    action,
    lastError,
  };
}

function countSyncActions(
  plugins: PrincipalPluginSyncItem[],
  action: PrincipalPluginSyncItem["action"],
): number {
  return plugins.filter((item) => item.action === action).length;
}

function buildPluginAuthRequiredMessage(
  appsNeedingAuth: Array<{ name: string }>,
): string | null {
  if (!appsNeedingAuth.length) {
    return null;
  }

  const appNames = appsNeedingAuth
    .map((item) => normalizeOptionalText(item.name))
    .filter((item): item is string => Boolean(item));

  if (!appNames.length) {
    return "当前 plugin 仍需补认证。";
  }

  return `待补认证 apps：${appNames.join(", ")}`;
}

function inferWorkspaceFingerprintFromSourcePath(sourcePath: string | null | undefined): string | null {
  const normalizedPath = normalizeOptionalText(sourcePath);

  if (!normalizedPath) {
    return null;
  }

  const marker = "/.agents/plugins/";
  const markerIndex = normalizedPath.indexOf(marker);

  if (markerIndex <= 0) {
    return null;
  }

  return normalizedPath.slice(0, markerIndex);
}

function inferPrincipalPluginSourceType(
  sourcePath: string | null,
  workspaceFingerprint: string,
): PrincipalPluginSourceType {
  if (!sourcePath) {
    return "marketplace";
  }

  const resolvedSourcePath = resolve(sourcePath);
  return isSameOrChildPath(resolvedSourcePath, workspaceFingerprint) ? "repo-local" : "home-local";
}

function resolveWorkspaceFingerprint(cwd: string | undefined, fallbackWorkingDirectory: string): string {
  return resolve(normalizeOptionalText(cwd) ?? fallbackWorkingDirectory);
}

function isSameOrChildPath(path: string, basePath: string): boolean {
  return path === basePath || path.startsWith(`${basePath}/`);
}

function normalizeRequiredText(value: unknown, errorMessage: string): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    throw new Error(errorMessage);
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

function normalizeNow(value: string | undefined): string {
  return normalizeOptionalText(value) ?? new Date().toISOString();
}
