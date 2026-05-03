import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrincipalPluginsService } from "./principal-plugins-service.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

const PRINCIPAL_ID = "principal-owner";

function createService() {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-principal-plugins-service-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });

  registry.savePrincipal({
    principalId: PRINCIPAL_ID,
    createdAt: "2026-04-11T00:00:00.000Z",
    updatedAt: "2026-04-11T00:00:00.000Z",
  });

  return {
    service: new PrincipalPluginsService({
      workingDirectory,
      registry,
    }),
    registry,
    workingDirectory,
  };
}

test("installPrincipalPlugin 会把 plugin 纳入 principal 并写入 materialization", async () => {
  const { service, registry, workingDirectory } = createService();

  try {
    const result = await service.installPrincipalPlugin(PRINCIPAL_ID, {
      marketplacePath: "/tmp/openai-curated/marketplace.json",
      pluginName: "github",
    }, {
      cwd: "/srv/repos/demo",
      createSession: async () => ({
        async initialize() {},
        async request(method: string) {
          if (method === "plugin/install") {
            return {
              authPolicy: "ON_INSTALL",
              appsNeedingAuth: [],
            };
          }

          if (method === "plugin/read") {
            return {
              plugin: {
                marketplaceName: "openai-curated",
                marketplacePath: "/tmp/openai-curated/marketplace.json",
                summary: {
                  id: "github@openai-curated",
                  name: "github",
                  source: {
                    type: "local",
                    path: "/srv/repos/demo/.agents/plugins/github",
                  },
                  installed: true,
                  enabled: true,
                  installPolicy: "AVAILABLE",
                  authPolicy: "ON_INSTALL",
                  interface: {
                    displayName: "GitHub",
                    shortDescription: "Review PRs",
                    capabilities: ["Interactive"],
                    screenshots: [],
                  },
                },
                description: "GitHub workflows",
                skills: [],
                apps: [],
                mcpServers: [],
              },
            };
          }

          throw new Error(`unexpected method: ${method}`);
        },
        async close() {},
      }),
    });

    assert.equal(result.plugin?.summary.owned, true);
    const stored = registry.getPrincipalPlugin(PRINCIPAL_ID, "github@openai-curated");
    assert.equal(stored?.sourceType, "repo-local");
    assert.match(stored?.sourceRefJson ?? "", /"workspaceFingerprint":"\/srv\/repos\/demo"/);
    assert.equal(
      registry.listPrincipalPluginMaterializations(PRINCIPAL_ID, "github@openai-curated")[0]?.state,
      "installed",
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("listPrincipalPlugins 会返回已拥有 plugins，并标记当前工作区缺失状态", async () => {
  const { service, registry, workingDirectory } = createService();

  try {
    registry.savePrincipalPlugin({
      principalId: PRINCIPAL_ID,
      pluginId: "github@openai-curated",
      pluginName: "github",
      marketplaceName: "openai-curated",
      marketplacePath: "/tmp/openai-curated/marketplace.json",
      sourceType: "marketplace",
      sourceRefJson: "{\"pluginId\":\"github@openai-curated\"}",
      interfaceJson: "{\"displayName\":\"GitHub\",\"shortDescription\":\"Review PRs\"}",
      installPolicy: "AVAILABLE",
      authPolicy: "ON_INSTALL",
      enabled: true,
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });

    const result = await service.listPrincipalPlugins(PRINCIPAL_ID, {
      cwd: "/srv/repos/another",
      createSession: async () => ({
        async initialize() {},
        async request(method: string) {
          assert.equal(method, "plugin/list");
          return {
            marketplaces: [{
              name: "openai-curated",
              path: "/tmp/openai-curated/marketplace.json",
              interface: {
                displayName: "OpenAI Curated",
              },
              plugins: [{
                id: "slack@openai-curated",
                name: "slack",
                source: {
                  type: "local",
                  path: "/tmp/plugins/slack",
                },
                installed: false,
                enabled: false,
                installPolicy: "AVAILABLE",
                authPolicy: "ON_USE",
                interface: {
                  displayName: "Slack",
                  shortDescription: "Chat ops",
                  capabilities: ["Interactive"],
                  screenshots: [],
                },
              }],
            }],
            marketplaceLoadErrors: [],
            remoteSyncError: null,
            featuredPluginIds: [],
          };
        },
        async close() {},
      }),
    });

    assert.equal(result.principalPlugins[0]?.summary.owned, true);
    assert.equal(result.principalPlugins[0]?.summary.runtimeState, "missing");
    assert.equal(result.principalPlugins[0]?.sourceRef?.pluginId, "github@openai-curated");
    assert.equal(result.principalPlugins[0]?.sourceScope, "marketplace");
    assert.equal(result.principalPlugins[0]?.repairAction, "sync");
    assert.equal(result.marketplaces[0]?.plugins[0]?.owned, false);
    assert.equal(
      registry.listPrincipalPluginMaterializations(PRINCIPAL_ID, "github@openai-curated")[0]?.state,
      "missing",
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("readPrincipalPlugin 在当前 runtime 无法读取时会回退到 principal 已保存定义", async () => {
  const { service, registry, workingDirectory } = createService();

  try {
    registry.savePrincipalPlugin({
      principalId: PRINCIPAL_ID,
      pluginId: "github@openai-curated",
      pluginName: "github",
      marketplaceName: "openai-curated",
      marketplacePath: "/tmp/openai-curated/marketplace.json",
      sourceType: "repo-local",
      sourceRefJson: JSON.stringify({
        pluginId: "github@openai-curated",
        pluginName: "github",
        marketplaceName: "openai-curated",
        marketplacePath: "/tmp/openai-curated/marketplace.json",
        sourceType: "repo-local",
        sourcePath: "/srv/repos/demo/.agents/plugins/github",
        workspaceFingerprint: "/srv/repos/demo",
      }),
      sourcePath: "/srv/repos/demo/.agents/plugins/github",
      interfaceJson: "{\"displayName\":\"GitHub\",\"shortDescription\":\"Review PRs\"}",
      installPolicy: "AVAILABLE",
      authPolicy: "ON_INSTALL",
      enabled: true,
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });
    registry.savePrincipalPluginMaterialization({
      principalId: PRINCIPAL_ID,
      pluginId: "github@openai-curated",
      targetKind: "auth-account",
      targetId: "default",
      workspaceFingerprint: "/srv/repos/other",
      state: "missing",
      lastSyncedAt: "2026-04-11T00:00:00.000Z",
      lastError: "当前工作区没有这个 repo-local plugin。",
    });

    const result = await service.readPrincipalPlugin(PRINCIPAL_ID, {
      marketplacePath: "/tmp/openai-curated/marketplace.json",
      pluginName: "github",
    }, {
      cwd: "/srv/repos/other",
      createSession: async () => ({
        async initialize() {},
        async request() {
          throw new Error("runtime missing");
        },
        async close() {},
      }),
    });

    assert.equal(result.plugin.summary.id, "github@openai-curated");
    assert.equal(result.plugin.summary.runtimeState, "missing");
    assert.equal(result.plugin.sourceRef?.workspaceFingerprint, "/srv/repos/demo");
    assert.equal(result.plugin.sourceScope, "workspace-other");
    assert.equal(result.plugin.repairAction, "switch_workspace");
    assert.match(result.plugin.repairHint ?? "", /切回该工作区/);
    assert.equal(result.plugin.lastError, "当前工作区没有这个 repo-local plugin。");
    assert.equal(result.plugin.description, "Review PRs");
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("uninstallPrincipalPlugin 在当前工作区缺失时会跳过 runtime 卸载，但仍移出 principal", async () => {
  const { service, registry, workingDirectory } = createService();
  let uninstallCalls = 0;

  try {
    registry.savePrincipalPlugin({
      principalId: PRINCIPAL_ID,
      pluginId: "github@openai-curated",
      pluginName: "github",
      marketplaceName: "openai-curated",
      marketplacePath: "/tmp/openai-curated/marketplace.json",
      sourceType: "marketplace",
      sourceRefJson: "{\"pluginId\":\"github@openai-curated\"}",
      interfaceJson: "{\"displayName\":\"GitHub\"}",
      installPolicy: "AVAILABLE",
      authPolicy: "ON_INSTALL",
      enabled: true,
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });
    registry.savePrincipalPluginMaterialization({
      principalId: PRINCIPAL_ID,
      pluginId: "github@openai-curated",
      targetKind: "auth-account",
      targetId: "default",
      workspaceFingerprint: "/srv/repos/demo",
      state: "missing",
      lastSyncedAt: "2026-04-11T00:00:00.000Z",
    });

    const result = await service.uninstallPrincipalPlugin(PRINCIPAL_ID, "github@openai-curated", {
      cwd: "/srv/repos/demo",
      createSession: async () => ({
        async initialize() {},
        async request() {
          uninstallCalls += 1;
          return {};
        },
        async close() {},
      }),
    });

    assert.equal(result.runtimeAction, "skipped");
    assert.equal(uninstallCalls, 0);
    assert.equal(registry.getPrincipalPlugin(PRINCIPAL_ID, "github@openai-curated"), null);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("syncPrincipalPlugins 会把当前 principal 已拥有 plugin 同步到当前 runtime", async () => {
  const { service, registry, workingDirectory } = createService();

  try {
    registry.savePrincipalPlugin({
      principalId: PRINCIPAL_ID,
      pluginId: "github@openai-curated",
      pluginName: "github",
      marketplaceName: "openai-curated",
      marketplacePath: "/tmp/openai-curated/marketplace.json",
      sourceType: "marketplace",
      sourceRefJson: "{\"pluginId\":\"github@openai-curated\"}",
      interfaceJson: "{\"displayName\":\"GitHub\"}",
      installPolicy: "AVAILABLE",
      authPolicy: "ON_INSTALL",
      enabled: true,
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });

    const result = await service.syncPrincipalPlugins(PRINCIPAL_ID, {
      cwd: "/srv/repos/demo",
      createSession: async () => ({
        async initialize() {},
        async request(method: string) {
          if (method === "plugin/list") {
            return {
              marketplaces: [{
                name: "openai-curated",
                path: "/tmp/openai-curated/marketplace.json",
                interface: {
                  displayName: "OpenAI Curated",
                },
                plugins: [{
                  id: "github@openai-curated",
                  name: "github",
                  source: {
                    type: "local",
                    path: "/srv/repos/demo/.agents/plugins/github",
                  },
                  installed: false,
                  enabled: false,
                  installPolicy: "AVAILABLE",
                  authPolicy: "ON_INSTALL",
                  interface: {
                    displayName: "GitHub",
                    shortDescription: "Review PRs",
                    capabilities: ["Interactive"],
                    screenshots: [],
                  },
                }],
              }],
              marketplaceLoadErrors: [],
              remoteSyncError: null,
              featuredPluginIds: [],
            };
          }

          if (method === "plugin/install") {
            return {
              authPolicy: "ON_INSTALL",
              appsNeedingAuth: [],
            };
          }

          if (method === "plugin/read") {
            return {
              plugin: {
                marketplaceName: "openai-curated",
                marketplacePath: "/tmp/openai-curated/marketplace.json",
                summary: {
                  id: "github@openai-curated",
                  name: "github",
                  source: {
                    type: "local",
                    path: "/srv/repos/demo/.agents/plugins/github",
                  },
                  installed: true,
                  enabled: true,
                  installPolicy: "AVAILABLE",
                  authPolicy: "ON_INSTALL",
                  interface: {
                    displayName: "GitHub",
                    shortDescription: "Review PRs",
                    capabilities: ["Interactive"],
                    screenshots: [],
                  },
                },
                description: "GitHub workflows",
                skills: [],
                apps: [],
                mcpServers: [],
              },
            };
          }

          throw new Error(`unexpected method: ${method}`);
        },
        async close() {},
      }),
    });

    assert.equal(result.total, 1);
    assert.equal(result.installedCount, 1);
    assert.equal(result.plugins[0]?.action, "installed");
    assert.equal(
      registry.listPrincipalPluginMaterializations(PRINCIPAL_ID, "github@openai-curated")[0]?.state,
      "installed",
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("listPrincipalPlugins 会保留 auth_required 状态，直到下一次同步改写它", async () => {
  const { service, registry, workingDirectory } = createService();

  try {
    registry.savePrincipalPlugin({
      principalId: PRINCIPAL_ID,
      pluginId: "github@openai-curated",
      pluginName: "github",
      marketplaceName: "openai-curated",
      marketplacePath: "/tmp/openai-curated/marketplace.json",
      sourceType: "marketplace",
      sourceRefJson: "{\"pluginId\":\"github@openai-curated\"}",
      interfaceJson: "{\"displayName\":\"GitHub\"}",
      installPolicy: "AVAILABLE",
      authPolicy: "ON_INSTALL",
      enabled: true,
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });
    registry.savePrincipalPluginMaterialization({
      principalId: PRINCIPAL_ID,
      pluginId: "github@openai-curated",
      targetKind: "auth-account",
      targetId: "default",
      workspaceFingerprint: "/srv/repos/demo",
      state: "auth_required",
      lastSyncedAt: "2026-04-11T00:00:00.000Z",
      lastError: "待补认证 apps：GitHub",
    });

    const result = await service.listPrincipalPlugins(PRINCIPAL_ID, {
      cwd: "/srv/repos/demo",
      createSession: async () => ({
        async initialize() {},
        async request(method: string) {
          assert.equal(method, "plugin/list");
          return {
            marketplaces: [{
              name: "openai-curated",
              path: "/tmp/openai-curated/marketplace.json",
              interface: {
                displayName: "OpenAI Curated",
              },
              plugins: [{
                id: "github@openai-curated",
                name: "github",
                source: {
                  type: "local",
                  path: "/srv/repos/demo/.agents/plugins/github",
                },
                installed: false,
                enabled: false,
                installPolicy: "AVAILABLE",
                authPolicy: "ON_INSTALL",
                interface: {
                  displayName: "GitHub",
                  shortDescription: "Review PRs",
                  capabilities: ["Interactive"],
                  screenshots: [],
                },
              }],
            }],
            marketplaceLoadErrors: [],
            remoteSyncError: null,
            featuredPluginIds: [],
          };
        },
        async close() {},
      }),
    });

    assert.equal(result.principalPlugins[0]?.summary.runtimeState, "auth_required");
    assert.equal(result.principalPlugins[0]?.lastError, "待补认证 apps：GitHub");
    assert.equal(result.principalPlugins[0]?.repairAction, "reauth");
    assert.match(result.principalPlugins[0]?.repairHint ?? "", /完成认证后再执行/);
    assert.equal(
      registry.listPrincipalPluginMaterializations(PRINCIPAL_ID, "github@openai-curated")[0]?.state,
      "auth_required",
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("upgradePluginMarketplaces 只透传 principal 身份和 runtime 选项，不改 principal 记录", async () => {
  const { service, registry, workingDirectory } = createService();
  const calls: Array<{ method: string; params: unknown }> = [];

  try {
    const result = await service.upgradePluginMarketplaces(PRINCIPAL_ID, {
      marketplaceName: "openai-curated",
    }, {
      cwd: "/srv/repos/demo",
      createSession: async () => ({
        async initialize() {},
        async request(method: string, params: unknown) {
          calls.push({ method, params });
          return {
            selectedMarketplaces: ["openai-curated"],
            upgradedRoots: ["/tmp/openai-curated"],
            errors: [],
          };
        },
        async close() {},
      }),
    });

    assert.deepEqual(calls, [{
      method: "marketplace/upgrade",
      params: {
        marketplaceName: "openai-curated",
      },
    }]);
    assert.deepEqual(result.selectedMarketplaces, ["openai-curated"]);
    assert.deepEqual(result.upgradedRoots, ["/tmp/openai-curated"]);
    assert.equal(registry.listPrincipalPlugins(PRINCIPAL_ID).length, 0);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
