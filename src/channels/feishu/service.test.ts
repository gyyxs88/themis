import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CodexRuntimeCatalog } from "../../core/codex-app-server.js";
import { IdentityLinkService } from "../../core/identity-link-service.js";
import { SESSION_WORKSPACE_LOCKED_ERROR } from "../../core/session-settings-service.js";
import type { CodexTaskRuntime } from "../../core/codex-runtime.js";
import type { PrincipalTaskSettings, SessionTaskSettings } from "../../types/index.js";
import { SqliteCodexSessionRegistry } from "../../storage/index.js";
import { FeishuChannelService } from "./service.js";
import { FeishuSessionStore } from "./session-store.js";

test("/help 只展示第一层命令", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("help", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /\/settings 查看设置树/);
    assert.match(message, /\/sessions 查看最近会话/);
    assert.match(message, /\/workspace 查看或设置当前会话工作区/);
    assert.match(message, /\/quota 查看当前 Codex \/ ChatGPT 额度信息/);
    assert.doesNotMatch(message, /\/sandbox /);
    assert.doesNotMatch(message, /\/account list/);
    assert.doesNotMatch(message, /\/settings network/);
  } finally {
    harness.cleanup();
  }
});

test("/workspace 在无参数时展示当前会话工作区", async () => {
  const harness = createHarness();

  try {
    const sessionId = "session-workspace-view";
    const workspace = harness.createWorkspace("workspace-view");
    harness.setCurrentSession(sessionId);
    harness.writeSessionSettings(sessionId, {
      workspacePath: workspace,
    });

    await harness.handleCommand("workspace", []);

    const message = harness.takeSingleMessage();
    assert.match(message, new RegExp(`当前会话：${sessionId}`));
    assert.match(message, new RegExp(`当前会话工作区：${escapeRegExp(workspace)}`));
  } finally {
    harness.cleanup();
  }
});

test("/workspace <path> 会写入当前会话工作区，/ws 作为别名可用", async () => {
  const harness = createHarness();

  try {
    const sessionId = "session-workspace-write";
    const workspace = harness.createWorkspace("workspace-write");
    harness.setCurrentSession(sessionId);

    await harness.handleCommand("ws", [workspace]);

    const message = harness.takeSingleMessage();
    assert.match(message, /当前会话工作区已更新为：/);
    assert.equal(harness.readSessionSettings(sessionId)?.settings.workspacePath, workspace);
  } finally {
    harness.cleanup();
  }
});

test("/workspace <path> 只影响当前 session，不会污染 principal 与 task payload options", async () => {
  const harness = createHarness();

  try {
    const sessionId = "session-workspace-isolated";
    const workspace = harness.createWorkspace("workspace-isolated");
    harness.setCurrentSession(sessionId);

    await harness.handleCommand("settings", ["network", "off"]);
    harness.takeSingleMessage();
    const beforePrincipal = harness.getStoredPrincipalTaskSettings();

    await harness.handleCommand("workspace", [workspace]);

    const message = harness.takeSingleMessage();
    assert.match(message, /当前会话工作区已更新为：/);
    assert.deepEqual(harness.getStoredPrincipalTaskSettings(), beforePrincipal);

    const payload = harness.createTaskPayload(sessionId, "hello");
    assert.equal("workspacePath" in (payload.options ?? {}), false);
    assert.equal(payload.options?.networkAccessEnabled, false);
  } finally {
    harness.cleanup();
  }
});

test("/workspace <path> 在会话已执行任务后会拒绝修改", async () => {
  const harness = createHarness();

  try {
    const sessionId = "session-workspace-frozen";
    const workspaceA = harness.createWorkspace("workspace-frozen-a");
    const workspaceB = harness.createWorkspace("workspace-frozen-b");
    harness.setCurrentSession(sessionId);
    harness.writeSessionSettings(sessionId, {
      workspacePath: workspaceA,
    });
    harness.appendTurn(sessionId);

    await harness.handleCommand("workspace", [workspaceB]);

    const message = harness.takeSingleMessage();
    assert.match(message, new RegExp(escapeRegExp(SESSION_WORKSPACE_LOCKED_ERROR)));
    assert.equal(harness.readSessionSettings(sessionId)?.settings.workspacePath, workspaceA);
  } finally {
    harness.cleanup();
  }
});

test("/workspace 在没有激活会话时返回清晰提示", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("workspace", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /当前还没有激活会话。直接发消息时会自动创建，或使用 \/new 手动新建。/);
  } finally {
    harness.cleanup();
  }
});

