import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PluginService,
  type PluginCreateSessionInput,
} from "./plugin-service.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

function createService(): {
  service: PluginService;
  registry: SqliteCodexSessionRegistry;
  workingDirectory: string;
} {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-plugin-service-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });

  return {
    service: new PluginService({
      workingDirectory,
      registry,
    }),
    registry,
    workingDirectory,
  };
}

test("listPlugins 会返回 marketplace、plugin 摘要和当前 auth 槽位", async () => {
  const { service, workingDirectory } = createService();
  let sessionInput: PluginCreateSessionInput | null = null;

  try {
    const result = await service.listPlugins({
      cwd: workingDirectory,
      activeAuthAccount: {
        accountId: "acc-1",
        codexHome: join(workingDirectory, "infra/local/codex-auth/acc-1"),
      },
      createSession: async (input: PluginCreateSessionInput) => {
        sessionInput = input;
        return {
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
                    path: "/tmp/plugins/github",
                  },
                  installed: true,
                  enabled: true,
                  installPolicy: "AVAILABLE",
                  authPolicy: "ON_INSTALL",
                  interface: {
                    displayName: "GitHub",
                    shortDescription: "Triage PRs",
                    longDescription: null,
                    developerName: "OpenAI",
                    category: "Coding",
                    capabilities: ["Interactive", "Write"],
                    websiteUrl: "https://github.com/",
                    privacyPolicyUrl: null,
                    termsOfServiceUrl: null,
                    defaultPrompt: ["Inspect PRs"],
                    brandColor: "#24292F",
                    composerIcon: null,
                    logo: null,
                    screenshots: [],
                  },
                }],
              }],
              marketplaceLoadErrors: [],
              remoteSyncError: null,
              featuredPluginIds: ["github@openai-curated"],
            };
          },
          async close() {},
        };
      },
    });

    assert.ok(sessionInput, "应该拿到 createSession 入参");
    const capturedSessionInput = sessionInput as PluginCreateSessionInput;
    assert.equal(capturedSessionInput.target.targetId, "acc-1");
    assert.equal(capturedSessionInput.env?.CODEX_HOME, join(workingDirectory, "infra/local/codex-auth/acc-1"));
    assert.equal(capturedSessionInput.configOverrides["cli_auth_credentials_store"], "file");
    assert.equal(result.target.targetId, "acc-1");
    assert.equal(result.marketplaces.length, 1);
    assert.equal(result.marketplaces[0]?.name, "openai-curated");
    assert.equal(result.marketplaces[0]?.plugins[0]?.id, "github@openai-curated");
    assert.equal(result.marketplaces[0]?.plugins[0]?.installed, true);
    assert.equal(result.marketplaces[0]?.plugins[0]?.interface?.displayName, "GitHub");
    assert.deepEqual(result.featuredPluginIds, ["github@openai-curated"]);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("installPlugin 会返回安装结果并补读 plugin 详情", async () => {
  const { service, workingDirectory } = createService();
  const calls: Array<{ method: string; params: unknown }> = [];

  try {
    const result = await service.installPlugin({
      marketplacePath: "/tmp/openai-curated/marketplace.json",
      pluginName: "github",
    }, {
      createSession: async () => ({
        async initialize() {},
        async request(method: string, params: unknown) {
          calls.push({ method, params });

          if (method === "plugin/install") {
            return {
              authPolicy: "ON_INSTALL",
              appsNeedingAuth: [{
                id: "github-app",
                name: "GitHub",
                description: "GitHub app",
                installUrl: "https://github.com/apps/demo",
                needsAuth: true,
              }],
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
                    path: "/tmp/plugins/github",
                  },
                  installed: true,
                  enabled: true,
                  installPolicy: "AVAILABLE",
                  authPolicy: "ON_INSTALL",
                  interface: {
                    displayName: "GitHub",
                    shortDescription: "Triage PRs",
                    longDescription: null,
                    developerName: "OpenAI",
                    category: "Coding",
                    capabilities: ["Interactive"],
                    websiteUrl: null,
                    privacyPolicyUrl: null,
                    termsOfServiceUrl: null,
                    defaultPrompt: null,
                    brandColor: null,
                    composerIcon: null,
                    logo: null,
                    screenshots: [],
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
                apps: [],
                mcpServers: ["github"],
              },
            };
          }

          throw new Error(`unexpected method: ${method}`);
        },
        async close() {},
      }),
    });

    assert.deepEqual(calls, [
      {
        method: "plugin/install",
        params: {
          marketplacePath: "/tmp/openai-curated/marketplace.json",
          pluginName: "github",
        },
      },
      {
        method: "plugin/read",
        params: {
          marketplacePath: "/tmp/openai-curated/marketplace.json",
          pluginName: "github",
        },
      },
    ]);
    assert.equal(result.authPolicy, "ON_INSTALL");
    assert.equal(result.appsNeedingAuth[0]?.id, "github-app");
    assert.equal(result.plugin?.summary.id, "github@openai-curated");
    assert.equal(result.plugin?.skills[0]?.name, "github-review");
    assert.deepEqual(result.plugin?.mcpServers, ["github"]);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("uninstallPlugin 会透传 pluginId", async () => {
  const { service, workingDirectory } = createService();
  const calls: Array<{ method: string; params: unknown }> = [];

  try {
    const result = await service.uninstallPlugin({
      pluginId: "github@openai-curated",
      forceRemoteSync: true,
    }, {
      createSession: async () => ({
        async initialize() {},
        async request(method: string, params: unknown) {
          calls.push({ method, params });
          return {};
        },
        async close() {},
      }),
    });

    assert.equal(result.pluginId, "github@openai-curated");
    assert.equal(result.target.targetId, "default");
    assert.deepEqual(calls, [{
      method: "plugin/uninstall",
      params: {
        pluginId: "github@openai-curated",
        forceRemoteSync: true,
      },
    }]);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
