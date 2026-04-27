import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FeishuDiagnosticsStateStore } from "../channels/feishu/diagnostics-state-store.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskRequest } from "../types/task.js";
import {
  buildFeishuTroubleshootingPlaybook,
  describeFeishuTakeoverGuidance,
  readFeishuDiagnosticsSnapshot,
  type FeishuDiagnosticsLastIgnoredMessageSummary,
  type FeishuDiagnosticsConversationSummary,
} from "./feishu-diagnostics.js";

test("describeFeishuTakeoverGuidance 会给出可执行的接管提示", () => {
  const noPending = describeFeishuTakeoverGuidance(null);
  assert.equal(noPending.state, "no_pending_action");
  assert.match(noPending.hint, /没有 pending action/);

  const blockedByApprovalConversation: FeishuDiagnosticsConversationSummary = {
    key: "chat-1::user-1",
    chatId: "chat-1",
    userId: "user-1",
    principalId: "principal-1",
    activeSessionId: "session-1",
    threadId: "thread-1",
    threadStatus: "running",
    lastMessageId: "message-1",
    lastEventType: "waiting_action.snapshot",
    pendingActionCount: 2,
    pendingActions: [
      {
        actionId: "input-1",
        actionType: "user-input",
        taskId: "task-1",
        requestId: "request-1",
        sourceChannel: "web",
        sessionId: "session-1",
        principalId: "principal-1",
      },
      {
        actionId: "approval-1",
        actionType: "approval",
        taskId: "task-2",
        requestId: "request-2",
        sourceChannel: "feishu",
        sessionId: "session-1",
        principalId: "principal-1",
      },
    ],
    updatedAt: "2026-04-02T10:00:00.000Z",
  };
  const blockedByApproval = describeFeishuTakeoverGuidance(blockedByApprovalConversation);
  assert.equal(blockedByApproval.state, "blocked_by_approval");
  assert.match(blockedByApproval.hint, /approval-1/);
  assert.match(blockedByApproval.hint, /input-1/);
  assert.match(blockedByApproval.hint, /先.*approve.*deny/);

  const replyRequiredConversation: FeishuDiagnosticsConversationSummary = {
    ...blockedByApprovalConversation,
    pendingActionCount: 2,
    pendingActions: [
      {
        actionId: "input-1",
        actionType: "user-input",
        taskId: "task-1",
        requestId: "request-1",
        sourceChannel: "web",
        sessionId: "session-1",
        principalId: "principal-1",
      },
      {
        actionId: "input-2",
        actionType: "user-input",
        taskId: "task-2",
        requestId: "request-2",
        sourceChannel: "feishu",
        sessionId: "session-1",
        principalId: "principal-1",
      },
    ],
  };
  const replyRequired = describeFeishuTakeoverGuidance(replyRequiredConversation);
  assert.equal(replyRequired.state, "reply_required");
  assert.match(replyRequired.hint, /\/reply <actionId> <内容>/);
  assert.match(replyRequired.hint, /input-1/);
  assert.match(replyRequired.hint, /input-2/);

  const directTextReadyConversation: FeishuDiagnosticsConversationSummary = {
    ...blockedByApprovalConversation,
    pendingActionCount: 1,
    pendingActions: [
      {
        actionId: "input-1",
        actionType: "user-input",
        taskId: "task-1",
        requestId: "request-1",
        sourceChannel: "web",
        sessionId: "session-1",
        principalId: "principal-1",
      },
    ],
  };
  const directTextReady = describeFeishuTakeoverGuidance(directTextReadyConversation);
  assert.equal(directTextReady.state, "direct_text_ready");
  assert.match(directTextReady.hint, /直接回复普通文本/);
  assert.match(directTextReady.hint, /input-1/);
});