test("/workspace <非法路径> 返回共享校验错误且不写入 settings", async () => {
  const harness = createHarness();

  try {
    const sessionId = "session-workspace-invalid-path";
    harness.setCurrentSession(sessionId);

    await harness.handleCommand("workspace", ["relative/project"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /只支持服务端本机绝对路径。/);
    assert.equal(harness.readSessionSettings(sessionId), null);
  } finally {
    harness.cleanup();
  }
});

test("/new 会继承当前激活会话的 workspacePath（只继承 workspacePath）", async () => {
  const harness = createHarness();

  try {
    const previousSessionId = "session-workspace-parent";
    const workspace = harness.createWorkspace("workspace-parent");
    harness.setCurrentSession(previousSessionId);
    harness.writeSessionSettings(previousSessionId, {
      workspacePath: workspace,
      profile: "custom-profile",
    });

    await harness.handleCommand("new", []);

    const message = harness.takeSingleMessage();
    const nextSessionId = parseSessionIdFromNewMessage(message);
    assert.notEqual(nextSessionId, previousSessionId);
    assert.equal(harness.getCurrentSessionId(), nextSessionId);
    assert.deepEqual(harness.readSessionSettings(nextSessionId)?.settings, {
      workspacePath: workspace,
    });
  } finally {
    harness.cleanup();
  }
});

test("/new 在工作区继承失败时会明确提示并保留新会话", async () => {
  const harness = createHarness();

  try {
    const previousSessionId = "session-workspace-parent-invalid";
    const missingWorkspace = join(harness.getWorkingDirectory(), "workspace-missing");
    harness.setCurrentSession(previousSessionId);
    harness.writeSessionSettings(previousSessionId, {
      workspacePath: missingWorkspace,
    });

    await harness.handleCommand("new", []);

    const message = harness.takeSingleMessage();
    const nextSessionId = parseSessionIdFromNewMessage(message);
    assert.match(message, /新会话已创建，但工作区继承失败/);
    assert.match(message, /工作区不存在/);
    assert.equal(harness.getCurrentSessionId(), nextSessionId);
    assert.equal(harness.readSessionSettings(nextSessionId), null);
  } finally {
    harness.cleanup();
  }
});

test("/current 会显示当前会话工作区", async () => {
  const harness = createHarness();

  try {
    const sessionId = "session-current-workspace";
    const workspace = harness.createWorkspace("workspace-current");
    harness.setCurrentSession(sessionId);
    harness.writeSessionSettings(sessionId, {
      workspacePath: workspace,
    });

    await harness.handleCommand("current", []);

    const message = harness.takeSingleMessage();
    assert.match(message, new RegExp(`当前会话：${sessionId}`));
    assert.match(message, new RegExp(`当前会话工作区：${escapeRegExp(workspace)}`));
  } finally {
    harness.cleanup();
  }
});

test("/current 在未设置工作区时显示回退文案", async () => {
  const harness = createHarness();

  try {
    const sessionId = "session-current-no-workspace";
    harness.setCurrentSession(sessionId);

    await harness.handleCommand("current", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /当前会话工作区：未设置（回退到 Themis 启动目录）/);
  } finally {
    harness.cleanup();
  }
});

test("/settings 只返回下一层配置项", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("settings", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /Themis 设置：/);
    assert.match(message, /\/settings sandbox/);
    assert.match(message, /\/settings search/);
    assert.match(message, /\/settings network/);
    assert.match(message, /\/settings approval/);
    assert.match(message, /\/settings account/);
    assert.match(message, /作用范围：Themis 中间层长期默认配置/);
    assert.doesNotMatch(message, /\/settings account use/);
  } finally {
    harness.cleanup();
  }
});

test("/settings network 只展示当前值和选项，不会修改 principal 配置", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("settings", ["network"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /设置项：\/settings network/);
    assert.match(message, /当前值：on/);
    assert.match(message, /来源：Themis 系统默认值/);
    assert.match(message, /可选值：on \| off/);
    assert.equal(harness.getStoredPrincipalTaskSettings(), null);
  } finally {
    harness.cleanup();
  }
});

test("/settings network off 会写入 principal 默认，并影响后续不同会话的新任务", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("settings", ["network", "off"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /网络访问已更新为：off/);
    assert.deepEqual(harness.getStoredPrincipalTaskSettings(), {
      networkAccessEnabled: false,
    });

    const payloadA = harness.createTaskPayload("session-a", "hello");
    const payloadB = harness.createTaskPayload("session-b", "world");
    assert.equal(payloadA.options?.networkAccessEnabled, false);
    assert.equal(payloadB.options?.networkAccessEnabled, false);
  } finally {
    harness.cleanup();
  }
});

