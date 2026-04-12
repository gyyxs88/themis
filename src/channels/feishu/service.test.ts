import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CodexAppServerNotification, CodexRuntimeCatalog } from "../../core/codex-app-server.js";
import { AppServerActionBridge } from "../../core/app-server-action-bridge.js";
import { AppServerTaskRuntime } from "../../core/app-server-task-runtime.js";
import { IdentityLinkService } from "../../core/identity-link-service.js";
import { PrincipalMcpService } from "../../core/principal-mcp-service.js";
import { SESSION_WORKSPACE_LOCKED_ERROR } from "../../core/session-settings-service.js";
import type { CodexTaskRuntime } from "../../core/codex-runtime.js";
import type {
  PrincipalTaskSettings,
  SessionTaskSettings,
  StoredScheduledTaskRecord,
  StoredScheduledTaskRunRecord,
  TaskPendingActionSubmitRequest,
  TaskEvent,
  TaskRequest,
  TaskResult,
  TaskRuntimeFacade,
  TaskRuntimeRunHooks,
} from "../../types/index.js";
import { SqliteCodexSessionRegistry } from "../../storage/index.js";
import type { ThemisUpdateService } from "../../diagnostics/update-service.js";
import { FeishuDiagnosticsStateStore } from "./diagnostics-state-store.js";
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

test("/update 会展示当前实例更新状态", async () => {
  const harness = createHarness({
    updateService: {
      async readOverview() {
        return {
          check: {
            packageVersion: "0.1.0",
            currentCommit: "1234567890abcdef",
            currentBranch: "main",
            currentCommitSource: "git",
            updateChannel: "release",
            updateSourceRepo: "gyyxs88/themis",
            updateSourceUrl: "https://github.com/gyyxs88/themis",
            updateSourceDefaultBranch: "main",
            latestCommit: "abcdef1234567890",
            latestCommitDate: "2026-04-11T00:00:00.000Z",
            latestCommitUrl: "https://github.com/gyyxs88/themis/commit/abcdef1234567890",
            latestReleaseTag: "v0.1.0",
            latestReleaseName: "v0.1.0",
            latestReleasePublishedAt: "2026-04-11T00:00:00.000Z",
            latestReleaseUrl: "https://github.com/gyyxs88/themis/releases/tag/v0.1.0",
            comparisonStatus: "identical",
            outcome: "up_to_date",
            summary: "当前已经是 GitHub 最新正式 release。",
            errorMessage: null,
          },
          operation: null,
          rollbackAnchor: {
            available: false,
            previousCommit: null,
            currentCommit: null,
            appliedReleaseTag: null,
            recordedAt: null,
          },
        };
      },
      async startApply() {
        throw new Error("not used");
      },
      async startRollback() {
        throw new Error("not used");
      },
    },
  });

  try {
    await harness.handleCommand("update", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /Themis 更新状态：/);
    assert.match(message, /更新渠道：release/);
    assert.match(message, /最新 release：v0\.1\.0/);
    assert.match(message, /执行升级：\/update apply confirm/);
  } finally {
    harness.cleanup();
  }
});

test("/update apply 在缺少 confirm 时只返回安全提示，不会真正启动升级", async () => {
  const calls: string[] = [];
  const harness = createHarness({
    updateService: {
      async readOverview() {
        throw new Error("not used");
      },
      async startApply() {
        calls.push("apply");
        throw new Error("not used");
      },
      async startRollback() {
        throw new Error("not used");
      },
    },
  });

  try {
    await harness.handleCommand("update", ["apply"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /这是高风险操作/);
    assert.match(message, /确认执行：\/update apply confirm/);
    assert.deepEqual(calls, []);
  } finally {
    harness.cleanup();
  }
});

test("/update apply confirm 会启动后台升级", async () => {
  const calls: Array<{ channel?: string; channelUserId?: string; chatId?: string | null }> = [];
  const harness = createHarness({
    updateService: {
      async readOverview() {
        throw new Error("not used");
      },
      async startApply(input) {
        calls.push(input.initiatedBy);
        return {
          action: "apply",
          status: "running",
          startedAt: "2026-04-11T00:00:00.000Z",
          updatedAt: "2026-04-11T00:00:00.000Z",
          finishedAt: null,
          initiatedBy: {
            channel: "feishu",
            channelUserId: "user-1",
            displayName: "user-1",
            chatId: "chat-1",
          },
          progressStep: "preflight",
          progressMessage: "已受理后台升级请求，正在准备执行。",
          result: null,
          errorMessage: null,
        };
      },
      async startRollback() {
        throw new Error("not used");
      },
    },
  });

  try {
    await harness.handleCommand("update", ["apply", "confirm"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /后台升级已启动。/);
    assert.match(message, /稍后可发送 \/update 查看最终状态。/);
    assert.deepEqual(calls, [{
      channel: "feishu",
      channelUserId: "user-1",
      displayName: "user-1",
      chatId: "chat-1",
    }]);
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

test("/current 会显示当前会话的 native thread 摘要", async () => {
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      readThreadSnapshot: async ({ threadId }) => ({
        threadId,
        preview: "ship mobile session summary",
        status: "running",
        cwd: "/workspace/themis",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        turnCount: 6,
        turns: [],
      }),
      async runTask(request, hooks = {}) {
        taskRuntimeCalls.appServer += 1;
        const sessionId = request.channelContext.channelSessionKey ?? "session-current-thread";
        const storedRequest = {
          ...request,
          channelContext: {
            ...request.channelContext,
            sessionId,
          },
        };
        runtimeStore.upsertTurnFromRequest(storedRequest, request.taskId ?? "task-current-thread");
        runtimeStore.saveSession({
          sessionId,
          threadId: "thread-current-1",
          createdAt: request.createdAt,
          updatedAt: request.createdAt,
        });

        const result: TaskResult = {
          taskId: request.taskId ?? "task-current-thread",
          requestId: request.requestId,
          status: "completed",
          summary: request.goal,
          output: request.goal,
          structuredOutput: {
            session: {
              engine: "app-server",
              threadId: "thread-current-1",
            },
          },
          completedAt: new Date().toISOString(),
        };

        const finalized = hooks.finalizeResult ? await hooks.finalizeResult(request, result) : result;
        runtimeStore.completeTaskTurn({
          request: storedRequest,
          result: finalized,
          sessionMode: "resumed",
          threadId: "thread-current-1",
        });
        return finalized;
      },
    }),
  } as FeishuHarnessConfig);

  try {
    await harness.handleIncomingText("先创建一条 app-server 会话");
    harness.takeMessages();
    await harness.handleCommand("current", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /thread-current-1/);
    assert.match(message, /ship mobile session summary/);
    assert.match(message, /任务状态：completed/);
  } finally {
    harness.cleanup();
  }
});

test("定时任务回执会在飞书切换会话后仍发回原 chat", async () => {
  const harness = createHarness();

  try {
    harness.setCurrentSession("session-feishu-scheduled-old-1");
    harness.setCurrentSession("session-feishu-scheduled-new-1");

    const delivered = await harness.notifyScheduledTaskResult({
      task: {
        scheduledTaskId: "scheduled-task-feishu-1",
        principalId: harness.getCurrentPrincipalId(),
        sourceChannel: "feishu",
        channelUserId: "user-1",
        sessionId: "session-feishu-scheduled-old-1",
        channelSessionKey: "session-feishu-scheduled-old-1",
        goal: "检查生产告警",
        timezone: "Asia/Shanghai",
        scheduledAt: "2026-04-09T09:00:00.000Z",
        status: "completed",
        createdAt: "2026-04-09T08:00:00.000Z",
        updatedAt: "2026-04-09T09:00:10.000Z",
        completedAt: "2026-04-09T09:00:10.000Z",
      } satisfies StoredScheduledTaskRecord,
      run: {
        runId: "scheduled-run-feishu-1",
        scheduledTaskId: "scheduled-task-feishu-1",
        principalId: harness.getCurrentPrincipalId(),
        schedulerId: "scheduler-scheduled-main",
        leaseToken: "lease-feishu-1",
        leaseExpiresAt: "2026-04-09T09:05:00.000Z",
        status: "completed",
        triggeredAt: "2026-04-09T09:00:00.000Z",
        completedAt: "2026-04-09T09:00:10.000Z",
        resultSummary: "检查完成，没有发现新的高优先级告警。",
        createdAt: "2026-04-09T09:00:00.000Z",
        updatedAt: "2026-04-09T09:00:10.000Z",
      } satisfies StoredScheduledTaskRunRecord,
      outcome: "completed",
    });

    assert.equal(delivered, true);
    const message = harness.takeSingleMessage();
    assert.match(message, /状态：已完成/);
    assert.match(message, /任务：检查生产告警/);
    assert.match(message, /结果摘要：检查完成，没有发现新的高优先级告警。/);
    assert.match(message, /\[定时任务回执\]/);
  } finally {
    harness.cleanup();
  }
});

test("飞书 /use 会把当前会话快照和 session.switched 写入诊断状态", async () => {
  const harness = createHarness();

  try {
    const sessionA = "session-feishu-diagnostics-a";
    const sessionB = "session-feishu-diagnostics-b";
    harness.seedAppServerSession(sessionA, {
      threadId: "thread-feishu-diagnostics-a",
      goal: "seed session A",
    });
    harness.seedAppServerSession(sessionB, {
      threadId: "thread-feishu-diagnostics-b",
      goal: "seed session B",
    });
    harness.setCurrentSession(sessionB);

    await harness.handleCommand("use", [sessionA]);

    const snapshot = harness.readFeishuDiagnosticsStore();
    assert.equal(snapshot.status, "ok");
    assert.equal(snapshot.conversations[0]?.activeSessionId, sessionA);
    assert.equal(snapshot.conversations[0]?.lastEventType, "session.switched");
    assert.equal(snapshot.recentEvents.at(-1)?.type, "session.switched");
    assert.equal(snapshot.recentEvents.at(-1)?.details?.switchedSessionId, sessionA);
  } finally {
    harness.cleanup();
  }
});

test("飞书 duplicate / stale 消息会写入诊断事件", async () => {
  const harness = createHarness();

  try {
    const firstMessage = {
      message: {
        chat_id: "chat-dup-1",
        message_id: "message-dup-1",
        create_time: "1711958400000",
        message_type: "text",
        chat_type: "p2p",
        content: JSON.stringify({ text: "第一条消息" }),
      },
      sender: {
        sender_id: {
          user_id: "user-dup-1",
        },
      },
    };
    const duplicateMessage = {
      ...firstMessage,
      message: {
        ...firstMessage.message,
      },
    };
    const staleMessage = {
      message: {
        chat_id: "chat-dup-1",
        message_id: "message-dup-2",
        create_time: "1711958399000",
        message_type: "text",
        chat_type: "p2p",
        content: JSON.stringify({ text: "更旧的消息" }),
      },
      sender: {
        sender_id: {
          user_id: "user-dup-1",
        },
      },
    };

    await harness.handleRawMessageEvent(firstMessage);
    harness.takeMessages();

    await harness.handleRawMessageEvent(duplicateMessage);
    let snapshot = harness.readFeishuDiagnosticsStore();
    assert.equal(snapshot.status, "ok");
    assert.equal(snapshot.recentEvents.at(-1)?.type, "message.duplicate_ignored");
    assert.equal(snapshot.recentEvents.at(-1)?.messageId, "message-dup-1");
    assert.equal(snapshot.recentEvents.at(-1)?.sessionId, snapshot.conversations[0]?.activeSessionId);
    assert.equal(snapshot.recentEvents.at(-1)?.principalId, harness.getCurrentPrincipalId());
    assert.equal(snapshot.recentEvents.at(-1)?.details?.dedupeWindowMs, 600_000);

    await harness.handleRawMessageEvent(staleMessage);
    snapshot = harness.readFeishuDiagnosticsStore();
    assert.equal(snapshot.status, "ok");
    assert.equal(snapshot.recentEvents.at(-1)?.type, "message.stale_ignored");
    assert.equal(snapshot.recentEvents.at(-1)?.details?.messageCreateTimeMs, 1711958399000);
    assert.equal(snapshot.recentEvents.at(-1)?.details?.latestCreateTimeMs, 1711958400000);
  } finally {
    harness.cleanup();
  }
});

test("群聊默认 smart 路由会忽略未显式触达的首条普通文本", async () => {
  const harness = createHarness();

  try {
    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-smart-ignored",
      userId: "user-group-smart-ignored",
      messageId: "message-group-smart-ignored-1",
      chatType: "group",
      createTime: "1711958400000",
      text: "大家先看一下这段日志",
    }));

    assert.deepEqual(harness.takeMessages(), []);
    assert.equal(harness.getTaskRequests().length, 0);

    const snapshot = harness.readFeishuDiagnosticsStore();
    assert.equal(snapshot.status, "ok");
    assert.equal(snapshot.recentEvents.at(-1)?.type, "message.route_ignored");
    assert.equal(snapshot.recentEvents.at(-1)?.details?.chatType, "group");
    assert.equal(snapshot.recentEvents.at(-1)?.details?.routePolicy, "smart");
    assert.equal(snapshot.recentEvents.at(-1)?.details?.reason, "group_requires_explicit_trigger");
  } finally {
    harness.cleanup();
  }
});

test("群聊 smart 路由会在显式触达后短时放开同一用户的后续普通文本", async () => {
  const harness = createHarness();

  try {
    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-smart-followup",
      userId: "user-group-smart-followup",
      messageId: "message-group-smart-followup-1",
      chatType: "group",
      createTime: "1711958400000",
      text: "@themis 帮我看看这段日志",
      mentions: [{ key: "@themis" }],
    }));

    assert.equal(harness.getTaskRequests().length, 1);
    harness.takeMessages();

    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-smart-followup",
      userId: "user-group-smart-followup",
      messageId: "message-group-smart-followup-2",
      chatType: "group",
      createTime: "1711958401000",
      text: "再补一句上下文",
    }));

    const requests = harness.getTaskRequests();
    assert.equal(requests.length, 2);
    assert.equal(
      requests[0]?.channelContext.channelSessionKey,
      requests[1]?.channelContext.channelSessionKey,
    );
  } finally {
    harness.cleanup();
  }
});

test("群聊 always 路由会让未显式触达的普通文本直接进入任务链", async () => {
  const harness = createHarness();

  try {
    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-always-route",
      userId: "user-group-always-owner",
      messageId: "message-group-always-route-config",
      chatType: "group",
      createTime: "1711958400000",
      text: "/group route always",
    }));
    harness.takeMessages();

    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-always-route",
      userId: "user-group-always-member",
      messageId: "message-group-always-route-1",
      chatType: "group",
      createTime: "1711958401000",
      text: "不用 @ 机器人也直接进入任务链",
    }));

    const requests = harness.getTaskRequests();
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.goal, "不用 @ 机器人也直接进入任务链");
  } finally {
    harness.cleanup();
  }
});

test("群聊 shared 会话策略会让不同用户复用同一会话", async () => {
  const harness = createHarness();

  try {
    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-shared",
      userId: "user-group-owner",
      messageId: "message-group-shared-config",
      chatType: "group",
      createTime: "1711958400000",
      text: "/group session shared",
    }));
    harness.takeMessages();

    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-shared",
      userId: "user-group-owner",
      messageId: "message-group-shared-1",
      chatType: "group",
      createTime: "1711958401000",
      text: "@themis 建立共享群会话",
      mentions: [{ key: "@themis" }],
    }));
    harness.takeMessages();

    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-shared",
      userId: "user-group-member",
      messageId: "message-group-shared-2",
      chatType: "group",
      createTime: "1711958402000",
      text: "我继续补充第二段上下文",
    }));

    const requests = harness.getTaskRequests();
    assert.equal(requests.length, 2);
    assert.equal(
      requests[0]?.channelContext.channelSessionKey,
      requests[1]?.channelContext.channelSessionKey,
    );

    const settings = harness.readFeishuChatSettingsStore();
    assert.equal(settings?.chats?.[0]?.sessionScope, "shared");
  } finally {
    harness.cleanup();
  }
});

test("群聊 shared 会话下非管理员不能切会话或修改工作区", async () => {
  const harness = createHarness();

  try {
    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-shared-admin-only",
      userId: "user-group-shared-admin-owner",
      messageId: "message-group-shared-admin-only-1",
      chatType: "group",
      createTime: "1711958400000",
      text: "/group session shared",
    }));
    harness.takeMessages();

    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-shared-admin-only",
      userId: "user-group-shared-admin-member",
      messageId: "message-group-shared-admin-only-2",
      chatType: "group",
      createTime: "1711958401000",
      text: "/new",
    }));

    assert.match(harness.takeSingleMessage(), /当前群是 shared 会话，只有群管理员才能执行 \/new/);

    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-shared-admin-only",
      userId: "user-group-shared-admin-member",
      messageId: "message-group-shared-admin-only-3",
      chatType: "group",
      createTime: "1711958402000",
      text: "/workspace /tmp/themis-shared-group",
    }));

    assert.match(harness.takeSingleMessage(), /当前群是 shared 会话，只有群管理员才能执行 \/workspace/);
  } finally {
    harness.cleanup();
  }
});

test("群聊 personal 会话策略会继续按用户隔离会话", async () => {
  const harness = createHarness();

  try {
    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-personal",
      userId: "user-group-personal-owner",
      messageId: "message-group-personal-config",
      chatType: "group",
      createTime: "1711958400000",
      text: "/group session personal",
    }));
    harness.takeMessages();

    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-personal",
      userId: "user-group-personal-a",
      messageId: "message-group-personal-a",
      chatType: "group",
      createTime: "1711958401000",
      text: "@themis 用户 A 的会话",
      mentions: [{ key: "@themis" }],
    }));
    harness.takeMessages();

    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-personal",
      userId: "user-group-personal-b",
      messageId: "message-group-personal-b",
      chatType: "group",
      createTime: "1711958402000",
      text: "@themis 用户 B 的会话",
      mentions: [{ key: "@themis" }],
    }));

    const requests = harness.getTaskRequests();
    assert.equal(requests.length, 2);
    assert.notEqual(
      requests[0]?.channelContext.channelSessionKey,
      requests[1]?.channelContext.channelSessionKey,
    );
  } finally {
    harness.cleanup();
  }
});

test("群管理员首次配置会自动认领，之后非管理员不能修改群设置", async () => {
  const harness = createHarness();

  try {
    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-admin-bootstrap",
      userId: "user-group-admin-owner",
      messageId: "message-group-admin-bootstrap-1",
      chatType: "group",
      createTime: "1711958400000",
      text: "/group route always",
    }));

    const firstMessage = harness.takeSingleMessage();
    assert.match(firstMessage, /已将你设为当前群的首个 Themis 管理员/);
    assert.match(firstMessage, /群消息路由已更新为：always/);

    let settings = harness.readFeishuChatSettingsStore();
    assert.deepEqual(settings?.chats?.[0]?.adminUserIds, ["user-group-admin-owner"]);
    assert.equal(settings?.chats?.[0]?.routePolicy, "always");

    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-admin-bootstrap",
      userId: "user-group-admin-other",
      messageId: "message-group-admin-bootstrap-2",
      chatType: "group",
      createTime: "1711958401000",
      text: "/group session shared",
    }));

    const deniedMessage = harness.takeSingleMessage();
    assert.match(deniedMessage, /只有当前群的 Themis 管理员才能修改群设置/);

    settings = harness.readFeishuChatSettingsStore();
    assert.equal(settings?.chats?.[0]?.sessionScope, "personal");
  } finally {
    harness.cleanup();
  }
});

test("群管理员可以维护管理员名单，但不能移除最后一个管理员", async () => {
  const harness = createHarness();

  try {
    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-admin-manage",
      userId: "user-group-admin-owner",
      messageId: "message-group-admin-manage-1",
      chatType: "group",
      createTime: "1711958400000",
      text: "/group route always",
    }));
    harness.takeMessages();

    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-admin-manage",
      userId: "user-group-admin-owner",
      messageId: "message-group-admin-manage-2",
      chatType: "group",
      createTime: "1711958401000",
      text: "/group admin add user-group-admin-member",
    }));

    const addMessage = harness.takeSingleMessage();
    assert.match(addMessage, /已添加群管理员：user-group-admin-member/);

    let settings = harness.readFeishuChatSettingsStore();
    assert.deepEqual(settings?.chats?.[0]?.adminUserIds, [
      "user-group-admin-owner",
      "user-group-admin-member",
    ]);

    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-admin-manage",
      userId: "user-group-admin-member",
      messageId: "message-group-admin-manage-3",
      chatType: "group",
      createTime: "1711958402000",
      text: "/group route smart",
    }));

    const memberWriteMessage = harness.takeSingleMessage();
    assert.match(memberWriteMessage, /群消息路由已更新为：smart/);

    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-admin-manage",
      userId: "user-group-admin-member",
      messageId: "message-group-admin-manage-4",
      chatType: "group",
      createTime: "1711958403000",
      text: "/group admin remove user-group-admin-owner",
    }));

    const removeOwnerMessage = harness.takeSingleMessage();
    assert.match(removeOwnerMessage, /已移除群管理员：user-group-admin-owner/);

    settings = harness.readFeishuChatSettingsStore();
    assert.deepEqual(settings?.chats?.[0]?.adminUserIds, ["user-group-admin-member"]);

    await harness.handleRawMessageEvent(createFeishuTextEvent({
      chatId: "chat-group-admin-manage",
      userId: "user-group-admin-member",
      messageId: "message-group-admin-manage-5",
      chatType: "group",
      createTime: "1711958404000",
      text: "/group admin remove user-group-admin-member",
    }));

    const removeLastDeniedMessage = harness.takeSingleMessage();
    assert.match(removeLastDeniedMessage, /至少保留 1 个群管理员/);

    settings = harness.readFeishuChatSettingsStore();
    assert.deepEqual(settings?.chats?.[0]?.adminUserIds, ["user-group-admin-member"]);
  } finally {
    harness.cleanup();
  }
});

test("飞书 direct-text takeover 会写入 takeover.submitted 并刷新 pendingActions", async () => {
  const harness = createHarness();

  try {
    harness.injectPendingAction({
      actionId: "takeover-1",
      requestId: "request-1",
      actionType: "user-input",
      prompt: "Please add details",
    });

    await harness.handleMessageEventText("继续执行");

    assert.deepEqual(harness.getResolvedActionSubmissions(), [{
      taskId: "task-pending-action",
      requestId: "request-1",
      actionId: "takeover-1",
      inputText: "继续执行",
    }]);

    const snapshot = harness.readFeishuDiagnosticsStore();
    assert.equal(snapshot.status, "ok");
    assert.equal(snapshot.conversations[0]?.lastEventType, "takeover.submitted");
    assert.equal(snapshot.conversations[0]?.pendingActions.length, 0);
    assert.equal(snapshot.recentEvents.at(-1)?.type, "takeover.submitted");
    assert.equal(snapshot.recentEvents.at(-1)?.requestId, "request-1");
    assert.equal(snapshot.recentEvents.at(-1)?.summary, "普通文本已提交补充输入。");
    assert.equal(snapshot.recentEvents.at(-1)?.details?.matchedPendingActionCount, 1);
    assert.equal(snapshot.recentEvents.at(-1)?.details?.sourceSessionId, harness.getCurrentSessionId());
  } finally {
    harness.cleanup();
  }
});

test("飞书 /reply 会写入 reply.submitted 并刷新 pendingActions", async () => {
  const harness = createHarness();

  try {
    harness.injectPendingAction({
      actionId: "reply-diagnostics-1",
      actionType: "user-input",
      prompt: "Please add details",
    });

    await harness.handleCommand("reply", ["reply-diagnostics-1", "继续", "补充"]);

    assert.deepEqual(harness.getResolvedActionSubmissions(), [{
      taskId: "task-pending-action",
      requestId: "req-pending-action",
      actionId: "reply-diagnostics-1",
      inputText: "继续 补充",
    }]);

    const snapshot = harness.readFeishuDiagnosticsStore();
    assert.equal(snapshot.status, "ok");
    assert.equal(snapshot.conversations[0]?.lastEventType, "reply.submitted");
    assert.equal(snapshot.conversations[0]?.pendingActions.length, 0);
    assert.equal(snapshot.recentEvents.at(-1)?.type, "reply.submitted");
    assert.equal(snapshot.recentEvents.at(-1)?.requestId, "req-pending-action");
    assert.equal(snapshot.recentEvents.at(-1)?.summary, "命令式 reply 已提交补充输入。");
    assert.equal(snapshot.recentEvents.at(-1)?.details?.matchedPendingActionCount, 1);
    assert.equal(snapshot.recentEvents.at(-1)?.details?.sourceSessionId, harness.getCurrentSessionId());
  } finally {
    harness.cleanup();
  }
});

test("飞书 /approve 提交失败时会写入结构化 approval.submit_failed 事件", async () => {
  const harness = createHarness({
    resolveFailureActionIds: ["approval-fail-1"],
  });

  try {
    harness.injectPendingAction({
      actionId: "approval-fail-1",
      requestId: "request-approval-fail-1",
      actionType: "approval",
      prompt: "Allow command?",
    });

    await harness.handleCommand("approve", ["approval-fail-1"]);

    const snapshot = harness.readFeishuDiagnosticsStore();
    assert.equal(snapshot.status, "ok");
    assert.equal(snapshot.recentEvents.at(-1)?.type, "approval.submit_failed");
    assert.equal(snapshot.recentEvents.at(-1)?.actionId, "approval-fail-1");
    assert.equal(snapshot.recentEvents.at(-1)?.requestId, "request-approval-fail-1");
    assert.equal(snapshot.recentEvents.at(-1)?.messageId, "message-1");
    assert.equal(snapshot.recentEvents.at(-1)?.sessionId, harness.getCurrentSessionId());
    assert.equal(snapshot.recentEvents.at(-1)?.principalId, harness.getCurrentPrincipalId());
    assert.equal(snapshot.recentEvents.at(-1)?.summary, "审批提交失败：approval-fail-1 已失效。");
    assert.equal(snapshot.recentEvents.at(-1)?.details?.matchedPendingActionCount, 1);
    assert.equal(snapshot.recentEvents.at(-1)?.details?.sourceSessionId, harness.getCurrentSessionId());
  } finally {
    harness.cleanup();
  }
});