test("buildFeishuTroubleshootingPlaybook 会把常见诊断翻成排障剧本", () => {
  const conversation: FeishuDiagnosticsConversationSummary = {
    key: "chat-1::user-1",
    chatId: "chat-1",
    userId: "user-1",
    principalId: "principal-1",
    activeSessionId: "session-1",
    threadId: "thread-1",
    threadStatus: "running",
    lastMessageId: "message-1",
    lastEventType: "waiting_action.snapshot",
    pendingActionCount: 2,
    pendingActions: [
      {
        actionId: "input-1",
        actionType: "user-input",
        taskId: "task-1",
        requestId: "request-1",
        sourceChannel: "web",
        sessionId: "session-1",
        principalId: "principal-1",
      },
      {
        actionId: "approval-1",
        actionType: "approval",
        taskId: "task-2",
        requestId: "request-2",
        sourceChannel: "feishu",
        sessionId: "session-1",
        principalId: "principal-1",
      },
    ],
    updatedAt: "2026-04-02T10:00:00.000Z",
  };
  const staleIgnoredMessage: FeishuDiagnosticsLastIgnoredMessageSummary = {
    type: "message.stale_ignored",
    messageId: "message-42",
    createdAt: "2026-04-02T10:10:00.000Z",
    summary: "旧消息被忽略",
  };

  const blockedByApproval = buildFeishuTroubleshootingPlaybook({
    primaryDiagnosisId: "approval_blocking_takeover",
    currentConversation: conversation,
    lastIgnoredMessage: null,
  });
  assert.ok(blockedByApproval.some((step) => step.includes("/approve approval-1")));
  assert.ok(blockedByApproval.some((step) => step.includes("/reply input-1 <内容>")));

  const replyRequired = buildFeishuTroubleshootingPlaybook({
    primaryDiagnosisId: "pending_input_ambiguous",
    currentConversation: {
      ...conversation,
      pendingActions: [
        conversation.pendingActions[0]!,
        {
          actionId: "input-2",
          actionType: "user-input",
          taskId: "task-3",
          requestId: "request-3",
          sourceChannel: "feishu",
          sessionId: "session-1",
          principalId: "principal-1",
        },
      ],
    },
    lastIgnoredMessage: null,
  });
  assert.ok(replyRequired.some((step) => step.includes("/reply input-1 <内容>")));
  assert.ok(replyRequired.some((step) => step.includes("/reply input-2 <内容>")));

  const ignoredMessage = buildFeishuTroubleshootingPlaybook({
    primaryDiagnosisId: "ignored_message_window",
    currentConversation: null,
    lastIgnoredMessage: staleIgnoredMessage,
  });
  assert.ok(ignoredMessage.some((step) => step.includes("message-42")));
  assert.ok(ignoredMessage.some((step) => step.includes("不要重发这条旧消息")));

  const pendingNotFound = buildFeishuTroubleshootingPlaybook({
    primaryDiagnosisId: "pending_input_not_found",
    currentConversation: {
      ...conversation,
      pendingActionCount: 1,
      pendingActions: [conversation.pendingActions[0]!],
    },
    lastIgnoredMessage: staleIgnoredMessage,
  });
  assert.ok(pendingNotFound.some((step) => step.includes("/use session-1")));
  assert.ok(pendingNotFound.some((step) => step.includes("/reply input-1 <内容>")));
  assert.ok(pendingNotFound.some((step) => step.includes("message-42")));

  const ignoredWithReadyInput = buildFeishuTroubleshootingPlaybook({
    primaryDiagnosisId: "ignored_message_window",
    currentConversation: {
      ...conversation,
      pendingActionCount: 1,
      pendingActions: [conversation.pendingActions[0]!],
    },
    lastIgnoredMessage: staleIgnoredMessage,
  });
  assert.ok(ignoredWithReadyInput.some((step) => step.includes("message-42")));
  assert.ok(ignoredWithReadyInput.some((step) => step.includes("/reply input-1 <内容>")));
  assert.ok(ignoredWithReadyInput.some((step) => step.includes("直接回复普通文本")));
});