test("/settings account 子树支持查看和切换 principal 默认认证账号", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("settings", ["account"]);
    const accountRoot = harness.takeSingleMessage();
    assert.match(accountRoot, /账号设置：/);
    assert.match(accountRoot, /\/settings account current/);
    assert.match(accountRoot, /\/settings account list/);
    assert.match(accountRoot, /\/settings account use/);

    await harness.handleCommand("settings", ["account", "use"]);
    const useHelp = harness.takeSingleMessage();
    assert.match(useHelp, /设置项：\/settings account use/);
    assert.match(useHelp, /可选输入：<账号名\|邮箱\|序号\|default>/);
    assert.match(useHelp, /1\. alpha@example\.com/);
    assert.match(useHelp, /2\. beta@example\.com/);

    await harness.handleCommand("settings", ["account", "use", "2"]);
    const updated = harness.takeSingleMessage();
    assert.match(updated, /默认认证账号已更新为：beta@example\.com/);
    assert.deepEqual(harness.getStoredPrincipalTaskSettings(), {
      authAccountId: "acc-2",
    });
    assert.equal(harness.createTaskPayload("session-a", "hello").options?.authAccountId, "acc-2");

    await harness.handleCommand("settings", ["account", "use", "default"]);
    const cleared = harness.takeSingleMessage();
    assert.match(cleared, /默认认证账号已改为：跟随 Themis 系统默认账号 alpha@example\.com/);
    assert.equal(harness.getStoredPrincipalTaskSettings(), null);
  } finally {
    harness.cleanup();
  }
});

test("旧的 /network 兼容入口仍会写入 principal 默认配置", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("network", ["off"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /网络访问已更新为：off/);
    assert.deepEqual(harness.getStoredPrincipalTaskSettings(), {
      networkAccessEnabled: false,
    });
  } finally {
    harness.cleanup();
  }
});

test("/settings foo 会回退到 settings 第一层帮助", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("settings", ["foo"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /未识别的设置项：foo/);
    assert.match(message, /\/settings sandbox/);
    assert.match(message, /\/settings account/);
  } finally {
    harness.cleanup();
  }
});