test("飞书 direct-text takeover 提交失败时会写入结构化 takeover.submit_failed 事件", async () => {
  const harness = createHarness({
    resolveFailureActionIds: ["takeover-fail-1"],
  });

  try {
    harness.injectPendingAction({
      actionId: "takeover-fail-1",
      requestId: "request-takeover-fail-1",
      actionType: "user-input",
      prompt: "Please add details",
    });

    await harness.handleMessageEventText("继续执行");

    const snapshot = harness.readFeishuDiagnosticsStore();
    assert.equal(snapshot.status, "ok");
    assert.equal(snapshot.recentEvents.at(-1)?.type, "takeover.submit_failed");
    assert.equal(snapshot.recentEvents.at(-1)?.actionId, "takeover-fail-1");
    assert.equal(snapshot.recentEvents.at(-1)?.requestId, "request-takeover-fail-1");
    assert.equal(snapshot.recentEvents.at(-1)?.messageId, "message-1");
    assert.equal(snapshot.recentEvents.at(-1)?.sessionId, harness.getCurrentSessionId());
    assert.equal(snapshot.recentEvents.at(-1)?.principalId, harness.getCurrentPrincipalId());
    assert.equal(snapshot.recentEvents.at(-1)?.summary, "普通文本补充输入失败：takeover-fail-1 已失效。");
    assert.equal(snapshot.recentEvents.at(-1)?.details?.matchedPendingActionCount, 1);
    assert.equal(snapshot.recentEvents.at(-1)?.details?.sourceSessionId, harness.getCurrentSessionId());
  } finally {
    harness.cleanup();
  }
});

test("飞书 /reply 提交失败时会写入结构化 reply.submit_failed 事件", async () => {
  const harness = createHarness({
    resolveFailureActionIds: ["reply-fail-1"],
  });

  try {
    harness.injectPendingAction({
      actionId: "reply-fail-1",
      requestId: "request-reply-fail-1",
      actionType: "user-input",
      prompt: "Please add details",
    });

    await harness.handleCommand("reply", ["reply-fail-1", "继续", "补充"]);

    const snapshot = harness.readFeishuDiagnosticsStore();
    assert.equal(snapshot.status, "ok");
    assert.equal(snapshot.recentEvents.at(-1)?.type, "reply.submit_failed");
    assert.equal(snapshot.recentEvents.at(-1)?.actionId, "reply-fail-1");
    assert.equal(snapshot.recentEvents.at(-1)?.requestId, "request-reply-fail-1");
    assert.equal(snapshot.recentEvents.at(-1)?.messageId, "message-1");
    assert.equal(snapshot.recentEvents.at(-1)?.sessionId, harness.getCurrentSessionId());
    assert.equal(snapshot.recentEvents.at(-1)?.principalId, harness.getCurrentPrincipalId());
    assert.equal(snapshot.recentEvents.at(-1)?.summary, "命令式回复失败：reply-fail-1 已失效。");
    assert.equal(snapshot.recentEvents.at(-1)?.details?.matchedPendingActionCount, 1);
    assert.equal(snapshot.recentEvents.at(-1)?.details?.sourceSessionId, harness.getCurrentSessionId());
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

test("/help 会展示 /skills 第一层入口", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("help", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /\/skills 查看和维护当前 principal 的 skills/);
  } finally {
    harness.cleanup();
  }
});

test("/help 会展示 /mcp 第一层入口", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("help", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /\/mcp 查看和维护当前 principal 的 MCP server/);
  } finally {
    harness.cleanup();
  }
});

test("/help 会展示 /plugins 第一层入口", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("help", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /\/plugins 查看和维护当前 principal 的 plugins/);
  } finally {
    harness.cleanup();
  }
});

test("/plugins foo 会回退到 /plugins 自己的帮助", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("plugins", ["foo"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /Plugins 管理：/);
    assert.match(message, /当前 principal：/);
    assert.match(message, /\/plugins read <MARKETPLACE> <PLUGIN_NAME>/);
    assert.match(message, /\/plugins sync \[remote\]/);
    assert.match(message, /\/plugins uninstall <PLUGIN_ID>/);
  } finally {
    harness.cleanup();
  }
});

test("/plugins list 会展示当前 principal 已拥有项和当前环境发现结果", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("plugins", ["list"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /当前 principal：/);
    assert.match(message, /当前槽位：acc-1/);
    assert.match(message, /已拥有：0/);
    assert.match(message, /当前环境发现：/);
    assert.match(message, /1\. OpenAI Curated/);
    assert.match(message, /name：openai-curated/);
    assert.match(message, /- github \[未纳入 principal\] \[当前可发现\]/);
    assert.match(message, /pluginId：github@openai-curated/);
    assert.match(message, /安装策略：可安装/);
    assert.match(message, /认证策略：安装时认证/);
  } finally {
    harness.cleanup();
  }
});

test("/plugins list 会优先按当前会话工作区发现 marketplace", async () => {
  let receivedPrincipalId = "";
  let receivedOptions: FeishuHarnessPluginRuntimeOptions | undefined;
  const harness = createHarness({
    pluginService: {
      listPrincipalPlugins: async (principalId, options) => {
        receivedPrincipalId = principalId;
        receivedOptions = options;
        return {
          target: {
            targetKind: "auth-account",
            targetId: "acc-1",
          },
          principalPlugins: [],
          marketplaces: [],
          marketplaceLoadErrors: [],
          remoteSyncError: null,
          featuredPluginIds: [],
        };
      },
      readPrincipalPlugin: async () => {
        throw new Error("unexpected readPrincipalPlugin");
      },
      installPrincipalPlugin: async () => {
        throw new Error("unexpected installPrincipalPlugin");
      },
      uninstallPrincipalPlugin: async () => {
        throw new Error("unexpected uninstallPrincipalPlugin");
      },
      syncPrincipalPlugins: async () => {
        throw new Error("unexpected syncPrincipalPlugins");
      },
    },
  });

  try {
    const sessionId = "session-plugins-workspace";
    harness.setCurrentSession(sessionId);
    harness.writeSessionSettings(sessionId, {
      workspacePath: "/srv/repos/demo",
    });

    await harness.handleCommand("plugins", ["list"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /当前 principal：/);
    assert.match(message, /当前槽位：acc-1/);
    assert.equal(receivedPrincipalId, harness.getCurrentPrincipalId());
    assert.equal(receivedOptions?.cwd, "/srv/repos/demo");
    assert.equal(receivedOptions?.activeAuthAccount?.accountId, "acc-1");
  } finally {
    harness.cleanup();
  }
});

test("/plugins list 会展示来源边界和建议动作", async () => {
  const harness = createHarness({
    pluginService: {
      listPrincipalPlugins: async () => ({
        target: {
          targetKind: "auth-account",
          targetId: "acc-1",
        },
        principalPlugins: [{
          pluginId: "github@openai-curated",
          pluginName: "github",
          marketplaceName: "openai-curated",
          marketplacePath: "/tmp/openai-curated/marketplace.json",
          sourceType: "repo-local",
          sourceScope: "workspace-other",
          sourcePath: "/srv/repos/demo/.agents/plugins/github",
          sourceRef: {
            sourceType: "repo-local",
            sourcePath: "/srv/repos/demo/.agents/plugins/github",
            workspaceFingerprint: "/srv/repos/demo",
            marketplaceName: "openai-curated",
            marketplacePath: "/tmp/openai-curated/marketplace.json",
          },
          runtimeAvailable: false,
          currentMaterialization: {
            targetKind: "auth-account",
            targetId: "acc-1",
            workspaceFingerprint: "/srv/repos/other",
            state: "missing",
            lastSyncedAt: "2026-04-11T00:00:00.000Z",
            lastError: "当前工作区没有这个 repo-local plugin。",
          },
          lastError: "当前工作区没有这个 repo-local plugin。",
          repairAction: "switch_workspace",
          repairHint: "这是绑定工作区 /srv/repos/demo 的 repo-local plugin；切回该工作区后再查看或同步。",
          createdAt: "2026-04-11T00:00:00.000Z",
          updatedAt: "2026-04-11T00:00:00.000Z",
          summary: {
            id: "github@openai-curated",
            name: "github",
            owned: true,
            runtimeInstalled: false,
            runtimeState: "missing",
            sourceType: "repo-local",
            sourceScope: "workspace-other",
            sourcePath: "/srv/repos/demo/.agents/plugins/github",
            installed: false,
            enabled: true,
            installPolicy: "AVAILABLE",
            authPolicy: "ON_INSTALL",
            lastError: "当前工作区没有这个 repo-local plugin。",
            repairAction: "switch_workspace",
            repairHint: "这是绑定工作区 /srv/repos/demo 的 repo-local plugin；切回该工作区后再查看或同步。",
            interface: {
              displayName: "GitHub",
              shortDescription: "Review PRs",
              capabilities: ["Interactive"],
            },
          },
        }],
        marketplaces: [],
        marketplaceLoadErrors: [],
        remoteSyncError: null,
        featuredPluginIds: [],
      }),
      readPrincipalPlugin: async () => {
        throw new Error("unexpected readPrincipalPlugin");
      },
      installPrincipalPlugin: async () => {
        throw new Error("unexpected installPrincipalPlugin");
      },
      uninstallPrincipalPlugin: async () => {
        throw new Error("unexpected uninstallPrincipalPlugin");
      },
      syncPrincipalPlugins: async () => {
        throw new Error("unexpected syncPrincipalPlugins");
      },
    },
  });

  try {
    await harness.handleCommand("plugins", ["list"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /来源：repo 本地｜其他工作区｜\/srv\/repos\/demo\/\.agents\/plugins\/github｜工作区 \/srv\/repos\/demo/);
    assert.match(message, /最近问题：当前工作区没有这个 repo-local plugin。/);
    assert.match(message, /建议动作：这是绑定工作区 \/srv\/repos\/demo 的 repo-local plugin；切回该工作区后再查看或同步。/);
  } finally {
    harness.cleanup();
  }
});

test("/plugins read <marketplace> <name> 会返回 plugin 详情", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("plugins", ["read", "openai-curated", "github"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /Plugin 详情：/);
    assert.match(message, /当前 principal：/);
    assert.match(message, /marketplace：openai-curated/);
    assert.match(message, /plugin：github/);
    assert.match(message, /pluginId：github@openai-curated/);
    assert.match(message, /来源：/);
    assert.match(message, /principal 归属：未纳入/);
    assert.match(message, /当前状态：当前可发现/);
    assert.match(message, /附带 skills：github-review/);
    assert.match(message, /附带 apps：GitHub/);
    assert.match(message, /附带 MCP：github/);
  } finally {
    harness.cleanup();
  }
});

test("/plugins install 和 /plugins uninstall 会调用对应写操作", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("plugins", ["install", "openai-curated", "github"]);
    const installed = harness.takeSingleMessage();
    assert.match(installed, /Plugin 已纳入 principal：/);
    assert.match(installed, /当前 principal：/);
    assert.match(installed, /plugin：github/);
    assert.match(installed, /当前状态：当前已可用/);
    assert.match(installed, /待补认证 apps：GitHub/);

    await harness.handleCommand("plugins", ["uninstall", "github@openai-curated"]);
    const removed = harness.takeSingleMessage();
    assert.match(removed, /Plugin 已从 principal 移除：/);
    assert.match(removed, /当前 principal：/);
    assert.match(removed, /pluginId：github@openai-curated/);
    assert.match(removed, /当前 runtime：已执行卸载。/);

    assert.deepEqual(harness.getPluginWriteCalls(), [
      {
        method: "installPrincipalPlugin",
        principalId: harness.getCurrentPrincipalId(),
        marketplacePath: "/tmp/openai-curated/marketplace.json",
        pluginName: "github",
      },
      {
        method: "uninstallPrincipalPlugin",
        principalId: harness.getCurrentPrincipalId(),
        pluginId: "github@openai-curated",
      },
    ]);
  } finally {
    harness.cleanup();
  }
});

test("/plugins sync 会调用 principal 同步，并沿用当前会话工作区", async () => {
  const harness = createHarness();

  try {
    const sessionId = "session-plugins-sync";
    harness.setCurrentSession(sessionId);
    harness.writeSessionSettings(sessionId, {
      workspacePath: "/srv/repos/demo",
    });

    await harness.handleCommand("plugins", ["sync", "remote"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /Plugin 同步完成：/);
    assert.match(message, /当前 principal：/);
    assert.match(message, /模式：先远程同步 marketplace，再落到当前 runtime/);
    assert.match(message, /查看：\/plugins list/);

    assert.deepEqual(harness.getPluginWriteCalls(), [{
      method: "syncPrincipalPlugins",
      principalId: harness.getCurrentPrincipalId(),
      forceRemoteSync: true,
      cwd: "/srv/repos/demo",
    }]);
  } finally {
    harness.cleanup();
  }
});

test("/mcp foo 会回退到 /mcp 自己的帮助", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("mcp", ["foo"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /MCP 管理：/);
    assert.match(message, /\/mcp reload/);
    assert.match(message, /\/mcp oauth <NAME>/);
  } finally {
    harness.cleanup();
  }
});

test("/mcp 在无定义时返回空列表提示", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("mcp", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /当前 principal：principal-local-owner/);
    assert.match(message, /暂无 MCP server/);
    assert.match(message, /查看：\/mcp reload/);
  } finally {
    harness.cleanup();
  }
});

test("/mcp list 会展示定义、状态和 runtime 槽位摘要", async () => {
  const harness = createHarness();

  try {
    const service = harness.getPrincipalMcpService();
    service.upsertPrincipalMcpServer({
      principalId: harness.getCurrentPrincipalId(),
      serverName: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "secret" },
      enabled: true,
    });
    service.savePrincipalMcpMaterialization({
      principalId: harness.getCurrentPrincipalId(),
      serverName: "github",
      targetKind: "auth-account",
      targetId: "acc-1",
      state: "synced",
      authState: "authenticated",
      lastError: "none",
    });

    await harness.handleCommand("mcp", ["list"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /1\. github \[已启用\]/);
    assert.match(message, /command：npx -y @modelcontextprotocol\/server-github/);
    assert.match(message, /env keys：GITHUB_TOKEN/);
    assert.match(message, /runtime 槽位 1 个，已就绪 1，待认证 0，失败 0/);
    assert.match(message, /槽位 acc-1 \[synced\/authenticated\]：none/);
  } finally {
    harness.cleanup();
  }
});

test("/mcp enable disable remove 会调用 principal MCP 写操作", async () => {
  const harness = createHarness();

  try {
    const service = harness.getPrincipalMcpService();
    service.upsertPrincipalMcpServer({
      principalId: harness.getCurrentPrincipalId(),
      serverName: "github",
      command: "npx",
      enabled: true,
    });

    await harness.handleCommand("mcp", ["disable", "github"]);
    const disabled = harness.takeSingleMessage();
    assert.match(disabled, /已停用 MCP server：github/);
    assert.equal(service.getPrincipalMcpServer(harness.getCurrentPrincipalId(), "github")?.enabled, false);

    await harness.handleCommand("mcp", ["enable", "github"]);
    const enabled = harness.takeSingleMessage();
    assert.match(enabled, /已启用 MCP server：github/);
    assert.equal(service.getPrincipalMcpServer(harness.getCurrentPrincipalId(), "github")?.enabled, true);

    await harness.handleCommand("mcp", ["remove", "github"]);
    const removed = harness.takeSingleMessage();
    assert.match(removed, /已删除 MCP server：github/);
    assert.equal(service.getPrincipalMcpServer(harness.getCurrentPrincipalId(), "github"), null);
  } finally {
    harness.cleanup();
  }
});

test("/mcp reload 会调用 runtime reload 并返回槽位摘要", async () => {
  const harness = createHarness();

  try {
    const service = harness.getPrincipalMcpService() as PrincipalMcpService & {
      reloadPrincipalMcpServers: PrincipalMcpService["reloadPrincipalMcpServers"];
    };

    service.reloadPrincipalMcpServers = async () => ({
      target: {
        targetKind: "auth-account",
        targetId: "acc-1",
      },
      runtimeServers: [{
        id: "github",
        name: "github",
        status: "available",
        args: [],
      }],
      servers: [{
        principalId: harness.getCurrentPrincipalId(),
        serverName: "github",
        transportType: "stdio",
        command: "npx",
        argsJson: "[]",
        envJson: "{}",
        enabled: true,
        sourceType: "manual",
        createdAt: "2026-04-11T00:00:00.000Z",
        updatedAt: "2026-04-11T00:00:00.000Z",
        materializations: [],
        summary: {
          totalTargets: 1,
          readyCount: 1,
          authRequiredCount: 0,
          failedCount: 0,
        },
      }],
    });

    await harness.handleCommand("mcp", ["reload"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /已重新读取当前 runtime 槽位的 MCP 状态/);
    assert.match(message, /当前槽位：acc-1/);
    assert.match(message, /runtime 返回：1 个 server/);
  } finally {
    harness.cleanup();
  }
});

test("/mcp oauth <name> 会返回授权链接", async () => {
  const harness = createHarness();

  try {
    const service = harness.getPrincipalMcpService() as PrincipalMcpService & {
      startPrincipalMcpOauthLogin: PrincipalMcpService["startPrincipalMcpOauthLogin"];
    };

    service.startPrincipalMcpOauthLogin = async () => ({
      target: {
        targetKind: "auth-account",
        targetId: "acc-1",
      },
      authorizationUrl: "https://example.com/oauth/github",
      server: {
        principalId: harness.getCurrentPrincipalId(),
        serverName: "github",
        transportType: "stdio",
        command: "npx",
        argsJson: "[]",
        envJson: "{}",
        enabled: true,
        sourceType: "manual",
        createdAt: "2026-04-11T00:00:00.000Z",
        updatedAt: "2026-04-11T00:00:00.000Z",
        materializations: [],
        summary: {
          totalTargets: 0,
          readyCount: 0,
          authRequiredCount: 0,
          failedCount: 0,
        },
      },
    });

    await harness.handleCommand("mcp", ["oauth", "github"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /已发起 MCP OAuth 登录：github/);
    assert.match(message, /授权链接：https:\/\/example\.com\/oauth\/github/);
    assert.match(message, /完成授权后建议执行：\/mcp reload/);
  } finally {
    harness.cleanup();
  }
});

test("/skills foo 会回退到 /skills 自己的帮助", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["foo"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /Skills 管理：/);
    assert.match(message, /\/skills curated/);
    assert.match(message, /\/skills install local <ABSOLUTE_PATH>/);
    assert.match(message, /第一版不支持带空格路径/);
  } finally {
    harness.cleanup();
  }
});

test("/skills 在无安装项时返回空列表提示", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /当前 principal：principal-local-owner/);
    assert.match(message, /暂无已安装 skill/);
    assert.match(message, /查看：\/skills curated/);
  } finally {
    harness.cleanup();
  }
});

test("/skills list 会展示同步摘要和异常账号", async () => {
  const harness = createHarness({
    listItems: [
      {
        skillName: "demo-skill",
        description: "demo",
        installStatus: "partially_synced",
        sourceType: "local-path",
        sourceRefJson: JSON.stringify({ absolutePath: "/srv/demo-skill" }),
        managedPath: "/srv/themis/skills/demo-skill",
        summary: { totalAccounts: 2, syncedCount: 1, conflictCount: 0, failedCount: 1 },
        materializations: [
          { targetId: "acc-1", state: "synced" },
          { targetId: "acc-2", state: "failed", lastError: "quota blocked" },
        ],
      },
    ],
  });

  try {
    await harness.handleCommand("skills", ["list"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /1\. demo-skill/);
    assert.match(message, /已同步 1\/2，冲突 0，失败 1/);
    assert.match(message, /账号槽位 acc-2 \[failed\]：quota blocked/);
  } finally {
    harness.cleanup();
  }
});

test("/skills curated 会展示 curated 列表和安装状态", async () => {
  const harness = createHarness({
    curatedItems: [
      { name: "python-setup", installed: true },
      { name: "debugger", installed: false },
    ],
  });

  try {
    await harness.handleCommand("skills", ["curated"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /当前 principal：principal-local-owner/);
    assert.match(message, /1\. python-setup \[已安装\]/);
    assert.match(message, /2\. debugger \[未安装\]/);
  } finally {
    harness.cleanup();
  }
});

test("/skills install local 会调用本机路径安装写操作", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["install", "local", "/srv/themis/skills/demo-skill"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /技能已安装：demo-skill/);
    assert.match(message, /安装状态：ready/);
    assert.match(message, /安装来源：本机路径 \/srv\/themis\/skills\/demo-skill/);
    assert.deepEqual(harness.getSkillWriteCalls(), [
      {
        method: "installFromLocalPath",
        principalId: "principal-local-owner",
        absolutePath: "/srv/themis/skills/demo-skill",
      },
    ]);
  } finally {
    harness.cleanup();
  }
});

test("/skills install url 会调用 GitHub URL 安装写操作", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", [
      "install",
      "url",
      "https://github.com/demo/repo/tree/main/skills/url-skill",
    ]);

    const message = harness.takeSingleMessage();
    assert.match(message, /技能已安装：url-skill/);
    assert.match(message, /安装来源：GitHub URL https:\/\/github\.com\/demo\/repo\/tree\/main\/skills\/url-skill/);
    assert.deepEqual(harness.getSkillWriteCalls(), [
      {
        method: "installFromGithub",
        principalId: "principal-local-owner",
        url: "https://github.com/demo/repo/tree/main/skills/url-skill",
      },
    ]);
  } finally {
    harness.cleanup();
  }
});

test("/skills install url <url> <ref> 会透传可选 ref", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", [
      "install",
      "url",
      "https://github.com/demo/repo/tree/main/skills/url-skill",
      "release-2026",
    ]);

    const message = harness.takeSingleMessage();
    assert.match(message, /技能已安装：url-skill/);
    assert.match(message, /GitHub ref：release-2026/);
    assert.deepEqual(harness.getSkillWriteCalls(), [
      {
        method: "installFromGithub",
        principalId: "principal-local-owner",
        url: "https://github.com/demo/repo/tree/main/skills/url-skill",
        ref: "release-2026",
      },
    ]);
  } finally {
    harness.cleanup();
  }
});

test("/skills install repo 会调用 GitHub repo/path 安装写操作", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["install", "repo", "demo/repo", "skills/repo-skill", "release-2026"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /技能已安装：repo-skill/);
    assert.match(message, /安装来源：GitHub 仓库 demo\/repo skills\/repo-skill/);
    assert.match(message, /GitHub ref：release-2026/);
    assert.deepEqual(harness.getSkillWriteCalls(), [
      {
        method: "installFromGithub",
        principalId: "principal-local-owner",
        repo: "demo/repo",
        path: "skills/repo-skill",
        ref: "release-2026",
      },
    ]);
  } finally {
    harness.cleanup();
  }
});

test("/skills install curated 会调用 curated 安装写操作", async () => {
  const harness = createHarness({
    curatedItems: [
      { name: "python-setup", installed: false },
    ],
  });

  try {
    await harness.handleCommand("skills", ["install", "curated", "python-setup"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /技能已安装：python-setup/);
    assert.match(message, /安装来源：curated skill python-setup/);
    assert.deepEqual(harness.getSkillWriteCalls(), [
      {
        method: "installFromCurated",
        principalId: "principal-local-owner",
        skillName: "python-setup",
      },
    ]);
  } finally {
    harness.cleanup();
  }
});

test("/skills remove <name> 会调用删除写操作", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["install", "local", "/srv/themis/skills/demo-skill"]);
    harness.takeSingleMessage();

    await harness.handleCommand("skills", ["remove", "demo-skill"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /技能已删除：demo-skill/);
    assert.match(message, /已删除受管目录：是/);
    assert.deepEqual(harness.getSkillWriteCalls().map((call) => call.method), [
      "installFromLocalPath",
      "removeSkill",
    ]);
  } finally {
    harness.cleanup();
  }
});

test("/skills sync <name> 会调用同步写操作", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["install", "local", "/srv/themis/skills/demo-skill"]);
    harness.takeSingleMessage();

    await harness.handleCommand("skills", ["sync", "demo-skill"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /已重同步 skill：demo-skill/);
    assert.match(message, /安装状态：ready/);
    assert.match(message, /已同步 2\/2，冲突 0，失败 0/);
    assert.deepEqual(harness.getSkillWriteCalls().map((call) => call.method), [
      "installFromLocalPath",
      "syncSkill",
    ]);
    assert.deepEqual(harness.getSkillWriteCalls()[1], {
      method: "syncSkill",
      principalId: "principal-local-owner",
      skillName: "demo-skill",
      force: false,
    });
  } finally {
    harness.cleanup();
  }
});

test("/skills sync <name> force 会以自然语言参数触发强制同步", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["install", "local", "/srv/themis/skills/demo-skill"]);
    harness.takeSingleMessage();

    await harness.handleCommand("skills", ["sync", "demo-skill", "force"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /已重同步 skill：demo-skill/);
    assert.match(message, /模式：强制同步/);
    assert.match(message, /安装状态：ready/);
    assert.match(message, /已同步 2\/2，冲突 0，失败 0/);
    assert.deepEqual(harness.getSkillWriteCalls()[1], {
      method: "syncSkill",
      principalId: "principal-local-owner",
      skillName: "demo-skill",
      force: true,
    });
  } finally {
    harness.cleanup();
  }
});

