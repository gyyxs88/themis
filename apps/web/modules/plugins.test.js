import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultPluginsState, createPluginsController } from "./plugins.js";

test("normalizePluginsList 会把后端结果映射成前端状态", () => {
  const state = createDefaultPluginsState();
  const controller = createPluginsController(createAppStub(state));

  const result = controller.normalizePluginsList({
    principalPlugins: [{
      pluginId: "github@openai-curated",
      pluginName: "github",
      marketplaceName: "openai-curated",
      marketplacePath: "/tmp/openai-curated/marketplace.json",
      runtimeAvailable: true,
      sourceType: "repo-local",
      sourceScope: "workspace-current",
      sourcePath: "/srv/repos/demo/.agents/plugins/github",
      sourceRef: {
        sourceType: "repo-local",
        sourcePath: "/srv/repos/demo/.agents/plugins/github",
        workspaceFingerprint: "/srv/repos/demo",
      },
      currentMaterialization: {
        targetKind: "auth-account",
        targetId: "default",
        workspaceFingerprint: "/srv/repos/demo",
        state: "installed",
        lastSyncedAt: "2026-04-11T00:00:00.000Z",
      },
      lastError: "",
      repairAction: "none",
      repairHint: "",
      summary: {
        id: "github@openai-curated",
        name: "github",
        owned: true,
        runtimeInstalled: true,
        runtimeState: "installed",
        installed: true,
        enabled: true,
        installPolicy: "AVAILABLE",
        authPolicy: "ON_INSTALL",
        interface: {
          displayName: "GitHub",
          shortDescription: "Review PRs",
          capabilities: ["Interactive"],
        },
      },
    }],
    marketplaces: [{
      name: "openai-curated",
      path: "/tmp/openai-curated/marketplace.json",
      interface: {
        displayName: "OpenAI Curated",
      },
      plugins: [{
        id: "github@openai-curated",
        name: "github",
        installed: true,
        enabled: true,
        installPolicy: "AVAILABLE",
        authPolicy: "ON_INSTALL",
        interface: {
          displayName: "GitHub",
          shortDescription: "Review PRs",
          capabilities: ["Interactive"],
        },
      }],
    }],
    marketplaceLoadErrors: [{
      marketplacePath: "/tmp/broken.json",
      message: "load failed",
    }],
    remoteSyncError: "sync failed",
    featuredPluginIds: ["github@openai-curated"],
  });

  assert.equal(result.principalPlugins[0].summary.owned, true);
  assert.equal(result.principalPlugins[0].sourceRef.workspaceFingerprint, "/srv/repos/demo");
  assert.equal(result.principalPlugins[0].sourceScope, "workspace-current");
  assert.equal(result.principalPlugins[0].currentMaterialization.targetId, "default");
  assert.equal(result.marketplaces[0].name, "openai-curated");
  assert.equal(result.marketplaces[0].plugins[0].id, "github@openai-curated");
  assert.equal(result.marketplaces[0].plugins[0].interface.displayName, "GitHub");
  assert.equal(result.marketplaceLoadErrors[0].message, "load failed");
  assert.equal(result.remoteSyncError, "sync failed");
  assert.deepEqual(result.featuredPluginIds, ["github@openai-curated"]);
});