function createHarness(runtimeCatalog = createRuntimeCatalog()) {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-feishu-service-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });
  const identityService = new IdentityLinkService(runtimeStore);
  const sessionStore = new FeishuSessionStore({
    filePath: join(workingDirectory, "infra/local/feishu-sessions.json"),
  });
  const accounts = [
    {
      accountId: "acc-1",
      label: "Alpha",
      accountEmail: "alpha@example.com",
      codexHome: "/tmp/codex-alpha",
    },
    {
      accountId: "acc-2",
      label: "Beta",
      accountEmail: "beta@example.com",
      codexHome: "/tmp/codex-beta",
    },
  ];
  const runtime = {
    getRuntimeStore: () => runtimeStore,
    getIdentityLinkService: () => identityService,
    readRuntimeConfig: async (): Promise<CodexRuntimeCatalog> => runtimeCatalog,
    getPrincipalTaskSettings: (principalId?: string): PrincipalTaskSettings | null => {
      if (!principalId) {
        return null;
      }

      return runtimeStore.getPrincipalTaskSettings(principalId)?.settings ?? null;
    },
    savePrincipalTaskSettings: (principalId: string, settings: PrincipalTaskSettings): PrincipalTaskSettings => {
      const now = new Date().toISOString();
      const existing = runtimeStore.getPrincipalTaskSettings(principalId);
      runtimeStore.savePrincipalTaskSettings({
        principalId,
        settings,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      return settings;
    },
  } as unknown as CodexTaskRuntime;
  const service = new FeishuChannelService({
    runtime,
    authRuntime: {
      listAccounts: () => accounts,
      getActiveAccount: () => accounts[0] ?? null,
      readSnapshot: async (accountId?: string) => {
        const resolved = accountId
          ? accounts.find((account) => account.accountId === accountId) ?? null
          : accounts[0] ?? null;

        if (!resolved) {
          return {
            accountId: "",
            accountLabel: "",
            authenticated: false,
            authMethod: null,
            requiresOpenaiAuth: true,
            pendingLogin: null,
            lastError: null,
            providerProfile: null,
            account: null,
            rateLimits: null,
          };
        }

        return {
          accountId: resolved.accountId,
          accountLabel: resolved.label,
          authenticated: true,
          authMethod: "chatgpt",
          requiresOpenaiAuth: true,
          pendingLogin: null,
          lastError: null,
          providerProfile: null,
          account: {
            email: resolved.accountEmail,
            planType: "plus",
          },
          rateLimits: null,
        };
      },
    } as never,
    taskTimeoutMs: 5_000,
    sessionStore,
    logger: createLogger(),
  });
  const messages: string[] = [];
  const context = {
    chatId: "chat-1",
    messageId: "message-1",
    userId: "user-1",
    text: "",
  };

  (service as unknown as { safeSendText: (chatId: string, text: string) => Promise<void> }).safeSendText = async (
    _chatId,
    text,
  ) => {
    messages.push(text);
  };

  function ensurePrincipalId(): string {
    return identityService.ensureIdentity({
      channel: "feishu",
      channelUserId: context.userId,
    }).principalId;
  }

  function conversationKey() {
    return {
      chatId: context.chatId,
      userId: context.userId,
    };
  }

  return {
    async handleCommand(name: string, args: string[]) {
      await (service as unknown as {
        handleCommand(command: { name: string; args: string[]; raw: string }, incomingContext: typeof context): Promise<void>;
      }).handleCommand({ name, args, raw: `/${name} ${args.join(" ")}`.trim() }, context);
    },
    takeSingleMessage() {
      assert.equal(messages.length, 1);
      return messages.pop() ?? "";
    },
    getStoredPrincipalTaskSettings() {
      return runtimeStore.getPrincipalTaskSettings(ensurePrincipalId())?.settings ?? null;
    },
    createTaskPayload(sessionId: string, text: string) {
      return (service as unknown as {
        createTaskPayload(incomingContext: typeof context, currentSessionId: string): { options?: Record<string, unknown> };
      }).createTaskPayload({ ...context, text }, sessionId);
    },
    getWorkingDirectory() {
      return workingDirectory;
    },
    setCurrentSession(sessionId: string) {
      sessionStore.setActiveSessionId(conversationKey(), sessionId);
    },
    getCurrentSessionId() {
      return sessionStore.getActiveSessionId(conversationKey());
    },
    readSessionSettings(sessionId: string) {
      return runtimeStore.getSessionTaskSettings(sessionId);
    },
    writeSessionSettings(sessionId: string, settings: SessionTaskSettings) {
      const now = new Date().toISOString();
      const existing = runtimeStore.getSessionTaskSettings(sessionId);
      runtimeStore.saveSessionTaskSettings({
        sessionId,
        settings,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    },
    appendTurn(sessionId: string, goal = "hello") {
      const now = new Date().toISOString();
      const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      runtimeStore.upsertTurnFromRequest({
        requestId: `request-${seed}`,
        sourceChannel: "feishu",
        user: {
          userId: context.userId,
        },
        goal,
        channelContext: {
          sessionId,
        },
        createdAt: now,
      }, `task-${seed}`);
    },
    createWorkspace(name: string) {
      const workspace = join(workingDirectory, name);
      mkdirSync(workspace, { recursive: true });
      return workspace;
    },
    cleanup() {
      rmSync(workingDirectory, { recursive: true, force: true });
    },
  };
}

function createRuntimeCatalog(): CodexRuntimeCatalog {
  return {
    models: [createRuntimeModel("gpt-5.4", "medium", true)],
    defaults: {
      profile: null,
      model: "gpt-5.4",
      reasoning: "medium",
      approvalPolicy: null,
      sandboxMode: null,
      webSearchMode: null,
      networkAccessEnabled: null,
    },
    provider: {
      type: "codex-default",
      name: "Codex CLI",
      baseUrl: null,
      model: "gpt-5.4",
      lockedModel: false,
    },
    accessModes: [
      {
        id: "auth",
        label: "auth",
        description: "auth",
      },
    ],
    thirdPartyProviders: [],
    personas: [],
  };
}

function createRuntimeModel(model: string, defaultReasoningEffort: string, isDefault: boolean) {
  return {
    id: model,
    model,
    displayName: model,
    description: model,
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "low" },
      { reasoningEffort: "medium", description: "medium" },
      { reasoningEffort: "high", description: "high" },
      { reasoningEffort: "xhigh", description: "xhigh" },
    ],
    defaultReasoningEffort,
    contextWindow: 200_000,
    capabilities: {
      textInput: true,
      imageInput: false,
      supportsCodexTasks: true,
      supportsReasoningSummaries: false,
      supportsVerbosity: false,
      supportsParallelToolCalls: false,
      supportsSearchTool: true,
      supportsImageDetailOriginal: false,
    },
    supportsPersonality: true,
    supportsCodexTasks: true,
    isDefault,
  };
}

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

function parseSessionIdFromNewMessage(message: string): string {
  const matched = message.match(/已创建新会话：([^\n]+)/);
  assert.ok(matched?.[1], `无法从消息中解析会话 ID：${message}`);
  return matched[1].trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