test("/skills install 缺参数或未知 mode 时会返回清晰用法", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["install"]);
    const missingMode = harness.takeSingleMessage();
    assert.match(missingMode, /\/skills install <local\|url\|repo\|curated>/);
    assert.match(missingMode, /\/skills install url <GITHUB_URL> \[REF\]/);

    await harness.handleCommand("skills", ["install", "foo"]);
    const unknownMode = harness.takeSingleMessage();
    assert.match(unknownMode, /未识别的 install 模式：foo/);
    assert.match(unknownMode, /\/skills install repo <REPO> <PATH> \[REF\]/);

    await harness.handleCommand("skills", ["remove"]);
    const missingRemove = harness.takeSingleMessage();
    assert.match(missingRemove, /\/skills remove <SKILL_NAME>/);

    await harness.handleCommand("skills", ["sync"]);
    const missingSync = harness.takeSingleMessage();
    assert.match(missingSync, /\/skills sync <SKILL_NAME> \[force\]/);
    assert.match(missingSync, /force 是自然语言参数/);
  } finally {
    harness.cleanup();
  }
});

test("/skills install local 缺路径时返回 local 的明确用法", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["install", "local"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /用法：\/skills install local <ABSOLUTE_PATH>/);
    assert.doesNotMatch(message, /未识别的 install 模式：local/);
  } finally {
    harness.cleanup();
  }
});

test("/skills remove 缺少名称时返回 remove 的明确用法", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["remove"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /用法：\/skills remove <SKILL_NAME>/);
  } finally {
    harness.cleanup();
  }
});

test("/skills ls 不作为 list 别名，而是回退到 /skills 帮助", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["ls"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /未识别的 skills 子命令：ls/);
    assert.match(message, /\/skills list 查看当前 principal 已安装的 skills/);
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
    assert.match(accountRoot, /认证与账号：/);
    assert.match(accountRoot, /\/settings account current/);
    assert.match(accountRoot, /\/settings account list/);
    assert.match(accountRoot, /\/settings account use/);
    assert.match(accountRoot, /\/settings account login/);
    assert.match(accountRoot, /\/settings account logout/);
    assert.match(accountRoot, /\/settings account cancel/);

    await harness.handleCommand("settings", ["account", "use"]);
    const useHelp = harness.takeSingleMessage();
    assert.match(useHelp, /设置项：\/settings account use/);
    assert.match(useHelp, /用法：\/settings account use <账号名\|邮箱\|序号\|default>/);
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

test("/settings account login device 在跟随系统默认账号时会命中 default 认证入口", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("settings", ["account", "login"]);
    const help = harness.takeSingleMessage();
    assert.match(help, /账号登录：/);
    assert.match(help, /\/settings account login device/);
    assert.match(help, /浏览器登录请改用 Web/);
    assert.match(help, /默认目标：如果当前 principal 固定了账号，就操作该账号；否则操作 Themis 系统默认认证入口。/);

    await harness.handleCommand("settings", ["account", "login", "device"]);
    const loginMessage = harness.takeSingleMessage();
    assert.match(loginMessage, /设备码登录：/);
    assert.match(loginMessage, /设备码登录已发起/);
    assert.match(loginMessage, /操作目标：Themis 系统默认认证入口（默认 CODEX_HOME）/);
    assert.match(loginMessage, /下一步：打开授权页，输入设备码，完成一次授权。/);
    assert.match(loginMessage, /设备码：DEFA-0001/);
    assert.match(loginMessage, /授权页：https:\/\/auth\.openai\.com\/codex\/device\/default/);

    assert.deepEqual(harness.getAuthCalls(), [
      {
        method: "startChatgptDeviceLogin",
        accountId: "default",
      },
    ]);
  } finally {
    harness.cleanup();
  }
});

test("/settings account logout、login device、cancel 支持显式操作指定认证账号", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("settings", ["account", "logout", "2"]);
    const logoutMessage = harness.takeSingleMessage();
    assert.match(logoutMessage, /账号已退出：/);
    assert.match(logoutMessage, /已退出认证账号：beta@example\.com/);
    assert.match(logoutMessage, /状态：未认证/);
    assert.match(logoutMessage, /下一步：发送 \/settings account login device 发起设备码登录。/);

    await harness.handleCommand("settings", ["account", "login", "device", "2"]);
    const loginMessage = harness.takeSingleMessage();
    assert.match(loginMessage, /设备码登录：/);
    assert.match(loginMessage, /设备码登录已发起/);
    assert.match(loginMessage, /操作目标：beta@example\.com/);
    assert.match(loginMessage, /设备码：BETA-0002/);
    assert.match(loginMessage, /授权页：https:\/\/auth\.openai\.com\/codex\/device\/acc-2/);

    await harness.handleCommand("settings", ["account", "use", "2"]);
    harness.takeSingleMessage();
    await harness.handleCommand("settings", ["account", "current"]);
    const currentMessage = harness.takeSingleMessage();
    assert.match(currentMessage, /认证状态：/);
    assert.match(currentMessage, /当前默认：固定使用 beta@example\.com/);
    assert.match(currentMessage, /状态：等待完成设备码授权/);
    assert.match(currentMessage, /下一步：打开授权页，输入设备码，完成一次授权。/);
    assert.match(currentMessage, /设备码：BETA-0002/);

    await harness.handleCommand("settings", ["account", "cancel", "2"]);
    const cancelMessage = harness.takeSingleMessage();
    assert.match(cancelMessage, /已取消登录：/);
    assert.match(cancelMessage, /已取消认证账号登录：beta@example\.com/);
    assert.match(cancelMessage, /状态：未认证/);
    assert.match(cancelMessage, /下一步：发送 \/settings account login device 发起设备码登录。/);

    assert.deepEqual(harness.getAuthCalls(), [
      {
        method: "logout",
        accountId: "acc-2",
      },
      {
        method: "startChatgptDeviceLogin",
        accountId: "acc-2",
      },
      {
        method: "cancelPendingLogin",
        accountId: "acc-2",
      },
    ]);
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

test("斜杠命令会记录完成耗时日志", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("help", []);
    harness.takeSingleMessage();

    const commandLogs = harness.getInfoLogs().filter((entry) => entry.includes("斜杠命令完成"));
    assert.equal(commandLogs.length, 1);
    assert.match(commandLogs[0] ?? "", /command=\/help/);
    assert.match(commandLogs[0] ?? "", /elapsedMs=\d+/);
    assert.match(commandLogs[0] ?? "", /chat=chat-1/);
    assert.match(commandLogs[0] ?? "", /message=message-1/);
  } finally {
    harness.cleanup();
  }
});

test("飞书文本发送会记录接口耗时日志", async () => {
  const harness = createHarness();

  try {
    harness.setClient({
      im: {
        v1: {
          message: {
            create: async () => ({
              data: {
                message_id: "msg-created-1",
              },
            }),
          },
        },
      },
    });

    await harness.createTextMessage("chat-1", "hello");

    const sendLogs = harness.getInfoLogs().filter((entry) => entry.includes("飞书消息发送完成"));
    assert.equal(sendLogs.length, 1);
    assert.match(sendLogs[0] ?? "", /action=create/);
    assert.match(sendLogs[0] ?? "", /msgType=text/);
    assert.match(sendLogs[0] ?? "", /chat=chat-1/);
    assert.match(sendLogs[0] ?? "", /message=msg-created-1/);
    assert.match(sendLogs[0] ?? "", /elapsedMs=\d+/);
    assert.match(sendLogs[0] ?? "", /bytes=\d+/);
  } finally {
    harness.cleanup();
  }
});

test("飞书普通任务在 app-server runtime 下仍保持占位、顺序缓冲与结果收口 parity", async () => {
  const harness = createHarness({
    runtimeEngine: "app-server",
  });

  try {
    await harness.handleIncomingText("请执行一次 app-server parity 测试");

    const messages = harness.takeMessages();
    assert.ok(messages.some((message) => /处理中/.test(message)));
    assert.ok(messages.some((message) => /app-server parity 测试/.test(message)));
    assert.deepEqual(harness.getTaskRuntimeCalls(), {
      sdk: 0,
      appServer: 1,
    });
  } finally {
    harness.cleanup();
  }
});

test("飞书普通任务在认证缺失时报错时，会用可更新的文本占位消息收口", async () => {
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      async runTask() {
        taskRuntimeCalls.appServer += 1;
        throw new Error("Not logged in");
      },
    }),
  });

  try {
    await harness.handleIncomingText("你好");

    const rendered = harness.peekRenderedMessages().filter((entry) => entry.action === "create" || entry.action === "update");
    assert.equal(rendered.length >= 2, true);
    assert.equal(rendered[0]?.msgType, "text");
    assert.equal(rendered[1]?.msgType, "text");

    const messages = harness.takeMessages();
    assert.ok(messages.some((message) => message.includes("处理中...")));
    assert.ok(messages.some((message) => message.includes("Codex 当前没有可用认证")));
  } finally {
    harness.cleanup();
  }
});

test("飞书真实 app-server delta 正文不会被渲染成任务状态更新", async () => {
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      taskRuntimeCalls,
      actionBridge,
    }) => {
      let notificationHandler: ((notification: CodexAppServerNotification) => void) | null = null;

      const runtime = new AppServerTaskRuntime({
        runtimeStore,
        actionBridge,
        sessionFactory: () => ({
          async initialize() {},
          async startThread() {
            return { threadId: "thread-feishu-delta-1" };
          },
          async resumeThread(threadId) {
            return { threadId };
          },
          async startTurn(threadId) {
            notificationHandler?.({
              method: "item/agentMessage/delta",
              params: {
                itemId: "item-feishu-delta-1",
                delta: "先读取",
                text: "先读取",
              },
            });
            notificationHandler?.({
              method: "item/agentMessage/delta",
              params: {
                itemId: "item-feishu-delta-1",
                delta: "先读取 `using-superpowers`",
                text: "先读取 `using-superpowers`",
              },
            });

            setTimeout(() => {
              notificationHandler?.({
                method: "item/completed",
                params: {
                  threadId,
                  turnId: "turn-feishu-delta-1",
                  item: {
                    type: "agentMessage",
                    id: "item-feishu-delta-final-1",
                    text: "先读取 `using-superpowers`",
                    phase: "final_answer",
                    memoryCitation: null,
                  },
                },
              });
              notificationHandler?.({
                method: "turn/completed",
                params: {
                  threadId,
                  turn: {
                    id: "turn-feishu-delta-1",
                    items: [],
                    status: "completed",
                    error: null,
                  },
                },
              });
            }, 0);

            return { turnId: "turn-feishu-delta-1" };
          },
          async close() {},
          onNotification(handler) {
            notificationHandler = handler;
            return () => {
              if (notificationHandler === handler) {
                notificationHandler = null;
              }
            };
          },
          onServerRequest() {},
        }),
      });

      return {
        runTask: async (request, hooks = {}) => {
          taskRuntimeCalls.appServer += 1;
          return await runtime.runTask(request, hooks);
        },
        getRuntimeStore: () => runtime.getRuntimeStore(),
        getIdentityLinkService: () => runtime.getIdentityLinkService(),
        getPrincipalSkillsService: () => runtime.getPrincipalSkillsService(),
        forkThread: runtime.forkThread.bind(runtime),
        readThreadSnapshot: runtime.readThreadSnapshot?.bind(runtime),
        startReview: runtime.startReview?.bind(runtime),
        steerTurn: runtime.steerTurn?.bind(runtime),
      };
    },
  } as FeishuHarnessConfig);

  try {
    await harness.handleIncomingText("请复现飞书增量正文");

    const messages = harness.takeMessages();
    assert.deepEqual(messages, [
      "处理中...",
      "先读取 `using-superpowers`",
    ]);
    assert.match(messages.join("\n"), /using-superpowers/);
    assert.doesNotMatch(messages.join("\n"), /任务状态更新/);
    assert.doesNotMatch(messages.join("\n"), /系统继续处理中/);
  } finally {
    harness.cleanup();
  }
});