test("load 会读取当前运行环境 plugins 并回写状态", async () => {
  const state = createDefaultPluginsState();
  const app = createAppStub(state);
  const controller = createPluginsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(init.body) : null,
      });

      return jsonResponse({
        result: {
          principalPlugins: [],
          marketplaces: [{
            name: "openai-curated",
            path: "/tmp/openai-curated/marketplace.json",
            interface: {
              displayName: "OpenAI Curated",
            },
            plugins: [{
              id: "github@openai-curated",
              name: "github",
              installed: false,
              enabled: false,
              installPolicy: "AVAILABLE",
              authPolicy: "ON_INSTALL",
              interface: {
                displayName: "GitHub",
                shortDescription: "Review PRs",
                capabilities: ["Interactive"],
              },
            }],
          }],
          marketplaceLoadErrors: [],
          remoteSyncError: null,
          featuredPluginIds: [],
        },
      });
    };

    const result = await controller.load();

    assert.equal(result.marketplaces.length, 1);
    assert.equal(app.runtime.plugins.status, "ready");
    assert.equal(app.runtime.plugins.marketplaces[0].plugins[0].name, "github");
    assert.equal(calls[0].url, "/api/plugins/list");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body.channel, "web");
    assert.equal(calls[0].body.channelUserId, "browser-123");
    assert.equal(calls[0].body.displayName, "Themis Web er-123");
    assert.equal(app.renderer.renderAllCallCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("load 和 install 会优先带上当前会话工作区 cwd", async () => {
  const state = createDefaultPluginsState();
  const app = createAppStub(state, {
    workspacePath: "/srv/repos/demo",
  });
  const controller = createPluginsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        body: init.body ? JSON.parse(init.body) : null,
      });

      if (url === "/api/plugins/list") {
        return jsonResponse({
          result: {
            principalPlugins: [],
            marketplaces: [],
            marketplaceLoadErrors: [],
            remoteSyncError: null,
            featuredPluginIds: [],
          },
        });
      }

      if (url === "/api/plugins/install") {
        return jsonResponse({
          result: {
            pluginName: "github",
            marketplacePath: "/tmp/openai-curated/marketplace.json",
            authPolicy: "ON_INSTALL",
            appsNeedingAuth: [],
            plugin: null,
          },
        });
      }

      throw new Error(`unexpected fetch ${url}`);
    };

    await controller.load();
    await controller.installPlugin({
      marketplacePath: "/tmp/openai-curated/marketplace.json",
      pluginName: "github",
    });

    assert.equal(calls[0].url, "/api/plugins/list");
    assert.equal(calls[0].body.channelUserId, "browser-123");
    assert.equal(calls[0].body.cwd, "/srv/repos/demo");
    assert.equal(calls[1].url, "/api/plugins/install");
    assert.equal(calls[1].body.channelUserId, "browser-123");
    assert.equal(calls[1].body.cwd, "/srv/repos/demo");
    assert.equal(calls[2].url, "/api/plugins/list");
    assert.equal(calls[2].body.channelUserId, "browser-123");
    assert.equal(calls[2].body.cwd, "/srv/repos/demo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("togglePluginDetail 会读取详情并写入缓存", async () => {
  const state = createDefaultPluginsState();
  const app = createAppStub(state);
  const controller = createPluginsController(app);
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url, init = {}) => {
      assert.equal(url, "/api/plugins/read");
      const body = init.body ? JSON.parse(init.body) : {};
      assert.equal(body.marketplacePath, "/tmp/openai-curated/marketplace.json");
      assert.equal(body.pluginName, "github");

      return jsonResponse({
        result: {
          plugin: {
            marketplaceName: "openai-curated",
            marketplacePath: "/tmp/openai-curated/marketplace.json",
            summary: {
              id: "github@openai-curated",
              name: "github",
              installed: true,
              enabled: true,
              installPolicy: "AVAILABLE",
              authPolicy: "ON_INSTALL",
              interface: {
                displayName: "GitHub",
                shortDescription: "Review PRs",
                capabilities: ["Interactive"],
              },
            },
            description: "GitHub workflows",
            skills: [{
              name: "github-review",
              description: "review PRs",
              shortDescription: "review",
              path: "/tmp/plugins/github/skills/review",
              enabled: true,
            }],
            apps: [{
              id: "github-app",
              name: "GitHub",
              description: "GitHub app",
              installUrl: "https://github.com/apps/demo",
              needsAuth: true,
            }],
            mcpServers: ["github"],
          },
        },
      });
    };

    const detail = await controller.togglePluginDetail({
      marketplacePath: "/tmp/openai-curated/marketplace.json",
      pluginName: "github",
      pluginId: "github@openai-curated",
    });

    assert.equal(detail.summary.id, "github@openai-curated");
    assert.equal(detail.skills[0].name, "github-review");
    assert.equal(detail.apps[0].id, "github-app");
    assert.deepEqual(detail.mcpServers, ["github"]);
    assert.equal(app.runtime.plugins.expandedPluginId, "/tmp/openai-curated/marketplace.json::github@openai-curated");
    assert.equal(app.runtime.plugins.detailsById[app.runtime.plugins.expandedPluginId].summary.name, "github");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("installPlugin 和 uninstallPlugin 会调用对应接口并刷新列表", async () => {
  const state = createDefaultPluginsState();
  const app = createAppStub(state);
  const controller = createPluginsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        body: init.body ? JSON.parse(init.body) : null,
      });

      if (url === "/api/plugins/install") {
        return jsonResponse({
          result: {
            pluginName: "github",
            marketplacePath: "/tmp/openai-curated/marketplace.json",
            authPolicy: "ON_INSTALL",
            appsNeedingAuth: [],
            plugin: {
              marketplaceName: "openai-curated",
              marketplacePath: "/tmp/openai-curated/marketplace.json",
              summary: {
                id: "github@openai-curated",
                name: "github",
                installed: true,
                enabled: true,
                installPolicy: "AVAILABLE",
                authPolicy: "ON_INSTALL",
                interface: {
                  displayName: "GitHub",
                  shortDescription: "Review PRs",
                  capabilities: ["Interactive"],
                },
              },
              description: "GitHub workflows",
              skills: [],
              apps: [],
              mcpServers: [],
            },
          },
        });
      }

      if (url === "/api/plugins/uninstall") {
        return jsonResponse({
          result: {
            pluginId: "github@openai-curated",
          },
        });
      }

      if (url === "/api/plugins/list") {
        return jsonResponse({
          result: {
            principalPlugins: [],
            marketplaces: [],
            marketplaceLoadErrors: [],
            remoteSyncError: null,
            featuredPluginIds: [],
          },
        });
      }

      throw new Error(`unexpected fetch ${url}`);
    };

    const installResult = await controller.installPlugin({
      marketplacePath: "/tmp/openai-curated/marketplace.json",
      pluginName: "github",
    });
    const uninstallResult = await controller.uninstallPlugin({
      pluginId: "github@openai-curated",
      marketplacePath: "/tmp/openai-curated/marketplace.json",
      pluginName: "github",
    });

    assert.equal(installResult.pluginName, "github");
    assert.equal(uninstallResult.pluginId, "github@openai-curated");
    assert.equal(calls[0].url, "/api/plugins/install");
    assert.equal(calls[0].body.channelUserId, "browser-123");
    assert.equal(calls[0].body.marketplacePath, "/tmp/openai-curated/marketplace.json");
    assert.equal(calls[1].url, "/api/plugins/list");
    assert.equal(calls[2].url, "/api/plugins/uninstall");
    assert.equal(calls[2].body.channelUserId, "browser-123");
    assert.equal(calls[2].body.pluginId, "github@openai-curated");
    assert.equal(calls[3].url, "/api/plugins/list");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("syncPlugins 会调用同步接口并刷新列表", async () => {
  const state = createDefaultPluginsState();
  const app = createAppStub(state, {
    workspacePath: "/srv/repos/demo",
  });
  const controller = createPluginsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        body: init.body ? JSON.parse(init.body) : null,
      });

      if (url === "/api/plugins/sync") {
        return jsonResponse({
          result: {
            total: 2,
            installedCount: 1,
            alreadyInstalledCount: 0,
            authRequiredCount: 0,
            missingCount: 1,
            failedCount: 0,
            plugins: [],
          },
        });
      }

      if (url === "/api/plugins/list") {
        return jsonResponse({
          result: {
            principalPlugins: [],
            marketplaces: [],
            marketplaceLoadErrors: [],
            remoteSyncError: null,
            featuredPluginIds: [],
          },
        });
      }

      throw new Error(`unexpected fetch ${url}`);
    };

    const result = await controller.syncPlugins({
      forceRemoteSync: true,
    });

    assert.equal(result.total, 2);
    assert.equal(calls[0].url, "/api/plugins/sync");
    assert.equal(calls[0].body.channelUserId, "browser-123");
    assert.equal(calls[0].body.cwd, "/srv/repos/demo");
    assert.equal(calls[0].body.forceRemoteSync, true);
    assert.equal(calls[1].url, "/api/plugins/list");
    assert.equal(app.runtime.plugins.noticeMessage, "已同步 2 个 principal plugins，新装 1，已在当前环境 0，待认证 0，缺失 1，失败 0");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("upgradeMarketplaces 会调用升级接口并刷新列表", async () => {
  const state = createDefaultPluginsState();
  const app = createAppStub(state, {
    workspacePath: "/srv/repos/demo",
  });
  const controller = createPluginsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        body: init.body ? JSON.parse(init.body) : null,
      });

      if (url === "/api/plugins/upgrade") {
        return jsonResponse({
          result: {
            selectedMarketplaces: ["openai-curated"],
            upgradedRoots: ["/tmp/openai-curated"],
            errors: [],
          },
        });
      }

      if (url === "/api/plugins/list") {
        return jsonResponse({
          result: {
            principalPlugins: [],
            marketplaces: [],
            marketplaceLoadErrors: [],
            remoteSyncError: null,
            featuredPluginIds: [],
          },
        });
      }

      throw new Error(`unexpected fetch ${url}`);
    };

    const result = await controller.upgradeMarketplaces();

    assert.deepEqual(result.selectedMarketplaces, ["openai-curated"]);
    assert.equal(calls[0].url, "/api/plugins/upgrade");
    assert.equal(calls[0].body.channelUserId, "browser-123");
    assert.equal(calls[0].body.cwd, "/srv/repos/demo");
    assert.equal(calls[1].url, "/api/plugins/list");
    assert.equal(app.runtime.plugins.noticeMessage, "marketplace 升级完成，选中 1 个，更新根目录 1 个，失败 0 个");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createAppStub(pluginsState, options = {}) {
  return {
    runtime: {
      plugins: pluginsState,
      identity: {
        browserUserId: options.browserUserId ?? "browser-123",
      },
      auth: {
        account: options.authAccount ?? null,
      },
    },
    store: {
      getActiveThread() {
        return options.workspacePath
          ? {
            settings: {
              workspacePath: options.workspacePath,
            },
          }
          : null;
      },
    },
    utils: {
      safeReadJson: async (response) => response.json(),
    },
    renderer: {
      renderAllCallCount: 0,
      renderAll() {
        this.renderAllCallCount += 1;
      },
    },
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