test("readFeishuDiagnosticsSnapshot 会在服务黑洞地址上超时返回不可达", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-timeout-"));
  let server: ReturnType<typeof createServer> | null = null;

  try {
    server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/") {
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("test server failed to bind");
    }

    const result = await Promise.race([
      readFeishuDiagnosticsSnapshot({
        workingDirectory: root,
        env: {
          FEISHU_APP_ID: "cli_xxx",
          FEISHU_APP_SECRET: "secret_xxx",
        },
        baseUrl: `http://127.0.0.1:${address.port}`,
        serviceProbeTimeoutMs: 50,
      }),
      waitForReject(250, "reader should not hang on blackhole service"),
    ]);

    assert.deepEqual(result.service, {
      serviceReachable: false,
      statusCode: null,
    });
    assert.equal(result.diagnostics.primaryDiagnosis?.id, "service_unreachable");
    assert.deepEqual(result.diagnostics.secondaryDiagnoses, []);
    assert.ok(result.diagnostics.recommendedNextSteps.includes("npm run dev:web"));
    assert.ok(result.diagnostics.recommendedNextSteps.includes("./themis doctor feishu"));
  } finally {
    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.unref();
      server.close();
    }

    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 会把缺失的状态文件标记为 missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-missing-"));

  try {
    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(result.state.sessionStore.status, "missing");
    assert.equal(result.state.attachmentDraftStore.status, "missing");
    assert.equal(result.state.sessionBindingCount, 0);
    assert.equal(result.state.attachmentDraftCount, 0);
    assert.equal(result.diagnostics.primaryDiagnosis?.id, "config_missing");
    assert.deepEqual(result.diagnostics.secondaryDiagnoses, []);
    assert.ok(result.diagnostics.recommendedNextSteps.some((step) => step.startsWith("./themis config set FEISHU_APP_ID")));
    assert.ok(result.diagnostics.recommendedNextSteps.some((step) => step.startsWith("./themis config set FEISHU_APP_SECRET")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 读取缺失 diagnostics 文件时不会创建 infra/local", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-read-only-"));

  try {
    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(result.diagnostics.store.status, "missing");
    assert.equal(existsSync(join(root, "infra", "local")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 会把非法 JSON 状态文件标记为 unreadable", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-unreadable-"));

  try {
    mkdirSync(join(root, "infra", "local"), { recursive: true });
    writeFileSync(join(root, "infra", "local", "feishu-sessions.json"), "{not-json", "utf8");
    writeFileSync(join(root, "infra", "local", "feishu-attachment-drafts.json"), "{not-json", "utf8");

    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(result.state.sessionStore.status, "unreadable");
    assert.equal(result.state.attachmentDraftStore.status, "unreadable");
    assert.equal(result.state.sessionBindingCount, 0);
    assert.equal(result.state.attachmentDraftCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 会正常统计 sessions 和 drafts 数量", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-count-"));

  try {
    mkdirSync(join(root, "docs", "feishu"), { recursive: true });
    writeFileSync(join(root, "docs", "feishu", "themis-feishu-real-journey-smoke.md"), "# smoke\n", "utf8");
    mkdirSync(join(root, "infra", "local"), { recursive: true });
    writeFileSync(
      join(root, "infra", "local", "feishu-sessions.json"),
      JSON.stringify(
        {
          version: 1,
          bindings: [
            {
              key: "chat-1::user-1",
              chatId: "chat-1",
              userId: "user-1",
              activeSessionId: "session-1",
              updatedAt: "2026-04-02T00:00:00.000Z",
            },
            {
              key: "chat-2::user-2",
              chatId: "chat-2",
              userId: "user-2",
              activeSessionId: "session-2",
              updatedAt: "2026-04-02T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(root, "infra", "local", "feishu-attachment-drafts.json"),
      JSON.stringify(
        {
          version: 1,
          drafts: [
            {
              key: "chat-1::user-1::session-1",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              parts: [],
              assets: [],
              attachments: [],
              createdAt: "2026-04-02T00:00:00.000Z",
              updatedAt: "2026-04-02T00:00:00.000Z",
              expiresAt: "2026-04-02T01:00:00.000Z",
            },
            {
              key: "chat-2::user-2::session-2",
              chatId: "chat-2",
              userId: "user-2",
              sessionId: "session-2",
              parts: [],
              assets: [],
              attachments: [],
              createdAt: "2026-04-02T00:00:00.000Z",
              updatedAt: "2026-04-02T00:00:00.000Z",
              expiresAt: "2026-04-02T01:00:00.000Z",
            },
            {
              key: "chat-3::user-3::session-3",
              chatId: "chat-3",
              userId: "user-3",
              sessionId: "session-3",
              parts: [],
              assets: [],
              attachments: [],
              createdAt: "2026-04-02T00:00:00.000Z",
              updatedAt: "2026-04-02T00:00:00.000Z",
              expiresAt: "2026-04-02T01:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(result.state.sessionStore.status, "ok");
    assert.equal(result.state.attachmentDraftStore.status, "ok");
    assert.equal(result.state.sessionBindingCount, 2);
    assert.equal(result.state.attachmentDraftCount, 3);
    assert.equal(result.docs.smokeDocExists, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 会派生 recentWindowStats、lastActionAttempt 和 lastIgnoredMessage", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-summary-"));
  const store = new FeishuDiagnosticsStateStore({
    filePath: join(root, "infra", "local", "feishu-diagnostics.json"),
  });

  try {
    store.upsertConversation({
      key: "chat-1::user-1",
      chatId: "chat-1",
      userId: "user-1",
      principalId: "principal-1",
      activeSessionId: "session-1",
      lastMessageId: "message-1",
      lastEventType: "takeover.submitted",
      updatedAt: "2026-04-02T08:00:00.000Z",
      pendingActions: [],
    });
    store.appendEvent({
      id: "event-1",
      type: "message.stale_ignored",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      principalId: "principal-1",
      messageId: "message-1",
      summary: "旧消息被忽略",
      createdAt: "2026-04-02T08:00:01.000Z",
      details: {
        messageId: "message-1",
        reason: "stale",
        retryCount: 1,
        approved: false,
        note: null,
      },
    });
    store.appendEvent({
      id: "event-2",
      type: "takeover.submitted",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      principalId: "principal-1",
      actionId: "action-1",
      requestId: "request-1",
      summary: "takeover 已提交",
      createdAt: "2026-04-02T08:00:02.000Z",
      details: {
        actionId: "action-1",
        requestId: "request-1",
        sessionId: "session-1",
        principalId: "principal-1",
      },
    });

    const summary = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(summary.diagnostics.recentWindowStats.staleIgnoredCount, 1);
    assert.equal(summary.diagnostics.recentWindowStats.takeoverSubmittedCount, 1);
    assert.equal(summary.diagnostics.recentWindowStats.duplicateIgnoredCount, 0);
    assert.equal(summary.diagnostics.recentWindowStats.replySubmittedCount, 0);
    assert.equal(summary.diagnostics.recentWindowStats.approvalSubmittedCount, 0);
    assert.equal(summary.diagnostics.recentWindowStats.pendingInputNotFoundCount, 0);
    assert.equal(summary.diagnostics.recentWindowStats.pendingInputNotFoundActionableCount, 0);
    assert.equal(summary.diagnostics.recentWindowStats.pendingInputNotFoundBenignCount, 0);
    assert.equal(summary.diagnostics.recentWindowStats.pendingInputAmbiguousCount, 0);
    assert.equal(summary.diagnostics.lastActionAttempt?.type, "takeover.submitted");
    assert.equal(summary.diagnostics.lastActionAttempt?.requestId, "request-1");
    assert.equal(summary.diagnostics.lastActionAttempt?.summary, "takeover 已提交");
    assert.equal(summary.diagnostics.lastActionAttempt?.createdAt, "2026-04-02T08:00:02.000Z");
    assert.equal(summary.diagnostics.lastIgnoredMessage?.type, "message.stale_ignored");
    assert.equal(summary.diagnostics.lastIgnoredMessage?.messageId, "message-1");
    assert.equal(summary.diagnostics.lastIgnoredMessage?.summary, "旧消息被忽略");
    assert.equal(summary.diagnostics.lastIgnoredMessage?.createdAt, "2026-04-02T08:00:01.000Z");
    assert.deepEqual(summary.diagnostics.recentEvents[0]?.details, {
      messageId: "message-1",
      reason: "stale",
      retryCount: 1,
      approved: false,
      note: null,
    });
    assert.deepEqual(summary.diagnostics.recentEvents[1]?.details, {
      actionId: "action-1",
      requestId: "request-1",
      sessionId: "session-1",
      principalId: "principal-1",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 会把 submit_failed action 纳入 lastActionAttempt", async () => {
  const cases = [
    {
      type: "approval.submit_failed",
      actionId: "approval-action",
      requestId: "approval-request",
      summary: "approval 提交失败",
      createdAt: "2026-04-02T08:00:01.000Z",
    },
    {
      type: "reply.submit_failed",
      actionId: "reply-action",
      requestId: "reply-request",
      summary: "reply 提交失败",
      createdAt: "2026-04-02T08:00:02.000Z",
    },
    {
      type: "takeover.submit_failed",
      actionId: "takeover-action",
      requestId: "takeover-request",
      summary: "takeover 提交失败",
      createdAt: "2026-04-02T08:00:03.000Z",
    },
  ] as const;

  for (const currentCase of cases) {
    const root = mkdtempSync(join(tmpdir(), `themis-feishu-diagnostics-${currentCase.type.replaceAll(".", "-")}-`));
    const store = new FeishuDiagnosticsStateStore({
      filePath: join(root, "infra", "local", "feishu-diagnostics.json"),
    });

    try {
      store.upsertConversation({
        key: "chat-1::user-1",
        chatId: "chat-1",
        userId: "user-1",
        principalId: "principal-1",
        activeSessionId: "session-1",
        updatedAt: "2026-04-02T08:00:00.000Z",
        pendingActions: [],
      });
      store.appendEvent({
        id: "event-1",
        type: currentCase.type,
        chatId: "chat-1",
        userId: "user-1",
        sessionId: "session-1",
        principalId: "principal-1",
        actionId: currentCase.actionId,
        requestId: currentCase.requestId,
        summary: currentCase.summary,
        createdAt: currentCase.createdAt,
      });

      const summary = await readFeishuDiagnosticsSnapshot({
        workingDirectory: root,
        env: {
          FEISHU_APP_ID: "cli_xxx",
          FEISHU_APP_SECRET: "secret_xxx",
        },
        fetchImpl: async () =>
          new Response(null, {
            status: 200,
          }),
      });

      assert.equal(summary.diagnostics.lastActionAttempt?.type, currentCase.type);
      assert.equal(summary.diagnostics.lastActionAttempt?.actionId, currentCase.actionId);
      assert.equal(summary.diagnostics.lastActionAttempt?.requestId, currentCase.requestId);
      assert.equal(summary.diagnostics.lastActionAttempt?.summary, currentCase.summary);
      assert.equal(summary.diagnostics.primaryDiagnosis?.id, "action_submit_failed");
      assert.deepEqual(summary.diagnostics.secondaryDiagnoses, []);
      assert.ok(summary.diagnostics.recommendedNextSteps.includes("./themis doctor smoke feishu"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("readFeishuDiagnosticsSnapshot 会基于当前 pendingActions 归类 approval_blocking_takeover", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-blocked-"));
  const store = new FeishuDiagnosticsStateStore({
    filePath: join(root, "infra", "local", "feishu-diagnostics.json"),
  });

  try {
    store.upsertConversation({
      key: "chat-1::user-1",
      chatId: "chat-1",
      userId: "user-1",
      principalId: "principal-1",
      activeSessionId: "session-1",
      lastEventType: "pending_input.blocked_by_approval",
      updatedAt: "2026-04-02T08:00:00.000Z",
      pendingActions: [
        {
          actionId: "approval-1",
          actionType: "approval",
          taskId: "task-1",
          requestId: "request-1",
          sourceChannel: "feishu",
          sessionId: "session-1",
          principalId: "principal-1",
        },
        {
          actionId: "reply-1",
          actionType: "user-input",
          taskId: "task-2",
          requestId: "request-2",
          sourceChannel: "feishu",
          sessionId: "session-1",
          principalId: "principal-1",
        },
      ],
    });
    store.appendEvent({
      id: "event-blocked-1",
      type: "pending_input.blocked_by_approval",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      principalId: "principal-1",
      summary: "approval 仍在阻挡 direct-text takeover",
      createdAt: "2026-04-02T08:00:01.000Z",
    });

    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      env: {
        FEISHU_APP_ID: "cli_xxx",
        FEISHU_APP_SECRET: "secret_xxx",
      },
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(result.diagnostics.primaryDiagnosis?.id, "approval_blocking_takeover");
    assert.equal(result.diagnostics.primaryDiagnosis?.severity, "warning");
    assert.deepEqual(result.diagnostics.secondaryDiagnoses, []);
    assert.ok(result.diagnostics.recommendedNextSteps.some((step) => step.includes("/approve <actionId>")));
    assert.ok(result.diagnostics.recommendedNextSteps.some((step) => step.includes("/deny <actionId>")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 会基于当前 pendingActions 归类 pending_input_ambiguous", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-ambiguous-"));
  const store = new FeishuDiagnosticsStateStore({
    filePath: join(root, "infra", "local", "feishu-diagnostics.json"),
  });

  try {
    store.upsertConversation({
      key: "chat-1::user-1",
      chatId: "chat-1",
      userId: "user-1",
      principalId: "principal-1",
      activeSessionId: "session-1",
      lastEventType: "pending_input.ambiguous",
      updatedAt: "2026-04-02T08:00:00.000Z",
      pendingActions: [
        {
          actionId: "reply-1",
          actionType: "user-input",
          taskId: "task-1",
          requestId: "request-1",
          sourceChannel: "feishu",
          sessionId: "session-1",
          principalId: "principal-1",
        },
        {
          actionId: "reply-2",
          actionType: "user-input",
          taskId: "task-2",
          requestId: "request-2",
          sourceChannel: "feishu",
          sessionId: "session-1",
          principalId: "principal-1",
        },
      ],
    });
    store.appendEvent({
      id: "event-ambiguous-1",
      type: "pending_input.ambiguous",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      principalId: "principal-1",
      summary: "存在多条待补充输入",
      createdAt: "2026-04-02T08:00:01.000Z",
    });

    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      env: {
        FEISHU_APP_ID: "cli_xxx",
        FEISHU_APP_SECRET: "secret_xxx",
      },
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(result.diagnostics.primaryDiagnosis?.id, "pending_input_ambiguous");
    assert.equal(result.diagnostics.primaryDiagnosis?.severity, "warning");
    assert.deepEqual(result.diagnostics.secondaryDiagnoses, []);
    assert.ok(result.diagnostics.recommendedNextSteps.some((step) => step.includes("/reply <actionId> <内容>")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 在当前状态恢复后不会继续报旧 blocked 或 ambiguous 主诊断", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-recovered-"));
  const store = new FeishuDiagnosticsStateStore({
    filePath: join(root, "infra", "local", "feishu-diagnostics.json"),
  });

  try {
    store.upsertConversation({
      key: "chat-1::user-1",
      chatId: "chat-1",
      userId: "user-1",
      principalId: "principal-1",
      activeSessionId: "session-1",
      lastEventType: "message.received",
      updatedAt: "2026-04-02T08:00:03.000Z",
      pendingActions: [],
    });
    store.appendEvent({
      id: "event-blocked-1",
      type: "pending_input.blocked_by_approval",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      principalId: "principal-1",
      summary: "历史 blocked 事件",
      createdAt: "2026-04-02T08:00:01.000Z",
    });
    store.appendEvent({
      id: "event-ambiguous-1",
      type: "pending_input.ambiguous",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      principalId: "principal-1",
      summary: "历史 ambiguous 事件",
      createdAt: "2026-04-02T08:00:02.000Z",
    });

    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      env: {
        FEISHU_APP_ID: "cli_xxx",
        FEISHU_APP_SECRET: "secret_xxx",
      },
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.notEqual(result.diagnostics.primaryDiagnosis?.id, "approval_blocking_takeover");
    assert.notEqual(result.diagnostics.primaryDiagnosis?.id, "pending_input_ambiguous");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 会把 pending_input.not_found 暴露成诊断并保留 secondary 信息", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-not-found-"));
  const store = new FeishuDiagnosticsStateStore({
    filePath: join(root, "infra", "local", "feishu-diagnostics.json"),
  });

  try {
    store.appendEvent({
      id: "event-not-found-1",
      type: "pending_input.not_found",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      principalId: "principal-1",
      summary: "没有匹配到 pending action",
      createdAt: "2026-04-02T08:00:01.000Z",
    });
    store.appendEvent({
      id: "event-ignored-1",
      type: "message.stale_ignored",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      principalId: "principal-1",
      messageId: "message-1",
      summary: "旧消息被忽略",
      createdAt: "2026-04-02T08:00:02.000Z",
    });

    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      env: {
        FEISHU_APP_ID: "cli_xxx",
        FEISHU_APP_SECRET: "secret_xxx",
      },
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(result.diagnostics.primaryDiagnosis?.id, "pending_input_not_found");
    assert.equal(result.diagnostics.primaryDiagnosis?.severity, "warning");
    assert.equal(result.diagnostics.recentWindowStats.pendingInputNotFoundActionableCount, 1);
    assert.equal(result.diagnostics.recentWindowStats.pendingInputNotFoundBenignCount, 0);
    assert.ok(result.diagnostics.secondaryDiagnoses.some((item) => item.id === "ignored_message_window"));
    assert.ok(result.diagnostics.recommendedNextSteps.some((step) => step.includes("./themis doctor feishu")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 不把无 pending 输入的普通文本接管探测当成主告警", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-benign-not-found-"));
  const store = new FeishuDiagnosticsStateStore({
    filePath: join(root, "infra", "local", "feishu-diagnostics.json"),
  });

  try {
    store.appendEvent({
      id: "event-not-found-benign-1",
      type: "pending_input.not_found",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      principalId: "principal-1",
      summary: "当前会话没有可接管的等待输入。",
      createdAt: "2026-04-02T08:00:01.000Z",
      details: {
        blockingReason: "no_pending_input",
        approvalPendingActionCount: 0,
        matchedPendingActionCount: 0,
      },
    });

    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      env: {
        FEISHU_APP_ID: "cli_xxx",
        FEISHU_APP_SECRET: "secret_xxx",
      },
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(result.diagnostics.primaryDiagnosis?.id, "healthy");
    assert.equal(result.diagnostics.recentWindowStats.pendingInputNotFoundCount, 1);
    assert.equal(result.diagnostics.recentWindowStats.pendingInputNotFoundActionableCount, 0);
    assert.equal(result.diagnostics.recentWindowStats.pendingInputNotFoundBenignCount, 1);
    assert.deepEqual(result.diagnostics.secondaryDiagnoses, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 会把 duplicate/stale ignored 场景归类成 ignored_message_window", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-ignored-"));
  const store = new FeishuDiagnosticsStateStore({
    filePath: join(root, "infra", "local", "feishu-diagnostics.json"),
  });

  try {
    store.appendEvent({
      id: "event-ignored-1",
      type: "message.duplicate_ignored",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      principalId: "principal-1",
      messageId: "message-1",
      summary: "重复消息被忽略",
      createdAt: "2026-04-02T08:00:01.000Z",
    });
    store.appendEvent({
      id: "event-ignored-2",
      type: "message.stale_ignored",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      principalId: "principal-1",
      messageId: "message-2",
      summary: "旧消息被忽略",
      createdAt: "2026-04-02T08:00:02.000Z",
    });

    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      env: {
        FEISHU_APP_ID: "cli_xxx",
        FEISHU_APP_SECRET: "secret_xxx",
      },
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(result.diagnostics.primaryDiagnosis?.id, "ignored_message_window");
    assert.equal(result.diagnostics.primaryDiagnosis?.severity, "warning");
    assert.deepEqual(result.diagnostics.secondaryDiagnoses, []);
    assert.equal(result.diagnostics.lastIgnoredMessage?.type, "message.stale_ignored");
    assert.ok(result.diagnostics.recommendedNextSteps.includes("./themis doctor smoke feishu"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 在健康场景下返回固定推荐顺序", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-healthy-"));

  try {
    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      env: {
        FEISHU_APP_ID: "cli_xxx",
        FEISHU_APP_SECRET: "secret_xxx",
      },
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(result.diagnostics.primaryDiagnosis?.id, "healthy");
    assert.equal(result.diagnostics.primaryDiagnosis?.severity, "info");
    assert.deepEqual(result.diagnostics.secondaryDiagnoses, []);
    assert.deepEqual(result.diagnostics.recommendedNextSteps, [
      "./themis doctor feishu",
      "./themis doctor smoke web",
      "./themis doctor smoke feishu",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 会根据 THEMIS_PORT 探测当前服务", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-port-"));

  try {
    const fetchCalls: string[] = [];
    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      env: {
        FEISHU_APP_ID: "cli_xxx",
        FEISHU_APP_SECRET: "secret_xxx",
        THEMIS_HOST: "0.0.0.0",
        THEMIS_PORT: "3210",
      },
      fetchImpl: async (input) => {
        const url = normalizeFetchInput(input);
        fetchCalls.push(url);
        return new Response(null, {
          status: 200,
        });
      },
    });

    assert.equal(result.service.statusCode, 200);
    assert.deepEqual(fetchCalls, ["http://127.0.0.1:3210/"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 会返回 diagnostics store 状态、currentConversation summary 和最近 5 条事件", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-store-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra", "local", "themis.db"),
  });

  try {
    mkdirSync(join(root, "docs", "feishu"), { recursive: true });
    writeFileSync(join(root, "docs", "feishu", "themis-feishu-real-journey-smoke.md"), "# smoke\n", "utf8");
    writeFileSync(
      join(root, "infra", "local", "feishu-sessions.json"),
      JSON.stringify(
        {
          version: 1,
          bindings: [
            {
              key: "chat-1::user-1",
              chatId: "chat-1",
              userId: "user-1",
              activeSessionId: "session-1",
              updatedAt: "2026-04-02T08:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    runtimeStore.saveSession({
      sessionId: "session-2",
      threadId: "thread-2",
      createdAt: "2026-04-02T08:59:00.000Z",
      updatedAt: "2026-04-02T09:00:00.000Z",
    });
    runtimeStore.upsertTurnFromRequest({
      ...createFeishuTaskRequest("session-2", "request-2-blocked"),
      createdAt: "2026-04-02T08:59:30.000Z",
    }, "task-2-blocked");
    runtimeStore.saveTurnInput({
      requestId: "request-2-blocked",
      envelope: {
        envelopeId: "env-2-blocked",
        sourceChannel: "feishu",
        sourceSessionId: "session-2",
        sourceMessageId: "message-2-blocked",
        parts: [
          {
            partId: "part-image-2-blocked",
            type: "image",
            role: "user",
            order: 0,
            assetId: "asset-image-2-blocked",
          },
        ],
        assets: [
          {
            assetId: "asset-image-2-blocked",
            kind: "image",
            name: "photo.png",
            mimeType: "image/png",
            localPath: join(root, "temp", "photo.png"),
            sourceChannel: "feishu",
            sourceMessageId: "message-2-blocked",
            ingestionStatus: "ready",
          },
        ],
        createdAt: "2026-04-02T08:59:30.000Z",
      },
      compileSummary: {
        runtimeTarget: "codex-sdk",
        degradationLevel: "blocked",
        warnings: [
          {
            code: "IMAGE_NATIVE_INPUT_REQUIRED",
            message: "当前 runtime 不支持 native image input。",
            assetId: "asset-image-2-blocked",
          },
        ],
        capabilityMatrix: {
          modelCapabilities: null,
          transportCapabilities: {
            nativeTextInput: true,
            nativeImageInput: false,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
          },
          effectiveCapabilities: {
            nativeTextInput: true,
            nativeImageInput: false,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
          },
          assetFacts: [
            {
              assetId: "asset-image-2-blocked",
              kind: "image",
              mimeType: "image/png",
              localPathStatus: "ready",
              modelNativeSupport: null,
              transportNativeSupport: false,
              effectiveNativeSupport: false,
              modelMimeTypeSupported: null,
              transportMimeTypeSupported: null,
              effectiveMimeTypeSupported: null,
              handling: "blocked",
            },
          ],
        },
      },
      createdAt: "2026-04-02T08:59:30.000Z",
    });
    runtimeStore.upsertTurnFromRequest(createFeishuTaskRequest("session-2", "request-2"), "task-2");
    runtimeStore.saveTurnInput({
      requestId: "request-2",
      envelope: {
        envelopeId: "env-2",
        sourceChannel: "feishu",
        sourceSessionId: "session-2",
        sourceMessageId: "message-2",
        parts: [
          {
            partId: "part-document-2",
            type: "document",
            role: "user",
            order: 0,
            assetId: "asset-document-2",
          },
        ],
        assets: [
          {
            assetId: "asset-document-2",
            kind: "document",
            name: "report.pdf",
            mimeType: "application/pdf",
            localPath: join(root, "temp", "report.pdf"),
            sourceChannel: "feishu",
            sourceMessageId: "message-2",
            ingestionStatus: "ready",
          },
        ],
        createdAt: "2026-04-02T09:00:00.000Z",
      },
      compileSummary: {
        runtimeTarget: "app-server",
        degradationLevel: "controlled_fallback",
        warnings: [
          {
            code: "DOCUMENT_NATIVE_INPUT_FALLBACK",
            message: "当前 runtime 未声明支持原生文档输入，文档已退化为路径提示。",
            assetId: "asset-document-2",
          },
        ],
        capabilityMatrix: {
          modelCapabilities: {
            nativeTextInput: true,
            nativeImageInput: true,
            nativeDocumentInput: true,
            supportedDocumentMimeTypes: ["application/pdf"],
          },
          transportCapabilities: {
            nativeTextInput: true,
            nativeImageInput: true,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
          },
          effectiveCapabilities: {
            nativeTextInput: true,
            nativeImageInput: true,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
          },
          assetFacts: [
            {
              assetId: "asset-document-2",
              kind: "document",
              mimeType: "application/pdf",
              localPathStatus: "ready",
              modelNativeSupport: true,
              transportNativeSupport: false,
              effectiveNativeSupport: false,
              modelMimeTypeSupported: true,
              transportMimeTypeSupported: null,
              effectiveMimeTypeSupported: null,
              handling: "path_fallback",
            },
          ],
        },
      },
      createdAt: "2026-04-02T09:00:00.000Z",
    });
    runtimeStore.appendTaskEvent({
      eventId: "event-runtime-1",
      taskId: "task-2",
      requestId: "request-2",
      type: "task.started",
      status: "running",
      message: "Task started",
      payload: {
        session: {
          threadId: "thread-2",
        },
      },
      timestamp: "2026-04-02T09:00:01.000Z",
    });
    writeFileSync(
      join(root, "infra", "local", "feishu-attachment-drafts.json"),
      JSON.stringify(
        {
          version: 1,
          drafts: [
            {
              key: "chat-1::user-1::session-1",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              parts: [],
              assets: [],
              attachments: [],
              createdAt: "2026-04-02T08:00:00.000Z",
              updatedAt: "2026-04-02T08:00:00.000Z",
              expiresAt: "2026-04-02T09:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(root, "infra", "local", "feishu-diagnostics.json"),
      JSON.stringify(
        {
          version: 1,
          conversations: [
            {
              key: "chat-1::user-1",
              chatId: "chat-1",
              userId: "user-1",
              principalId: "principal-1",
              activeSessionId: "session-1",
              lastMessageId: "message-1",
              lastEventType: "message.created",
              updatedAt: "2026-04-02T08:00:00.000Z",
              pendingActions: [
                {
                  actionId: "action-1",
                  actionType: "approval",
                  taskId: "task-1",
                  requestId: "request-1",
                  sourceChannel: "feishu",
                  sessionId: "session-1",
                  principalId: "principal-1",
                },
              ],
            },
            {
              key: "chat-2::user-2",
              chatId: "chat-2",
              userId: "user-2",
              principalId: "principal-2",
              activeSessionId: "session-2",
              lastMessageId: "message-2",
              lastEventType: "message.received",
              updatedAt: "2026-04-02T09:00:00.000Z",
              pendingActions: [
                {
                  actionId: "action-2",
                  actionType: "user-input",
                  taskId: "task-2",
                  requestId: "request-2",
                  sourceChannel: "feishu",
                  sessionId: "session-2",
                  principalId: "principal-2",
                },
              ],
            },
          ],
          recentEvents: [
            {
              id: "event-1",
              type: "message.created",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              messageId: "message-1",
              actionId: "action-1",
              requestId: "request-1",
              summary: "收到第一条消息",
              createdAt: "2026-04-02T08:00:01.000Z",
            },
            {
              id: "event-2",
              type: "task.progress",
              chatId: "chat-2",
              userId: "user-2",
              sessionId: "session-2",
              principalId: "principal-2",
              summary: "任务仍在推进",
              createdAt: "2026-04-02T09:00:01.000Z",
            },
            {
              id: "event-3",
              type: "task.progress",
              chatId: "chat-2",
              userId: "user-2",
              sessionId: "session-2",
              principalId: "principal-2",
              summary: "第三条",
              createdAt: "2026-04-02T09:00:02.000Z",
            },
            {
              id: "event-4",
              type: "task.progress",
              chatId: "chat-2",
              userId: "user-2",
              sessionId: "session-2",
              principalId: "principal-2",
              summary: "第四条",
              createdAt: "2026-04-02T09:00:03.000Z",
            },
            {
              id: "event-5",
              type: "task.progress",
              chatId: "chat-2",
              userId: "user-2",
              sessionId: "session-2",
              principalId: "principal-2",
              summary: "第五条",
              createdAt: "2026-04-02T09:00:04.000Z",
            },
            {
              id: "event-6",
              type: "task.progress",
              chatId: "chat-2",
              userId: "user-2",
              sessionId: "session-2",
              principalId: "principal-2",
              summary: "第六条",
              createdAt: "2026-04-02T09:00:05.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      runtimeStore,
      baseUrl: "https://example.com",
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.deepEqual(result.diagnostics.store, {
      path: "infra/local/feishu-diagnostics.json",
      status: "ok",
    });
    assert.deepEqual(result.diagnostics.currentConversation, {
      key: "chat-2::user-2",
      chatId: "chat-2",
      userId: "user-2",
      principalId: "principal-2",
      activeSessionId: "session-2",
      threadId: "thread-2",
      threadStatus: "running",
      multimodalSampleCount: 2,
      multimodalWarningCodeCounts: [
        {
          code: "DOCUMENT_NATIVE_INPUT_FALLBACK",
          count: 1,
        },
        {
          code: "IMAGE_NATIVE_INPUT_REQUIRED",
          count: 1,
        },
      ],
      lastMultimodalInput: {
        requestId: "request-2",
        assetCount: 1,
        assetKinds: ["document"],
        runtimeTarget: "app-server",
        degradationLevel: "controlled_fallback",
        warningCodes: ["DOCUMENT_NATIVE_INPUT_FALLBACK"],
        warningMessages: ["当前 runtime 未声明支持原生文档输入，文档已退化为路径提示。"],
        capabilityMatrix: {
          modelCapabilities: {
            nativeTextInput: true,
            nativeImageInput: true,
            nativeDocumentInput: true,
            supportedDocumentMimeTypes: ["application/pdf"],
          },
          transportCapabilities: {
            nativeTextInput: true,
            nativeImageInput: true,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
          },
          effectiveCapabilities: {
            nativeTextInput: true,
            nativeImageInput: true,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
          },
          assetFacts: [
            {
              assetId: "asset-document-2",
              kind: "document",
              mimeType: "application/pdf",
              localPathStatus: "ready",
              modelNativeSupport: true,
              transportNativeSupport: false,
              effectiveNativeSupport: false,
              modelMimeTypeSupported: true,
              transportMimeTypeSupported: null,
              effectiveMimeTypeSupported: null,
              handling: "path_fallback",
            },
          ],
        },
        createdAt: "2026-04-02T09:00:00.000Z",
      },
      lastBlockedMultimodalInput: {
        requestId: "request-2-blocked",
        assetCount: 1,
        assetKinds: ["image"],
        runtimeTarget: "codex-sdk",
        degradationLevel: "blocked",
        warningCodes: ["IMAGE_NATIVE_INPUT_REQUIRED"],
        warningMessages: ["当前 runtime 不支持 native image input。"],
        capabilityMatrix: {
          modelCapabilities: null,
          transportCapabilities: {
            nativeTextInput: true,
            nativeImageInput: false,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
          },
          effectiveCapabilities: {
            nativeTextInput: true,
            nativeImageInput: false,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
          },
          assetFacts: [
            {
              assetId: "asset-image-2-blocked",
              kind: "image",
              mimeType: "image/png",
              localPathStatus: "ready",
              modelNativeSupport: null,
              transportNativeSupport: false,
              effectiveNativeSupport: false,
              modelMimeTypeSupported: null,
              transportMimeTypeSupported: null,
              effectiveMimeTypeSupported: null,
              handling: "blocked",
            },
          ],
        },
        createdAt: "2026-04-02T08:59:30.000Z",
      },
      lastMessageId: "message-2",
      lastEventType: "message.received",
      pendingActionCount: 1,
      pendingActions: [
        {
          actionId: "action-2",
          actionType: "user-input",
          taskId: "task-2",
          requestId: "request-2",
          sourceChannel: "feishu",
          sessionId: "session-2",
          principalId: "principal-2",
        },
      ],
      updatedAt: "2026-04-02T09:00:00.000Z",
    });
    assert.equal(result.diagnostics.currentConversation?.pendingActionCount, 1);
    assert.deepEqual(result.diagnostics.currentConversation?.pendingActions, [
      {
        actionId: "action-2",
        actionType: "user-input",
        taskId: "task-2",
        requestId: "request-2",
        sourceChannel: "feishu",
        sessionId: "session-2",
        principalId: "principal-2",
      },
    ]);
    assert.deepEqual(result.diagnostics.recentEvents[0], {
      id: "event-2",
      type: "task.progress",
      chatId: "chat-2",
      userId: "user-2",
      sessionId: "session-2",
      principalId: "principal-2",
      messageId: null,
      actionId: null,
      requestId: null,
      summary: "任务仍在推进",
      createdAt: "2026-04-02T09:00:01.000Z",
    });
    assert.deepEqual(result.diagnostics.recentEvents.map((event) => event.id), [
      "event-2",
      "event-3",
      "event-4",
      "event-5",
      "event-6",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function normalizeFetchInput(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

test("readFeishuDiagnosticsSnapshot 在没有 runtimeStore 时会在 sqlite 文件存在时读取 thread summary", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-sqlite-fallback-"));
  const sqliteFilePath = join(root, "infra", "local", "themis.db");
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: sqliteFilePath,
  });

  try {
    mkdirSync(join(root, "infra", "local"), { recursive: true });
    writeFileSync(
      join(root, "infra", "local", "feishu-diagnostics.json"),
      JSON.stringify(
        {
          version: 1,
          conversations: [
            {
              key: "chat-1::user-1",
              chatId: "chat-1",
              userId: "user-1",
              principalId: "principal-1",
              activeSessionId: "session-1",
              lastMessageId: "message-1",
              lastEventType: "message.created",
              updatedAt: "2026-04-02T10:00:00.000Z",
              pendingActions: [],
            },
          ],
          recentEvents: [],
        },
        null,
        2,
      ),
      "utf8",
    );
    runtimeStore.saveSession({
      sessionId: "session-1",
      threadId: "thread-fallback-1",
      createdAt: "2026-04-02T10:00:00.000Z",
      updatedAt: "2026-04-02T10:00:00.000Z",
    });
    runtimeStore.upsertTurnFromRequest(createFeishuTaskRequest("session-1", "request-fallback-1"), "task-fallback-1");
    runtimeStore.appendTaskEvent({
      eventId: "event-fallback-1",
      taskId: "task-fallback-1",
      requestId: "request-fallback-1",
      type: "task.started",
      status: "running",
      message: "Task started",
      payload: {
        session: {
          threadId: "thread-fallback-1",
        },
      },
      timestamp: "2026-04-02T10:00:01.000Z",
    });

    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      sqliteFilePath,
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(result.diagnostics.currentConversation?.threadId, "thread-fallback-1");
    assert.equal(result.diagnostics.currentConversation?.threadStatus, "running");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function waitForReject(timeoutMs: number, message: string): Promise<never> {
  await new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    timer.unref?.();
  });
  throw new Error(message);
}

function createFeishuTaskRequest(sessionId: string, requestId: string): TaskRequest {
  return {
    requestId,
    taskId: requestId.replace("request", "task"),
    sourceChannel: "feishu",
    user: {
      userId: "user-1",
    },
    goal: "diagnostics",
    channelContext: {
      sessionId,
    },
    createdAt: "2026-04-02T09:00:00.000Z",
  };
}