test("飞书 /approve 会提交等待中的 approval action", async () => {
  const harness = createHarness();

  try {
    harness.injectPendingAction({
      actionId: "approval-1",
      actionType: "approval",
      prompt: "Allow command?",
      choices: ["approve", "deny"],
    });

    await harness.handleCommand("approve", ["approval-1"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /已提交审批/);
    assert.doesNotMatch(message, /\[处理中\]/);
    assert.equal(harness.findPendingAction("approval-1"), null);
    assert.deepEqual(harness.getResolvedActionSubmissions(), [{
      taskId: "task-pending-action",
      requestId: "req-pending-action",
      actionId: "approval-1",
      decision: "approve",
    }]);
  } finally {
    harness.cleanup();
  }
});

test("飞书 /approve 只会命中当前会话的同名 waiting action，不会串到别的 session", async () => {
  const harness = createHarness();

  try {
    const currentSessionId = "session-feishu-current";
    harness.setCurrentSession(currentSessionId);
    harness.injectPendingAction({
      taskId: "task-other-session",
      requestId: "req-other-session",
      actionId: "approval-shared",
      actionType: "approval",
      prompt: "Allow other command?",
      sessionId: "session-feishu-other",
    });
    harness.injectPendingAction({
      taskId: "task-current-session",
      requestId: "req-current-session",
      actionId: "approval-shared",
      actionType: "approval",
      prompt: "Allow current command?",
      sessionId: currentSessionId,
    });

    await harness.handleCommand("approve", ["approval-shared"]);

    assert.deepEqual(harness.getResolvedActionSubmissions(), [{
      taskId: "task-current-session",
      requestId: "req-current-session",
      actionId: "approval-shared",
      decision: "approve",
    }]);
  } finally {
    harness.cleanup();
  }
});

test("飞书 /approve 在 Web-origin waiting action 的 userId 不同时仍能按 principal 接管", async () => {
  const harness = createHarness();

  try {
    harness.injectPendingAction({
      actionId: "approval-web-1",
      actionType: "approval",
      prompt: "Allow web command?",
      sourceChannel: "web",
      userId: "web-user-1",
      principalId: harness.getCurrentPrincipalId(),
    });

    await harness.handleCommand("approve", ["approval-web-1"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /已提交审批/);
    assert.doesNotMatch(message, /\[处理中\]/);
    assert.equal(harness.findPendingAction("approval-web-1"), null);
    assert.deepEqual(harness.getResolvedActionSubmissions(), [{
      taskId: "task-pending-action",
      requestId: "req-pending-action",
      actionId: "approval-web-1",
      decision: "approve",
    }]);

    const snapshot = harness.readFeishuDiagnosticsStore();
    assert.equal(snapshot.status, "ok");
    assert.equal(snapshot.recentEvents.at(-1)?.type, "approval.submitted");
    assert.equal(snapshot.recentEvents.at(-1)?.requestId, "req-pending-action");
    assert.equal(snapshot.recentEvents.at(-1)?.details?.matchedPendingActionCount, 1);
    assert.equal(snapshot.recentEvents.at(-1)?.details?.sourceSessionId, harness.getCurrentSessionId());
  } finally {
    harness.cleanup();
  }
});

test("飞书 /approve 不会命中同一会话里属于其他 principal 的 Web-origin waiting action", async () => {
  const harness = createHarness();

  try {
    harness.injectPendingAction({
      actionId: "approval-web-other-principal-1",
      actionType: "approval",
      prompt: "Allow other principal web command?",
      sourceChannel: "web",
      userId: "user-1",
      principalId: "principal-other",
    });

    await harness.handleCommand("approve", ["approval-web-other-principal-1"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /未找到等待中的 action：approval-web-other-principal-1/);
    assert.notEqual(harness.findPendingAction("approval-web-other-principal-1"), null);
    assert.deepEqual(harness.getResolvedActionSubmissions(), []);
  } finally {
    harness.cleanup();
  }
});

test("飞书 /reply <actionId> <内容> 会提交等待中的 user-input action", async () => {
  const harness = createHarness();

  try {
    harness.injectPendingAction({
      actionId: "reply-1",
      actionType: "user-input",
      prompt: "Please add details",
    });

    await harness.handleCommand("reply", ["reply-1", "继续", "执行"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /已提交补充输入/);
    assert.doesNotMatch(message, /\[处理中\]/);
    assert.equal(harness.findPendingAction("reply-1"), null);
    assert.deepEqual(harness.getResolvedActionSubmissions(), [{
      taskId: "task-pending-action",
      requestId: "req-pending-action",
      actionId: "reply-1",
      inputText: "继续 执行",
    }]);
  } finally {
    harness.cleanup();
  }
});

test("飞书 /reply 在 Web-origin waiting action 的 userId 不同时仍能按 principal 接管", async () => {
  const harness = createHarness();

  try {
    harness.injectPendingAction({
      actionId: "reply-web-command-1",
      actionType: "user-input",
      prompt: "Please add web details",
      sourceChannel: "web",
      userId: "web-user-1",
      principalId: harness.getCurrentPrincipalId(),
    });

    await harness.handleCommand("reply", ["reply-web-command-1", "跨端", "继续"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /已提交补充输入/);
    assert.doesNotMatch(message, /\[处理中\]/);
    assert.equal(harness.findPendingAction("reply-web-command-1"), null);
    assert.deepEqual(harness.getResolvedActionSubmissions(), [{
      taskId: "task-pending-action",
      requestId: "req-pending-action",
      actionId: "reply-web-command-1",
      inputText: "跨端 继续",
    }]);
  } finally {
    harness.cleanup();
  }
});

test("飞书 /reply 不会命中同一会话里属于其他 principal 的 Web-origin user-input action", async () => {
  const harness = createHarness();

  try {
    harness.injectPendingAction({
      actionId: "reply-web-command-other-principal-1",
      actionType: "user-input",
      prompt: "Please add details",
      sourceChannel: "web",
      userId: "web-user-1",
      principalId: "principal-other",
    });

    await harness.handleCommand("reply", ["reply-web-command-other-principal-1", "这条", "不该命中"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /未找到等待中的 action：reply-web-command-other-principal-1/);
    assert.notEqual(harness.findPendingAction("reply-web-command-other-principal-1"), null);
    assert.deepEqual(harness.getResolvedActionSubmissions(), []);
  } finally {
    harness.cleanup();
  }
});

test("飞书普通文本在当前会话存在唯一 user-input waiting action 时会直接提交补充输入", async () => {
  const harness = createHarness();

  try {
    harness.injectPendingAction({
      actionId: "reply-1",
      actionType: "user-input",
      prompt: "Please add details",
    });

    await harness.handleMessageEventText("继续执行");

    assert.deepEqual(harness.getResolvedActionSubmissions(), [{
      taskId: "task-pending-action",
      requestId: "req-pending-action",
      actionId: "reply-1",
      inputText: "继续执行",
    }]);
    assert.deepEqual(harness.getTaskRuntimeCalls(), {
      sdk: 0,
      appServer: 0,
    });
  } finally {
    harness.cleanup();
  }
});

test("飞书普通文本在没有 pending action 时仍按现有语义进入任务链", async () => {
  const harness = createHarness();

  try {
    await harness.handleMessageEventText("请继续执行新的任务");

    assert.deepEqual(harness.getResolvedActionSubmissions(), []);
    assert.deepEqual(harness.getTaskRuntimeCalls(), {
      sdk: 0,
      appServer: 1,
    });

    const snapshot = harness.readFeishuDiagnosticsStore();
    assert.equal(snapshot.status, "ok");
    assert.equal(snapshot.recentEvents.at(-1)?.type, "pending_input.not_found");
    assert.equal(snapshot.recentEvents.at(-1)?.messageId, "message-1");
    assert.equal(snapshot.recentEvents.at(-1)?.sessionId, harness.getCurrentSessionId());
    assert.equal(snapshot.recentEvents.at(-1)?.principalId, harness.getCurrentPrincipalId());
    assert.equal(snapshot.recentEvents.at(-1)?.details?.blockingReason, "no_pending_input");
    assert.equal(snapshot.recentEvents.at(-1)?.details?.approvalPendingActionCount, 0);
    assert.equal(snapshot.recentEvents.at(-1)?.details?.matchedPendingActionCount, 0);
    assert.equal(snapshot.conversations.at(-1)?.lastMessageId, "message-1");
  } finally {
    harness.cleanup();
  }
});

test("飞书普通文本在当前会话存在 approval waiting action 时不会误提交补充输入", async () => {
  const harness = createHarness();

  try {
    harness.injectPendingAction({
      actionId: "approval-1",
      actionType: "approval",
      prompt: "Allow command?",
    });

    await harness.handleMessageEventText("我补充一句");

    assert.deepEqual(harness.getResolvedActionSubmissions(), []);
    assert.equal(harness.findPendingAction("approval-1")?.actionType, "approval");
    assert.deepEqual(harness.getTaskRuntimeCalls(), {
      sdk: 0,
      appServer: 1,
    });

    const snapshot = harness.readFeishuDiagnosticsStore();
    assert.equal(snapshot.status, "ok");
    assert.equal(snapshot.recentEvents.at(-1)?.type, "pending_input.not_found");
    assert.equal(snapshot.recentEvents.at(-1)?.messageId, "message-1");
    assert.equal(snapshot.recentEvents.at(-1)?.sessionId, harness.getCurrentSessionId());
    assert.equal(snapshot.recentEvents.at(-1)?.principalId, harness.getCurrentPrincipalId());
    assert.equal(snapshot.recentEvents.at(-1)?.details?.blockingReason, "approval_pending_without_takeover");
    assert.equal(snapshot.recentEvents.at(-1)?.details?.approvalPendingActionCount, 1);
    assert.equal(snapshot.recentEvents.at(-1)?.details?.matchedPendingActionCount, 0);
    assert.equal(snapshot.conversations.at(-1)?.lastMessageId, "message-1");
  } finally {
    harness.cleanup();
  }
});

test("飞书普通文本在同一会话同时存在 approval 和 user-input waiting action 时会记录阻塞诊断", async () => {
  const harness = createHarness();

  try {
    harness.injectPendingAction({
      actionId: "approval-block-1",
      actionType: "approval",
      prompt: "Allow command?",
    });
    harness.injectPendingAction({
      actionId: "reply-block-1",
      actionType: "user-input",
      prompt: "Please add details",
    });

    await harness.handleMessageEventText("我补充一句");

    assert.deepEqual(harness.getResolvedActionSubmissions(), []);
    assert.deepEqual(harness.getTaskRuntimeCalls(), {
      sdk: 0,
      appServer: 1,
    });

    const snapshot = harness.readFeishuDiagnosticsStore();
    assert.equal(snapshot.status, "ok");
    assert.equal(snapshot.recentEvents.at(-1)?.type, "pending_input.blocked_by_approval");
    assert.equal(snapshot.recentEvents.at(-1)?.messageId, "message-1");
    assert.equal(snapshot.recentEvents.at(-1)?.sessionId, harness.getCurrentSessionId());
    assert.equal(snapshot.recentEvents.at(-1)?.principalId, harness.getCurrentPrincipalId());
    assert.equal(snapshot.recentEvents.at(-1)?.details?.blockingReason, "approval_pending");
    assert.equal(snapshot.recentEvents.at(-1)?.details?.approvalPendingActionCount, 1);
    assert.equal(snapshot.recentEvents.at(-1)?.details?.matchedPendingActionCount, 1);
    assert.equal(snapshot.conversations.at(-1)?.lastMessageId, "message-1");
  } finally {
    harness.cleanup();
  }
});

test("飞书普通文本在同一会话存在多条 user-input waiting action 时会提示改用 /reply", async () => {
  const harness = createHarness();

  try {
    harness.injectPendingAction({
      taskId: "task-1",
      requestId: "req-1",
      actionId: "reply-1",
      actionType: "user-input",
      prompt: "Please add details A",
    });
    harness.injectPendingAction({
      taskId: "task-2",
      requestId: "req-2",
      actionId: "reply-2",
      actionType: "user-input",
      prompt: "Please add details B",
    });

    await harness.handleMessageEventText("统一补一句");

    assert.match(harness.takeSingleMessage(), /存在多条待补充输入.*\/reply <actionId> <内容>/);
    assert.deepEqual(harness.getResolvedActionSubmissions(), []);
    assert.deepEqual(harness.getTaskRuntimeCalls(), {
      sdk: 0,
      appServer: 0,
    });

    const snapshot = harness.readFeishuDiagnosticsStore();
    assert.equal(snapshot.status, "ok");
    assert.equal(snapshot.recentEvents.at(-1)?.type, "pending_input.ambiguous");
    assert.equal(snapshot.recentEvents.at(-1)?.messageId, "message-1");
    assert.equal(snapshot.recentEvents.at(-1)?.sessionId, harness.getCurrentSessionId());
    assert.equal(snapshot.recentEvents.at(-1)?.principalId, harness.getCurrentPrincipalId());
    assert.equal(snapshot.recentEvents.at(-1)?.details?.blockingReason, "multiple_user_input_pending");
    assert.equal(snapshot.recentEvents.at(-1)?.details?.matchedPendingActionCount, 2);
  } finally {
    harness.cleanup();
  }
});

test("飞书普通文本在 Web-origin waiting action 的 userId 不同时仍能按 principal 接管", async () => {
  const harness = createHarness();

  try {
    harness.injectPendingAction({
      actionId: "reply-web-1",
      actionType: "user-input",
      prompt: "Please add details",
      sourceChannel: "web",
      userId: "web-user-1",
      principalId: harness.getCurrentPrincipalId(),
    });

    await harness.handleMessageEventText("按 Web 会话上下文继续");

    assert.deepEqual(harness.getResolvedActionSubmissions(), [{
      taskId: "task-pending-action",
      requestId: "req-pending-action",
      actionId: "reply-web-1",
      inputText: "按 Web 会话上下文继续",
    }]);
    assert.deepEqual(harness.getTaskRuntimeCalls(), {
      sdk: 0,
      appServer: 0,
    });
  } finally {
    harness.cleanup();
  }
});

test("飞书普通文本不会自动接管同 session 但不同 principal 的 Web-origin user-input waiting action", async () => {
  const harness = createHarness();

  try {
    harness.injectPendingAction({
      actionId: "reply-web-other-principal-1",
      actionType: "user-input",
      prompt: "Please add details",
      sourceChannel: "web",
      userId: "web-user-1",
      principalId: "principal-other",
    });

    await harness.handleMessageEventText("这条消息应该继续走普通任务链");

    assert.deepEqual(harness.getResolvedActionSubmissions(), []);
    assert.notEqual(harness.findPendingAction("reply-web-other-principal-1"), null);
    assert.deepEqual(harness.getTaskRuntimeCalls(), {
      sdk: 0,
      appServer: 1,
    });
  } finally {
    harness.cleanup();
  }
});

test("飞书图片消息会先写入附件草稿并提示用户继续补文字", async () => {
  const harness = createHarness();

  try {
    harness.setMessageResourceDownloader(async () => ({
      headers: {
        "content-type": "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-image-1",
        create_time: "1711958400000",
        message_type: "image",
        chat_type: "p2p",
        content: JSON.stringify({
          image_key: "img-key-1",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
          open_id: "open-user-1",
        },
        tenant_key: "tenant-1",
      },
    });

    assert.match(harness.takeSingleMessage(), /已收到 1 个附件，请直接回复你的问题/);
    assert.deepEqual(harness.getTaskRuntimeCalls(), {
      sdk: 0,
      appServer: 0,
    });
    const draftStore = harness.readAttachmentDraftStore();
    assert.equal(draftStore?.drafts.length, 1);
    assert.equal(draftStore?.drafts[0]?.parts?.[0]?.type, "image");
    assert.equal(draftStore?.drafts[0]?.assets?.[0]?.kind, "image");
  } finally {
    harness.cleanup();
  }
});

test("飞书附件草稿会在下一条普通文本中自动合并进任务请求并清空", async () => {
  const harness = createHarness();

  try {
    harness.setMessageResourceDownloader(async () => ({
      headers: {
        "content-type": "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-image-2",
        create_time: "1711958400000",
        message_type: "image",
        chat_type: "p2p",
        content: JSON.stringify({
          image_key: "img-key-2",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    await harness.handleMessageEventText("帮我总结这张图");

    const requests = harness.getTaskRequests();
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.goal, "帮我总结这张图");
    assert.equal(requests[0]?.inputEnvelope?.parts.length, 2);
    assert.deepEqual(requests[0]?.inputEnvelope?.parts.map((item) => item.type), ["text", "image"]);
    assert.equal(requests[0]?.inputEnvelope?.assets.length, 1);
    assert.equal(requests[0]?.inputEnvelope?.assets[0]?.kind, "image");
    assert.equal(requests[0]?.attachments?.length, 1);
    assert.equal(requests[0]?.attachments?.[0]?.type, "image");
    assert.match(requests[0]?.attachments?.[0]?.value ?? "", /temp\/feishu-attachments\/.+\/message-image-2\//);
    assert.equal(harness.readAttachmentDraftStore()?.drafts.length ?? 0, 0);
  } finally {
    harness.cleanup();
  }
});

test("飞书同一条 post 消息里的文本和图片会直接作为任务输入", async () => {
  const harness = createHarness();

  try {
    harness.setMessageResourceDownloader(async () => ({
      headers: {
        "content-type": "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-post-1",
        create_time: "1711958400000",
        message_type: "post",
        content: JSON.stringify({
          zh_cn: {
            title: "",
            content: [[
              {
                tag: "text",
                text: "帮我看看这张图",
              },
              {
                tag: "img",
                image_key: "img-key-post-1",
              },
            ]],
          },
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });

    const requests = harness.getTaskRequests();
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.goal, "帮我看看这张图");
    assert.equal(requests[0]?.inputEnvelope?.parts.length, 2);
    assert.deepEqual(requests[0]?.inputEnvelope?.parts.map((item) => item.type), ["text", "image"]);
    assert.equal(requests[0]?.inputEnvelope?.assets.length, 1);
    assert.equal(requests[0]?.inputEnvelope?.assets[0]?.kind, "image");
    assert.equal(requests[0]?.attachments?.length, 1);
    assert.equal(requests[0]?.attachments?.[0]?.type, "image");
    assert.match(requests[0]?.attachments?.[0]?.value ?? "", /temp\/feishu-attachments\/.+\/message-post-1\//);
    assert.equal(harness.readAttachmentDraftStore(), null);
  } finally {
    harness.cleanup();
  }
});

test("飞书真实入站 post 顶层结构里的文本和图片会直接作为任务输入", async () => {
  const harness = createHarness();

  try {
    harness.setMessageResourceDownloader(async () => ({
      headers: {
        "content-type": "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-post-2",
        create_time: "1775040596104",
        message_type: "post",
        content: JSON.stringify({
          title: "",
          content: [[
            {
              tag: "img",
              image_key: "img-key-post-2",
              width: 1226,
              height: 780,
            },
          ], [
            {
              tag: "text",
              text: "帮我看看这张图",
              style: [],
            },
          ]],
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });

    const requests = harness.getTaskRequests();
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.goal, "帮我看看这张图");
    assert.equal(requests[0]?.inputEnvelope?.parts.length, 2);
    assert.deepEqual(requests[0]?.inputEnvelope?.parts.map((item) => item.type), ["image", "text"]);
    const firstPart = requests[0]?.inputEnvelope?.parts[0];
    const secondPart = requests[0]?.inputEnvelope?.parts[1];
    assert.equal(firstPart?.type, "image");
    assert.equal(firstPart.assetId, "message-post-2::img-key-post-2");
    assert.equal(secondPart?.type, "text");
    assert.equal(secondPart.text, "帮我看看这张图");
    assert.equal(requests[0]?.inputEnvelope?.assets.length, 1);
    assert.equal(requests[0]?.inputEnvelope?.assets[0]?.kind, "image");
    assert.equal(requests[0]?.attachments?.length, 1);
    assert.equal(requests[0]?.attachments?.[0]?.type, "image");
    assert.equal(harness.readAttachmentDraftStore(), null);
  } finally {
    harness.cleanup();
  }
});

test("飞书同一条 post 里的多段 text/image 交错内容会按原始顺序进入 inputEnvelope", async () => {
  const harness = createHarness();

  try {
    harness.setMessageResourceDownloader(async () => ({
      headers: {
        "content-type": "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-post-3",
        create_time: "1775040596999",
        message_type: "post",
        content: JSON.stringify({
          zh_cn: {
            title: "缺陷复盘",
            content: [[
              {
                tag: "text",
                text: "先看第一张",
              },
              {
                tag: "img",
                image_key: "img-key-post-3",
              },
              {
                tag: "text",
                text: "再看第二张",
              },
            ], [
              {
                tag: "img",
                image_key: "img-key-post-4",
              },
              {
                tag: "text",
                text: "最后给结论",
              },
            ]],
          },
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });

    const requests = harness.getTaskRequests();
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.goal, "缺陷复盘\n先看第一张\n再看第二张\n最后给结论");
    assert.deepEqual(
      requests[0]?.inputEnvelope?.parts.map((item) => item.type === "text" ? item.text : item.assetId),
      [
        "缺陷复盘",
        "先看第一张",
        "message-post-3::img-key-post-3",
        "再看第二张",
        "message-post-3::img-key-post-4",
        "最后给结论",
      ],
    );
    assert.deepEqual(
      requests[0]?.inputEnvelope?.assets.map((asset) => asset.assetId),
      [
        "message-post-3::img-key-post-3",
        "message-post-3::img-key-post-4",
      ],
    );
    assert.deepEqual(
      requests[0]?.attachments?.map((attachment) => attachment.id),
      [
        "message-post-3::img-key-post-3",
        "message-post-3::img-key-post-4",
      ],
    );
    assert.equal(harness.readAttachmentDraftStore(), null);
  } finally {
    harness.cleanup();
  }
});

test("飞书同一条 post 消息在 task.started 前失败时会把 inline 图片恢复进草稿", async () => {
  const seenRequests: Array<{ goal?: string }> = [];
  const harness = createHarness({
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      async runTask(request) {
        taskRuntimeCalls.appServer += 1;
        seenRequests.push(request);
        throw new Error("runTask before task.started");
      },
    }),
  });

  try {
    harness.setMessageResourceDownloader(async () => ({
      headers: {
        "content-type": "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-post-fail-1",
        create_time: "1775040596104",
        message_type: "post",
        content: JSON.stringify({
          title: "",
          content: [[
            {
              tag: "text",
              text: "帮我看看这张图",
            },
            {
              tag: "img",
              image_key: "img-key-post-fail-1",
            },
          ]],
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });

    const messages = harness.takeMessages();
    assert.ok(messages.some((message) => message.includes("执行异常")));
    assert.ok(messages.some((message) => message.includes("runTask before task.started")));
    assert.equal(seenRequests.length, 1);

    const draftStore = harness.readAttachmentDraftStore();
    assert.equal(draftStore?.drafts.length, 1);
    const draft = draftStore?.drafts[0];
    assert.ok(draft);
    assert.ok(draft.assets);
    assert.ok(draft.parts);
    assert.equal(draft.assets.length, 1);
    assert.equal(draft.assets[0]?.kind, "image");
    assert.equal(draft.parts.some((part) => part.type === "image"), true);
  } finally {
    harness.cleanup();
  }
});

test("飞书混合附件草稿和当前 post 在 task.started 前失败后，重试仍保留上次提交的附件顺序", async () => {
  const seenRequests: TaskRequest[] = [];
  let attempt = 0;
  const harness = createHarness({
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => {
      const baseRuntime = createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      });

      return {
        ...baseRuntime,
        async runTask(request, hooks) {
          seenRequests.push(request);
          attempt += 1;

          if (attempt === 1) {
            taskRuntimeCalls.appServer += 1;
            throw new Error("runTask before task.started");
          }

          return await baseRuntime.runTask(request, hooks);
        },
      };
    },
  });

  try {
    harness.setMessageResourceDownloader(async (payload) => ({
      headers: {
        "content-type": payload?.params.type === "file" ? "application/pdf" : "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(
          filePath,
          payload?.params.type === "file" ? "fake-file" : "fake-image",
        ));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-file-retry-order-1",
        create_time: "1711958400000",
        message_type: "file",
        content: JSON.stringify({
          file_key: "file-key-retry-order-1",
          file_name: "report.pdf",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-post-retry-order-1",
        create_time: "1711958460000",
        message_type: "post",
        content: JSON.stringify({
          zh_cn: {
            title: "",
            content: [[
              {
                tag: "text",
                text: "先看我刚补的截图",
              },
              {
                tag: "img",
                image_key: "img-key-post-retry-order-1",
              },
            ]],
          },
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });

    const failedMessages = harness.takeMessages();
    assert.ok(failedMessages.some((message) => message.includes("runTask before task.started")));
    assert.equal(seenRequests.length, 1);
    assert.deepEqual(
      seenRequests[0]?.attachments?.map((item) => item.id),
      [
        "message-post-retry-order-1::img-key-post-retry-order-1",
        "message-file-retry-order-1::file-key-retry-order-1",
      ],
    );

    await harness.handleMessageEventText("再试一次");

    assert.equal(seenRequests.length, 2);
    assert.deepEqual(
      seenRequests[1]?.inputEnvelope?.parts.map((item) => item.type),
      ["text", "image", "document"],
    );
    assert.deepEqual(
      seenRequests[1]?.attachments?.map((item) => item.id),
      [
        "message-post-retry-order-1::img-key-post-retry-order-1",
        "message-file-retry-order-1::file-key-retry-order-1",
      ],
    );
    assert.equal(harness.readAttachmentDraftStore()?.drafts.length ?? 0, 0);
  } finally {
    harness.cleanup();
  }
});

test("飞书多附件草稿和多张当前 post 图片在 task.started 前失败后，重试仍保留整条提交顺序", async () => {
  const seenRequests: TaskRequest[] = [];
  let attempt = 0;
  const harness = createHarness({
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => {
      const baseRuntime = createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      });

      return {
        ...baseRuntime,
        async runTask(request, hooks) {
          seenRequests.push(request);
          attempt += 1;

          if (attempt === 1) {
            taskRuntimeCalls.appServer += 1;
            throw new Error("runTask before task.started");
          }

          return await baseRuntime.runTask(request, hooks);
        },
      };
    },
  });

  try {
    harness.setMessageResourceDownloader(async (payload) => ({
      headers: {
        "content-type": payload?.params.type === "file" ? "application/pdf" : "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(
          filePath,
          payload?.params.type === "file" ? "fake-file" : "fake-image",
        ));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-image-retry-order-2",
        create_time: "1711958400000",
        message_type: "image",
        content: JSON.stringify({
          image_key: "img-key-retry-order-2",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-file-retry-order-2",
        create_time: "1711958460000",
        message_type: "file",
        content: JSON.stringify({
          file_key: "file-key-retry-order-2",
          file_name: "report.pdf",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-post-retry-order-2",
        create_time: "1711958520000",
        message_type: "post",
        content: JSON.stringify({
          zh_cn: {
            title: "补充说明",
            content: [[
              {
                tag: "text",
                text: "先看第一张新图",
              },
              {
                tag: "img",
                image_key: "img-key-post-retry-order-2a",
              },
              {
                tag: "text",
                text: "再看第二张新图",
              },
              {
                tag: "img",
                image_key: "img-key-post-retry-order-2b",
              },
            ]],
          },
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });

    const failedMessages = harness.takeMessages();
    assert.ok(failedMessages.some((message) => message.includes("runTask before task.started")));
    assert.equal(seenRequests.length, 1);
    assert.deepEqual(
      seenRequests[0]?.attachments?.map((item) => item.id),
      [
        "message-post-retry-order-2::img-key-post-retry-order-2a",
        "message-post-retry-order-2::img-key-post-retry-order-2b",
        "message-image-retry-order-2::img-key-retry-order-2",
        "message-file-retry-order-2::file-key-retry-order-2",
      ],
    );

    await harness.handleMessageEventText("再试一次，按刚才那组顺序来");

    assert.equal(seenRequests.length, 2);
    assert.deepEqual(
      seenRequests[1]?.inputEnvelope?.parts.map((item) => item.type === "text" ? item.text : item.assetId),
      [
        "再试一次，按刚才那组顺序来",
        "message-post-retry-order-2::img-key-post-retry-order-2a",
        "message-post-retry-order-2::img-key-post-retry-order-2b",
        "message-image-retry-order-2::img-key-retry-order-2",
        "message-file-retry-order-2::file-key-retry-order-2",
      ],
    );
    assert.deepEqual(
      seenRequests[1]?.attachments?.map((item) => item.id),
      [
        "message-post-retry-order-2::img-key-post-retry-order-2a",
        "message-post-retry-order-2::img-key-post-retry-order-2b",
        "message-image-retry-order-2::img-key-retry-order-2",
        "message-file-retry-order-2::file-key-retry-order-2",
      ],
    );
    assert.equal(harness.readAttachmentDraftStore()?.drafts.length ?? 0, 0);
  } finally {
    harness.cleanup();
  }
});

test("飞书附件会落到当前 session 工作区，并把 sessionId 透传给 runtime 请求", async () => {
  const harness = createHarness();
  const sessionId = "session-image-workspace";
  const workspace = harness.createWorkspace("attachment-workspace");

  try {
    harness.setCurrentSession(sessionId);
    harness.writeSessionSettings(sessionId, {
      workspacePath: workspace,
    });
    harness.setMessageResourceDownloader(async () => ({
      headers: {
        "content-type": "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-image-workspace",
        create_time: "1711958400000",
        message_type: "image",
        chat_type: "p2p",
        content: JSON.stringify({
          image_key: "img-key-workspace",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    await harness.handleMessageEventText("请处理这个附件");

    const request = harness.getTaskRequests()[0];
    assert.equal(request?.channelContext.sessionId, sessionId);
    assert.equal(
      request?.inputEnvelope?.assets[0]?.localPath.startsWith(
        join(workspace, "temp", "feishu-attachments", sessionId, "message-image-workspace"),
      ),
      true,
    );
    assert.equal(
      request?.attachments?.[0]?.value.startsWith(
        join(workspace, "temp", "feishu-attachments", sessionId, "message-image-workspace"),
      ),
      true,
    );
  } finally {
    harness.cleanup();
  }
});

test("飞书普通文本在 waiting action 存在时不会误消费附件草稿", async () => {
  const harness = createHarness();

  try {
    harness.setMessageResourceDownloader(async () => ({
      headers: {
        "content-type": "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-image-3",
        create_time: "1711958400000",
        message_type: "image",
        content: JSON.stringify({
          image_key: "img-key-3",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    harness.injectPendingAction({
      actionId: "reply-attachment-1",
      actionType: "user-input",
      prompt: "Please add details",
    });

    await harness.handleMessageEventText("先补一句说明");

    assert.deepEqual(harness.getResolvedActionSubmissions(), [{
      taskId: "task-pending-action",
      requestId: "req-pending-action",
      actionId: "reply-attachment-1",
      inputText: "先补一句说明",
    }]);
    assert.equal(harness.getTaskRequests().length, 0);
    assert.equal(harness.readAttachmentDraftStore()?.drafts.length, 1);
  } finally {
    harness.cleanup();
  }
});

test("飞书连续收到两个附件后，下一条普通文本会自动合并发送", async () => {
  const harness = createHarness();

  try {
    harness.setMessageResourceDownloader(async (payload) => ({
      headers: {
        "content-type": payload?.params.type === "file" ? "application/pdf" : "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(
          filePath,
          payload?.params.type === "file" ? "fake-file" : "fake-image",
        ));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-image-4",
        create_time: "1711958400000",
        message_type: "image",
        content: JSON.stringify({
          image_key: "img-key-4",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-file-4",
        create_time: "1711958460000",
        message_type: "file",
        content: JSON.stringify({
          file_key: "file-key-4",
          file_name: "report.pdf",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    await harness.handleMessageEventText("帮我一起总结这两个附件");

    const requests = harness.getTaskRequests();
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.inputEnvelope?.parts.length, 3);
    assert.deepEqual(
      requests[0]?.inputEnvelope?.parts.map((item) => item.type),
      ["text", "image", "document"],
    );
    assert.equal(requests[0]?.inputEnvelope?.assets.length, 2);
    assert.deepEqual(requests[0]?.inputEnvelope?.assets.map((item) => item.kind), ["image", "document"]);
    assert.deepEqual(
      requests[0]?.attachments?.map((item) => [item.type, item.name ?? ""]),
      [
        ["image", "image-message-image-4-img-key-4.png"],
        ["file", "report.pdf"],
      ],
    );
    assert.equal(harness.readAttachmentDraftStore()?.drafts.length ?? 0, 0);
  } finally {
    harness.cleanup();
  }
});

test("飞书乱序到达的附件会按消息时间顺序合并进任务请求", async () => {
  const harness = createHarness();

  try {
    harness.setMessageResourceDownloader(async (payload) => ({
      headers: {
        "content-type": payload?.params.type === "file" ? "application/pdf" : "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(
          filePath,
          payload?.params.type === "file" ? "fake-file" : "fake-image",
        ));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-file-out-of-order-1",
        create_time: "1711958460000",
        message_type: "file",
        content: JSON.stringify({
          file_key: "file-key-out-of-order-1",
          file_name: "report.pdf",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-image-out-of-order-1",
        create_time: "1711958400000",
        message_type: "image",
        content: JSON.stringify({
          image_key: "img-key-out-of-order-1",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    await harness.handleMessageEventText("帮我一起处理这两个附件");

    const requests = harness.getTaskRequests();
    assert.equal(requests.length, 1);
    assert.deepEqual(
      requests[0]?.inputEnvelope?.parts.map((item) => item.type),
      ["text", "image", "document"],
    );
    assert.deepEqual(
      requests[0]?.inputEnvelope?.assets.map((item) => item.kind),
      ["image", "document"],
    );
    assert.deepEqual(
      requests[0]?.attachments?.map((item) => [item.type, item.name ?? ""]),
      [
        ["image", "image-message-image-out-of-order-1-img-key-out-of-order-1.png"],
        ["file", "report.pdf"],
      ],
    );
  } finally {
    harness.cleanup();
  }
});

test("飞书文档 fallback 成功后会追加输入说明", async () => {
  const harness = createHarness({
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      async runTask(request, hooks = {}) {
        taskRuntimeCalls.appServer += 1;
        const sessionId = request.channelContext.sessionId ?? request.channelContext.channelSessionKey ?? "session-1";
        runtimeStore.upsertTurnFromRequest({
          ...request,
          channelContext: {
            ...request.channelContext,
            sessionId,
          },
        }, request.taskId ?? "task-document-fallback-1");
        assert.ok(request.inputEnvelope);
        runtimeStore.saveTurnInput({
          requestId: request.requestId,
          envelope: request.inputEnvelope,
          compileSummary: {
            runtimeTarget: "app-server",
            degradationLevel: "controlled_fallback",
            warnings: [
              {
                code: "DOCUMENT_NATIVE_INPUT_FALLBACK",
                message: "当前 runtime 未声明支持原生文档输入，文档已退化为路径提示。",
                ...(request.inputEnvelope.assets[0]?.assetId
                  ? { assetId: request.inputEnvelope.assets[0].assetId }
                  : {}),
              },
            ],
          },
          createdAt: request.createdAt,
        });
        const baseResult: TaskResult = {
          taskId: request.taskId ?? "task-document-fallback-1",
          requestId: request.requestId,
          status: "completed",
          summary: "文档总结完成",
          output: "文档总结完成",
          completedAt: new Date().toISOString(),
        };
        return hooks.finalizeResult ? await hooks.finalizeResult(request, baseResult) : baseResult;
      },
    }),
  });

  try {
    harness.setMessageResourceDownloader(async (payload) => ({
      headers: {
        "content-type": payload?.params.type === "file" ? "application/pdf" : "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(
          filePath,
          payload?.params.type === "file" ? "fake-file" : "fake-image",
        ));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-file-followup-1",
        create_time: "1711958460000",
        message_type: "file",
        content: JSON.stringify({
          file_key: "file-key-followup-1",
          file_name: "report.pdf",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    await harness.handleMessageEventText("帮我总结这个文档");

    const messages = harness.takeMessages().join("\n");
    assert.match(messages, /文档总结完成/);
    assert.match(messages, /输入说明：当前执行链这一跳还不支持原生文档附件，所以这份文档只按文件路径提示处理，没有直接作为原生文档输入发送给 runtime。/);
  } finally {
    harness.cleanup();
  }
});

test("飞书图片路径失效导致失败时会追加重新发送提示", async () => {
  const harness = createHarness({
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      async runTask(request) {
        taskRuntimeCalls.appServer += 1;
        const sessionId = request.channelContext.sessionId ?? request.channelContext.channelSessionKey ?? "session-image-path-missing-1";
        runtimeStore.upsertTurnFromRequest({
          ...request,
          channelContext: {
            ...request.channelContext,
            sessionId,
          },
        }, request.taskId ?? "task-image-path-missing-1");
        assert.ok(request.inputEnvelope);
        runtimeStore.saveTurnInput({
          requestId: request.requestId,
          envelope: request.inputEnvelope,
          compileSummary: {
            runtimeTarget: "app-server",
            degradationLevel: "blocked",
            warnings: [
              {
                code: "IMAGE_PATH_UNAVAILABLE",
                message: "当前图片缺少可信本地路径，无法作为原生图片输入发送。",
                ...(request.inputEnvelope.assets[0]?.assetId
                  ? { assetId: request.inputEnvelope.assets[0].assetId }
                  : {}),
              },
            ],
          },
          createdAt: request.createdAt,
        });
        throw new Error("当前图片缺少可信本地路径，无法作为原生图片输入发送。");
      },
    }),
  });

  try {
    harness.setMessageResourceDownloader(async () => ({
      headers: {
        "content-type": "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-image-followup-missing-1",
        create_time: "1711958460000",
        message_type: "image",
        content: JSON.stringify({
          image_key: "img-key-followup-missing-1",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    await harness.handleMessageEventText("帮我看看这张图");

    const messages = harness.takeMessages().join("\n");
    assert.match(messages, /执行异常/);
    assert.match(messages, /当前图片缺少可信本地路径/);
    assert.match(messages, /输入说明：当前图片的本地临时文件已经失效，没法继续发送给 runtime，请重新发送这张图片后再试。/);
  } finally {
    harness.cleanup();
  }
});

test("飞书图片 native 不支持导致失败时会追加切换执行链提示", async () => {
  const harness = createHarness({
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      async runTask(request) {
        taskRuntimeCalls.appServer += 1;
        const sessionId = request.channelContext.sessionId ?? request.channelContext.channelSessionKey ?? "session-image-native-required-1";
        runtimeStore.upsertTurnFromRequest({
          ...request,
          channelContext: {
            ...request.channelContext,
            sessionId,
          },
        }, request.taskId ?? "task-image-native-required-1");
        assert.ok(request.inputEnvelope);
        runtimeStore.saveTurnInput({
          requestId: request.requestId,
          envelope: request.inputEnvelope,
          compileSummary: {
            runtimeTarget: "app-server",
            degradationLevel: "blocked",
            warnings: [
              {
                code: "IMAGE_NATIVE_INPUT_REQUIRED",
                message: "当前 runtime 未声明支持图片原生输入，任务已阻止。",
                ...(request.inputEnvelope.assets[0]?.assetId
                  ? { assetId: request.inputEnvelope.assets[0].assetId }
                  : {}),
              },
            ],
          },
          createdAt: request.createdAt,
        });
        throw new Error("当前 runtime 未声明支持图片原生输入，任务已阻止。");
      },
    }),
  });

  try {
    harness.setMessageResourceDownloader(async () => ({
      headers: {
        "content-type": "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-image-native-required-1",
        create_time: "1711958460000",
        message_type: "image",
        content: JSON.stringify({
          image_key: "img-key-native-required-1",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    await harness.handleMessageEventText("帮我看下这张图里有什么");

    const messages = harness.takeMessages().join("\n");
    assert.match(messages, /执行异常/);
    assert.match(messages, /当前 runtime 未声明支持图片原生输入/);
    assert.match(
      messages,
      /输入说明：当前执行链这一跳不支持原生图片附件，所以这张图片这次没法继续发给 runtime。请切到支持图片的执行链，或先用文字描述你想让我处理的内容。/,
    );
  } finally {
    harness.cleanup();
  }
});

test("飞书文本 native 不支持导致失败时会追加切回文本执行链提示", async () => {
  const harness = createHarness({
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      async runTask(request) {
        taskRuntimeCalls.appServer += 1;
        const sessionId = request.channelContext.sessionId ?? request.channelContext.channelSessionKey ?? "session-text-native-required-1";
        runtimeStore.upsertTurnFromRequest({
          ...request,
          channelContext: {
            ...request.channelContext,
            sessionId,
          },
        }, request.taskId ?? "task-text-native-required-1");
        assert.ok(request.inputEnvelope);
        runtimeStore.saveTurnInput({
          requestId: request.requestId,
          envelope: request.inputEnvelope,
          compileSummary: {
            runtimeTarget: "app-server",
            degradationLevel: "blocked",
            warnings: [
              {
                code: "TEXT_NATIVE_INPUT_REQUIRED",
                message: "当前 runtime 未声明支持文本原生输入。",
              },
            ],
          },
          createdAt: request.createdAt,
        });
        throw new Error("当前 runtime 未声明支持文本原生输入。");
      },
    }),
  });

  try {
    harness.setMessageResourceDownloader(async () => ({
      headers: {
        "content-type": "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-text-native-required-1",
        create_time: "1711958460000",
        message_type: "image",
        content: JSON.stringify({
          image_key: "img-key-text-native-required-1",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    await harness.handleMessageEventText("请根据图片和我的描述一起处理");

    const messages = harness.takeMessages().join("\n");
    assert.match(messages, /执行异常/);
    assert.match(messages, /当前 runtime 未声明支持文本原生输入/);
    assert.match(messages, /输入说明：当前执行链这一跳不支持文本原生输入，所以这条消息这次没法继续处理。请切回支持文本的执行链后再试。/);
  } finally {
    harness.cleanup();
  }
});

test("飞书不支持的文档输入导致失败时会追加文档类型提示", async () => {
  const harness = createHarness({
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      async runTask(request) {
        taskRuntimeCalls.appServer += 1;
        const sessionId = request.channelContext.sessionId ?? request.channelContext.channelSessionKey ?? "session-document-unsupported-1";
        runtimeStore.upsertTurnFromRequest({
          ...request,
          channelContext: {
            ...request.channelContext,
            sessionId,
          },
        }, request.taskId ?? "task-document-unsupported-1");
        assert.ok(request.inputEnvelope);
        runtimeStore.saveTurnInput({
          requestId: request.requestId,
          envelope: request.inputEnvelope,
          compileSummary: {
            runtimeTarget: "app-server",
            degradationLevel: "blocked",
            warnings: [
              {
                code: "DOCUMENT_INPUT_UNSUPPORTED",
                message: "当前 runtime 不支持文档输入：application/vnd.ms-excel",
                ...(request.inputEnvelope.assets[0]?.assetId
                  ? { assetId: request.inputEnvelope.assets[0].assetId }
                  : {}),
              },
            ],
          },
          createdAt: request.createdAt,
        });
        throw new Error("当前 runtime 不支持文档输入：application/vnd.ms-excel");
      },
    }),
  });

  try {
    harness.setMessageResourceDownloader(async (payload) => ({
      headers: {
        "content-type": payload?.params.type === "file" ? "application/vnd.ms-excel" : "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-file"));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-document-unsupported-1",
        create_time: "1711958460000",
        message_type: "file",
        content: JSON.stringify({
          file_key: "file-key-document-unsupported-1",
          file_name: "sheet.xls",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    await harness.handleMessageEventText("帮我处理这个表格");

    const messages = harness.takeMessages().join("\n");
    assert.match(messages, /执行异常/);
    assert.match(messages, /当前 runtime 不支持文档输入：application\/vnd\.ms-excel/);
    assert.match(messages, /输入说明：当前执行链这一跳还不支持这种文档输入（application\/vnd\.ms-excel），所以这份附件这次没法继续处理。请换成受支持的文档类型，或直接把关键信息发成文本。/);
  } finally {
    harness.cleanup();
  }
});

test("飞书切换到新会话后不会误消费旧会话的附件草稿", async () => {
  const harness = createHarness();

  try {
    harness.setMessageResourceDownloader(async () => ({
      headers: {
        "content-type": "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-image-5",
        create_time: "1711958400000",
        message_type: "image",
        content: JSON.stringify({
          image_key: "img-key-5",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    await harness.handleCommand("new", []);
    harness.takeSingleMessage();

    await harness.handleMessageEventText("这是新会话里的普通文本");

    const requests = harness.getTaskRequests();
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.inputEnvelope, undefined);
    assert.equal(requests[0]?.attachments?.length ?? 0, 0);
    assert.equal(harness.readAttachmentDraftStore()?.drafts.length ?? 0, 1);
  } finally {
    harness.cleanup();
  }
});

test("飞书附件下载失败时会提示错误且不留下脏草稿", async () => {
  const harness = createHarness();

  try {
    harness.setMessageResourceDownloader(async () => {
      throw new Error("download failed");
    });

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-image-6",
        create_time: "1711958400000",
        message_type: "image",
        content: JSON.stringify({
          image_key: "img-key-6",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });

    const message = harness.takeSingleMessage();
    assert.match(message, /执行异常/);
    assert.match(message, /download failed/);
    assert.equal(harness.getTaskRequests().length, 0);
    assert.equal(harness.readAttachmentDraftStore(), null);
  } finally {
    harness.cleanup();
  }
});

test("飞书原始入站回调会先返回，再在后台继续处理任务", async () => {
  let releaseTask = (): void => {};
  const taskReleased = new Promise<void>((resolve) => {
    releaseTask = resolve;
  });
  let markTaskStarted = (): void => {};
  const taskStarted = new Promise<void>((resolve) => {
    markTaskStarted = resolve;
  });
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      async runTask(request, hooks = {}) {
        taskRuntimeCalls.appServer += 1;
        markTaskStarted();
        await taskReleased;
        const result = {
          taskId: request.taskId ?? "task-feishu-raw-ack",
          requestId: request.requestId,
          status: "completed" as const,
          summary: request.goal,
          output: request.goal,
          completedAt: new Date().toISOString(),
        };
        return hooks.finalizeResult ? await hooks.finalizeResult(request, result) : result;
      },
    }),
  });

  try {
    let settled = false;
    const accepted = harness.acceptRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-text-ack-1",
        create_time: "1711958400000",
        message_type: "text",
        content: JSON.stringify({
          text: "请慢慢处理这条消息",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    void accepted.then(() => {
      settled = true;
    });

    await taskStarted;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, true);

    releaseTask();
    await accepted;
    await harness.waitForBackgroundMessages();
  } finally {
    harness.cleanup();
  }
});

test("飞书较早到达的附件即使晚于文本处理完成，也仍会进入草稿", async () => {
  const harness = createHarness();

  try {
    harness.setMessageResourceDownloader(async () => ({
      headers: {
        "content-type": "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-text-before-attachment",
        create_time: "1711958460000",
        message_type: "text",
        content: JSON.stringify({
          text: "先看这段说明",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeMessages();

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-image-after-text",
        create_time: "1711958400000",
        message_type: "image",
        content: JSON.stringify({
          image_key: "img-key-after-text",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });

    assert.match(harness.takeSingleMessage(), /已收到 1 个附件，请直接回复你的问题/);
    assert.equal(harness.readAttachmentDraftStore()?.drafts.length, 1);
  } finally {
    harness.cleanup();
  }
});

test("飞书后续普通文本不会重复消费同一份附件草稿", async () => {
  let releaseFirstTask = (): void => {};
  const firstTaskReleased = new Promise<void>((resolve) => {
    releaseFirstTask = resolve;
  });
  let markFirstTaskEntered = (): void => {};
  const firstTaskEntered = new Promise<void>((resolve) => {
    markFirstTaskEntered = resolve;
  });
  const startedAttachmentCounts: number[] = [];
  let runIndex = 0;
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      async runTask(request, hooks = {}) {
        taskRuntimeCalls.appServer += 1;
        runIndex += 1;

        if (runIndex === 1) {
          markFirstTaskEntered();
          await firstTaskReleased;
        }

        startedAttachmentCounts.push(request.attachments?.length ?? 0);
        await hooks.onEvent?.({
          eventId: `event-task-started-${runIndex}`,
          taskId: request.taskId ?? `task-feishu-attachment-race-${runIndex}`,
          requestId: request.requestId,
          type: "task.started",
          status: "running",
          message: request.goal,
          timestamp: new Date().toISOString(),
        });

        const result = {
          taskId: request.taskId ?? `task-feishu-attachment-race-${runIndex}`,
          requestId: request.requestId,
          status: "completed" as const,
          summary: request.goal,
          output: request.goal,
          completedAt: new Date().toISOString(),
        };
        return hooks.finalizeResult ? await hooks.finalizeResult(request, result) : result;
      },
    }),
  });

  try {
    harness.setMessageResourceDownloader(async () => ({
      headers: {
        "content-type": "image/png",
      },
      async writeFile(filePath: string) {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
      },
      getReadableStream() {
        throw new Error("not implemented");
      },
    }));

    await harness.handleRawMessageEvent({
      message: {
        chat_id: "chat-1",
        message_id: "message-image-race-1",
        create_time: "1711958400000",
        message_type: "image",
        content: JSON.stringify({
          image_key: "img-key-race-1",
        }),
      },
      sender: {
        sender_id: {
          user_id: "user-1",
        },
      },
    });
    harness.takeSingleMessage();

    const first = harness.handleMessageEventText("第一条普通文本");
    await firstTaskEntered;

    const second = harness.handleMessageEventText("第二条普通文本");
    await new Promise((resolve) => setImmediate(resolve));

    releaseFirstTask();
    await Promise.all([first, second]);

    assert.deepEqual(startedAttachmentCounts, [1, 0]);
  } finally {
    harness.cleanup();
  }
});

test("飞书普通任务在未显式指定 runtimeEngine 时默认走 app-server runtime", async () => {
  const harness = createHarness();

  try {
    await harness.handleIncomingText("请执行一次默认引擎切换测试");

    assert.deepEqual(harness.getTaskRuntimeCalls(), {
      sdk: 0,
      appServer: 1,
    });
  } finally {
    harness.cleanup();
  }
});

test("飞书在未传 runtimeRegistry 时也默认走内建 app-server runtime", async () => {
  let appServerCalls = 0;
  const originalRunTask = AppServerTaskRuntime.prototype.runTask;

  AppServerTaskRuntime.prototype.runTask = async function patchedRunTask(request) {
    appServerCalls += 1;
    return {
      taskId: request.taskId ?? "task-feishu-built-in-app-server-1",
      requestId: request.requestId,
      status: "completed",
      summary: request.goal,
      output: request.goal,
      structuredOutput: {
        session: {
          engine: "app-server",
        },
      },
      completedAt: new Date().toISOString(),
    };
  };

  const harness = createHarness({
    omitRuntimeRegistry: true,
  });

  try {
    await harness.handleIncomingText("请走内建 app-server runtime");
    const messages = harness.takeMessages();

    assert.ok(messages.some((message) => message.includes("请走内建 app-server runtime")));
    assert.equal(appServerCalls, 1);
    assert.equal(harness.getTaskRuntimeCalls().sdk, 0);
  } finally {
    AppServerTaskRuntime.prototype.runTask = originalRunTask;
    harness.cleanup();
  }
});

test("飞书收到 task.action_required 时会提示命令式回复", async () => {
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerEventsBuilder: (request) => [{
      eventId: "event-feishu-action-required-1",
      taskId: request.taskId ?? "task-feishu-action-required",
      requestId: request.requestId,
      type: "task.action_required",
      status: "waiting",
      message: "Allow command?\n使用 /approve approval-1 或 /deny approval-1",
      payload: {
        actionId: "approval-1",
        actionType: "approval",
        prompt: "Allow command?",
        choices: ["approve", "deny"],
      },
      timestamp: new Date().toISOString(),
    }],
  });

  try {
    await harness.handleIncomingText("请执行一次等待审批测试");

    const messages = harness.takeMessages();
    assert.ok(messages.some((message) => /Allow command\?/.test(message)));
    assert.ok(messages.some((message) => /\/approve approval-1/.test(message)));
  } finally {
    harness.cleanup();
  }
});

test("飞书 approval waiting action 会把占位消息升级成 interactive 审批卡", async () => {
  const actionId = "approval-card-1";
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerEventsBuilder: (request) => [{
      eventId: "event-feishu-approval-card-1",
      taskId: "task-feishu-approval-card-1",
      requestId: request.requestId,
      type: "task.action_required",
      status: "waiting",
      message: "Allow card action?",
      payload: {
        actionId,
        actionType: "approval",
        prompt: "Allow card action?",
        choices: ["approve", "deny"],
      },
      timestamp: new Date().toISOString(),
    }],
  });

  try {
    await harness.handleIncomingText("请执行一次审批卡测试");

    const interactiveDraft = harness.peekRenderedMessages().find((entry) => entry.msgType === "interactive");
    assert.ok(interactiveDraft);

    const buttons = listInteractiveCardButtons(interactiveDraft.content);
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0]?.value?.actionId, actionId);
    assert.equal(buttons[0]?.value?.decision, "approve");
    assert.equal(typeof buttons[0]?.value?.cardKey, "string");
    assert.match(interactiveDraft.content, /\/approve approval-card-1/);
    assert.match(interactiveDraft.content, /\/deny approval-card-1/);
  } finally {
    harness.cleanup();
  }
});

test("飞书审批卡回调会复用 approval 解析并同步返回终态卡", async () => {
  const actionId = "approval-card-callback-1";
  const taskId = "task-feishu-approval-card-callback-1";
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerEventsBuilder: (request) => [{
      eventId: "event-feishu-approval-card-callback-1",
      taskId,
      requestId: request.requestId,
      type: "task.action_required",
      status: "waiting",
      message: "Allow callback approval?",
      payload: {
        actionId,
        actionType: "approval",
        prompt: "Allow callback approval?",
        choices: ["approve", "deny"],
      },
      timestamp: new Date().toISOString(),
    }],
  });

  try {
    await harness.handleIncomingText("请执行一次审批卡回调测试");

    const taskRequest = harness.getTaskRequests().at(-1);
    assert.ok(taskRequest?.requestId);
    harness.injectPendingAction({
      taskId,
      requestId: taskRequest.requestId,
      actionId,
      actionType: "approval",
      prompt: "Allow callback approval?",
      choices: ["approve", "deny"],
    });

    const interactiveDraft = harness.peekRenderedMessages().find((entry) => entry.msgType === "interactive");
    assert.ok(interactiveDraft);

    const approveButton = listInteractiveCardButtons(interactiveDraft.content).find((button) => button.value?.decision === "approve");
    assert.ok(approveButton?.value);

    const callbackCard = await harness.handleCardActionEvent({
      schema: "2.0",
      header: {
        event_type: "card.action.trigger",
        token: "token",
        create_time: String(Date.now()),
        app_id: "cli_test",
      },
      event: {
        open_id: "ou_user_1",
        user_id: "user-1",
        tenant_key: "tenant-card-test",
        open_message_id: "om_card_callback_1",
        token: "callback-token-1",
        action: {
          tag: "button",
          value: approveButton.value,
        },
      },
    });

    assert.equal(harness.findPendingAction(actionId), null);
    assert.deepEqual(harness.getResolvedActionSubmissions().at(-1), {
      taskId,
      requestId: taskRequest.requestId,
      actionId,
      decision: "approve",
    });
    assert.match(JSON.stringify(callbackCard), /已批准|已提交审批/);
  } finally {
    harness.cleanup();
  }
});

test("/use 成功后会回显切换后的会话状态和线程摘要", async () => {
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      readThreadSnapshot: async ({ threadId }) => ({
        threadId,
        preview: threadId === "thread-switch-a" ? "session A preview" : "session B preview",
        status: "idle",
        cwd: "/workspace/themis",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        turnCount: 2,
        turns: [],
      }),
      async runTask(request, hooks = {}) {
        taskRuntimeCalls.appServer += 1;
        const sessionId = request.channelContext.channelSessionKey ?? "session-switch-fallback";
        const threadId = /第一条/.test(request.goal) ? "thread-switch-a" : "thread-switch-b";
        const storedRequest = {
          ...request,
          channelContext: {
            ...request.channelContext,
            sessionId,
          },
        };
        runtimeStore.upsertTurnFromRequest(storedRequest, request.taskId ?? `task-${threadId}`);
        runtimeStore.saveSession({
          sessionId,
          threadId,
          createdAt: request.createdAt,
          updatedAt: request.createdAt,
        });

        const result: TaskResult = {
          taskId: request.taskId ?? `task-${threadId}`,
          requestId: request.requestId,
          status: "completed",
          summary: request.goal,
          output: request.goal,
          structuredOutput: {
            session: {
              engine: "app-server",
              threadId,
            },
          },
          completedAt: new Date().toISOString(),
        };

        const finalized = hooks.finalizeResult ? await hooks.finalizeResult(request, result) : result;
        runtimeStore.completeTaskTurn({
          request: storedRequest,
          result: finalized,
          sessionMode: "resumed",
          threadId,
        });
        return finalized;
      },
    }),
  } as FeishuHarnessConfig);

  try {
    await harness.handleIncomingText("第一条会话");
    const firstSessionId = harness.getCurrentSessionId();
    harness.takeMessages();

    await harness.handleCommand("new", []);
    harness.takeMessages();
    await harness.handleIncomingText("第二条会话");
    harness.takeMessages();

    assert.ok(firstSessionId);
    await harness.handleCommand("use", [firstSessionId]);

    const messages = harness.takeMessages().join("\n");
    assert.match(messages, new RegExp(`已切换到会话：${firstSessionId}`));
    assert.match(messages, /当前会话/);
    assert.match(messages, /thread-switch-a/);
    assert.match(messages, /session A preview/);
  } finally {
    harness.cleanup();
  }
});

test("飞书 /use 切回目标会话后会接管该会话里的 Web-origin user-input waiting action", async () => {
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      readThreadSnapshot: async ({ threadId }) => ({
        threadId,
        preview: threadId === "thread-web-switch-a" ? "session A preview" : "session B preview",
        status: "idle",
        cwd: "/workspace/themis",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        turnCount: 2,
        turns: [],
      }),
      async runTask(request, hooks = {}) {
        taskRuntimeCalls.appServer += 1;
        const sessionId = request.channelContext.channelSessionKey ?? "session-web-switch-fallback";
        const threadId = /会话 A/.test(request.goal) ? "thread-web-switch-a" : "thread-web-switch-b";
        const storedRequest = {
          ...request,
          channelContext: {
            ...request.channelContext,
            sessionId,
          },
        };
        runtimeStore.upsertTurnFromRequest(storedRequest, request.taskId ?? `task-${threadId}`);
        runtimeStore.saveSession({
          sessionId,
          threadId,
          createdAt: request.createdAt,
          updatedAt: request.createdAt,
        });

        const result: TaskResult = {
          taskId: request.taskId ?? `task-${threadId}`,
          requestId: request.requestId,
          status: "completed",
          summary: request.goal,
          output: request.goal,
          structuredOutput: {
            session: {
              engine: "app-server",
              threadId,
            },
          },
          completedAt: new Date().toISOString(),
        };

        const finalized = hooks.finalizeResult ? await hooks.finalizeResult(request, result) : result;
        runtimeStore.completeTaskTurn({
          request: storedRequest,
          result: finalized,
          sessionMode: "resumed",
          threadId,
        });
        return finalized;
      },
    }),
  });

  try {
    await harness.handleIncomingText("建立会话 A");
    const sessionA = harness.getCurrentSessionId();
    harness.takeMessages();

    await harness.handleCommand("new", []);
    harness.takeMessages();
    await harness.handleIncomingText("建立会话 B");
    const sessionB = harness.getCurrentSessionId();
    harness.takeMessages();

    assert.ok(sessionA);
    assert.ok(sessionB);
    assert.notEqual(sessionA, sessionB);

    harness.injectPendingAction({
      taskId: "task-web-switch-1",
      requestId: "req-web-switch-1",
      actionId: "reply-web-switch-1",
      actionType: "user-input",
      prompt: "Please continue session A",
      sourceChannel: "web",
      userId: "web-user-1",
      principalId: harness.getCurrentPrincipalId(),
      sessionId: sessionA,
    });

    await harness.handleCommand("use", [sessionA]);
    const switchMessages = harness.takeMessages().join("\n");
    assert.match(switchMessages, new RegExp(`已切换到会话：${sessionA}`));
    const beforeTaskRuntimeCalls = harness.getTaskRuntimeCalls();

    await harness.handleMessageEventText("按会话 A 的上下文继续");

    assert.equal(harness.findPendingAction("reply-web-switch-1"), null);
    assert.deepEqual(harness.getResolvedActionSubmissions().at(-1), {
      taskId: "task-web-switch-1",
      requestId: "req-web-switch-1",
      actionId: "reply-web-switch-1",
      inputText: "按会话 A 的上下文继续",
    });
    assert.deepEqual(harness.getTaskRuntimeCalls(), beforeTaskRuntimeCalls);
  } finally {
    harness.cleanup();
  }
});

test("飞书切到其他会话后不会误接管非当前会话的 waiting input", async () => {
  const harness = createHarness();

  try {
    await harness.handleIncomingText("建立会话 A");
    const sessionA = harness.getCurrentSessionId();
    assert.ok(sessionA);
    harness.takeMessages();

    harness.injectPendingAction({
      taskId: "task-hidden-session-a",
      requestId: "req-hidden-session-a",
      actionId: "reply-hidden-a",
      actionType: "user-input",
      prompt: "Please continue session A",
      sourceChannel: "web",
      userId: "web-user-2",
      principalId: harness.getCurrentPrincipalId(),
      sessionId: sessionA,
    });

    await harness.handleCommand("new", []);
    harness.takeMessages();
    const beforeTaskRuntimeCalls = harness.getTaskRuntimeCalls();
    await harness.handleMessageEventText("建立会话 B");
    const sessionB = harness.getCurrentSessionId();

    const messages = harness.takeMessages().join("\n");
    assert.ok(sessionA);
    assert.ok(sessionB);
    assert.notEqual(sessionA, sessionB);
    assert.match(messages, /建立会话 B/);
    assert.notEqual(harness.findPendingAction("reply-hidden-a"), null);
    assert.deepEqual(harness.getResolvedActionSubmissions(), []);
    assert.deepEqual(harness.getTaskRuntimeCalls(), {
      sdk: beforeTaskRuntimeCalls.sdk,
      appServer: beforeTaskRuntimeCalls.appServer + 1,
    });
  } finally {
    harness.cleanup();
  }
});

test("飞书切回已有 app-server 会话后，继续发送普通消息会复用同一 native thread", async () => {
  const resumedThreadIds: string[] = [];
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      readThreadSnapshot: async ({ threadId }) => ({
        threadId,
        preview: "shared web-feishu thread",
        status: "completed",
        cwd: "/workspace/themis",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        turnCount: 2,
        turns: [],
      }),
      async runTask(request, hooks = {}) {
        taskRuntimeCalls.appServer += 1;
        const sessionId = request.channelContext.channelSessionKey ?? "session-feishu-existing";
        const existingThreadId = runtimeStore.getSession(sessionId)?.threadId ?? null;
        const threadId = existingThreadId ?? "thread-feishu-existing-1";

        if (existingThreadId) {
          resumedThreadIds.push(existingThreadId);
        }

        const storedRequest = {
          ...request,
          channelContext: {
            ...request.channelContext,
            sessionId,
          },
        };
        runtimeStore.upsertTurnFromRequest(storedRequest, request.taskId ?? "task-feishu-existing");
        runtimeStore.saveSession({
          sessionId,
          threadId,
          createdAt: request.createdAt,
          updatedAt: request.createdAt,
        });

        const result: TaskResult = {
          taskId: request.taskId ?? "task-feishu-existing",
          requestId: request.requestId,
          status: "completed",
          summary: request.goal,
          output: request.goal,
          structuredOutput: {
            session: {
              engine: "app-server",
              threadId,
            },
          },
          completedAt: new Date().toISOString(),
        };
        const finalized = hooks.finalizeResult ? await hooks.finalizeResult(request, result) : result;
        runtimeStore.completeTaskTurn({
          request: storedRequest,
          result: finalized,
          sessionMode: "resumed",
          threadId,
        });
        return finalized;
      },
    }),
  } as FeishuHarnessConfig);

  try {
    const sessionId = "session-web-feishu-shared";
    harness.seedAppServerSession(sessionId, {
      threadId: "thread-feishu-existing-1",
      sourceChannel: "web",
      goal: "web 先建立共享会话",
      summary: "web 已完成首轮",
      status: "completed",
    });

    await harness.handleCommand("use", [sessionId]);
    const switched = harness.takeMessages().join("\n");
    assert.match(switched, /thread-feishu-existing-1/);

    await harness.handleIncomingText("飞书继续这个共享会话");
    harness.takeMessages();

    assert.deepEqual(resumedThreadIds, ["thread-feishu-existing-1"]);

    await harness.handleCommand("current", []);
    const current = harness.takeSingleMessage();
    assert.match(current, /thread-feishu-existing-1/);
    assert.match(current, /shared web-feishu thread/);
  } finally {
    harness.cleanup();
  }
});

test("飞书切回已有 web app-server 会话后，/review 会命中同一 sessionId", async () => {
  const reviewCalls: Array<{ sessionId: string; instructions: string }> = [];
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      startReview: async (request) => {
        reviewCalls.push(request);
        return {
          reviewThreadId: "review-thread-shared-1",
          turnId: "review-turn-shared-1",
        };
      },
    }),
  } as FeishuHarnessConfig);

  try {
    const sessionId = "session-review-from-web";
    harness.seedAppServerSession(sessionId, {
      threadId: "thread-review-from-web-1",
      sourceChannel: "web",
      goal: "web 先建立 review 会话",
      status: "completed",
    });

    await harness.handleCommand("use", [sessionId]);
    harness.takeMessages();
    await harness.handleCommand("review", ["请复查 Web 建立的这条会话"]);

    assert.deepEqual(reviewCalls, [{
      sessionId,
      instructions: "请复查 Web 建立的这条会话",
    }]);
    assert.match(harness.takeSingleMessage(), /已发起 Review/);
  } finally {
    harness.cleanup();
  }
});

test("飞书切回已有 web app-server 会话后，/steer 会命中同一 sessionId", async () => {
  const steerCalls: Array<{ sessionId: string; message: string; turnId?: string }> = [];
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      readThreadSnapshot: async ({ threadId }) => ({
        threadId,
        preview: "running shared thread",
        status: "running",
        cwd: "/workspace/themis",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        turnCount: 1,
        turns: [],
      }),
      steerTurn: async (request) => {
        steerCalls.push(request);
        return {
          turnId: "turn-steer-shared-1",
        };
      },
    }),
  } as FeishuHarnessConfig);

  try {
    const sessionId = "session-steer-from-web";
    harness.seedAppServerSession(sessionId, {
      threadId: "thread-steer-from-web-1",
      sourceChannel: "web",
      goal: "web 先建立 steer 会话",
      summary: "正在执行中的共享会话",
      status: "running",
    });

    await harness.handleCommand("use", [sessionId]);
    harness.takeMessages();
    await harness.handleCommand("steer", ["请把范围收窄到回归和 history 校验"]);

    assert.deepEqual(steerCalls, [{
      sessionId,
      message: "请把范围收窄到回归和 history 校验",
    }]);
    assert.match(harness.takeSingleMessage(), /已发送 Steer/);
  } finally {
    harness.cleanup();
  }
});

test("飞书收到 task.action_required 时会输出移动端 waiting action 表达和线程摘要", async () => {
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      actionBridge,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      readThreadSnapshot: async () => ({
        threadId: "thread-feishu-mobile-action-1",
        preview: "review current diff",
        status: "running",
        cwd: "/workspace/themis",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        turnCount: 3,
        turns: [],
      }),
      async runTask(request, hooks = {}) {
        taskRuntimeCalls.appServer += 1;
        const sessionId = request.channelContext.channelSessionKey ?? "session-feishu-mobile-action";
        const taskId = request.taskId ?? "task-feishu-mobile-action";
        const requestId = request.requestId;
        const principalId = identityService.ensureIdentity({
          channel: request.sourceChannel,
          channelUserId: request.user.userId,
        }).principalId;

        runtimeStore.saveSession({
          sessionId,
          threadId: "thread-feishu-mobile-action-1",
          createdAt: request.createdAt,
          updatedAt: request.createdAt,
        });

        actionBridge.register({
          taskId,
          requestId,
          actionId: "approval-mobile-1",
          actionType: "approval",
          prompt: "Allow command?",
          choices: ["approve", "deny"],
          scope: {
            sourceChannel: "feishu",
            principalId,
            userId: request.user.userId,
            ...(sessionId ? { sessionId } : {}),
          },
        });

        await hooks.onEvent?.({
          eventId: "event-feishu-mobile-action-1",
          taskId,
          requestId,
          type: "task.action_required",
          status: "waiting",
          message: "Allow command?",
          payload: {
            actionId: "approval-mobile-1",
            actionType: "approval",
            prompt: "Allow command?",
            choices: ["approve", "deny"],
          },
          timestamp: new Date().toISOString(),
        });

        return {
          taskId,
          requestId,
          status: "cancelled",
          summary: "cancel after waiting action",
          output: "cancel after waiting action",
          structuredOutput: {
            session: {
              engine: "app-server",
              threadId: "thread-feishu-mobile-action-1",
            },
          },
          completedAt: new Date().toISOString(),
        };
      },
    }),
  } as FeishuHarnessConfig);

  try {
    await harness.handleIncomingText("请执行移动端 waiting action 测试");

    const messages = harness.takeMessages().join("\n");
    assert.match(messages, /等待你处理/);
    assert.match(messages, /approval-mobile-1/);
    assert.match(messages, /thread-feishu-mobile-action-1/);
    assert.match(messages, /review current diff/);
    assert.match(messages, /\/approve approval-mobile-1/);
  } finally {
    harness.cleanup();
  }
});

test("/review <指令> 会对当前会话发起 review", async () => {
  const reviewCalls: Array<{ sessionId: string; instructions: string }> = [];
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      startReview: async (request) => {
        reviewCalls.push(request);
        return {
          reviewThreadId: "review-thread-1",
          turnId: "review-turn-1",
        };
      },
      async runTask(request, hooks = {}) {
        taskRuntimeCalls.appServer += 1;
        const sessionId = request.channelContext.channelSessionKey ?? "session-review";
        const storedRequest = {
          ...request,
          channelContext: {
            ...request.channelContext,
            sessionId,
          },
        };
        runtimeStore.upsertTurnFromRequest(storedRequest, request.taskId ?? "task-review");

        const result: TaskResult = {
          taskId: request.taskId ?? "task-review",
          requestId: request.requestId,
          status: "completed",
          summary: request.goal,
          output: request.goal,
          structuredOutput: {
            session: {
              engine: "app-server",
              threadId: "thread-review-1",
            },
          },
          completedAt: new Date().toISOString(),
        };
        const finalized = hooks.finalizeResult ? await hooks.finalizeResult(request, result) : result;
        runtimeStore.completeTaskTurn({
          request: storedRequest,
          result: finalized,
          sessionMode: "resumed",
          threadId: "thread-review-1",
        });
        return finalized;
      },
    }),
  } as FeishuHarnessConfig);

  try {
    await harness.handleIncomingText("先建立一条可 review 会话");
    harness.takeMessages();
    await harness.handleCommand("review", ["请只检查回归风险"]);

    assert.deepEqual(reviewCalls, [{
      sessionId: harness.getCurrentSessionId() ?? "",
      instructions: "请只检查回归风险",
    }]);
    assert.match(harness.takeSingleMessage(), /已发起 Review/);
  } finally {
    harness.cleanup();
  }
});

test("/steer <指令> 会向当前会话发送 steer", async () => {
  const steerCalls: Array<{ sessionId: string; message: string; turnId?: string }> = [];
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
    }) => ({
      ...createTaskRuntimeDouble({
        engine: "app-server",
        runtimeStore,
        identityService,
        principalSkillsService,
        taskRuntimeCalls,
      }),
      steerTurn: async (request) => {
        steerCalls.push(request);
        return {
          turnId: "turn-steer-1",
        };
      },
      async runTask(request, hooks = {}) {
        taskRuntimeCalls.appServer += 1;
        const sessionId = request.channelContext.channelSessionKey ?? "session-steer";
        const storedRequest = {
          ...request,
          channelContext: {
            ...request.channelContext,
            sessionId,
          },
        };
        runtimeStore.upsertTurnFromRequest(storedRequest, request.taskId ?? "task-steer");

        const result: TaskResult = {
          taskId: request.taskId ?? "task-steer",
          requestId: request.requestId,
          status: "completed",
          summary: request.goal,
          output: request.goal,
          structuredOutput: {
            session: {
              engine: "app-server",
              threadId: "thread-steer-1",
            },
          },
          completedAt: new Date().toISOString(),
        };
        const finalized = hooks.finalizeResult ? await hooks.finalizeResult(request, result) : result;
        runtimeStore.completeTaskTurn({
          request: storedRequest,
          result: finalized,
          sessionMode: "resumed",
          threadId: "thread-steer-1",
        });
        return finalized;
      },
    }),
  } as FeishuHarnessConfig);

  try {
    await harness.handleIncomingText("先建立一条可 steer 会话");
    harness.takeMessages();
    await harness.handleCommand("steer", ["请先收窄到测试和回归验证"]);

    assert.deepEqual(steerCalls, [{
      sessionId: harness.getCurrentSessionId() ?? "",
      message: "请先收窄到测试和回归验证",
    }]);
    assert.match(harness.takeSingleMessage(), /已发送 Steer/);
  } finally {
    harness.cleanup();
  }
});

test("飞书 /use 切回目标会话后，/review 仍绑定当前会话", async () => {
  const reviewCalls: Array<{ sessionId: string; instructions: string }> = [];
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: (deps) => ({
      ...createAppServerSessionThreadRuntime({
        ...deps,
        sessionIdFallback: "session-review-fallback",
        taskIdPrefix: "task-review",
        threadIdForGoal: (goal) => (/会话 A/.test(goal) ? "thread-review-a" : "thread-review-b"),
      }),
      startReview: async (request) => {
        reviewCalls.push(request);
        return {
          reviewThreadId: `review-thread-${request.sessionId}`,
          turnId: `review-turn-${request.sessionId}`,
        };
      },
    }),
  } as FeishuHarnessConfig);

  try {
    await harness.handleIncomingText("建立 review 会话 A");
    const sessionA = harness.getCurrentSessionId();
    harness.takeMessages();

    await harness.handleCommand("new", []);
    harness.takeMessages();
    await harness.handleIncomingText("建立 review 会话 B");
    harness.takeMessages();

    assert.ok(sessionA);
    await harness.handleCommand("use", [sessionA ?? ""]);
    harness.takeMessages();
    await harness.handleCommand("review", ["只检查会话 A 的回归风险"]);

    assert.deepEqual(reviewCalls, [{
      sessionId: sessionA ?? "",
      instructions: "只检查会话 A 的回归风险",
    }]);
  } finally {
    harness.cleanup();
  }
});

test("飞书 /use 切回目标会话后，/steer 仍绑定当前会话", async () => {
  const steerCalls: Array<{ sessionId: string; message: string }> = [];
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: (deps) => ({
      ...createAppServerSessionThreadRuntime({
        ...deps,
        sessionIdFallback: "session-steer-fallback",
        taskIdPrefix: "task-steer",
        threadIdForGoal: (goal) => (/会话 A/.test(goal) ? "thread-steer-a" : "thread-steer-b"),
      }),
      steerTurn: async (request) => {
        steerCalls.push(request);
        return {
          turnId: `steer-turn-${request.sessionId}`,
        };
      },
    }),
  } as FeishuHarnessConfig);

  try {
    await harness.handleIncomingText("建立 steer 会话 A");
    const sessionA = harness.getCurrentSessionId();
    harness.takeMessages();

    await harness.handleCommand("new", []);
    harness.takeMessages();
    await harness.handleIncomingText("建立 steer 会话 B");
    harness.takeMessages();

    assert.ok(sessionA);
    await harness.handleCommand("use", [sessionA ?? ""]);
    harness.takeMessages();
    await harness.handleCommand("steer", ["把当前会话收窄到 A 的上下文"]);

    assert.deepEqual(steerCalls, [{
      sessionId: sessionA ?? "",
      message: "把当前会话收窄到 A 的上下文",
    }]);
  } finally {
    harness.cleanup();
  }
});

test("飞书命令式审批恢复会沿同一任务链收口 action 提示、审批提交与最终结果", async () => {
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      actionBridge,
      taskRuntimeCalls,
    }) => ({
      async runTask(request, hooks = {}) {
        taskRuntimeCalls.appServer += 1;
        const taskId = request.taskId ?? "task-feishu-journey-1";
        const requestId = request.requestId;
        const actionId = "approval-feishu-journey-1";
        const principalId = identityService.ensureIdentity({
          channel: request.sourceChannel,
          channelUserId: request.user.userId,
        }).principalId;

        actionBridge.register({
          taskId,
          requestId,
          actionId,
          actionType: "approval",
          prompt: "Allow feishu recovery journey?",
          choices: ["approve", "deny"],
          scope: {
            sourceChannel: "feishu",
            principalId,
            userId: request.user.userId,
            ...(request.channelContext.channelSessionKey
              ? {
                sessionId: request.channelContext.channelSessionKey,
              }
              : {}),
          },
        });

        await hooks.onEvent?.({
          eventId: "event-feishu-journey-action-required",
          taskId,
          requestId,
          type: "task.action_required",
          status: "waiting",
          message: `Allow feishu recovery journey?\n使用 /approve ${actionId} 或 /deny ${actionId}`,
          payload: {
            actionId,
            actionType: "approval",
            prompt: "Allow feishu recovery journey?",
            choices: ["approve", "deny"],
          },
          timestamp: new Date().toISOString(),
        });

        const submissionPromise = actionBridge.waitForSubmission(taskId, requestId, actionId);
        assert.ok(submissionPromise);
        const submission = await submissionPromise;
        assert.ok(submission);
        assert.equal(submission.decision, "approve");

        const result: TaskResult = {
          taskId,
          requestId,
          status: "completed",
          summary: `最终结果：${request.goal}`,
          output: `最终结果：${request.goal}`,
          structuredOutput: {
            session: {
              engine: "app-server",
            },
          },
          completedAt: new Date().toISOString(),
        };

        return hooks.finalizeResult ? await hooks.finalizeResult(request, result) : result;
      },
      getRuntimeStore() {
        return runtimeStore;
      },
      getIdentityLinkService() {
        return identityService;
      },
      getPrincipalSkillsService() {
        return principalSkillsService;
      },
    }),
  } as FeishuHarnessConfig);

  try {
    const taskPromise = harness.handleIncomingText("请执行一次飞书恢复闭环测试");

    await waitFor(() => {
      const messages = harness.peekMessages();
      return messages.some((message) => message.includes("/approve approval-feishu-journey-1"));
    });

    await harness.handleCommand("approve", ["approval-feishu-journey-1"]);
    await taskPromise;

    const messages = harness.takeMessages().join("\n");
    assert.match(messages, /Allow feishu recovery journey\?/);
    assert.match(messages, /已提交审批/);
    assert.match(messages, /最终结果：请执行一次飞书恢复闭环测试/);
    const submissions = harness.getResolvedActionSubmissions();
    assert.equal(submissions.length, 1);
    assert.match(submissions[0]?.taskId ?? "", /^task-/);
    assert.equal(submissions[0]?.actionId, "approval-feishu-journey-1");
    assert.equal(submissions[0]?.decision, "approve");
    assert.ok(submissions[0]?.requestId);
  } finally {
    harness.cleanup();
  }
});

test("飞书 approval -> user-input 混合恢复会由 direct-text takeover 完成第二轮收口", async () => {
  const emittedEventSummaries: string[] = [];
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      actionBridge,
      taskRuntimeCalls,
    }) => ({
      async runTask(request, hooks = {}) {
        taskRuntimeCalls.appServer += 1;
        const taskId = request.taskId ?? "task-feishu-mixed-journey";
        const requestId = request.requestId;
        const approvalActionId = "approval-feishu-mixed-1";
        const inputActionId = "reply-feishu-mixed-2";
        const principalId = identityService.ensureIdentity({
          channel: request.sourceChannel,
          channelUserId: request.user.userId,
        }).principalId;

        actionBridge.register({
          taskId,
          requestId,
          actionId: approvalActionId,
          actionType: "approval",
          prompt: "Allow first step?",
          choices: ["approve", "deny"],
          scope: {
            sourceChannel: "feishu",
            principalId,
            userId: request.user.userId,
            ...(request.channelContext.channelSessionKey
              ? { sessionId: request.channelContext.channelSessionKey }
              : {}),
          },
        });

        await hooks.onEvent?.({
          eventId: "event-feishu-mixed-approval",
          taskId,
          requestId,
          type: "task.action_required",
          status: "waiting",
          message: `Allow first step?\n使用 /approve ${approvalActionId} 或 /deny ${approvalActionId}`,
          payload: {
            actionId: approvalActionId,
            actionType: "approval",
            prompt: "Allow first step?",
            choices: ["approve", "deny"],
          },
          timestamp: new Date().toISOString(),
        });
        emittedEventSummaries.push(`task.action_required:${approvalActionId}`);

        const approvalSubmission = await actionBridge.waitForSubmission(taskId, requestId, approvalActionId);
        assert.ok(approvalSubmission);
        assert.equal(approvalSubmission.decision, "approve");

        await hooks.onEvent?.({
          eventId: "event-feishu-mixed-running",
          taskId,
          requestId,
          type: "task.progress",
          status: "running",
          message: "第一轮审批已提交，继续等待补充输入。",
          payload: {
            itemType: "agent_message",
            threadEventType: "item.completed",
            itemId: "item-feishu-mixed-running",
          },
          timestamp: new Date().toISOString(),
        });
        emittedEventSummaries.push("task.progress:running");

        actionBridge.register({
          taskId,
          requestId,
          actionId: inputActionId,
          actionType: "user-input",
          prompt: "Please provide final detail",
          scope: {
            sourceChannel: "feishu",
            principalId,
            userId: request.user.userId,
            ...(request.channelContext.channelSessionKey
              ? { sessionId: request.channelContext.channelSessionKey }
              : {}),
          },
        });

        await hooks.onEvent?.({
          eventId: "event-feishu-mixed-input",
          taskId,
          requestId,
          type: "task.action_required",
          status: "waiting",
          message: "Please provide final detail",
          payload: {
            actionId: inputActionId,
            actionType: "user-input",
            prompt: "Please provide final detail",
          },
          timestamp: new Date().toISOString(),
        });
        emittedEventSummaries.push(`task.action_required:${inputActionId}`);

        const inputSubmission = await actionBridge.waitForSubmission(taskId, requestId, inputActionId);
        assert.ok(inputSubmission);
        assert.equal(inputSubmission.inputText, "补充最终上下文");

        const result: TaskResult = {
          taskId,
          requestId,
          status: "completed",
          summary: `最终结果：${request.goal}`,
          output: `最终结果：${request.goal}`,
          structuredOutput: {
            session: {
              engine: "app-server",
            },
          },
          completedAt: new Date().toISOString(),
        };

        return hooks.finalizeResult ? await hooks.finalizeResult(request, result) : result;
      },
      getRuntimeStore() {
        return runtimeStore;
      },
      getIdentityLinkService() {
        return identityService;
      },
      getPrincipalSkillsService() {
        return principalSkillsService;
      },
    }),
  } as FeishuHarnessConfig);

  try {
    let taskSettled = false;
    const taskPromise = harness.handleIncomingText("请执行一次飞书混合恢复闭环测试").then(() => {
      taskSettled = true;
    });

    await waitFor(() => harness.peekMessages().some((message) => message.includes("/approve approval-feishu-mixed-1")));
    await harness.handleCommand("approve", ["approval-feishu-mixed-1"]);

    await waitFor(() => {
      const messages = harness.peekMessages().join("\n");
      return /Please provide final detail/.test(messages) && /直接回复.*继续/.test(messages);
    });

    assert.equal(taskSettled, false);
    await harness.handleMessageEventText("补充最终上下文");
    await taskPromise;

    const messages = harness.takeMessages().join("\n");
    const submissions = harness.getResolvedActionSubmissions();
    assert.match(messages, /Allow first step\?/);
    assert.match(messages, /Please provide final detail/);
    assert.match(messages, /直接回复.*继续/);
    assert.match(messages, /最终结果：请执行一次飞书混合恢复闭环测试/);
    assert.deepEqual(emittedEventSummaries, [
      "task.action_required:approval-feishu-mixed-1",
      "task.progress:running",
      "task.action_required:reply-feishu-mixed-2",
    ]);
    assert.equal(submissions.length, 2);
    const taskId = submissions[0]?.taskId;
    assert.ok(taskId);
    assert.equal(submissions[0]?.actionId, "approval-feishu-mixed-1");
    assert.equal(submissions[0]?.decision, "approve");
    assert.ok(submissions[0]?.requestId);
    assert.equal(submissions[1]?.taskId, taskId);
    assert.equal(submissions[1]?.actionId, "reply-feishu-mixed-2");
    assert.equal(submissions[1]?.inputText, "补充最终上下文");
    assert.equal(submissions[1]?.requestId, submissions[0]?.requestId);
  } finally {
    harness.cleanup();
  }
});

test("飞书连续 waiting action 恢复会在第二轮命令提交后才最终收口", async () => {
  const emittedEventSummaries: string[] = [];
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      actionBridge,
      taskRuntimeCalls,
    }) => ({
      async runTask(request, hooks = {}) {
        taskRuntimeCalls.appServer += 1;
        const taskId = request.taskId ?? "task-feishu-journey-2";
        const requestId = request.requestId;
        const firstActionId = "approval-feishu-journey-2a";
        const secondActionId = "approval-feishu-journey-2b";
        const principalId = identityService.ensureIdentity({
          channel: request.sourceChannel,
          channelUserId: request.user.userId,
        }).principalId;

        actionBridge.register({
          taskId,
          requestId,
          actionId: firstActionId,
          actionType: "approval",
          prompt: "Allow first feishu recovery step?",
          choices: ["approve", "deny"],
          scope: {
            sourceChannel: "feishu",
            principalId,
            userId: request.user.userId,
            ...(request.channelContext.channelSessionKey
              ? {
                sessionId: request.channelContext.channelSessionKey,
              }
              : {}),
          },
        });

        await hooks.onEvent?.({
          eventId: "event-feishu-journey-2-action-required-a",
          taskId,
          requestId,
          type: "task.action_required",
          status: "waiting",
          message: `Allow first feishu recovery step?\n使用 /approve ${firstActionId} 或 /deny ${firstActionId}`,
          payload: {
            actionId: firstActionId,
            actionType: "approval",
            prompt: "Allow first feishu recovery step?",
            choices: ["approve", "deny"],
          },
          timestamp: new Date().toISOString(),
        });
        emittedEventSummaries.push(`task.action_required:${firstActionId}`);

        const firstSubmissionPromise = actionBridge.waitForSubmission(taskId, requestId, firstActionId);
        assert.ok(firstSubmissionPromise);
        const firstSubmission = await firstSubmissionPromise;
        assert.ok(firstSubmission);
        assert.equal(firstSubmission.decision, "approve");

        emittedEventSummaries.push("task.progress:running");
        await hooks.onEvent?.({
          eventId: "event-feishu-journey-2-running",
          taskId,
          requestId,
          type: "task.progress",
          status: "running",
          message: "第一轮审批已提交，任务继续执行中。",
          payload: {
            itemType: "agent_message",
            threadEventType: "item.completed",
            itemId: "item-feishu-journey-2-running",
          },
          timestamp: new Date().toISOString(),
        });

        actionBridge.register({
          taskId,
          requestId,
          actionId: secondActionId,
          actionType: "approval",
          prompt: "Allow second feishu recovery step?",
          choices: ["approve", "deny"],
          scope: {
            sourceChannel: "feishu",
            principalId,
            userId: request.user.userId,
            ...(request.channelContext.channelSessionKey
              ? {
                sessionId: request.channelContext.channelSessionKey,
              }
              : {}),
          },
        });

        await hooks.onEvent?.({
          eventId: "event-feishu-journey-2-action-required-b",
          taskId,
          requestId,
          type: "task.action_required",
          status: "waiting",
          message: `Allow second feishu recovery step?\n使用 /approve ${secondActionId} 或 /deny ${secondActionId}`,
          payload: {
            actionId: secondActionId,
            actionType: "approval",
            prompt: "Allow second feishu recovery step?",
            choices: ["approve", "deny"],
          },
          timestamp: new Date().toISOString(),
        });
        emittedEventSummaries.push(`task.action_required:${secondActionId}`);

        const secondSubmissionPromise = actionBridge.waitForSubmission(taskId, requestId, secondActionId);
        assert.ok(secondSubmissionPromise);
        const secondSubmission = await secondSubmissionPromise;
        assert.ok(secondSubmission);
        assert.equal(secondSubmission.decision, "approve");

        const result: TaskResult = {
          taskId,
          requestId,
          status: "completed",
          summary: `最终结果：${request.goal}`,
          output: `最终结果：${request.goal}`,
          structuredOutput: {
            session: {
              engine: "app-server",
            },
          },
          completedAt: new Date().toISOString(),
        };

        return hooks.finalizeResult ? await hooks.finalizeResult(request, result) : result;
      },
      getRuntimeStore() {
        return runtimeStore;
      },
      getIdentityLinkService() {
        return identityService;
      },
      getPrincipalSkillsService() {
        return principalSkillsService;
      },
    }),
  } as FeishuHarnessConfig);

  try {
    let taskSettled = false;
    const taskPromise = harness.handleIncomingText("请执行一次飞书连续恢复闭环测试").then(() => {
      taskSettled = true;
    });

    await waitFor(() => {
      const messages = harness.peekMessages();
      return messages.some((message) => message.includes("/approve approval-feishu-journey-2a"));
    });

    const sessionId = harness.getCurrentSessionId();
    assert.ok(sessionId);

    await harness.handleCommand("approve", ["approval-feishu-journey-2a"]);

    await waitFor(() => {
      const messages = harness.peekMessages();
      return messages.some((message) => message.includes("/approve approval-feishu-journey-2b"));
    });

    const messagesAfterFirstApproval = harness.peekMessages().join("\n");
    assert.equal(taskSettled, false);
    assert.match(messagesAfterFirstApproval, /Allow first feishu recovery step\?/);
    assert.match(messagesAfterFirstApproval, /Allow second feishu recovery step\?/);
    assert.match(messagesAfterFirstApproval, /\/approve approval-feishu-journey-2b/);
    assert.doesNotMatch(messagesAfterFirstApproval, /最终结果：请执行一次飞书连续恢复闭环测试/);
    assert.deepEqual(emittedEventSummaries, [
      "task.action_required:approval-feishu-journey-2a",
      "task.progress:running",
      "task.action_required:approval-feishu-journey-2b",
    ]);

    await harness.handleCommand("approve", ["approval-feishu-journey-2b"]);
    await taskPromise;

    const messages = harness.takeMessages().join("\n");
    assert.equal(harness.getCurrentSessionId(), sessionId);
    assert.match(messages, /\/approve approval-feishu-journey-2a/);
    assert.match(messages, /\/approve approval-feishu-journey-2b/);
    assert.match(messages, /最终结果：请执行一次飞书连续恢复闭环测试/);
    assert.deepEqual(
      harness.getResolvedActionSubmissions().map((entry) => entry.actionId),
      [
        "approval-feishu-journey-2a",
        "approval-feishu-journey-2b",
      ],
    );
  } finally {
    harness.cleanup();
  }
});

type FeishuHarnessSkillItem = {
  skillName: string;
  description: string;
  installStatus: string;
  sourceType: string;
  sourceRefJson: string;
  managedPath: string;
  summary: { totalAccounts: number; syncedCount: number; conflictCount: number; failedCount: number };
  materializations: Array<{ targetId: string; state: string; lastError?: string }>;
  lastError?: string;
};

type FeishuHarnessCuratedItem = { name: string; installed: boolean };
type FeishuHarnessPluginSummary = {
  id: string;
  name: string;
  owned?: boolean;
  runtimeInstalled?: boolean;
  runtimeState?: string;
  sourceType?: string;
  sourceScope?: string;
  sourcePath?: string | null;
  sourceRef?: {
    sourceType?: string;
    sourcePath?: string | null;
    workspaceFingerprint?: string;
    marketplaceName?: string;
    marketplacePath?: string;
  } | null;
  installed: boolean;
  enabled: boolean;
  installPolicy: string;
  authPolicy: string;
  lastError?: string | null;
  repairAction?: string;
  repairHint?: string | null;
  interface?: {
    displayName?: string;
    shortDescription?: string;
    longDescription?: string | null;
    developerName?: string | null;
    category?: string | null;
    capabilities?: string[];
  } | null;
};
type FeishuHarnessPluginMarketplace = {
  name: string;
  path: string;
  interface?: {
    displayName?: string;
  } | null;
  plugins: FeishuHarnessPluginSummary[];
};
type FeishuHarnessPluginDetail = {
  marketplaceName: string;
  marketplacePath: string;
  summary: FeishuHarnessPluginSummary;
  description?: string | null;
  sourceType?: string;
  sourceScope?: string;
  sourcePath?: string | null;
  sourceRef?: FeishuHarnessPluginSummary["sourceRef"];
  currentMaterialization?: {
    targetKind?: string;
    targetId?: string;
    workspaceFingerprint?: string;
    state?: string;
    lastSyncedAt?: string;
    lastError?: string | null;
  } | null;
  lastError?: string | null;
  repairAction?: string;
  repairHint?: string | null;
  skills?: Array<{
    name: string;
    description: string;
    shortDescription?: string | null;
    path?: string | null;
    enabled: boolean;
  }>;
  apps?: Array<{
    id: string;
    name: string;
    description?: string | null;
    installUrl?: string | null;
    needsAuth: boolean;
  }>;
  mcpServers?: string[];
};
type FeishuHarnessPluginRuntimeOptions = {
  cwd?: string;
  forceRemoteSync?: boolean;
  activeAuthAccount?: {
    accountId?: string;
    codexHome?: string;
  } | null;
};
type FeishuHarnessPluginService = {
  listPrincipalPlugins: (principalId: string, options?: FeishuHarnessPluginRuntimeOptions) => Promise<{
    target: { targetKind: "auth-account"; targetId: string };
    principalPlugins: Array<{
      pluginId: string;
      pluginName: string;
      marketplaceName: string;
      marketplacePath: string;
      sourceType: string;
      sourceScope?: string;
      sourcePath?: string | null;
      sourceRef?: FeishuHarnessPluginSummary["sourceRef"];
      runtimeAvailable: boolean;
      currentMaterialization?: FeishuHarnessPluginDetail["currentMaterialization"];
      lastError?: string | null;
      repairAction?: string;
      repairHint?: string | null;
      createdAt: string;
      updatedAt: string;
      summary: FeishuHarnessPluginSummary;
    }>;
    marketplaces: FeishuHarnessPluginMarketplace[];
    marketplaceLoadErrors: Array<{ marketplacePath: string; message: string }>;
    remoteSyncError: string | null;
    featuredPluginIds: string[];
  }>;
  readPrincipalPlugin: (
    principalId: string,
    input: { marketplacePath: string; pluginName: string },
    options?: FeishuHarnessPluginRuntimeOptions,
  ) => Promise<{
    target: { targetKind: "auth-account"; targetId: string };
    plugin: FeishuHarnessPluginDetail;
  }>;
  installPrincipalPlugin: (
    principalId: string,
    input: {
      marketplacePath: string;
      pluginName: string;
      forceRemoteSync?: boolean;
    },
    options?: FeishuHarnessPluginRuntimeOptions,
  ) => Promise<{
    target: { targetKind: "auth-account"; targetId: string };
    pluginName: string;
    marketplacePath: string;
    authPolicy: string;
    appsNeedingAuth: Array<{
      id: string;
      name: string;
      description?: string | null;
      installUrl?: string | null;
      needsAuth: boolean;
    }>;
    plugin: FeishuHarnessPluginDetail | null;
  }>;
  uninstallPrincipalPlugin: (
    principalId: string,
    pluginId: string,
    options?: FeishuHarnessPluginRuntimeOptions,
  ) => Promise<{
    target: { targetKind: "auth-account"; targetId: string };
    pluginId: string;
    removedDefinition: boolean;
    removedMaterializations: number;
    runtimeAction: "uninstalled" | "skipped";
  }>;
  syncPrincipalPlugins: (
    principalId: string,
    options?: FeishuHarnessPluginRuntimeOptions,
  ) => Promise<{
    target: { targetKind: "auth-account"; targetId: string };
    syncedAt: string;
    total: number;
    installedCount: number;
    alreadyInstalledCount: number;
    authRequiredCount: number;
    missingCount: number;
    failedCount: number;
    plugins: Array<{
      pluginId: string;
      pluginName: string;
      marketplaceName: string;
      marketplacePath: string;
      previousState: string;
      nextState: string;
      action: "installed" | "already_installed" | "auth_required" | "missing" | "failed";
      lastError: string | null;
    }>;
  }>;
};

type FeishuHarnessConfig = {
  runtimeCatalog?: CodexRuntimeCatalog;
  runtimeEngine?: "sdk" | "app-server";
  omitRuntimeRegistry?: boolean;
  appServerEventsBuilder?: (request: TaskRequest) => TaskEvent[];
  resolveFailureActionIds?: string[];
  appServerRuntimeFactory?: (input: {
    runtimeStore: SqliteCodexSessionRegistry;
    identityService: IdentityLinkService;
    principalMcpService: PrincipalMcpService;
    principalSkillsService: {
      listPrincipalSkills: () => FeishuHarnessSkillItem[];
      listCuratedSkills: () => Promise<FeishuHarnessCuratedItem[]>;
      installFromLocalPath: (input: {
        principalId: string;
        absolutePath: string;
        replace?: boolean;
      }) => Promise<unknown>;
      installFromGithub: (input: {
        principalId: string;
        repo?: string;
        path?: string;
        url?: string;
        ref?: string;
        replace?: boolean;
      }) => Promise<unknown>;
      installFromCurated: (input: {
        principalId: string;
        skillName: string;
        replace?: boolean;
      }) => Promise<unknown>;
      removeSkill: (principalId: string, skillName: string) => unknown;
      syncSkill: (principalId: string, skillName: string, options?: { force?: boolean }) => Promise<unknown>;
    };
    pluginService: FeishuHarnessPluginService;
    taskRuntimeCalls: { sdk: number; appServer: number };
    actionBridge: AppServerActionBridge;
  }) => TaskRuntimeFacade;
  listItems?: Array<FeishuHarnessSkillItem>;
  curatedItems?: Array<FeishuHarnessCuratedItem>;
  pluginService?: FeishuHarnessPluginService;
  updateService?: Pick<ThemisUpdateService, "readOverview" | "startApply" | "startRollback">;
};

type FeishuHarnessSkillCall =
  | { method: "installFromLocalPath"; principalId: string; absolutePath: string; replace?: boolean }
  | {
    method: "installFromGithub";
    principalId: string;
    repo?: string;
    path?: string;
    url?: string;
    ref?: string;
    replace?: boolean;
  }
  | { method: "installFromCurated"; principalId: string; skillName: string; replace?: boolean }
  | { method: "removeSkill"; principalId: string; skillName: string }
  | { method: "syncSkill"; principalId: string; skillName: string; force?: boolean };

type FeishuHarnessAuthCall =
  | { method: "startChatgptDeviceLogin"; accountId: string }
  | { method: "logout"; accountId: string }
  | { method: "cancelPendingLogin"; accountId: string };
type FeishuHarnessPluginCall =
  | { method: "readPrincipalPlugin"; principalId: string; marketplacePath: string; pluginName: string; cwd?: string }
  | {
    method: "installPrincipalPlugin";
    principalId: string;
    marketplacePath: string;
    pluginName: string;
    forceRemoteSync?: boolean;
    cwd?: string;
  }
  | {
    method: "uninstallPrincipalPlugin";
    principalId: string;
    pluginId: string;
    forceRemoteSync?: boolean;
    cwd?: string;
  }
  | {
    method: "syncPrincipalPlugins";
    principalId: string;
    forceRemoteSync?: boolean;
    cwd?: string;
  };

type FeishuTaskRuntimeDouble = TaskRuntimeFacade & {
  getPrincipalMcpService: () => PrincipalMcpService;
  getPrincipalPluginsService: () => FeishuHarnessPluginService;
};

function createTaskRuntimeDouble(input: {
  engine: "sdk" | "app-server";
  runtimeStore: SqliteCodexSessionRegistry;
  identityService: IdentityLinkService;
  principalMcpService?: PrincipalMcpService;
  pluginService?: FeishuHarnessPluginService;
  principalSkillsService: {
    listPrincipalSkills: () => FeishuHarnessSkillItem[];
    listCuratedSkills: () => Promise<FeishuHarnessCuratedItem[]>;
    installFromLocalPath: (input: {
      principalId: string;
      absolutePath: string;
      replace?: boolean;
    }) => Promise<unknown>;
    installFromGithub: (input: {
      principalId: string;
      repo?: string;
      path?: string;
      url?: string;
      ref?: string;
      replace?: boolean;
    }) => Promise<unknown>;
    installFromCurated: (input: {
      principalId: string;
      skillName: string;
      replace?: boolean;
    }) => Promise<unknown>;
    removeSkill: (principalId: string, skillName: string) => unknown;
    syncSkill: (principalId: string, skillName: string, options?: { force?: boolean }) => Promise<unknown>;
  };
  taskRuntimeCalls: { sdk: number; appServer: number };
  eventBuilder?: (request: TaskRequest) => TaskEvent[];
  onRequest?: (request: TaskRequest) => void;
}): FeishuTaskRuntimeDouble {
  const principalMcpService = input.principalMcpService ?? new PrincipalMcpService({
    registry: input.runtimeStore,
  });
  const pluginService = input.pluginService ?? {
    listPrincipalPlugins: async () => ({
      target: {
        targetKind: "auth-account" as const,
        targetId: "default",
      },
      principalPlugins: [],
      marketplaces: [],
      marketplaceLoadErrors: [],
      remoteSyncError: null,
      featuredPluginIds: [],
    }),
    readPrincipalPlugin: async () => {
      throw new Error("plugin service not configured");
    },
    installPrincipalPlugin: async () => {
      throw new Error("plugin service not configured");
    },
    uninstallPrincipalPlugin: async () => {
      throw new Error("plugin service not configured");
    },
    syncPrincipalPlugins: async () => {
      throw new Error("plugin service not configured");
    },
  };

  return {
    async runTask(request: TaskRequest, hooks: TaskRuntimeRunHooks = {}): Promise<TaskResult> {
      input.onRequest?.(request);

      if (input.engine === "sdk") {
        input.taskRuntimeCalls.sdk += 1;
      } else {
        input.taskRuntimeCalls.appServer += 1;
      }

      const events = input.eventBuilder?.(request) ?? [{
        eventId: `event-feishu-${input.engine}-1`,
        taskId: request.taskId ?? `task-feishu-${input.engine}`,
        requestId: request.requestId,
        type: "task.progress",
        status: "running",
        message: request.goal,
        payload: {
          itemType: "agent_message",
          threadEventType: "item.completed",
          itemId: `item-feishu-${input.engine}-1`,
        },
        timestamp: new Date().toISOString(),
      }];

      for (const event of events) {
        await hooks.onEvent?.(event);
      }

      const baseResult: TaskResult = {
        taskId: request.taskId ?? `task-feishu-${input.engine}`,
        requestId: request.requestId,
        status: "completed",
        summary: request.goal,
        output: request.goal,
        ...(input.engine === "app-server"
          ? {
            structuredOutput: {
              session: {
                engine: "app-server",
              },
            },
          }
          : {}),
        completedAt: new Date().toISOString(),
      };
      return hooks.finalizeResult ? await hooks.finalizeResult(request, baseResult) : baseResult;
    },
    getRuntimeStore: () => input.runtimeStore,
    getIdentityLinkService: () => input.identityService,
    getPrincipalMcpService: () => principalMcpService,
    getPrincipalPluginsService: () => pluginService,
    getPrincipalSkillsService: () => input.principalSkillsService,
  };
}

function createAppServerSessionThreadRuntime(
  input: Parameters<NonNullable<FeishuHarnessConfig["appServerRuntimeFactory"]>>[0] & {
    sessionIdFallback: string;
    taskIdPrefix: string;
    threadIdForGoal: (goal: string) => string;
  },
): FeishuTaskRuntimeDouble {
  return {
    ...createTaskRuntimeDouble({
      engine: "app-server",
      runtimeStore: input.runtimeStore,
      identityService: input.identityService,
      principalMcpService: input.principalMcpService,
      pluginService: input.pluginService,
      principalSkillsService: input.principalSkillsService,
      taskRuntimeCalls: input.taskRuntimeCalls,
    }),
    async runTask(request: TaskRequest, hooks: TaskRuntimeRunHooks = {}): Promise<TaskResult> {
      input.taskRuntimeCalls.appServer += 1;
      const sessionId = request.channelContext.channelSessionKey ?? input.sessionIdFallback;
      const threadId = input.threadIdForGoal(request.goal);
      const storedRequest = {
        ...request,
        channelContext: {
          ...request.channelContext,
          sessionId,
        },
      };

      input.runtimeStore.upsertTurnFromRequest(storedRequest, request.taskId ?? `${input.taskIdPrefix}-${threadId}`);
      input.runtimeStore.saveSession({
        sessionId,
        threadId,
        createdAt: request.createdAt,
        updatedAt: request.createdAt,
      });

      const result: TaskResult = {
        taskId: request.taskId ?? `${input.taskIdPrefix}-${threadId}`,
        requestId: request.requestId,
        status: "completed",
        summary: request.goal,
        output: request.goal,
        structuredOutput: {
          session: {
            engine: "app-server",
            threadId,
          },
        },
        completedAt: new Date().toISOString(),
      };

      return hooks.finalizeResult ? await hooks.finalizeResult(request, result) : result;
    },
  };
}

function createHarness(
  runtimeCatalogOrSkillsOverrides?: CodexRuntimeCatalog | FeishuHarnessConfig | {
    listItems?: Array<FeishuHarnessSkillItem>;
    curatedItems?: Array<FeishuHarnessCuratedItem>;
  },
  skillsOverrides?: {
    listItems?: Array<FeishuHarnessSkillItem>;
    curatedItems?: Array<FeishuHarnessCuratedItem>;
  },
) {
  const harnessConfig =
    runtimeCatalogOrSkillsOverrides
    && typeof runtimeCatalogOrSkillsOverrides === "object"
    && !("models" in runtimeCatalogOrSkillsOverrides)
    && (
      "runtimeEngine" in runtimeCatalogOrSkillsOverrides
      || "runtimeCatalog" in runtimeCatalogOrSkillsOverrides
      || "omitRuntimeRegistry" in runtimeCatalogOrSkillsOverrides
      || "appServerEventsBuilder" in runtimeCatalogOrSkillsOverrides
      || "appServerRuntimeFactory" in runtimeCatalogOrSkillsOverrides
      || "resolveFailureActionIds" in runtimeCatalogOrSkillsOverrides
      || "pluginService" in runtimeCatalogOrSkillsOverrides
      || "updateService" in runtimeCatalogOrSkillsOverrides
    )
      ? runtimeCatalogOrSkillsOverrides as FeishuHarnessConfig
      : null;
  const runtimeCatalog = harnessConfig?.runtimeCatalog
    ?? (
      runtimeCatalogOrSkillsOverrides && "models" in runtimeCatalogOrSkillsOverrides
        ? runtimeCatalogOrSkillsOverrides
        : createRuntimeCatalog()
    );
  const normalizedSkillsOverrides = harnessConfig
    ? {
      listItems: harnessConfig.listItems,
      curatedItems: harnessConfig.curatedItems,
    }
    : (
      runtimeCatalogOrSkillsOverrides && "models" in runtimeCatalogOrSkillsOverrides
        ? skillsOverrides
        : runtimeCatalogOrSkillsOverrides
    );
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-feishu-service-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });
  const identityService = new IdentityLinkService(runtimeStore);
  const principalMcpService = new PrincipalMcpService({ registry: runtimeStore });
  const sessionStore = new FeishuSessionStore({
    filePath: join(workingDirectory, "infra/local/feishu-sessions.json"),
  });
  const diagnosticsStateStore = new FeishuDiagnosticsStateStore({
    filePath: join(workingDirectory, "infra/local/feishu-diagnostics.json"),
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
  const authCalls: FeishuHarnessAuthCall[] = [];
  const authSnapshots = new Map<string, {
    authenticated: boolean;
    authMethod: "chatgpt" | null;
    pendingLogin: {
      provider: "chatgpt";
      mode: "device";
      verificationUri: string;
      userCode: string;
      startedAt: string;
      expiresAt: string | null;
    } | null;
    lastError: string | null;
    accountEmail: string | null;
    planType: string | null;
  }>();
  authSnapshots.set("default", {
    authenticated: false,
    authMethod: null,
    pendingLogin: null,
    lastError: null,
    accountEmail: null,
    planType: null,
  });
  for (const account of accounts) {
    authSnapshots.set(account.accountId, {
      authenticated: true,
      authMethod: "chatgpt",
      pendingLogin: null,
      lastError: null,
      accountEmail: account.accountEmail,
      planType: "plus",
    });
  }

  function ensureAuthSnapshot(accountId: string) {
    const existing = authSnapshots.get(accountId);

    if (existing) {
      return existing;
    }

    const account = accounts.find((entry) => entry.accountId === accountId) ?? null;
    const created = {
      authenticated: false,
      authMethod: null as "chatgpt" | null,
      pendingLogin: null,
      lastError: null,
      accountEmail: account?.accountEmail ?? null,
      planType: account ? "plus" : null,
    };
    authSnapshots.set(accountId, created);
    return created;
  }

  function buildAuthSnapshot(accountId: string) {
    const auth = ensureAuthSnapshot(accountId);
    const account = accounts.find((entry) => entry.accountId === accountId) ?? null;
    return {
      accountId,
      accountLabel: account?.label ?? (accountId === "default" ? "默认账号" : accountId),
      authenticated: auth.authenticated,
      authMethod: auth.authMethod,
      requiresOpenaiAuth: true,
      pendingLogin: auth.pendingLogin,
      lastError: auth.lastError,
      providerProfile: null,
      account: auth.accountEmail
        ? {
          email: auth.accountEmail,
          planType: auth.planType ?? "plus",
        }
        : null,
      rateLimits: null,
    };
  }

  function resolveAuthCommandAccountId(accountId?: string) {
    const normalized = accountId?.trim();
    return normalized ? normalized : accounts[0]?.accountId ?? "default";
  }

  function createPendingDeviceLogin(accountId: string) {
    return {
      provider: "chatgpt" as const,
      mode: "device" as const,
      verificationUri: `https://auth.openai.com/codex/device/${accountId}`,
      userCode: accountId === "default" ? "DEFA-0001" : accountId === "acc-2" ? "BETA-0002" : "ALPH-0001",
      startedAt: "2026-04-09T07:45:00.000Z",
      expiresAt: "2026-04-09T07:55:00.000Z",
    };
  }
  const skillsState = {
    listItems: normalizedSkillsOverrides?.listItems ?? [],
    curatedItems: normalizedSkillsOverrides?.curatedItems ?? [],
    writeCalls: [] as FeishuHarnessSkillCall[],
  };
  const pluginState = {
    marketplaces: [{
      name: "openai-curated",
      path: "/tmp/openai-curated/marketplace.json",
      interface: {
        displayName: "OpenAI Curated",
      },
      plugins: [{
        id: "github@openai-curated",
        name: "github",
        sourceType: "local",
        sourcePath: "/tmp/plugins/github",
        installed: false,
        enabled: false,
        installPolicy: "AVAILABLE",
        authPolicy: "ON_INSTALL",
        interface: {
          displayName: "GitHub",
          shortDescription: "Review pull requests",
          longDescription: "GitHub workflows",
          developerName: "OpenAI",
          category: "Coding",
          capabilities: ["Interactive", "Write"],
        },
      }],
    }] as FeishuHarnessPluginMarketplace[],
    details: new Map<string, FeishuHarnessPluginDetail>(),
    writeCalls: [] as FeishuHarnessPluginCall[],
  };
  function currentPrincipalId(): string {
    return ensurePrincipalId();
  }

  function buildManagedPath(skillName: string): string {
    return join(workingDirectory, "infra/local/principals", currentPrincipalId(), "skills", skillName);
  }

  function buildSkillSummary(totalAccounts = accounts.length) {
    return {
      totalAccounts,
      syncedCount: totalAccounts,
      conflictCount: 0,
      failedCount: 0,
    };
  }

  function buildSkillMaterializations(totalAccounts = accounts.length) {
    return accounts.slice(0, totalAccounts).map((account) => ({
      targetId: account.accountId,
      state: "synced",
    }));
  }

  function buildSkillItem(input: {
    skillName: string;
    description?: string;
    sourceType: string;
    sourceRefJson: string;
    installStatus?: string;
  }): FeishuHarnessSkillItem {
    return {
      skillName: input.skillName,
      description: input.description ?? `${input.skillName} description`,
      installStatus: input.installStatus ?? "ready",
      sourceType: input.sourceType,
      sourceRefJson: input.sourceRefJson,
      managedPath: buildManagedPath(input.skillName),
      summary: buildSkillSummary(),
      materializations: buildSkillMaterializations(),
    };
  }

  function upsertSkillItem(item: FeishuHarnessSkillItem): void {
    const index = skillsState.listItems.findIndex((existing) => existing.skillName === item.skillName);
    if (index >= 0) {
      skillsState.listItems[index] = item;
      return;
    }
    skillsState.listItems.push(item);
  }

  function syncCuratedInstalledFlag(skillName: string, installed: boolean): void {
    const existing = skillsState.curatedItems.find((item) => item.name === skillName);
    if (existing) {
      existing.installed = installed;
      return;
    }
    skillsState.curatedItems.push({ name: skillName, installed });
  }

  function removeSkillItem(skillName: string): FeishuHarnessSkillItem {
    const index = skillsState.listItems.findIndex((item) => item.skillName === skillName);
    if (index === -1) {
      throw new Error(`技能 ${skillName} 不存在。`);
    }
    const [removed] = skillsState.listItems.splice(index, 1);
    if (!removed) {
      throw new Error(`技能 ${skillName} 删除失败。`);
    }
    syncCuratedInstalledFlag(skillName, false);
    return removed;
  }

  function buildPluginTarget() {
    return {
      targetKind: "auth-account" as const,
      targetId: "acc-1",
    };
  }

  function createPluginDetailKey(marketplacePath: string, pluginName: string): string {
    return `${marketplacePath}::${pluginName}`;
  }

  function findPluginByMarketplacePath(marketplacePath: string, pluginName: string): {
    marketplace: FeishuHarnessPluginMarketplace;
    plugin: FeishuHarnessPluginSummary;
  } {
    const marketplace = pluginState.marketplaces.find((item) => item.path === marketplacePath);

    if (!marketplace) {
      throw new Error(`plugin marketplace 不存在：${marketplacePath}`);
    }

    const plugin = marketplace.plugins.find((item) => item.name === pluginName);

    if (!plugin) {
      throw new Error(`plugin 不存在：${pluginName}`);
    }

    return { marketplace, plugin };
  }

  function findPluginById(pluginId: string): {
    marketplace: FeishuHarnessPluginMarketplace;
    plugin: FeishuHarnessPluginSummary;
  } {
    for (const marketplace of pluginState.marketplaces) {
      const plugin = marketplace.plugins.find((item) => item.id === pluginId);

      if (plugin) {
        return { marketplace, plugin };
      }
    }

    throw new Error(`plugin 不存在：${pluginId}`);
  }

  function buildPluginDetail(marketplace: FeishuHarnessPluginMarketplace, plugin: FeishuHarnessPluginSummary): FeishuHarnessPluginDetail {
    const detailKey = createPluginDetailKey(marketplace.path, plugin.name);
    const cached = pluginState.details.get(detailKey);

    if (cached) {
      cached.summary = plugin;
      return cached;
    }

    const created: FeishuHarnessPluginDetail = {
      marketplaceName: marketplace.name,
      marketplacePath: marketplace.path,
      summary: plugin,
      description: plugin.interface?.longDescription ?? plugin.interface?.shortDescription ?? "暂无说明",
      skills: [{
        name: `${plugin.name}-review`,
        description: `review ${plugin.name}`,
        shortDescription: "review",
        path: `/tmp/plugins/${plugin.name}/skills/review`,
        enabled: true,
      }],
      apps: [{
        id: `${plugin.name}-app`,
        name: plugin.interface?.displayName ?? plugin.name,
        description: `${plugin.name} app`,
        installUrl: `https://example.com/apps/${plugin.name}`,
        needsAuth: plugin.authPolicy === "ON_INSTALL",
      }],
      mcpServers: [plugin.name],
    };
    pluginState.details.set(detailKey, created);
    return created;
  }

  function buildPluginSummaryWithPrincipalState(
    plugin: FeishuHarnessPluginSummary,
    overrides: Partial<FeishuHarnessPluginSummary> = {},
  ): FeishuHarnessPluginSummary {
    return {
      ...plugin,
      owned: plugin.installed,
      runtimeInstalled: plugin.installed,
      runtimeState: plugin.installed ? "installed" : "available",
      ...overrides,
    };
  }

  function buildPrincipalPluginItem(
    marketplace: FeishuHarnessPluginMarketplace,
    plugin: FeishuHarnessPluginSummary,
  ) {
    return {
      pluginId: plugin.id,
      pluginName: plugin.name,
      marketplaceName: marketplace.name,
      marketplacePath: marketplace.path,
      sourceType: plugin.sourceType ?? "unknown",
      ...(plugin.sourcePath ? { sourcePath: plugin.sourcePath } : {}),
      runtimeAvailable: true,
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
      summary: buildPluginSummaryWithPrincipalState(plugin, {
        owned: true,
        runtimeInstalled: true,
        runtimeState: "installed",
      }),
    };
  }

  const pluginService: FeishuHarnessPluginService = harnessConfig?.pluginService ?? {
    listPrincipalPlugins: async () => ({
      target: buildPluginTarget(),
      principalPlugins: pluginState.marketplaces.flatMap((marketplace) =>
        marketplace.plugins
          .filter((plugin) => plugin.installed)
          .map((plugin) => buildPrincipalPluginItem(marketplace, plugin))
      ),
      marketplaces: pluginState.marketplaces.map((marketplace) => ({
        ...marketplace,
        plugins: marketplace.plugins.map((plugin) => buildPluginSummaryWithPrincipalState(plugin)),
      })),
      marketplaceLoadErrors: [],
      remoteSyncError: null,
      featuredPluginIds: ["github@openai-curated"],
    }),
    readPrincipalPlugin: async (principalId, input, options) => {
      pluginState.writeCalls.push({
        method: "readPrincipalPlugin",
        principalId,
        marketplacePath: input.marketplacePath,
        pluginName: input.pluginName,
        ...(typeof options?.cwd === "string" ? { cwd: options.cwd } : {}),
      });
      const { marketplace, plugin } = findPluginByMarketplacePath(input.marketplacePath, input.pluginName);
      return {
        target: buildPluginTarget(),
        plugin: {
          ...buildPluginDetail(marketplace, plugin),
          summary: buildPluginSummaryWithPrincipalState(plugin),
        },
      };
    },
    installPrincipalPlugin: async (principalId, input, options) => {
      pluginState.writeCalls.push({
        method: "installPrincipalPlugin",
        principalId,
        marketplacePath: input.marketplacePath,
        pluginName: input.pluginName,
        ...(input.forceRemoteSync === true ? { forceRemoteSync: true } : {}),
        ...(typeof options?.cwd === "string" ? { cwd: options.cwd } : {}),
      });
      const { marketplace, plugin } = findPluginByMarketplacePath(input.marketplacePath, input.pluginName);
      plugin.installed = true;
      plugin.enabled = true;
      const detail = buildPluginDetail(marketplace, plugin);

      return {
        target: buildPluginTarget(),
        pluginName: input.pluginName,
        marketplacePath: input.marketplacePath,
        authPolicy: plugin.authPolicy,
        appsNeedingAuth: (detail.apps ?? []).filter((item) => item.needsAuth),
        plugin: {
          ...detail,
          summary: buildPluginSummaryWithPrincipalState(plugin, {
            owned: true,
            runtimeInstalled: true,
            runtimeState: "installed",
          }),
        },
      };
    },
    uninstallPrincipalPlugin: async (principalId, pluginId, options) => {
      pluginState.writeCalls.push({
        method: "uninstallPrincipalPlugin",
        principalId,
        pluginId,
        ...(options?.forceRemoteSync === true ? { forceRemoteSync: true } : {}),
        ...(typeof options?.cwd === "string" ? { cwd: options.cwd } : {}),
      });
      const { marketplace, plugin } = findPluginById(pluginId);
      plugin.installed = false;
      plugin.enabled = false;
      buildPluginDetail(marketplace, plugin);

      return {
        target: buildPluginTarget(),
        pluginId,
        removedDefinition: true,
        removedMaterializations: 1,
        runtimeAction: "uninstalled",
      };
    },
    syncPrincipalPlugins: async (principalId, options) => {
      pluginState.writeCalls.push({
        method: "syncPrincipalPlugins",
        principalId,
        ...(options?.forceRemoteSync === true ? { forceRemoteSync: true } : {}),
        ...(typeof options?.cwd === "string" ? { cwd: options.cwd } : {}),
      });
      const plugins = pluginState.marketplaces.flatMap((marketplace) => marketplace.plugins)
        .filter((plugin) => plugin.installed)
        .map((plugin) => {
          return {
            pluginId: plugin.id,
            pluginName: plugin.name,
            marketplaceName: "openai-curated",
            marketplacePath: "/tmp/openai-curated/marketplace.json",
            previousState: "installed",
            nextState: "installed",
            action: "already_installed" as const,
            lastError: null,
          };
        });

      return {
        target: buildPluginTarget(),
        syncedAt: "2026-04-11T00:00:00.000Z",
        total: plugins.length,
        installedCount: 0,
        alreadyInstalledCount: plugins.length,
        authRequiredCount: 0,
        missingCount: 0,
        failedCount: 0,
        plugins,
      };
    },
  };

  const principalSkillsService = {
    listPrincipalSkills: () => skillsState.listItems,
    listCuratedSkills: async () => skillsState.curatedItems,
    installFromLocalPath: async (input: { principalId: string; absolutePath: string; replace?: boolean }) => {
      skillsState.writeCalls.push({ method: "installFromLocalPath", ...input });
      const skillName = input.absolutePath.split("/").filter(Boolean).pop() ?? "local-skill";
      const item = buildSkillItem({
        skillName,
        description: `installed from local path ${input.absolutePath}`,
        sourceType: "local-path",
        sourceRefJson: JSON.stringify({ absolutePath: input.absolutePath }),
      });
      upsertSkillItem(item);
      syncCuratedInstalledFlag(skillName, true);
      return { skill: item, materializations: item.materializations, summary: item.summary };
    },
    installFromGithub: async (input: {
      principalId: string;
      repo?: string;
      path?: string;
      url?: string;
      ref?: string;
      replace?: boolean;
    }) => {
      skillsState.writeCalls.push({ method: "installFromGithub", ...input });
      const skillName = (input.path ?? input.url ?? "github-skill").split("/").filter(Boolean).pop() ?? "github-skill";
      const sourceRefJson = input.url
        ? JSON.stringify({ url: input.url, ...(input.ref ? { ref: input.ref } : {}) })
        : JSON.stringify({ repo: input.repo, path: input.path, ...(input.ref ? { ref: input.ref } : {}) });
      const sourceType = input.url ? "github-url" : "github-repo-path";
      const item = buildSkillItem({
        skillName,
        description: `installed from ${sourceType}`,
        sourceType,
        sourceRefJson,
      });
      upsertSkillItem(item);
      syncCuratedInstalledFlag(skillName, true);
      return { skill: item, materializations: item.materializations, summary: item.summary };
    },
    installFromCurated: async (input: { principalId: string; skillName: string; replace?: boolean }) => {
      skillsState.writeCalls.push({ method: "installFromCurated", ...input });
      const item = buildSkillItem({
        skillName: input.skillName,
        description: `installed curated skill ${input.skillName}`,
        sourceType: "curated",
        sourceRefJson: JSON.stringify({ repo: "openai/skills", path: `skills/.curated/${input.skillName}` }),
      });
      upsertSkillItem(item);
      syncCuratedInstalledFlag(input.skillName, true);
      return { skill: item, materializations: item.materializations, summary: item.summary };
    },
    removeSkill: (principalId: string, skillName: string) => {
      skillsState.writeCalls.push({ method: "removeSkill", principalId, skillName });
      const removed = removeSkillItem(skillName);
      return {
        skillName: removed.skillName,
        removedManagedPath: true,
        removedMaterializations: removed.materializations.length,
      };
    },
    syncSkill: async (principalId: string, skillName: string, options?: { force?: boolean }) => {
      skillsState.writeCalls.push({
        method: "syncSkill",
        principalId,
        skillName,
        ...(typeof options?.force === "boolean" ? { force: options.force } : {}),
      });
      const item = skillsState.listItems.find((entry) => entry.skillName === skillName);
      if (!item) {
        throw new Error(`技能 ${skillName} 不存在。`);
      }
      item.summary = buildSkillSummary();
      item.materializations = buildSkillMaterializations();
      item.installStatus = "ready";
      return { skill: item, materializations: item.materializations, summary: item.summary };
    },
  };
  const taskRuntimeCalls = {
    sdk: 0,
    appServer: 0,
  };
  const taskRequests: TaskRequest[] = [];
  const actionBridge = new AppServerActionBridge();
  const baseRuntime = createTaskRuntimeDouble({
    engine: "sdk",
    runtimeStore,
    identityService,
    principalMcpService,
    pluginService,
    principalSkillsService,
    taskRuntimeCalls,
    onRequest: (request) => taskRequests.push(request),
  });
  const runtime = {
    ...baseRuntime,
    getWorkingDirectory: () => workingDirectory,
    readRuntimeConfig: async (): Promise<CodexRuntimeCatalog> => runtimeCatalog,
    getPrincipalMcpService: () => principalMcpService,
    getPrincipalPluginsService: () => pluginService,
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
  const appServerRuntime = harnessConfig?.appServerRuntimeFactory
    ? harnessConfig.appServerRuntimeFactory({
      runtimeStore,
      identityService,
      principalMcpService,
      pluginService,
      principalSkillsService,
      taskRuntimeCalls,
      actionBridge,
    })
    : createTaskRuntimeDouble({
      engine: "app-server",
      runtimeStore,
      identityService,
      principalMcpService,
      pluginService,
      principalSkillsService,
      taskRuntimeCalls,
      onRequest: (request) => taskRequests.push(request),
      ...(harnessConfig?.appServerEventsBuilder ? { eventBuilder: harnessConfig.appServerEventsBuilder } : {}),
    });
  const loggerState = createLogger();
  const resolvedActionSubmissions: TaskPendingActionSubmitRequest[] = [];
  const renderedMessages: Array<{
    action: "create" | "update";
    msgType: string;
    content: string;
    messageId: string;
  }> = [];
  const forcedResolveFailureActionIds = new Set(harnessConfig?.resolveFailureActionIds ?? []);
  const originalResolveAction = actionBridge.resolve.bind(actionBridge);
  actionBridge.resolve = (payload) => {
    if (forcedResolveFailureActionIds.has(payload.actionId)) {
      return false;
    }

    const resolved = originalResolveAction(payload);

    if (resolved) {
      resolvedActionSubmissions.push(payload);
    }

    return resolved;
  };
  const service = new FeishuChannelService({
    runtime,
    ...(harnessConfig?.omitRuntimeRegistry
      ? {}
      : {
        runtimeRegistry: buildRuntimeRegistry({
          defaultRuntimeEngine: harnessConfig?.runtimeEngine === "sdk" ? "sdk" : "app-server",
          sdkRuntime: runtime,
          appServerRuntime,
        }),
      }),
    authRuntime: {
      listAccounts: () => accounts,
      getActiveAccount: () => accounts[0] ?? null,
      readSnapshot: async (accountId?: string) => {
        return buildAuthSnapshot(resolveAuthCommandAccountId(accountId));
      },
      startChatgptDeviceLogin: async (accountId?: string) => {
        const resolvedAccountId = resolveAuthCommandAccountId(accountId);
        authCalls.push({
          method: "startChatgptDeviceLogin",
          accountId: resolvedAccountId,
        });
        const auth = ensureAuthSnapshot(resolvedAccountId);

        if (!auth.authenticated && auth.pendingLogin?.mode !== "device") {
          auth.pendingLogin = createPendingDeviceLogin(resolvedAccountId);
        }

        return buildAuthSnapshot(resolvedAccountId);
      },
      logout: async (accountId?: string) => {
        const resolvedAccountId = resolveAuthCommandAccountId(accountId);
        authCalls.push({
          method: "logout",
          accountId: resolvedAccountId,
        });
        const auth = ensureAuthSnapshot(resolvedAccountId);
        auth.authenticated = false;
        auth.authMethod = null;
        auth.pendingLogin = null;
        auth.lastError = null;
        return buildAuthSnapshot(resolvedAccountId);
      },
      cancelPendingLogin: async (accountId?: string) => {
        const resolvedAccountId = resolveAuthCommandAccountId(accountId);
        authCalls.push({
          method: "cancelPendingLogin",
          accountId: resolvedAccountId,
        });
        const auth = ensureAuthSnapshot(resolvedAccountId);
        auth.pendingLogin = null;
        auth.lastError = null;
        return buildAuthSnapshot(resolvedAccountId);
      },
    } as never,
    taskTimeoutMs: 5_000,
    sessionStore,
    diagnosticsStateStore,
    ...(harnessConfig?.updateService ? { updateService: harnessConfig.updateService as never } : {}),
    logger: loggerState.logger,
  });
  const messages: string[] = [];
  let nextMessageId = 1;
  let messageResourceDownloader: ((
    payload?: { params: { type: string }; path: { message_id: string; file_key: string } },
  ) => Promise<{ writeFile: (filePath: string) => Promise<unknown>; getReadableStream: () => unknown; headers: unknown }>)
    | null = null;
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
  (service as unknown as { actionBridge: AppServerActionBridge }).actionBridge = actionBridge;
  (service as unknown as { client: unknown }).client = {
    im: {
      v1: {
        message: {
          create: async ({ data }: { data: { content: string; msg_type?: string } }) => {
            const messageId = `msg-created-${nextMessageId++}`;
            renderedMessages.push({
              action: "create",
              msgType: data.msg_type ?? "text",
              content: data.content,
              messageId,
            });
            messages.push(extractFeishuRenderedText(data.content));
            return {
              data: {
                message_id: messageId,
              },
            };
          },
          update: async ({ path, data }: { path: { message_id: string }; data: { content: string; msg_type?: string } }) => {
            renderedMessages.push({
              action: "update",
              msgType: data.msg_type ?? "text",
              content: data.content,
              messageId: path.message_id,
            });
            messages.push(extractFeishuRenderedText(data.content));
            return {
              data: {
                message_id: path.message_id,
              },
            };
          },
        },
        messageResource: {
          get: async (payload?: { params: { type: string }; path: { message_id: string; file_key: string } }) => {
            if (!messageResourceDownloader) {
              throw new Error("message resource downloader not configured");
            }

            return await messageResourceDownloader(payload);
          },
        },
      },
    },
  };
  const backgroundMessageTasks = new Set<Promise<void>>();
  const originalHandleMessageReceiveEvent = (service as unknown as {
    handleMessageReceiveEvent(incomingContext: typeof context): Promise<void>;
  }).handleMessageReceiveEvent.bind(service);
  (service as unknown as {
    handleMessageReceiveEvent(incomingContext: typeof context): Promise<void>;
  }).handleMessageReceiveEvent = (incomingContext) => {
    const task = Promise.resolve(originalHandleMessageReceiveEvent(incomingContext));
    backgroundMessageTasks.add(task);
    void task.finally(() => {
      backgroundMessageTasks.delete(task);
    });
    return task;
  };

  async function waitForBackgroundMessages() {
    while (backgroundMessageTasks.size > 0) {
      await Promise.allSettled([...backgroundMessageTasks]);
    }
  }

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
    async handleMessageEventText(text: string) {
      await (service as unknown as {
        handleMessageReceiveEvent(incomingContext: typeof context): Promise<void>;
      }).handleMessageReceiveEvent({ ...context, text });
    },
    async handleRawMessageEvent(event: unknown) {
      await (service as unknown as {
        acceptMessageReceiveEvent(event: unknown): Promise<void>;
      }).acceptMessageReceiveEvent(event);
      await waitForBackgroundMessages();
    },
    async acceptRawMessageEvent(event: unknown) {
      await (service as unknown as {
        acceptMessageReceiveEvent(event: unknown): Promise<void>;
      }).acceptMessageReceiveEvent(event);
    },
    async handleIncomingText(text: string) {
      await (service as unknown as {
        handleTaskMessage(incomingContext: typeof context): Promise<void>;
      }).handleTaskMessage({ ...context, text });
    },
    async handleCardActionEvent(event: unknown) {
      return await (service as unknown as {
        handleCardActionEvent(event: unknown): Promise<unknown>;
      }).handleCardActionEvent(event);
    },
    takeMessages() {
      const current = [...messages];
      messages.length = 0;
      return current;
    },
    peekMessages() {
      return [...messages];
    },
    peekRenderedMessages() {
      return [...renderedMessages];
    },
    takeSingleMessage() {
      assert.equal(messages.length, 1);
      return messages.pop() ?? "";
    },
    getTaskRuntimeCalls() {
      return { ...taskRuntimeCalls };
    },
    getTaskRequests() {
      return [...taskRequests];
    },
    async waitForBackgroundMessages() {
      await waitForBackgroundMessages();
    },
    setMessageResourceDownloader(
      downloader: (
        payload?: { params: { type: string }; path: { message_id: string; file_key: string } },
      ) => Promise<{ writeFile: (filePath: string) => Promise<unknown>; getReadableStream: () => unknown; headers: unknown }>,
    ) {
      messageResourceDownloader = downloader;
    },
    readAttachmentDraftStore() {
      const filePath = join(workingDirectory, "infra/local/feishu-attachment-drafts.json");
      if (!existsSync(filePath)) {
        return null;
      }
      return JSON.parse(readFileSync(filePath, "utf8")) as {
        version: number;
        drafts: Array<{
          parts?: Array<{ type: string; assetId?: string; text?: string }>;
          assets?: Array<{ kind: string; localPath: string }>;
          attachments: Array<{ type: string; value: string }>;
        }>;
      };
    },
    readFeishuChatSettingsStore() {
      const filePath = join(workingDirectory, "infra/local/feishu-chat-settings.json");
      if (!existsSync(filePath)) {
        return null;
      }
      return JSON.parse(readFileSync(filePath, "utf8")) as {
        version: number;
        chats?: Array<{
          chatId: string;
          chatType: string;
          routePolicy: string;
          sessionScope: string;
          adminUserIds: string[];
        }>;
      };
    },
    readFeishuDiagnosticsStore() {
      return diagnosticsStateStore.readSnapshot();
    },
    injectPendingAction(input: {
      taskId?: string;
      requestId?: string;
      actionId: string;
      actionType: "approval" | "user-input";
      prompt: string;
      choices?: string[];
      sourceChannel?: "feishu" | "web";
      sessionId?: string;
      userId?: string;
      principalId?: string;
    }) {
      const taskId = input.taskId ?? "task-pending-action";
      const requestId = input.requestId ?? "req-pending-action";
      const scopedSessionId = input.sessionId ?? sessionStore.ensureActiveSessionId(conversationKey());

      return actionBridge.register({
        taskId,
        requestId,
        actionId: input.actionId,
        actionType: input.actionType,
        prompt: input.prompt,
        ...(input.choices ? { choices: input.choices } : {}),
        scope: {
          sourceChannel: input.sourceChannel ?? "feishu",
          sessionId: scopedSessionId,
          principalId: input.principalId ?? currentPrincipalId(),
          userId: input.userId ?? context.userId,
        },
      });
    },
    findPendingAction(actionId: string) {
      return actionBridge.find(actionId);
    },
    getResolvedActionSubmissions() {
      return [...resolvedActionSubmissions];
    },
    getSkillWriteCalls() {
      return [...skillsState.writeCalls];
    },
    getPluginWriteCalls() {
      return [...pluginState.writeCalls];
    },
    getPrincipalMcpService() {
      return principalMcpService;
    },
    getPrincipalPluginsService() {
      return pluginService;
    },
    getPluginService() {
      return pluginService;
    },
    getInfoLogs() {
      return [...loggerState.infoLogs];
    },
    getAuthCalls() {
      return [...authCalls];
    },
    getStoredPrincipalTaskSettings() {
      return runtimeStore.getPrincipalTaskSettings(ensurePrincipalId())?.settings ?? null;
    },
    getCurrentPrincipalId() {
      return currentPrincipalId();
    },
    async createTextMessage(chatId: string, text: string) {
      return await (service as unknown as {
        createTextMessage(targetChatId: string, value: string): Promise<unknown>;
      }).createTextMessage(chatId, text);
    },
    async notifyScheduledTaskResult(input: {
      task: StoredScheduledTaskRecord;
      run: StoredScheduledTaskRunRecord;
      outcome: "completed" | "failed" | "cancelled";
      failureMessage?: string;
    }) {
      return await service.notifyScheduledTaskResult(input);
    },
    setClient(client: unknown) {
      (service as unknown as { client: unknown }).client = client;
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
    seedAppServerSession(sessionId: string, input: {
      threadId: string;
      sourceChannel?: "web" | "feishu";
      goal?: string;
      summary?: string;
      status?: "completed" | "running";
    }) {
      const now = new Date().toISOString();
      const requestId = `request-seed-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const taskId = `task-seed-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const goal = input.goal ?? "seed app-server session";
      const request = {
        requestId,
        sourceChannel: input.sourceChannel ?? "web",
        user: {
          userId: context.userId,
        },
        goal,
        channelContext: {
          sessionId,
        },
        createdAt: now,
      } satisfies TaskRequest;

      runtimeStore.upsertTurnFromRequest(request, taskId);
      runtimeStore.saveSession({
        sessionId,
        threadId: input.threadId,
        createdAt: now,
        updatedAt: now,
        ...(input.status === "running" ? { activeTaskId: taskId } : {}),
      });

      if (input.status === "running") {
        runtimeStore.appendTaskEvent({
          eventId: `event-seed-running-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          taskId,
          requestId,
          type: "task.progress",
          status: "running",
          message: input.summary ?? goal,
          payload: {
            itemType: "agent_message",
            threadEventType: "item.completed",
            itemId: `item-seed-running-${Math.random().toString(36).slice(2, 10)}`,
          },
          timestamp: now,
        });
        return;
      }

      runtimeStore.completeTaskTurn({
        request,
        result: {
          taskId,
          requestId,
          status: "completed",
          summary: input.summary ?? goal,
          output: input.summary ?? goal,
          structuredOutput: {
            session: {
              engine: "app-server",
              threadId: input.threadId,
            },
          },
          completedAt: now,
        },
        sessionMode: "resumed",
        threadId: input.threadId,
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

function buildRuntimeRegistry(input: {
  defaultRuntimeEngine: "sdk" | "app-server";
  sdkRuntime: TaskRuntimeFacade;
  appServerRuntime: TaskRuntimeFacade;
}) {
  return {
    defaultRuntime: input.defaultRuntimeEngine === "sdk" ? input.sdkRuntime : input.appServerRuntime,
    runtimes: {
      sdk: input.sdkRuntime,
      "app-server": input.appServerRuntime,
    },
  };
}

function extractFeishuRenderedText(content: string): string {
  const parsed = JSON.parse(content) as {
    text?: string;
    zh_cn?: {
      content?: Array<Array<{ text?: string }>>;
    };
    header?: {
      title?: {
        content?: string;
      };
    };
    elements?: Array<{
      tag?: string;
      text?: { content?: string };
      content?: string;
      elements?: Array<{ content?: string }>;
    }>;
  };

  if (typeof parsed.text === "string") {
    return parsed.text;
  }

  const firstText = parsed.zh_cn?.content?.flat().find((item) => typeof item.text === "string")?.text;
  if (typeof firstText === "string") {
    return firstText;
  }

  const headerText = parsed.header?.title?.content;
  const bodyText = parsed.elements?.flatMap((element) => {
    if (typeof element.text?.content === "string") {
      return [element.text.content];
    }

    if (typeof element.content === "string") {
      return [element.content];
    }

    if (Array.isArray(element.elements)) {
      return element.elements.map((item) => item.content).filter((item): item is string => typeof item === "string");
    }

    return [];
  }) ?? [];

  return [headerText, ...bodyText].filter((item): item is string => typeof item === "string" && item.length > 0).join("\n");
}

function listInteractiveCardButtons(content: string): Array<{
  tag?: string;
  text?: { content?: string };
  type?: string;
  value?: Record<string, unknown>;
}> {
  const parsed = JSON.parse(content) as {
    elements?: Array<{
      tag?: string;
      actions?: Array<{
        tag?: string;
        text?: { content?: string };
        type?: string;
        value?: Record<string, unknown>;
      }>;
    }>;
  };

  return parsed.elements
    ?.flatMap((element) => element.tag === "action" && Array.isArray(element.actions) ? element.actions : [])
    ?? [];
}

async function waitFor(check: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
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
      nativeTextInput: true,
      nativeImageInput: false,
      nativeDocumentInput: false,
      supportedDocumentMimeTypes: [],
      supportsPdfTextExtraction: false,
      supportsDocumentPageRasterization: false,
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
  const infoLogs: string[] = [];
  const warnLogs: string[] = [];
  const errorLogs: string[] = [];

  return {
    logger: {
      info(message: string) {
        infoLogs.push(message);
      },
      warn(message: string) {
        warnLogs.push(message);
      },
      error(message: string) {
        errorLogs.push(message);
      },
    },
    infoLogs,
    warnLogs,
    errorLogs,
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

function createFeishuTextEvent(input: {
  chatId: string;
  userId: string;
  messageId: string;
  text: string;
  chatType?: string;
  createTime?: string;
  mentions?: Array<{ key?: string }>;
}) {
  return {
    message: {
      chat_id: input.chatId,
      message_id: input.messageId,
      create_time: input.createTime ?? `${Date.now()}`,
      message_type: "text",
      chat_type: input.chatType ?? "p2p",
      content: JSON.stringify({ text: input.text }),
      ...(input.mentions ? { mentions: input.mentions } : {}),
    },
    sender: {
      sender_id: {
        user_id: input.userId,
      },
    },
  };
}
