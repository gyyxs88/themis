import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { FeishuChannelService } from "../channels/feishu/service.js";
import { FeishuSessionStore } from "../channels/feishu/session-store.js";
import { AppServerActionBridge } from "../core/app-server-action-bridge.js";
import { AppServerTaskRuntime, type AppServerTaskRuntimeSession } from "../core/app-server-task-runtime.js";
import type { CodexAuthRuntime } from "../core/codex-auth.js";
import type { CodexTaskRuntime } from "../core/codex-runtime.js";
import { IdentityLinkService } from "../core/identity-link-service.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type {
  PrincipalTaskSettings,
  TaskRequest,
  TaskRuntimeFacade,
  TaskRuntimeRegistry,
  TaskRuntimeThreadSnapshot,
} from "../types/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface CrossChannelJourneyThreadState {
  preview: string;
  turns: Array<{
    turnId: string;
    status: string;
  }>;
}

interface CrossChannelApprovalPlanEntry {
  serverRequestId: string;
  approvalId?: string;
  turnId: string;
  itemId: string;
  command?: string;
  reason?: string;
  actionType?: "approval" | "user-input";
  questionId?: string;
  questionText?: string;
  waitForGate?: Promise<void>;
}

interface CrossChannelJourneyState {
  started: Array<{ threadId: string; cwd: string }>;
  resumed: Array<{ threadId: string; cwd: string }>;
  prompts: Array<{ threadId: string; prompt: string }>;
  read: Array<{ threadId: string; includeTurns: boolean }>;
  reviews: Array<{ threadId: string; instructions: string }>;
  steers: Array<{ threadId: string; turnId: string; message: string }>;
  approvalPlan: CrossChannelApprovalPlanEntry[];
  approvals: Array<{ id: string | number; method: string }>;
  respondedApprovals: Array<{ id: string | number; result: unknown }>;
  notificationHandler: ((notification: { method: string; params?: unknown }) => void) | null;
  serverRequestHandler: ((request: { id: string | number; method: string; params?: unknown }) => void) | null;
  resolveApproval: (() => void) | null;
  nextThreadNumber: number;
  nextTurnNumber: number;
  threads: Map<string, CrossChannelJourneyThreadState>;
}

interface HistorySessionDetailPayload {
  nativeThread?: {
    threadId?: string;
    preview?: string;
    turnCount?: number;
  };
  turns?: Array<{
    goal?: string;
    status?: string;
    taskId?: string;
    requestId?: string;
    events?: Array<{
      type?: string;
      taskId?: string;
      requestId?: string;
      payloadJson?: string;
    }>;
  }>;
}

interface CrossChannelTestContext {
  baseUrl: string;
  root: string;
  runtimeStore: SqliteCodexSessionRegistry;
  authHeaders: Record<string, string>;
  appServerJourneyState: CrossChannelJourneyState;
  feishu: ReturnType<typeof createFeishuDriver>;
  seedRunningAppServerSession: (
    sessionId: string,
    input: {
      threadId?: string;
      turnId?: string;
      sourceChannel?: "web" | "feishu";
      goal?: string;
      summary?: string;
    },
  ) => { threadId: string; turnId: string };
  seedWaitingAppServerSession: (
    sessionId: string,
    input: {
      threadId?: string;
      turnId?: string;
      sourceChannel?: "web" | "feishu";
      goal?: string;
      summary?: string;
      actionId: string;
      actionType?: "approval" | "user-input";
      prompt?: string;
      choices?: string[];
      userId?: string;
    },
  ) => {
    threadId: string;
    turnId: string;
    taskId: string;
    requestId: string;
    actionId: string;
  };
}

interface WithWebAndFeishuServerOptions {
  appServerApprovalPlan?: CrossChannelApprovalPlanEntry[];
}

test("真实 Web / 飞书跨端旅程会在 Feishu /use 后复用同一 app-server native thread，并保持 history 连续", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, runtimeStore, appServerJourneyState, feishu }) => {
    const sessionId = "session-web-feishu-cross-1";
    const firstGoal = "请从 Web 发起跨端任务";
    const secondGoal = "请从飞书继续推进这个任务";

    const taskResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: firstGoal,
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(taskResponse.status, 200);
    const ndjson = parseNdjson(await taskResponse.text());
    assert.deepEqual(ndjson.slice(0, 1).map((line) => line.kind), ["ack"]);
    assert.ok(ndjson.some((line) => line.kind === "result"));
    assert.deepEqual(ndjson.slice(-1).map((line) => line.kind), ["done"]);

    const threadId = runtimeStore.getSession(sessionId)?.threadId;
    assert.ok(threadId);
    assert.equal(appServerJourneyState.started.length, 1);
    assert.equal(appServerJourneyState.started[0]?.threadId, threadId);
    assert.equal(appServerJourneyState.resumed.length, 0);

    await feishu.handleCommand("use", [sessionId]);
    const useReplies = feishu.takeMessages();
    assert.equal(useReplies.length, 2);
    assert.match(useReplies.join("\n"), new RegExp(sessionId));
    assert.match(useReplies.join("\n"), new RegExp(threadId));

    await feishu.handleIncomingText(secondGoal);
    feishu.takeMessages();

    assert.equal(appServerJourneyState.started.length, 1);
    assert.equal(appServerJourneyState.resumed.length, 1);
    assert.equal(appServerJourneyState.resumed[0]?.threadId, threadId);
    assert.deepEqual(appServerJourneyState.prompts.map((entry) => entry.prompt), [firstGoal, secondGoal]);

    const historyDetailResponse = await fetch(`${baseUrl}/api/history/sessions/${sessionId}`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(historyDetailResponse.status, 200);

    const historyDetailPayload = await historyDetailResponse.json() as {
      nativeThread?: {
        threadId?: string;
        preview?: string;
        turnCount?: number;
      };
      turns?: Array<{
        goal?: string;
        status?: string;
      }>;
    };

    assert.equal(historyDetailPayload.turns?.length, 2);
    assert.deepEqual(historyDetailPayload.turns?.map((turn) => turn.goal), [firstGoal, secondGoal]);
    assert.deepEqual(historyDetailPayload.nativeThread, {
      threadId,
      preview: "cross-channel native preview",
      turnCount: 2,
    });
  });
});

test("真实飞书消息事件入口会让 Web 创建的 session 在 /use 后继续普通文本并复用同一 native thread", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, runtimeStore, appServerJourneyState, feishu }) => {
    const sessionId = "session-web-feishu-event-continue-1";
    const firstGoal = "请由 Web 先建立共享线程";
    const secondGoal = "请由飞书真实消息事件继续这条线程";

    const taskResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: firstGoal,
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(taskResponse.status, 200);
    parseNdjson(await taskResponse.text());

    const threadId = runtimeStore.getSession(sessionId)?.threadId;
    assert.ok(threadId);

    await feishu.receiveTextMessage(`/use ${sessionId}`, {
      messageId: "message-cross-event-use-1",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    feishu.takeMessages();

    await feishu.receiveTextMessage(secondGoal, {
      messageId: "message-cross-event-continue-1",
    });

    await waitFor(() => appServerJourneyState.resumed.length === 1 && appServerJourneyState.prompts.length === 2);

    const historyDetailPayload = await waitForHistoryTurnCount(baseUrl, authHeaders, sessionId, 2);
    assert.equal(appServerJourneyState.resumed[0]?.threadId, threadId);
    assert.deepEqual(appServerJourneyState.prompts.map((entry) => entry.prompt), [firstGoal, secondGoal]);
    assert.equal(historyDetailPayload.nativeThread?.threadId, threadId);
    assert.equal(historyDetailPayload.nativeThread?.turnCount, 2);
  });
});

test("真实飞书消息事件入口会忽略重复 messageId 的普通文本任务，不会重复启动同一 turn", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, runtimeStore, appServerJourneyState, feishu }) => {
    const sessionId = "session-web-feishu-event-dedupe-task-1";
    const firstGoal = "请由 Web 先建立一个用于去重验证的会话";
    const secondGoal = "请由飞书继续这条线程，但同一消息只算一次";

    const taskResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: firstGoal,
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(taskResponse.status, 200);
    parseNdjson(await taskResponse.text());

    const threadId = runtimeStore.getSession(sessionId)?.threadId;
    assert.ok(threadId);

    await feishu.receiveTextMessage(`/use ${sessionId}`, {
      messageId: "message-cross-event-dedupe-use-1",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    feishu.takeMessages();

    const duplicateMessageId = "message-cross-event-dedupe-task-1";
    await feishu.receiveTextMessage(secondGoal, {
      messageId: duplicateMessageId,
    });
    await feishu.receiveTextMessage(secondGoal, {
      messageId: duplicateMessageId,
    });

    await waitFor(() => appServerJourneyState.resumed.length === 1 && appServerJourneyState.prompts.length === 2);
    const historyDetailPayload = await waitForHistoryTurnCount(baseUrl, authHeaders, sessionId, 2);

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 80);
      timer.unref?.();
    });

    assert.equal(appServerJourneyState.resumed.length, 1);
    assert.deepEqual(appServerJourneyState.prompts.map((entry) => entry.prompt), [firstGoal, secondGoal]);
    assert.equal(historyDetailPayload.nativeThread?.threadId, threadId);
    assert.equal(historyDetailPayload.nativeThread?.turnCount, 2);
    assert.equal((await readHistoryDetail(baseUrl, authHeaders, sessionId)).turns?.length, 2);
  });
});

test("真实飞书消息事件入口会忽略 create_time 更旧的延迟普通文本，不会追加过时 turn", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, runtimeStore, appServerJourneyState, feishu }) => {
    const sessionId = "session-web-feishu-event-stale-text-1";
    const firstGoal = "请由 Web 先建立一个用于延迟投递验证的会话";
    const secondGoal = "请由飞书较新的文本继续这条线程";
    const staleGoal = "这是一条更旧但晚到的文本，不应该再追加 turn";

    const taskResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: firstGoal,
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(taskResponse.status, 200);
    parseNdjson(await taskResponse.text());

    const threadId = runtimeStore.getSession(sessionId)?.threadId;
    assert.ok(threadId);

    await feishu.receiveTextMessage(`/use ${sessionId}`, {
      messageId: "message-cross-event-stale-text-use-1",
      createTime: "1000",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    feishu.takeMessages();

    await feishu.receiveTextMessage(secondGoal, {
      messageId: "message-cross-event-stale-text-new-1",
      createTime: "3000",
    });
    await waitFor(() => appServerJourneyState.resumed.length === 1 && appServerJourneyState.prompts.length === 2);
    const secondTurnHistory = await waitForHistoryTurnCount(baseUrl, authHeaders, sessionId, 2);
    assert.equal(secondTurnHistory.nativeThread?.threadId, threadId);

    await feishu.receiveTextMessage(staleGoal, {
      messageId: "message-cross-event-stale-text-old-1",
      createTime: "2000",
    });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 120);
      timer.unref?.();
    });

    const finalHistory = await readHistoryDetail(baseUrl, authHeaders, sessionId);
    assert.equal(finalHistory.nativeThread?.threadId, threadId);
    assert.equal(finalHistory.nativeThread?.turnCount, 2);
    assert.equal(finalHistory.turns?.length, 2);
    assert.deepEqual(appServerJourneyState.prompts.map((entry) => entry.prompt), [firstGoal, secondGoal]);
  });
});

test("真实飞书消息事件入口不会因为 create_time 相等而误丢后一条普通文本，并保持 history/detail 稳定", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, runtimeStore, appServerJourneyState, feishu }) => {
    const sessionId = "session-web-feishu-event-same-create-time-1";
    const firstGoal = "请由 Web 先建立同秒顺序验证会话";
    const secondGoal = "请处理同秒第一条飞书消息";
    const thirdGoal = "请处理同秒第二条飞书消息";

    const taskResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: firstGoal,
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(taskResponse.status, 200);
    parseNdjson(await taskResponse.text());

    const threadId = runtimeStore.getSession(sessionId)?.threadId;
    assert.ok(threadId);

    await feishu.receiveTextMessage(`/use ${sessionId}`, {
      messageId: "message-cross-event-same-create-time-use-1",
      createTime: "3000",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    feishu.takeMessages();

    await feishu.receiveTextMessage(secondGoal, {
      messageId: "message-cross-event-same-create-time-second-1",
      createTime: "4000",
    });
    await waitFor(() => appServerJourneyState.resumed.length === 1 && appServerJourneyState.prompts.length === 2);

    await feishu.receiveTextMessage(thirdGoal, {
      messageId: "message-cross-event-same-create-time-third-1",
      createTime: "4000",
    });
    await waitFor(() => appServerJourneyState.resumed.length === 2 && appServerJourneyState.prompts.length === 3);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const historyDetail = await waitForHistoryTurnCount(baseUrl, authHeaders, sessionId, 3);
      assert.equal(historyDetail.nativeThread?.threadId, threadId);
      assert.equal(historyDetail.nativeThread?.turnCount, 3);
      assert.deepEqual(historyDetail.turns?.map((turn) => turn.goal), [firstGoal, secondGoal, thirdGoal]);
      assert.deepEqual(historyDetail.turns?.map((turn) => turn.status), ["completed", "completed", "completed"]);
    }

    assert.deepEqual(appServerJourneyState.prompts.map((entry) => entry.prompt), [firstGoal, secondGoal, thirdGoal]);
  });
});

test("真实 Web / 飞书跨端旅程会让 Feishu /review 命中 Web 创建的同一 app-server thread", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, runtimeStore, appServerJourneyState, feishu }) => {
    const sessionId = "session-web-feishu-review-1";
    const goal = "请从 Web 创建一个可复核会话";
    const instructions = "请从飞书对这个 web 会话发起 review";

    const taskResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal,
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(taskResponse.status, 200);
    parseNdjson(await taskResponse.text());

    const threadId = runtimeStore.getSession(sessionId)?.threadId;
    assert.ok(threadId);

    await feishu.handleCommand("use", [sessionId]);
    feishu.takeMessages();

    await feishu.handleCommand("review", [instructions]);
    const reviewReply = feishu.takeSingleMessage();
    assert.match(reviewReply, new RegExp(sessionId));
    assert.match(reviewReply, /Review 线程/);
    assert.deepEqual(appServerJourneyState.reviews, [{
      threadId,
      instructions,
    }]);

    const historyDetailResponse = await fetch(`${baseUrl}/api/history/sessions/${sessionId}`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(historyDetailResponse.status, 200);
    const historyDetailPayload = await historyDetailResponse.json() as {
      nativeThread?: {
        threadId?: string;
      };
    };
    assert.equal(historyDetailPayload.nativeThread?.threadId, threadId);
  });
});

test("真实飞书消息事件入口会让 Web 创建的 completed session 在 /use 后通过 /review 命中同一 app-server thread", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, runtimeStore, appServerJourneyState, feishu }) => {
    const sessionId = "session-web-feishu-event-review-1";
    const goal = "请从 Web 创建一个供真实事件 review 的会话";
    const instructions = "请从飞书真实事件入口发起 review";

    const taskResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal,
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(taskResponse.status, 200);
    parseNdjson(await taskResponse.text());

    const threadId = runtimeStore.getSession(sessionId)?.threadId;
    assert.ok(threadId);

    await feishu.receiveTextMessage(`/use ${sessionId}`, {
      messageId: "message-cross-event-review-use-1",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    feishu.takeMessages();

    await feishu.receiveTextMessage(`/review ${instructions}`, {
      messageId: "message-cross-event-review-submit-1",
    });
    await waitFor(() => appServerJourneyState.reviews.length === 1);
    await waitFor(() => feishu.peekMessages().some((message) => message.includes("Review 线程")));

    const reviewReply = feishu.takeSingleMessage();
    assert.match(reviewReply, new RegExp(sessionId));
    assert.match(reviewReply, /Review 线程/);
    assert.deepEqual(appServerJourneyState.reviews, [{
      threadId,
      instructions,
    }]);

    const historyDetailPayload = await readHistoryDetail(baseUrl, authHeaders, sessionId);
    assert.equal(historyDetailPayload.nativeThread?.threadId, threadId);
  });
});

test("真实飞书消息事件入口会忽略跨会话更旧的 /use，不会把当前会话切回去", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, feishu }) => {
    const sessionA = "session-web-feishu-stale-use-a";
    const sessionB = "session-web-feishu-stale-use-b";

    for (const [sessionId, goal] of [
      [sessionA, "请先建立会话 A"],
      [sessionB, "请再建立会话 B"],
    ] as const) {
      const response = await fetch(`${baseUrl}/api/tasks/stream`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
          goal,
          options: {
            runtimeEngine: "app-server",
          },
        }),
      });

      assert.equal(response.status, 200);
      parseNdjson(await response.text());
    }

    await feishu.receiveTextMessage(`/use ${sessionB}`, {
      messageId: "message-cross-event-stale-use-new-1",
      createTime: "3000",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    feishu.takeMessages();
    assert.equal(feishu.getCurrentSessionId(), sessionB);

    await feishu.receiveTextMessage(`/use ${sessionA}`, {
      messageId: "message-cross-event-stale-use-old-1",
      createTime: "2000",
    });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 120);
      timer.unref?.();
    });

    assert.equal(feishu.getCurrentSessionId(), sessionB);
    assert.deepEqual(feishu.peekMessages(), []);
  });
});

test("共享中的 running app-server 会话可以在 Feishu /use 后通过 /steer 命中同一 thread 的活动 turn", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, appServerJourneyState, feishu, seedRunningAppServerSession }) => {
    const sessionId = "session-web-feishu-steer-1";
    const threadId = "thread-app-cross-steer-1";
    const turnId = "turn-app-cross-steer-1";
    const steerMessage = "请在飞书端把范围收窄到主链路回归";

    seedRunningAppServerSession(sessionId, {
      threadId,
      turnId,
      sourceChannel: "web",
      goal: "seed running journey session",
      summary: "跨端 running 会话已就绪",
    });

    await feishu.handleCommand("use", [sessionId]);
    const useReplies = feishu.takeMessages();
    assert.equal(useReplies.length, 2);
    assert.match(useReplies.join("\n"), new RegExp(threadId));
    assert.match(useReplies.join("\n"), /running|进行中|已就绪/);

    await feishu.handleCommand("steer", [steerMessage]);
    const steerReply = feishu.takeSingleMessage();
    assert.match(steerReply, new RegExp(sessionId));
    assert.match(steerReply, new RegExp(turnId));
    assert.deepEqual(appServerJourneyState.steers, [{
      threadId,
      turnId,
      message: steerMessage,
    }]);
    assert.ok(appServerJourneyState.read.some((entry) => entry.threadId === threadId && entry.includeTurns));

    const historyDetailResponse = await fetch(`${baseUrl}/api/history/sessions/${sessionId}`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(historyDetailResponse.status, 200);
    const historyDetailPayload = await historyDetailResponse.json() as {
      nativeThread?: {
        threadId?: string;
        turnCount?: number;
      };
      turns?: Array<{
        status?: string;
      }>;
    };
    assert.equal(historyDetailPayload.nativeThread?.threadId, threadId);
    assert.equal(historyDetailPayload.nativeThread?.turnCount, 1);
    assert.equal(historyDetailPayload.turns?.[0]?.status, "running");
  });
});

test("真实飞书消息事件入口会让 shared running session 在 /use 后通过 /steer 命中同一活动 turn", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, appServerJourneyState, feishu, seedRunningAppServerSession }) => {
    const sessionId = "session-web-feishu-event-steer-1";
    const threadId = "thread-app-cross-event-steer-1";
    const turnId = "turn-app-cross-event-steer-1";
    const steerMessage = "请从真实飞书事件入口继续收窄回归范围";

    seedRunningAppServerSession(sessionId, {
      threadId,
      turnId,
      sourceChannel: "web",
      goal: "seed running event-entry session",
      summary: "跨端 running 会话已就绪，等待真实事件 steer",
    });

    await feishu.receiveTextMessage(`/use ${sessionId}`, {
      messageId: "message-cross-event-steer-use-1",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    const useReplies = feishu.takeMessages();
    assert.match(useReplies.join("\n"), new RegExp(threadId));
    assert.match(useReplies.join("\n"), /running|进行中|已就绪/);

    await feishu.receiveTextMessage(`/steer ${steerMessage}`, {
      messageId: "message-cross-event-steer-submit-1",
    });
    await waitFor(() => appServerJourneyState.steers.length === 1);
    await waitFor(() => feishu.peekMessages().some((message) => message.includes(turnId)));

    const steerReply = feishu.takeSingleMessage();
    assert.match(steerReply, new RegExp(sessionId));
    assert.match(steerReply, new RegExp(turnId));
    assert.deepEqual(appServerJourneyState.steers, [{
      threadId,
      turnId,
      message: steerMessage,
    }]);
    assert.ok(appServerJourneyState.read.some((entry) => entry.threadId === threadId && entry.includeTurns));

    const historyDetailPayload = await readHistoryDetail(baseUrl, authHeaders, sessionId);
    assert.equal(historyDetailPayload.nativeThread?.threadId, threadId);
    assert.equal(historyDetailPayload.nativeThread?.turnCount, 1);
    assert.equal(historyDetailPayload.turns?.[0]?.status, "running");
  });
});

test("飞书发起的 waiting action 可以由 Web /api/tasks/actions 恢复收口，并保持同一 native thread", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, appServerJourneyState, feishu }) => {
    const taskPromise = feishu.handleIncomingText("请等待审批后再继续这个飞书任务");

    await waitFor(() => feishu.peekMessages().some((message) => message.includes("/approve approval-cross-feishu-web-1")));

    const sessionId = feishu.getCurrentSessionId();
    assert.ok(sessionId);

    const waitingHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "waiting");
    const restoredAction = extractActionRequiredFromHistory(waitingHistory);

    assert.ok(restoredAction);
    assert.equal(restoredAction.actionId, "approval-cross-feishu-web-1");

    const actionSubmitResponse = await fetch(`${baseUrl}/api/tasks/actions`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskId: restoredAction.taskId,
        requestId: restoredAction.requestId,
        actionId: restoredAction.actionId,
        decision: "approve",
      }),
    });

    assert.equal(actionSubmitResponse.status, 200);
    assert.deepEqual(await actionSubmitResponse.json(), {
      ok: true,
    });

    await taskPromise;

    const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    assert.equal(completedHistory.nativeThread?.threadId, appServerJourneyState.started[0]?.threadId);
    assert.equal(completedHistory.nativeThread?.turnCount, 1);
  }, {
    appServerApprovalPlan: [{
      serverRequestId: "server-cross-feishu-web-1",
      approvalId: "approval-cross-feishu-web-1",
      turnId: "turn-cross-feishu-web-1",
      itemId: "item-cross-feishu-web-1",
      command: "npm test",
      reason: "Need approval from web",
    }],
  });
});

test("真实飞书消息事件入口会忽略重复 messageId 的 /approve，不会重复提交同一 waiting action", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, appServerJourneyState, feishu }) => {
    await feishu.receiveTextMessage("请等待审批后再继续这个飞书去重任务", {
      messageId: "message-cross-event-dedupe-approve-start-1",
    });

    await waitFor(() => feishu.peekMessages().some((message) => message.includes("/approve approval-cross-feishu-dedupe-1")));
    const sessionId = feishu.getCurrentSessionId();
    assert.ok(sessionId);

    feishu.takeMessages();
    const duplicateMessageId = "message-cross-event-dedupe-approve-submit-1";
    await feishu.receiveTextMessage("/approve approval-cross-feishu-dedupe-1", {
      messageId: duplicateMessageId,
    });
    await feishu.receiveTextMessage("/approve approval-cross-feishu-dedupe-1", {
      messageId: duplicateMessageId,
    });

    const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 80);
      timer.unref?.();
    });

    assert.equal(completedHistory.turns?.[0]?.status, "completed");
    assert.deepEqual(appServerJourneyState.respondedApprovals, [{
      id: "server-cross-feishu-dedupe-1",
      result: {
        decision: "accept",
      },
    }]);
    assert.ok(feishu.peekMessages().some((message) => message.includes("已提交审批")));
  }, {
    appServerApprovalPlan: [{
      serverRequestId: "server-cross-feishu-dedupe-1",
      approvalId: "approval-cross-feishu-dedupe-1",
      turnId: "turn-cross-feishu-dedupe-1",
      itemId: "item-cross-feishu-dedupe-1",
      command: "npm test",
      reason: "Need approval dedupe",
    }],
  });
});

test("真实飞书消息事件入口会忽略 create_time 更旧的延迟 /approve，不会重复提交或产生噪音", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, appServerJourneyState, feishu }) => {
    await feishu.receiveTextMessage("请等待审批后再继续这个飞书延迟命令任务", {
      messageId: "message-cross-event-stale-approve-start-1",
      createTime: "1000",
    });

    await waitFor(() => feishu.peekMessages().some((message) => message.includes("/approve approval-cross-feishu-stale-1")));
    const sessionId = feishu.getCurrentSessionId();
    assert.ok(sessionId);

    feishu.takeMessages();
    await feishu.receiveTextMessage("/approve approval-cross-feishu-stale-1", {
      messageId: "message-cross-event-stale-approve-new-1",
      createTime: "3000",
    });
    await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    const messagesAfterApprove = feishu.takeMessages();
    assert.ok(messagesAfterApprove.some((message) => message.includes("已提交审批")));

    await feishu.receiveTextMessage("/approve approval-cross-feishu-stale-1", {
      messageId: "message-cross-event-stale-approve-old-1",
      createTime: "2000",
    });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 120);
      timer.unref?.();
    });

    assert.deepEqual(appServerJourneyState.respondedApprovals, [{
      id: "server-cross-feishu-stale-1",
      result: {
        decision: "accept",
      },
    }]);
    assert.deepEqual(feishu.peekMessages(), []);
  }, {
    appServerApprovalPlan: [{
      serverRequestId: "server-cross-feishu-stale-1",
      approvalId: "approval-cross-feishu-stale-1",
      turnId: "turn-cross-feishu-stale-1",
      itemId: "item-cross-feishu-stale-1",
      command: "npm test",
      reason: "Need stale command approval",
    }],
  });
});

test("真实飞书消息事件入口会忽略 create_time 更旧的延迟 /reply，不会重复提交或产生噪音", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, appServerJourneyState, feishu }) => {
    await feishu.receiveTextMessage("请等待我补充输入后再继续这个飞书延迟回复任务", {
      messageId: "message-cross-event-stale-reply-start-1",
      createTime: "1000",
    });

    await waitFor(() => feishu.peekMessages().some((message) => message.includes("/reply reply-cross-feishu-stale-1")));
    const sessionId = feishu.getCurrentSessionId();
    assert.ok(sessionId);

    feishu.takeMessages();
    await feishu.receiveTextMessage("/reply reply-cross-feishu-stale-1 这是新的补充输入", {
      messageId: "message-cross-event-stale-reply-new-1",
      createTime: "3000",
    });
    await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    const messagesAfterReply = feishu.takeMessages();
    assert.ok(messagesAfterReply.some((message) => message.includes("已提交补充输入")));

    await feishu.receiveTextMessage("/reply reply-cross-feishu-stale-1 这是晚到的旧补充输入", {
      messageId: "message-cross-event-stale-reply-old-1",
      createTime: "2000",
    });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 120);
      timer.unref?.();
    });

    assert.deepEqual(appServerJourneyState.respondedApprovals, [{
      id: "server-cross-feishu-stale-reply-1",
      result: {
        answers: {
          followup: {
            answers: ["这是新的补充输入"],
          },
        },
      },
    }]);
    assert.deepEqual(feishu.peekMessages(), []);
  }, {
    appServerApprovalPlan: [{
      serverRequestId: "server-cross-feishu-stale-reply-1",
      turnId: "turn-cross-feishu-stale-reply-1",
      itemId: "reply-cross-feishu-stale-1",
      actionType: "user-input",
      questionId: "followup",
      questionText: "请补充你希望我下一步怎么做？",
      reason: "Need stale reply",
    }],
  });
});

test("Web 发起的 waiting action 在飞书 /use 后可以直接通过 /approve 接管并恢复", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, feishu }) => {
    const sessionId = "session-web-feishu-action-boundary-1";

    const streamResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: "请等待审批后让我从飞书尝试接管",
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(streamResponse.status, 200);
    assert.ok(streamResponse.body);

    const reader = createNdjsonStreamReader(streamResponse.body!);
    const partialLines = await withTimeout(
      reader.readUntil((lines) => lines.some((line) => line.kind === "event" && line.title === "task.action_required")),
      "missing cross-channel web action_required",
    );
    const actionRequiredLine = partialLines.find(
      (line) => line.kind === "event" && line.title === "task.action_required",
    );

    assert.ok(actionRequiredLine);
    assert.equal(actionRequiredLine?.metadata?.actionId, "approval-cross-web-feishu-1");
    await reader.cancel();

    const waitingHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "waiting");
    const restoredAction = extractActionRequiredFromHistory(waitingHistory);
    assert.ok(restoredAction);
    assert.equal(restoredAction.actionId, "approval-cross-web-feishu-1");

    await feishu.handleCommand("use", [sessionId]);
    feishu.takeMessages();

    await feishu.handleCommand("approve", ["approval-cross-web-feishu-1"]);
    assert.match(feishu.takeSingleMessage(), /已提交审批/);

    const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    assert.equal(completedHistory.nativeThread?.turnCount, 1);
  }, {
    appServerApprovalPlan: [{
      serverRequestId: "server-cross-web-feishu-1",
      approvalId: "approval-cross-web-feishu-1",
      turnId: "turn-cross-web-feishu-1",
      itemId: "item-cross-web-feishu-1",
      command: "rm -rf tmp",
      reason: "Need approval from web starter",
    }],
  });
});

test("真实飞书消息事件入口会让 Web waiting action 在 /use 后通过 /approve 接管并恢复", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, feishu }) => {
    const sessionId = "session-web-feishu-event-approve-1";

    const streamResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: "请等待审批后让我从飞书真实事件入口接管",
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(streamResponse.status, 200);
    assert.ok(streamResponse.body);

    const reader = createNdjsonStreamReader(streamResponse.body!);
    const partialLines = await withTimeout(
      reader.readUntil((lines) => lines.some((line) => line.kind === "event" && line.title === "task.action_required")),
      "missing cross-channel web event-entry approval action_required",
    );
    const actionRequiredLine = partialLines.find(
      (line) => line.kind === "event" && line.title === "task.action_required",
    );

    assert.ok(actionRequiredLine);
    assert.equal(actionRequiredLine?.metadata?.actionId, "approval-cross-web-feishu-1");
    await reader.cancel();

    await feishu.receiveTextMessage(`/use ${sessionId}`, {
      messageId: "message-cross-event-approve-use-1",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    feishu.takeMessages();

    await feishu.receiveTextMessage("/approve approval-cross-web-feishu-1", {
      messageId: "message-cross-event-approve-submit-1",
    });
    await waitFor(() => feishu.peekMessages().some((message) => message.includes("已提交审批")));
    feishu.takeMessages();

    const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    assert.equal(completedHistory.nativeThread?.turnCount, 1);
  }, {
    appServerApprovalPlan: [{
      serverRequestId: "server-cross-web-feishu-1",
      approvalId: "approval-cross-web-feishu-1",
      turnId: "turn-cross-web-feishu-1",
      itemId: "item-cross-web-feishu-1",
      command: "rm -rf tmp",
      reason: "Need approval from web starter",
    }],
  });
});

test("synthetic smoke 的 Web user-input waiting action 可以由飞书普通文本 direct-text takeover 恢复", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, feishu }) => {
    const sessionId = "session-web-feishu-smoke-user-input-1";
    const replyText = "这是 synthetic smoke 的普通文本补充输入";

    const streamResponse = await fetch(`${baseUrl}/api/tasks/smoke`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: "/smoke user-input",
        options: {
          syntheticSmokeScenario: "user-input",
        },
      }),
    });

    assert.equal(streamResponse.status, 200);
    assert.ok(streamResponse.body);

    const reader = createNdjsonStreamReader(streamResponse.body!);
    const partialLines = await withTimeout(
      reader.readUntil((lines) => lines.some((line) => line.kind === "event" && line.title === "task.action_required")),
      "missing synthetic smoke user-input action_required",
    );
    const actionRequiredLine = partialLines.find(
      (line) => line.kind === "event" && line.title === "task.action_required",
    );

    assert.ok(actionRequiredLine);
    assert.equal(actionRequiredLine?.metadata?.actionType, "user-input");
    await reader.cancel();

    const waitingHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "waiting");
    const restoredAction = extractActionRequiredFromHistory(waitingHistory);
    assert.ok(restoredAction);
    assert.equal(restoredAction.actionType, "user-input");

    await feishu.receiveTextMessage(`/use ${sessionId}`, {
      messageId: "message-cross-event-smoke-user-input-use-1",
    });
    await waitFor(() => feishu.peekMessages().some((message) => message.includes("已切换到会话")));
    feishu.takeMessages();

    await feishu.receiveTextMessage(replyText, {
      messageId: "message-cross-event-smoke-user-input-submit-1",
    });
    await waitFor(() => feishu.peekMessages().some((message) => message.includes("已提交补充输入")));
    feishu.takeMessages();

    const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    assert.equal(completedHistory.turns?.length, 1);
    assert.equal(completedHistory.turns?.[0]?.status, "completed");
    assert.ok(completedHistory.turns?.[0]?.events?.some((event) => event.type === "task.action_required"));
  });
});

test("synthetic smoke 的 Web mixed waiting action 可以由飞书 /approve 再普通文本恢复", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, feishu }) => {
    const sessionId = "session-web-feishu-smoke-mixed-1";
    const replyText = "这是 synthetic smoke mixed 的普通文本补充输入";

    const streamResponse = await fetch(`${baseUrl}/api/tasks/smoke`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: "/smoke mixed",
        options: {
          syntheticSmokeScenario: "mixed",
        },
      }),
    });

    assert.equal(streamResponse.status, 200);
    assert.ok(streamResponse.body);

    const reader = createNdjsonStreamReader(streamResponse.body!);
    const partialLines = await withTimeout(
      reader.readUntil((lines) => lines.some((line) => line.kind === "event" && line.title === "task.action_required")),
      "missing synthetic smoke mixed approval action_required",
    );
    const firstActionLine = partialLines.find(
      (line) => line.kind === "event" && line.title === "task.action_required",
    );

    assert.ok(firstActionLine);
    assert.equal(firstActionLine?.metadata?.actionType, "approval");
    await reader.cancel();

    const waitingHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "waiting");
    const approvalAction = extractActionRequiredFromHistory(waitingHistory);
    assert.ok(approvalAction);
    assert.equal(approvalAction.actionType, "approval");

    await feishu.receiveTextMessage(`/use ${sessionId}`, {
      messageId: "message-cross-event-smoke-mixed-use-1",
    });
    await waitFor(() => feishu.peekMessages().some((message) => message.includes("已切换到会话")));
    feishu.takeMessages();

    await feishu.receiveTextMessage(`/approve ${approvalAction.actionId}`, {
      messageId: "message-cross-event-smoke-mixed-approve-1",
    });
    await waitFor(() => feishu.peekMessages().some((message) => message.includes("已提交审批")));
    feishu.takeMessages();

    let inputAction: ReturnType<typeof extractActionRequiredFromHistory> = null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 1_000) {
      const historyDetail = await readHistoryDetail(baseUrl, authHeaders, sessionId);
      const waitingTurn = historyDetail.turns?.find((turn) => turn.status === "waiting");
      const latestUserInputEvent = [...(waitingTurn?.events ?? [])]
        .reverse()
        .find((event) => {
          if (event.type !== "task.action_required" || !event.payloadJson) {
            return false;
          }

          const payload = JSON.parse(event.payloadJson) as {
            actionId?: string;
            actionType?: string;
          };
          return payload.actionType === "user-input";
        });

      const taskId = latestUserInputEvent?.taskId ?? waitingTurn?.taskId;
      const requestId = latestUserInputEvent?.requestId ?? waitingTurn?.requestId;

      if (latestUserInputEvent?.payloadJson && taskId && requestId) {
        const payload = JSON.parse(latestUserInputEvent.payloadJson) as {
          actionId?: string;
          actionType?: string;
        };
        inputAction = {
          taskId,
          requestId,
          actionId: payload.actionId ?? "",
          ...(payload.actionType ? { actionType: payload.actionType } : {}),
        };
        break;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 20);
        timer.unref?.();
      });
    }

    assert.ok(inputAction);

    await feishu.receiveTextMessage(replyText, {
      messageId: "message-cross-event-smoke-mixed-submit-1",
    });
    await waitFor(() => feishu.peekMessages().some((message) => message.includes("已提交补充输入")));
    feishu.takeMessages();

    const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    assert.equal(completedHistory.turns?.length, 1);
    assert.equal(completedHistory.turns?.[0]?.status, "completed");
    assert.ok(completedHistory.turns?.[0]?.events?.filter((event) => event.type === "task.action_required").length === 2);
  });
});

test("更长的 shared cross-channel E2E 会在 Web waiting action 由飞书接管后继续追加新 turn，并保持 history/detail 一致", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, runtimeStore, appServerJourneyState, feishu }) => {
    const sessionId = "session-web-feishu-event-long-e2e-1";
    const firstGoal = "请先等待我从飞书审批，再继续共享会话";
    const secondGoal = "审批完成后请继续推进后续收口";

    const streamResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: firstGoal,
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(streamResponse.status, 200);
    assert.ok(streamResponse.body);

    const reader = createNdjsonStreamReader(streamResponse.body!);
    const partialLines = await withTimeout(
      reader.readUntil((lines) => lines.some((line) => line.kind === "event" && line.title === "task.action_required")),
      "missing shared long e2e action_required",
    );
    const actionRequiredLine = partialLines.find(
      (line) => line.kind === "event" && line.title === "task.action_required",
    );

    assert.ok(actionRequiredLine);
    assert.equal(actionRequiredLine?.metadata?.actionId, "approval-cross-web-feishu-long-e2e-1");
    await reader.cancel();

    const threadId = runtimeStore.getSession(sessionId)?.threadId;
    assert.ok(threadId);

    await feishu.receiveTextMessage(`/use ${sessionId}`, {
      messageId: "message-cross-event-long-e2e-use-1",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    feishu.takeMessages();

    await feishu.receiveTextMessage("/approve approval-cross-web-feishu-long-e2e-1", {
      messageId: "message-cross-event-long-e2e-approve-1",
    });
    await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    feishu.takeMessages();
    assert.deepEqual(appServerJourneyState.approvals.map((entry) => entry.id), [
      "server-cross-web-feishu-long-e2e-1",
    ]);
    appServerJourneyState.approvalPlan.length = 0;

    await feishu.receiveTextMessage(secondGoal, {
      messageId: "message-cross-event-long-e2e-continue-1",
    });
    await waitFor(() => appServerJourneyState.resumed.length === 1 && appServerJourneyState.prompts.length === 2);

    const historyDetailPayload = await waitForHistoryTurnCount(baseUrl, authHeaders, sessionId, 2);
    assert.equal(appServerJourneyState.started.length, 1);
    assert.equal(appServerJourneyState.resumed[0]?.threadId, threadId);
    assert.deepEqual(appServerJourneyState.prompts.map((entry) => entry.prompt), [firstGoal, secondGoal]);
    assert.equal(historyDetailPayload.nativeThread?.threadId, threadId);
    assert.equal(historyDetailPayload.nativeThread?.turnCount, 2);
    assert.deepEqual(historyDetailPayload.turns?.map((turn) => turn.status), ["completed", "completed"]);
  }, {
    appServerApprovalPlan: [{
      serverRequestId: "server-cross-web-feishu-long-e2e-1",
      approvalId: "approval-cross-web-feishu-long-e2e-1",
      turnId: "turn-cross-web-feishu-long-e2e-1",
      itemId: "item-cross-web-feishu-long-e2e-1",
      command: "npm test",
      reason: "Need cross-channel approval before continue",
    }],
  });
});

test("更长的 shared cross-channel E2E 会在 Web -> Feishu -> Web 连续三轮后保持 history/detail 一致", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, runtimeStore, appServerJourneyState, feishu }) => {
    const sessionId = "session-web-feishu-history-long-1";
    const firstGoal = "请先等待我从飞书审批，再开始这条三轮链路";
    const secondGoal = "请由飞书继续推进第二轮";
    const thirdGoal = "请由 Web 再补第三轮收口";

    const firstResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: firstGoal,
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(firstResponse.status, 200);
    assert.ok(firstResponse.body);
    const firstReader = createNdjsonStreamReader(firstResponse.body!);
    const firstPartialLines = await withTimeout(
      firstReader.readUntil((lines) => lines.some((line) => line.kind === "event" && line.title === "task.action_required")),
      "missing three-turn history action_required",
    );
    const firstActionRequiredLine = firstPartialLines.find(
      (line) => line.kind === "event" && line.title === "task.action_required",
    );
    assert.ok(firstActionRequiredLine);
    assert.equal(firstActionRequiredLine?.metadata?.actionId, "approval-cross-web-feishu-history-long-1");
    await firstReader.cancel();

    const threadId = runtimeStore.getSession(sessionId)?.threadId;
    assert.ok(threadId);

    const waitingHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "waiting");
    assert.equal(waitingHistory.nativeThread?.threadId, threadId);
    assert.deepEqual(waitingHistory.turns?.map((turn) => turn.status), ["waiting"]);

    await feishu.receiveTextMessage(`/use ${sessionId}`, {
      messageId: "message-cross-event-history-long-use-1",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    feishu.takeMessages();

    await feishu.receiveTextMessage("/approve approval-cross-web-feishu-history-long-1", {
      messageId: "message-cross-event-history-long-approve-1",
    });
    await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    feishu.takeMessages();
    appServerJourneyState.approvalPlan.length = 0;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const afterFirstTurn = await readHistoryDetail(baseUrl, authHeaders, sessionId);
      assert.equal(afterFirstTurn.nativeThread?.threadId, threadId);
      assert.equal(afterFirstTurn.nativeThread?.turnCount, 1);
      assert.deepEqual(afterFirstTurn.turns?.map((turn) => turn.status), ["completed"]);
    }

    await feishu.receiveTextMessage(secondGoal, {
      messageId: "message-cross-event-history-long-second-1",
    });
    await waitFor(() => appServerJourneyState.resumed.length === 1 && appServerJourneyState.prompts.length === 2);

    const secondHistory = await waitForHistoryTurnCount(baseUrl, authHeaders, sessionId, 2);
    assert.equal(secondHistory.nativeThread?.threadId, threadId);
    assert.equal(secondHistory.nativeThread?.turnCount, 2);
    assert.deepEqual(secondHistory.turns?.map((turn) => turn.goal), [firstGoal, secondGoal]);
    assert.deepEqual(secondHistory.turns?.map((turn) => turn.status), ["completed", "completed"]);

    const thirdResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: thirdGoal,
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(thirdResponse.status, 200);
    parseNdjson(await thirdResponse.text());

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const finalHistory = await waitForHistoryTurnCount(baseUrl, authHeaders, sessionId, 3);
      assert.equal(finalHistory.nativeThread?.threadId, threadId);
      assert.equal(finalHistory.nativeThread?.turnCount, 3);
      assert.deepEqual(finalHistory.turns?.map((turn) => turn.goal), [firstGoal, secondGoal, thirdGoal]);
      assert.deepEqual(finalHistory.turns?.map((turn) => turn.status), ["completed", "completed", "completed"]);
    }

    assert.equal(appServerJourneyState.started.length, 1);
    assert.equal(appServerJourneyState.resumed.length, 2);
    assert.deepEqual(appServerJourneyState.prompts.map((entry) => entry.prompt), [firstGoal, secondGoal, thirdGoal]);
  }, {
    appServerApprovalPlan: [{
      serverRequestId: "server-cross-web-feishu-history-long-1",
      approvalId: "approval-cross-web-feishu-history-long-1",
      turnId: "turn-cross-web-feishu-history-long-1",
      itemId: "item-cross-web-feishu-history-long-1",
      command: "npm test",
      reason: "Need approval before three-turn history flow",
    }],
  });
});

test("更密集的 shared cross-channel E2E 会在 Web -> Feishu -> Web -> Feishu 连续四轮后保持 history/detail 一致", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, runtimeStore, appServerJourneyState, feishu }) => {
    const sessionId = "session-web-feishu-history-long-2";
    const firstGoal = "请先等待我从飞书审批，再开始四轮链路";
    const secondGoal = "请由飞书继续推进第二轮";
    const thirdGoal = "请由 Web 再补第三轮";
    const fourthGoal = "请由飞书完成第四轮收口";

    const firstResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: firstGoal,
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(firstResponse.status, 200);
    assert.ok(firstResponse.body);
    const firstReader = createNdjsonStreamReader(firstResponse.body!);
    const firstPartialLines = await withTimeout(
      firstReader.readUntil((lines) => lines.some((line) => line.kind === "event" && line.title === "task.action_required")),
      "missing four-turn history action_required",
    );
    const firstActionRequiredLine = firstPartialLines.find(
      (line) => line.kind === "event" && line.title === "task.action_required",
    );
    assert.ok(firstActionRequiredLine);
    assert.equal(firstActionRequiredLine?.metadata?.actionId, "approval-cross-web-feishu-history-long-2");
    await firstReader.cancel();

    const threadId = runtimeStore.getSession(sessionId)?.threadId;
    assert.ok(threadId);

    await feishu.receiveTextMessage(`/use ${sessionId}`, {
      messageId: "message-cross-event-history-long-2-use-1",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    feishu.takeMessages();

    await feishu.receiveTextMessage("/approve approval-cross-web-feishu-history-long-2", {
      messageId: "message-cross-event-history-long-2-approve-1",
    });
    await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    feishu.takeMessages();
    appServerJourneyState.approvalPlan.length = 0;

    await feishu.receiveTextMessage(secondGoal, {
      messageId: "message-cross-event-history-long-2-second-1",
    });
    await waitFor(() => appServerJourneyState.resumed.length === 1 && appServerJourneyState.prompts.length === 2);

    const thirdResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: thirdGoal,
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(thirdResponse.status, 200);
    parseNdjson(await thirdResponse.text());

    await waitFor(() => appServerJourneyState.resumed.length === 2 && appServerJourneyState.prompts.length === 3);

    await feishu.receiveTextMessage(`/use ${sessionId}`, {
      messageId: "message-cross-event-history-long-2-use-2",
      createTime: "7000",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    feishu.takeMessages();

    await feishu.receiveTextMessage(fourthGoal, {
      messageId: "message-cross-event-history-long-2-fourth-1",
      createTime: "7100",
    });
    await waitFor(() => appServerJourneyState.resumed.length === 3 && appServerJourneyState.prompts.length === 4);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const finalHistory = await waitForHistoryTurnCount(baseUrl, authHeaders, sessionId, 4);
      assert.equal(finalHistory.nativeThread?.threadId, threadId);
      assert.equal(finalHistory.nativeThread?.turnCount, 4);
      assert.deepEqual(finalHistory.turns?.map((turn) => turn.goal), [firstGoal, secondGoal, thirdGoal, fourthGoal]);
      assert.deepEqual(finalHistory.turns?.map((turn) => turn.status), ["completed", "completed", "completed", "completed"]);
    }

    assert.equal(appServerJourneyState.started.length, 1);
    assert.equal(appServerJourneyState.resumed.length, 3);
    assert.deepEqual(appServerJourneyState.prompts.map((entry) => entry.prompt), [
      firstGoal,
      secondGoal,
      thirdGoal,
      fourthGoal,
    ]);
  }, {
    appServerApprovalPlan: [{
      serverRequestId: "server-cross-web-feishu-history-long-2",
      approvalId: "approval-cross-web-feishu-history-long-2",
      turnId: "turn-cross-web-feishu-history-long-2",
      itemId: "item-cross-web-feishu-history-long-2",
      command: "npm test",
      reason: "Need approval before four-turn history flow",
    }],
  });
});

test("真实飞书消息事件入口会忽略跨会话旧 /use 与旧 /approve 的组合晚到，不会切回旧会话或制造噪音", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, feishu, seedWaitingAppServerSession }) => {
    const staleSessionId = "session-web-feishu-stale-combo-a";
    const currentSessionId = "session-web-feishu-stale-combo-b";
    const staleAction = seedWaitingAppServerSession(staleSessionId, {
      sourceChannel: "web",
      goal: "请等待我从飞书审批后再继续旧会话",
      summary: "Need cross-session stale combo approval",
      actionId: "approval-cross-web-feishu-stale-combo-1",
      prompt: "Need cross-session stale combo approval",
    });
    const restoredAction = await waitForHistoryActionId(
      baseUrl,
      authHeaders,
      staleSessionId,
      staleAction.actionId,
    );
    assert.equal(restoredAction.actionId, staleAction.actionId);

    const newerResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: currentSessionId,
        goal: "请建立当前正在进行的新会话",
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(newerResponse.status, 200);
    parseNdjson(await newerResponse.text());

    await feishu.receiveTextMessage(`/use ${currentSessionId}`, {
      messageId: "message-cross-event-stale-combo-new-use-1",
      createTime: "3000",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    feishu.takeMessages();
    assert.equal(feishu.getCurrentSessionId(), currentSessionId);

    await feishu.receiveTextMessage(`/use ${staleSessionId}`, {
      messageId: "message-cross-event-stale-combo-old-use-1",
      createTime: "2000",
    });
    await feishu.receiveTextMessage("/approve approval-cross-web-feishu-stale-combo-1", {
      messageId: "message-cross-event-stale-combo-old-approve-1",
      createTime: "2100",
    });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 120);
      timer.unref?.();
    });

    assert.equal(feishu.getCurrentSessionId(), currentSessionId);
    assert.deepEqual(feishu.peekMessages(), []);
  });
});

test("真实飞书消息事件入口会忽略跨会话旧 /use、旧普通文本与旧 /approve 的批量晚到，不会切回旧会话或制造噪音", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, runtimeStore, appServerJourneyState, feishu, seedWaitingAppServerSession }) => {
    const staleSessionId = "session-web-feishu-stale-batch-a";
    const currentSessionId = "session-web-feishu-stale-batch-b";
    const currentGoal = "请建立当前正在进行的新会话";
    const staleAction = seedWaitingAppServerSession(staleSessionId, {
      sourceChannel: "web",
      goal: "请等待我从飞书审批后再继续旧会话",
      summary: "Need cross-session stale batch approval",
      actionId: "approval-cross-web-feishu-stale-batch-1",
      prompt: "Need cross-session stale batch approval",
    });
    const restoredAction = await waitForHistoryActionId(
      baseUrl,
      authHeaders,
      staleSessionId,
      staleAction.actionId,
    );
    assert.equal(restoredAction.actionId, staleAction.actionId);

    const currentResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: currentSessionId,
        goal: currentGoal,
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(currentResponse.status, 200);
    parseNdjson(await currentResponse.text());
    const currentThreadId = runtimeStore.getSession(currentSessionId)?.threadId;
    assert.ok(currentThreadId);

    await feishu.receiveTextMessage(`/use ${currentSessionId}`, {
      messageId: "message-cross-event-stale-batch-new-use-1",
      createTime: "5000",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    feishu.takeMessages();
    assert.equal(feishu.getCurrentSessionId(), currentSessionId);

    await feishu.receiveTextMessage(`/use ${staleSessionId}`, {
      messageId: "message-cross-event-stale-batch-old-use-1",
      createTime: "1000",
    });
    await feishu.receiveTextMessage("请继续旧会话里的过时任务", {
      messageId: "message-cross-event-stale-batch-old-text-1",
      createTime: "1100",
    });
    await feishu.receiveTextMessage("/approve approval-cross-web-feishu-stale-batch-1", {
      messageId: "message-cross-event-stale-batch-old-approve-1",
      createTime: "1200",
    });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 120);
      timer.unref?.();
    });

    const currentHistory = await readHistoryDetail(baseUrl, authHeaders, currentSessionId);
    assert.equal(feishu.getCurrentSessionId(), currentSessionId);
    assert.equal(currentHistory.nativeThread?.threadId, currentThreadId);
    assert.equal(currentHistory.nativeThread?.turnCount, 1);
    assert.deepEqual(currentHistory.turns?.map((turn) => turn.goal), [currentGoal]);
    assert.deepEqual(appServerJourneyState.prompts.map((entry) => entry.prompt), [currentGoal]);
    assert.deepEqual(appServerJourneyState.respondedApprovals, []);
    assert.deepEqual(feishu.peekMessages(), []);
  });
});

test("真实飞书消息事件入口会忽略跨会话旧 /use 与旧普通文本的组合晚到，不会切回旧会话或追加过时 turn", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, runtimeStore, appServerJourneyState, feishu }) => {
    const staleSessionId = "session-web-feishu-stale-text-combo-a";
    const currentSessionId = "session-web-feishu-stale-text-combo-b";
    const staleGoal = "请继续旧会话里的过时任务";

    const staleResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: staleSessionId,
        goal: "请先建立一个旧会话",
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });
    assert.equal(staleResponse.status, 200);
    parseNdjson(await staleResponse.text());

    const currentResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: currentSessionId,
        goal: "请建立当前正在进行的新会话",
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });
    assert.equal(currentResponse.status, 200);
    parseNdjson(await currentResponse.text());

    const currentThreadId = runtimeStore.getSession(currentSessionId)?.threadId;
    assert.ok(currentThreadId);
    assert.deepEqual(appServerJourneyState.prompts.map((entry) => entry.prompt), [
      "请先建立一个旧会话",
      "请建立当前正在进行的新会话",
    ]);

    await feishu.receiveTextMessage(`/use ${currentSessionId}`, {
      messageId: "message-cross-event-stale-text-combo-new-use-1",
      createTime: "3000",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    feishu.takeMessages();
    assert.equal(feishu.getCurrentSessionId(), currentSessionId);

    await feishu.receiveTextMessage(`/use ${staleSessionId}`, {
      messageId: "message-cross-event-stale-text-combo-old-use-1",
      createTime: "2000",
    });
    await feishu.receiveTextMessage(staleGoal, {
      messageId: "message-cross-event-stale-text-combo-old-text-1",
      createTime: "2100",
    });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 120);
      timer.unref?.();
    });

    const finalHistory = await readHistoryDetail(baseUrl, authHeaders, currentSessionId);
    assert.equal(feishu.getCurrentSessionId(), currentSessionId);
    assert.equal(finalHistory.nativeThread?.threadId, currentThreadId);
    assert.equal(finalHistory.nativeThread?.turnCount, 1);
    assert.deepEqual(finalHistory.turns?.map((turn) => turn.goal), ["请建立当前正在进行的新会话"]);
    assert.deepEqual(appServerJourneyState.prompts.map((entry) => entry.prompt), [
      "请先建立一个旧会话",
      "请建立当前正在进行的新会话",
    ]);
    assert.deepEqual(feishu.peekMessages(), []);
  });
});

test("真实飞书消息事件入口会忽略跨会话旧 /use 与旧 /reply 的组合晚到，不会切回旧会话或制造噪音", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, feishu, seedWaitingAppServerSession }) => {
    const staleSessionId = "session-web-feishu-stale-reply-combo-a";
    const currentSessionId = "session-web-feishu-stale-reply-combo-b";
    const staleAction = seedWaitingAppServerSession(staleSessionId, {
      sourceChannel: "web",
      goal: "请等待我从飞书补充输入后再继续旧会话",
      summary: "Need cross-session stale combo reply",
      actionId: "reply-cross-web-feishu-stale-combo-1",
      actionType: "user-input",
      prompt: "请补充你希望我下一步怎么做？",
      userId: "user-cross-1",
    });
    const restoredAction = await waitForHistoryActionId(
      baseUrl,
      authHeaders,
      staleSessionId,
      staleAction.actionId,
    );
    assert.equal(restoredAction.actionId, staleAction.actionId);

    const newerResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: currentSessionId,
        goal: "请建立当前正在进行的新会话",
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(newerResponse.status, 200);
    parseNdjson(await newerResponse.text());

    await feishu.receiveTextMessage(`/use ${currentSessionId}`, {
      messageId: "message-cross-event-stale-reply-combo-new-use-1",
      createTime: "3000",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    feishu.takeMessages();
    assert.equal(feishu.getCurrentSessionId(), currentSessionId);

    await feishu.receiveTextMessage(`/use ${staleSessionId}`, {
      messageId: "message-cross-event-stale-reply-combo-old-use-1",
      createTime: "2000",
    });
    await feishu.receiveTextMessage("/reply reply-cross-web-feishu-stale-combo-1 这是旧补充输入", {
      messageId: "message-cross-event-stale-reply-combo-old-reply-1",
      createTime: "2100",
    });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 120);
      timer.unref?.();
    });

    assert.equal(feishu.getCurrentSessionId(), currentSessionId);
    assert.deepEqual(feishu.peekMessages(), []);
  });
});

test("Web 发起的 user-input waiting action 在飞书 /use 后可以直接通过 /reply 接管并恢复", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, appServerJourneyState, feishu }) => {
    const sessionId = "session-web-feishu-reply-boundary-1";
    const replyText = "请按同一个个人助理来继续处理";

    const streamResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: "请等待我从飞书补充输入",
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(streamResponse.status, 200);
    assert.ok(streamResponse.body);

    const reader = createNdjsonStreamReader(streamResponse.body!);
    const partialLines = await withTimeout(
      reader.readUntil((lines) => lines.some((line) => line.kind === "event" && line.title === "task.action_required")),
      "missing cross-channel web user-input action_required",
    );
    const actionRequiredLine = partialLines.find(
      (line) => line.kind === "event" && line.title === "task.action_required",
    );

    assert.ok(actionRequiredLine);
    assert.equal(actionRequiredLine?.metadata?.actionId, "reply-cross-web-feishu-1");
    await reader.cancel();

    const waitingHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "waiting");
    const restoredAction = extractActionRequiredFromHistory(waitingHistory);
    assert.ok(restoredAction);
    assert.equal(restoredAction.actionId, "reply-cross-web-feishu-1");

    await feishu.handleCommand("use", [sessionId]);
    feishu.takeMessages();

    await feishu.handleCommand("reply", ["reply-cross-web-feishu-1", "请按同一个个人助理来继续处理"]);
    assert.match(feishu.takeSingleMessage(), /已提交补充输入/);

    const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    assert.equal(completedHistory.nativeThread?.turnCount, 1);
    assert.deepEqual(appServerJourneyState.respondedApprovals, [{
      id: "server-cross-web-feishu-reply-1",
      result: {
        answers: {
          followup: {
            answers: [replyText],
          },
        },
      },
    }]);
  }, {
    appServerApprovalPlan: [{
      serverRequestId: "server-cross-web-feishu-reply-1",
      turnId: "turn-cross-web-feishu-reply-1",
      itemId: "reply-cross-web-feishu-1",
      actionType: "user-input",
      questionId: "followup",
      questionText: "请补充你希望我下一步怎么做？",
      reason: "Need more context from web task",
    }],
  });
});

test("真实飞书消息事件入口会让 Web user-input waiting action 在 /use 后通过 /reply 接管并恢复", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, appServerJourneyState, feishu }) => {
    const sessionId = "session-web-feishu-event-reply-1";
    const replyText = "请按真实飞书消息事件继续处理";

    const streamResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: "请等待我从飞书真实事件里补充输入",
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(streamResponse.status, 200);
    assert.ok(streamResponse.body);

    const reader = createNdjsonStreamReader(streamResponse.body!);
    const partialLines = await withTimeout(
      reader.readUntil((lines) => lines.some((line) => line.kind === "event" && line.title === "task.action_required")),
      "missing cross-channel web event-entry reply action_required",
    );
    const actionRequiredLine = partialLines.find(
      (line) => line.kind === "event" && line.title === "task.action_required",
    );

    assert.ok(actionRequiredLine);
    assert.equal(actionRequiredLine?.metadata?.actionId, "reply-cross-web-feishu-1");
    await reader.cancel();

    await feishu.receiveTextMessage(`/use ${sessionId}`, {
      messageId: "message-cross-event-reply-use-1",
    });
    await waitFor(() => feishu.peekMessages().length >= 2);
    feishu.takeMessages();

    await feishu.receiveTextMessage(`/reply reply-cross-web-feishu-1 ${replyText}`, {
      messageId: "message-cross-event-reply-submit-1",
    });
    await waitFor(() => feishu.peekMessages().some((message) => message.includes("已提交补充输入")));
    feishu.takeMessages();

    const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    assert.equal(completedHistory.nativeThread?.turnCount, 1);
    assert.deepEqual(appServerJourneyState.respondedApprovals, [{
      id: "server-cross-web-feishu-reply-1",
      result: {
        answers: {
          followup: {
            answers: [replyText],
          },
        },
      },
    }]);
  }, {
    appServerApprovalPlan: [{
      serverRequestId: "server-cross-web-feishu-reply-1",
      turnId: "turn-cross-web-feishu-reply-1",
      itemId: "reply-cross-web-feishu-1",
      actionType: "user-input",
      questionId: "followup",
      questionText: "请补充你希望我下一步怎么做？",
      reason: "Need more context from web task",
    }],
  });
});

test("飞书发起的双 waiting action 长恢复链可以由 Web 连续恢复，并在第二轮出现前保持 running", async () => {
  let releaseSecondActionGate: (() => void) | null = null;
  const secondActionGate = new Promise<void>((resolve) => {
    releaseSecondActionGate = resolve;
  });

  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, appServerJourneyState, feishu }) => {
    let taskSettled = false;
    const taskPromise = feishu.handleIncomingText("请经历两轮审批后继续这个跨端任务").then(() => {
      taskSettled = true;
    });

    await waitFor(() => feishu.peekMessages().some((message) => message.includes("/approve approval-cross-feishu-long-1a")));

    const sessionId = feishu.getCurrentSessionId();
    assert.ok(sessionId);

    const firstAction = await waitForHistoryActionId(baseUrl, authHeaders, sessionId, "approval-cross-feishu-long-1a");
    const firstSubmitResponse = await fetch(`${baseUrl}/api/tasks/actions`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskId: firstAction.taskId,
        requestId: firstAction.requestId,
        actionId: firstAction.actionId,
        decision: "approve",
      }),
    });
    assert.equal(firstSubmitResponse.status, 200);

    const runningHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "running");
    assert.equal(runningHistory.turns?.[0]?.status, "running");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const historyDetail = await readHistoryDetail(baseUrl, authHeaders, sessionId);
      assert.equal(historyDetail.turns?.[0]?.status, "running");
      assert.equal(extractActionRequiredFromHistory(historyDetail), null);
    }
    assert.equal(taskSettled, false);

    releaseSecondActionGate?.();

    const secondAction = await waitForHistoryActionId(baseUrl, authHeaders, sessionId, "approval-cross-feishu-long-1b");
    const secondSubmitResponse = await fetch(`${baseUrl}/api/tasks/actions`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskId: secondAction.taskId,
        requestId: secondAction.requestId,
        actionId: secondAction.actionId,
        decision: "approve",
      }),
    });
    assert.equal(secondSubmitResponse.status, 200);
    assert.deepEqual(await secondSubmitResponse.json(), {
      ok: true,
    });

    await taskPromise;

    const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    assert.equal(completedHistory.turns?.[0]?.status, "completed");
    assert.equal(completedHistory.nativeThread?.turnCount, 1);
    assert.deepEqual(appServerJourneyState.approvals.map((entry) => entry.id), [
      "server-cross-feishu-long-1a",
      "server-cross-feishu-long-1b",
    ]);
  }, {
    appServerApprovalPlan: [
      {
        serverRequestId: "server-cross-feishu-long-1a",
        approvalId: "approval-cross-feishu-long-1a",
        turnId: "turn-cross-feishu-long-1a",
        itemId: "item-cross-feishu-long-1a",
        command: "npm test",
        reason: "Need approval 1",
      },
      {
        serverRequestId: "server-cross-feishu-long-1b",
        approvalId: "approval-cross-feishu-long-1b",
        turnId: "turn-cross-feishu-long-1b",
        itemId: "item-cross-feishu-long-1b",
        command: "git push",
        reason: "Need approval 2",
        waitForGate: secondActionGate,
      },
    ],
  });
});

test("真实飞书消息事件入口会让 Feishu-origin 双 waiting action 长恢复链继续由 Web 连续恢复", async () => {
  let releaseSecondActionGate: (() => void) | null = null;
  const secondActionGate = new Promise<void>((resolve) => {
    releaseSecondActionGate = resolve;
  });

  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, appServerJourneyState, feishu }) => {
    await feishu.receiveTextMessage("请经历两轮审批后继续这个跨端真实事件任务", {
      messageId: "message-cross-event-long-start-1",
    });

    await waitFor(() => feishu.peekMessages().some((message) => message.includes("/approve approval-cross-feishu-event-long-1a")));
    const sessionId = feishu.getCurrentSessionId();
    assert.ok(sessionId);

    const firstAction = await waitForHistoryActionId(baseUrl, authHeaders, sessionId, "approval-cross-feishu-event-long-1a");
    const firstSubmitResponse = await fetch(`${baseUrl}/api/tasks/actions`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskId: firstAction.taskId,
        requestId: firstAction.requestId,
        actionId: firstAction.actionId,
        decision: "approve",
      }),
    });
    assert.equal(firstSubmitResponse.status, 200);

    const runningHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "running");
    assert.equal(runningHistory.turns?.[0]?.status, "running");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const historyDetail = await readHistoryDetail(baseUrl, authHeaders, sessionId);
      assert.equal(historyDetail.turns?.[0]?.status, "running");
      assert.equal(extractActionRequiredFromHistory(historyDetail), null);
    }

    feishu.takeMessages();
    releaseSecondActionGate?.();

    await waitFor(() => feishu.peekMessages().some((message) => message.includes("/approve approval-cross-feishu-event-long-1b")));

    const secondAction = await waitForHistoryActionId(baseUrl, authHeaders, sessionId, "approval-cross-feishu-event-long-1b");
    const secondSubmitResponse = await fetch(`${baseUrl}/api/tasks/actions`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskId: secondAction.taskId,
        requestId: secondAction.requestId,
        actionId: secondAction.actionId,
        decision: "approve",
      }),
    });
    assert.equal(secondSubmitResponse.status, 200);
    assert.deepEqual(await secondSubmitResponse.json(), {
      ok: true,
    });

    const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    assert.equal(completedHistory.turns?.[0]?.status, "completed");
    assert.equal(completedHistory.nativeThread?.turnCount, 1);
    assert.deepEqual(appServerJourneyState.approvals.map((entry) => entry.id), [
      "server-cross-feishu-event-long-1a",
      "server-cross-feishu-event-long-1b",
    ]);
  }, {
    appServerApprovalPlan: [
      {
        serverRequestId: "server-cross-feishu-event-long-1a",
        approvalId: "approval-cross-feishu-event-long-1a",
        turnId: "turn-cross-feishu-event-long-1a",
        itemId: "item-cross-feishu-event-long-1a",
        command: "npm test",
        reason: "Need approval event 1",
      },
      {
        serverRequestId: "server-cross-feishu-event-long-1b",
        approvalId: "approval-cross-feishu-event-long-1b",
        turnId: "turn-cross-feishu-event-long-1b",
        itemId: "item-cross-feishu-event-long-1b",
        command: "git push",
        reason: "Need approval event 2",
        waitForGate: secondActionGate,
      },
    ],
  });
});

test("飞书发起的 user-input waiting action 可以由 Web /api/tasks/actions 提交 reply 恢复", async () => {
  await withWebAndFeishuServer(async ({ baseUrl, authHeaders, appServerJourneyState, feishu }) => {
    const taskPromise = feishu.handleIncomingText("请先等我补充输入再继续");

    await waitFor(() => feishu.peekMessages().some((message) => message.includes("/reply reply-cross-feishu-web-1")));

    const sessionId = feishu.getCurrentSessionId();
    assert.ok(sessionId);

    const restoredAction = await waitForHistoryActionId(baseUrl, authHeaders, sessionId, "reply-cross-feishu-web-1");
    const replyText = "请优先补回归，再继续主链路";
    const actionSubmitResponse = await fetch(`${baseUrl}/api/tasks/actions`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskId: restoredAction.taskId,
        requestId: restoredAction.requestId,
        actionId: restoredAction.actionId,
        inputText: replyText,
      }),
    });

    assert.equal(actionSubmitResponse.status, 200);
    assert.deepEqual(await actionSubmitResponse.json(), {
      ok: true,
    });

    await taskPromise;

    const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    assert.equal(completedHistory.turns?.[0]?.status, "completed");
    assert.deepEqual(appServerJourneyState.respondedApprovals, [{
      id: "server-cross-feishu-reply-1",
      result: {
        answers: {
          followup: {
            answers: [replyText],
          },
        },
      },
    }]);
  }, {
    appServerApprovalPlan: [{
      serverRequestId: "server-cross-feishu-reply-1",
      turnId: "turn-cross-feishu-reply-1",
      itemId: "reply-cross-feishu-web-1",
      actionType: "user-input",
      questionId: "followup",
      questionText: "请补充你希望我下一步怎么做？",
      reason: "Need more context",
    }],
  });
});

async function withWebAndFeishuServer(
  run: (context: CrossChannelTestContext) => Promise<void>,
  options: WithWebAndFeishuServerOptions = {},
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-feishu-cross-journey-"));
  const controlDirectory = join(root, "control");
  mkdirSync(controlDirectory, { recursive: true });
  writeWorkspaceDocs(controlDirectory, {
    agents: "cross-channel-control-rule",
    readmeTitle: "cross-channel-control",
  });

  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const identityService = new IdentityLinkService(runtimeStore);
  const actionBridge = new AppServerActionBridge();
  const appServerJourneyState = createCrossChannelJourneyState(options.appServerApprovalPlan ?? []);
  const runtime = createSharedRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
    identityService,
  });
  const appServerRuntime = new AppServerTaskRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
    actionBridge,
    sessionFactory: async (): Promise<AppServerTaskRuntimeSession> => ({
      initialize: async () => {},
      startThread: async (params) => {
        const threadId = `thread-app-cross-${++appServerJourneyState.nextThreadNumber}`;
        ensureThreadState(appServerJourneyState, threadId);
        appServerJourneyState.started.push({ threadId, cwd: params.cwd });
        return { threadId };
      },
      resumeThread: async (threadId, params) => {
        ensureThreadState(appServerJourneyState, threadId);
        appServerJourneyState.resumed.push({ threadId, cwd: params.cwd });
        return { threadId };
      },
      readThread: async (threadId, options) => {
        const threadState = ensureThreadState(appServerJourneyState, threadId);
        appServerJourneyState.read.push({
          threadId,
          includeTurns: options?.includeTurns === true,
        });
        return toThreadSnapshot(controlDirectory, threadId, threadState, options?.includeTurns === true);
      },
      startReview: async (threadId, instructions) => {
        appServerJourneyState.reviews.push({ threadId, instructions });
        return {
          reviewThreadId: `review-${threadId}`,
          turnId: `review-turn-${appServerJourneyState.reviews.length}`,
        };
      },
      steerTurn: async (threadId, turnId, message) => {
        appServerJourneyState.steers.push({ threadId, turnId, message });
        return {
          turnId,
        };
      },
      startTurn: async (threadId, prompt) => {
        const threadState = ensureThreadState(appServerJourneyState, threadId);
        const turnId = `turn-app-cross-${++appServerJourneyState.nextTurnNumber}`;
        appServerJourneyState.prompts.push({ threadId, prompt });

        for (const approval of appServerJourneyState.approvalPlan) {
          await approval.waitForGate;
          const actionType = approval.actionType ?? "approval";
          const method = actionType === "user-input"
            ? "item/tool/requestUserInput"
            : "item/commandExecution/requestApproval";

          appServerJourneyState.approvals.push({
            id: approval.serverRequestId,
            method,
          });
          const approvalResolved = new Promise<void>((resolve) => {
            appServerJourneyState.resolveApproval = resolve;
          });
          appServerJourneyState.serverRequestHandler?.({
            id: approval.serverRequestId,
            method,
            params: actionType === "user-input"
              ? {
                threadId,
                turnId: approval.turnId,
                itemId: approval.itemId,
                questions: [{
                  id: approval.questionId ?? "reply",
                  question: approval.questionText ?? "需要补充输入。",
                }],
              }
              : {
                threadId,
                turnId: approval.turnId,
                itemId: approval.itemId,
                approvalId: approval.approvalId,
                command: approval.command,
                reason: approval.reason,
              },
          });
          await approvalResolved;
          appServerJourneyState.resolveApproval = null;

          if (approval !== appServerJourneyState.approvalPlan[appServerJourneyState.approvalPlan.length - 1]) {
            appServerJourneyState.notificationHandler?.({
              method: "item/agentMessage/delta",
              params: {
                itemId: `${approval.serverRequestId}-running`,
                text: "上一轮 waiting action 已处理，任务继续执行中。",
              },
            });
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, 300);
              timer.unref?.();
            });
          }
        }

        threadState.turns.push({
          turnId,
          status: "completed",
        });
        setTimeout(() => {
          appServerJourneyState.notificationHandler?.({
            method: "item/completed",
            params: {
              threadId,
              turnId,
              item: {
                type: "agentMessage",
                id: `item-complete-${turnId}`,
                text: `cross-channel task completed: ${prompt}`,
                phase: "final_answer",
                memoryCitation: null,
              },
            },
          });
          appServerJourneyState.notificationHandler?.({
            method: "turn/completed",
            params: {
              threadId,
              turn: {
                id: turnId,
                items: [],
                status: "completed",
                error: null,
              },
            },
          });
        }, 0);
        return { turnId };
      },
      close: async () => {},
      onNotification: (handler) => {
        appServerJourneyState.notificationHandler = handler;
      },
      onServerRequest: (handler) => {
        appServerJourneyState.serverRequestHandler = handler;
      },
      respondToServerRequest: async (id, result) => {
        appServerJourneyState.respondedApprovals.push({ id, result });
        appServerJourneyState.resolveApproval?.();
      },
      rejectServerRequest: async () => {},
    }),
  });
  const runtimeRegistry: TaskRuntimeRegistry = {
    defaultRuntime: appServerRuntime,
    runtimes: {
      "app-server": appServerRuntime,
    },
  };
  const authRuntime = createAuthRuntime({
    authenticated: false,
    requiresOpenaiAuth: false,
  });
  const server = createThemisHttpServer({
    runtime,
    runtimeRegistry: {
      defaultRuntime: appServerRuntime,
      runtimes: {
        "app-server": appServerRuntime,
      },
    },
    authRuntime,
    actionBridge,
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const authHeaders = await createAuthenticatedWebHeaders({
    baseUrl,
    runtimeStore,
  });
  const feishu = createFeishuDriver({
    root,
    runtime,
    runtimeRegistry,
    authRuntime,
    actionBridge,
  });

  try {
    await run({
      baseUrl,
      root,
      runtimeStore,
      authHeaders,
      appServerJourneyState,
      feishu,
      seedRunningAppServerSession: (sessionId, input) => {
        const now = new Date().toISOString();
        const threadId = input.threadId ?? `thread-app-cross-${++appServerJourneyState.nextThreadNumber}`;
        const turnId = input.turnId ?? `turn-app-cross-${++appServerJourneyState.nextTurnNumber}`;
        const goal = input.goal ?? "seed running app-server session";
        const summary = input.summary ?? goal;
        const requestId = `request-seed-running-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const taskId = `task-seed-running-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

        runtimeStore.upsertTurnFromRequest({
          requestId,
          sourceChannel: input.sourceChannel ?? "web",
          user: {
            userId: "user-cross-1",
          },
          goal,
          channelContext: {
            sessionId,
          },
          createdAt: now,
        } satisfies TaskRequest, taskId);
        runtimeStore.saveSession({
          sessionId,
          threadId,
          activeTaskId: taskId,
          createdAt: now,
          updatedAt: now,
        });
        runtimeStore.appendTaskEvent({
          eventId: `event-seed-running-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          taskId,
          requestId,
          type: "task.progress",
          status: "running",
          message: summary,
          payload: {
            itemType: "agent_message",
            threadEventType: "item.completed",
            itemId: `item-seed-running-${Math.random().toString(36).slice(2, 10)}`,
          },
          timestamp: now,
        });
        appServerJourneyState.threads.set(threadId, {
          preview: "cross-channel native preview",
          turns: [{
            turnId,
            status: "running",
          }],
        });
        return { threadId, turnId };
      },
      seedWaitingAppServerSession: (sessionId, input) => {
        const now = new Date().toISOString();
        const threadId = input.threadId ?? `thread-app-cross-${++appServerJourneyState.nextThreadNumber}`;
        const turnId = input.turnId ?? `turn-app-cross-${++appServerJourneyState.nextTurnNumber}`;
        const taskId = `task-seed-waiting-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const requestId = `request-seed-waiting-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const goal = input.goal ?? "seed waiting app-server session";
        const summary = input.summary ?? input.prompt ?? goal;
        const actionType = input.actionType ?? "approval";
        const prompt = input.prompt ?? "需要等待下一步操作。";

        runtimeStore.upsertTurnFromRequest({
          requestId,
          sourceChannel: input.sourceChannel ?? "web",
          user: {
            userId: input.userId ?? "user-cross-1",
          },
          goal,
          channelContext: {
            sessionId,
          },
          createdAt: now,
        } satisfies TaskRequest, taskId);
        runtimeStore.saveSession({
          sessionId,
          threadId,
          activeTaskId: taskId,
          createdAt: now,
          updatedAt: now,
        });
        runtimeStore.appendTaskEvent({
          eventId: `event-seed-waiting-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          taskId,
          requestId,
          type: "task.action_required",
          status: "waiting",
          message: summary,
          payload: {
            actionId: input.actionId,
            actionType,
            prompt,
            ...(input.choices ? { choices: input.choices } : {}),
          },
          timestamp: now,
        });
        actionBridge.register({
          taskId,
          requestId,
          actionId: input.actionId,
          actionType,
          prompt,
          ...(input.choices ? { choices: input.choices } : {}),
          scope: {
            sourceChannel: input.sourceChannel ?? "web",
            sessionId,
            userId: input.userId ?? "user-cross-1",
          },
        });
        appServerJourneyState.threads.set(threadId, {
          preview: "cross-channel native preview",
          turns: [{
            turnId,
            status: "waiting",
          }],
        });
        return {
          threadId,
          turnId,
          taskId,
          requestId,
          actionId: input.actionId,
        };
      },
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
}

function createCrossChannelJourneyState(approvalPlan: CrossChannelApprovalPlanEntry[]): CrossChannelJourneyState {
  return {
    started: [],
    resumed: [],
    prompts: [],
    read: [],
    reviews: [],
    steers: [],
    approvalPlan,
    approvals: [],
    respondedApprovals: [],
    notificationHandler: null,
    serverRequestHandler: null,
    resolveApproval: null,
    nextThreadNumber: 0,
    nextTurnNumber: 0,
    threads: new Map(),
  };
}

function ensureThreadState(
  state: CrossChannelJourneyState,
  threadId: string,
): CrossChannelJourneyThreadState {
  const existing = state.threads.get(threadId);

  if (existing) {
    return existing;
  }

  const created: CrossChannelJourneyThreadState = {
    preview: "cross-channel native preview",
    turns: [],
  };
  state.threads.set(threadId, created);
  return created;
}

function toThreadSnapshot(
  cwd: string,
  threadId: string,
  threadState: CrossChannelJourneyThreadState,
  includeTurns: boolean,
): TaskRuntimeThreadSnapshot {
  return {
    threadId,
    preview: threadState.preview,
    status: threadState.turns.some((turn) => turn.status === "running") ? "running" : "idle",
    cwd,
    createdAt: "2026-03-30T08:00:00.000Z",
    updatedAt: "2026-03-30T08:05:00.000Z",
    turnCount: threadState.turns.length,
    turns: includeTurns
      ? threadState.turns.map((turn) => ({
        turnId: turn.turnId,
        status: turn.status,
      }))
      : [],
  };
}

function createSharedRuntime(input: {
  workingDirectory: string;
  runtimeStore: SqliteCodexSessionRegistry;
  identityService: IdentityLinkService;
}): CodexTaskRuntime {
  const principalSkillsService = {
    listPrincipalSkills: () => [],
    listCuratedSkills: async () => [],
    syncAllSkillsToAuthAccount: async () => {},
  };

  return {
    getWorkingDirectory: () => input.workingDirectory,
    getRuntimeStore: () => input.runtimeStore,
    getIdentityLinkService: () => input.identityService,
    getPrincipalSkillsService: () => principalSkillsService,
    getPrincipalTaskSettings: (principalId?: string): PrincipalTaskSettings | null => {
      if (!principalId) {
        return null;
      }

      return input.runtimeStore.getPrincipalTaskSettings(principalId)?.settings ?? null;
    },
    savePrincipalTaskSettings: (principalId: string, settings: PrincipalTaskSettings): PrincipalTaskSettings => {
      const now = new Date().toISOString();
      const existing = input.runtimeStore.getPrincipalTaskSettings(principalId);
      input.runtimeStore.savePrincipalTaskSettings({
        principalId,
        settings,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      return settings;
    },
  } as unknown as CodexTaskRuntime;
}

function createFeishuDriver(input: {
  root: string;
  runtime: CodexTaskRuntime;
  runtimeRegistry: TaskRuntimeRegistry;
  authRuntime: CodexAuthRuntime;
  actionBridge: AppServerActionBridge;
}) {
  const sessionStore = new FeishuSessionStore({
    filePath: join(input.root, "infra/local/feishu-sessions.json"),
  });
  const service = new FeishuChannelService({
    runtime: input.runtime,
    runtimeRegistry: input.runtimeRegistry,
    authRuntime: input.authRuntime,
    actionBridge: input.actionBridge,
    taskTimeoutMs: 5_000,
    sessionStore,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  });
  const messages: string[] = [];
  let nextMessageId = 1;
  const context = {
    chatId: "chat-cross-1",
    messageId: "message-cross-1",
    userId: "user-cross-1",
    text: "",
  };

  (service as unknown as { safeSendText: (chatId: string, text: string) => Promise<void> }).safeSendText = async (
    _chatId,
    text,
  ) => {
    messages.push(text);
  };
  (service as unknown as { client: unknown }).client = {
    im: {
      v1: {
        message: {
          create: async ({ data }: { data: { content: string } }) => {
            messages.push(extractFeishuRenderedText(data.content));
            return {
              data: {
                message_id: `msg-cross-${nextMessageId++}`,
              },
            };
          },
          update: async ({ path, data }: { path: { message_id: string }; data: { content: string } }) => {
            messages.push(extractFeishuRenderedText(data.content));
            return {
              data: {
                message_id: path.message_id,
              },
            };
          },
        },
      },
    },
  };

  return {
    async handleCommand(name: string, args: string[]) {
      await (service as unknown as {
        handleCommand(command: { name: string; args: string[]; raw: string }, incomingContext: typeof context): Promise<void>;
      }).handleCommand({ name, args, raw: `/${name} ${args.join(" ")}`.trim() }, context);
    },
    async handleIncomingText(text: string) {
      await (service as unknown as {
        handleTaskMessage(incomingContext: typeof context): Promise<void>;
      }).handleTaskMessage({ ...context, text });
    },
    async receiveTextMessage(text: string, options: { messageId?: string; createTime?: string } = {}) {
      await (service as unknown as {
        acceptMessageReceiveEvent(event: unknown): Promise<void>;
      }).acceptMessageReceiveEvent(createFeishuTextReceiveEvent({
        chatId: context.chatId,
        userId: context.userId,
        text,
        messageId: options.messageId ?? `message-cross-event-${nextMessageId++}`,
        ...(options.createTime ? { createTime: options.createTime } : {}),
      }));
    },
    takeMessages() {
      const current = [...messages];
      messages.length = 0;
      return current;
    },
    peekMessages() {
      return [...messages];
    },
    takeSingleMessage() {
      assert.equal(messages.length, 1);
      return messages.pop() ?? "";
    },
    getCurrentSessionId() {
      return sessionStore.getActiveSessionId({
        chatId: context.chatId,
        userId: context.userId,
      });
    },
  };
}

function createFeishuTextReceiveEvent(input: {
  chatId: string;
  userId: string;
  text: string;
  messageId: string;
  createTime?: string;
}): unknown {
  return {
    message: {
      chat_id: input.chatId,
      message_id: input.messageId,
      ...(input.createTime ? { create_time: input.createTime } : {}),
      message_type: "text",
      chat_type: "p2p",
      content: JSON.stringify({
        text: input.text,
      }),
    },
    sender: {
      sender_id: {
        user_id: input.userId,
        open_id: `open-${input.userId}`,
      },
      tenant_key: "tenant-cross-1",
    },
  };
}

function extractFeishuRenderedText(content: string): string {
  const parsed = JSON.parse(content) as {
    text?: string;
    zh_cn?: {
      content?: Array<Array<{ text?: string }>>;
    };
  };

  if (typeof parsed.text === "string") {
    return parsed.text;
  }

  const firstText = parsed.zh_cn?.content?.flat().find((item) => typeof item.text === "string")?.text;
  return typeof firstText === "string" ? firstText : "";
}

function parseNdjson(payload: string): Array<Record<string, unknown>> {
  return payload
    .trim()
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function createNdjsonStreamReader(body: ReadableStream<Uint8Array>): {
  readUntil: (
    predicate: (lines: Array<Record<string, any>>) => boolean,
  ) => Promise<Array<Record<string, any>>>;
  readAll: () => Promise<Array<Record<string, any>>>;
  cancel: () => Promise<void>;
} {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const lines: Array<Record<string, any>> = [];

  async function drainUntil(
    predicate: (lines: Array<Record<string, any>>) => boolean,
    stopAtEnd: boolean,
  ): Promise<Array<Record<string, any>>> {
    while (true) {
      if (predicate(lines)) {
        return [...lines];
      }

      const { value, done } = await reader.read();

      if (done) {
        const trailing = buffer.trim();

        if (trailing) {
          lines.push(JSON.parse(trailing) as Record<string, any>);
          buffer = "";
          if (predicate(lines)) {
            return [...lines];
          }
        }

        if (stopAtEnd) {
          return [...lines];
        }

        throw new Error("NDJSON stream ended before predicate matched.");
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        const trimmed = chunk.trim();

        if (!trimmed) {
          continue;
        }

        lines.push(JSON.parse(trimmed) as Record<string, any>);

        if (predicate(lines)) {
          return [...lines];
        }
      }
    }
  }

  return {
    readUntil: async (predicate) => await drainUntil(predicate, false),
    readAll: async () => {
      const consumedBefore = lines.length;
      const all = await drainUntil(() => false, true);
      return all.slice(consumedBefore);
    },
    cancel: async () => {
      await reader.cancel();
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = 1_000): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      timer.unref?.();
    }),
  ]);
}

async function waitFor(check: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 20);
      timer.unref?.();
    });
  }

  throw new Error("condition did not become true in time");
}

async function waitForHistoryTurnStatus(
  baseUrl: string,
  authHeaders: Record<string, string>,
  sessionId: string,
  expectedStatus: string,
  timeoutMs = 1_000,
): Promise<HistorySessionDetailPayload> {
  const startedAt = Date.now();

  while (true) {
    const historyDetailPayload = await readHistoryDetail(baseUrl, authHeaders, sessionId);

    if (historyDetailPayload.turns?.some((turn) => turn.status === expectedStatus)) {
      return historyDetailPayload;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`history turn did not reach status ${expectedStatus}`);
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 20);
      timer.unref?.();
    });
  }
}

async function waitForHistoryTurnCount(
  baseUrl: string,
  authHeaders: Record<string, string>,
  sessionId: string,
  expectedTurnCount: number,
  timeoutMs = 1_000,
): Promise<HistorySessionDetailPayload> {
  const startedAt = Date.now();

  while (true) {
    const historyDetailPayload = await readHistoryDetail(baseUrl, authHeaders, sessionId);

    if (historyDetailPayload.nativeThread?.turnCount === expectedTurnCount) {
      return historyDetailPayload;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`history turn count did not reach ${expectedTurnCount}`);
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 20);
      timer.unref?.();
    });
  }
}

async function readHistoryDetail(
  baseUrl: string,
  authHeaders: Record<string, string>,
  sessionId: string,
): Promise<HistorySessionDetailPayload> {
  const historyDetailResponse = await fetch(`${baseUrl}/api/history/sessions/${sessionId}`, {
    method: "GET",
    headers: authHeaders,
  });
  assert.equal(historyDetailResponse.status, 200);
  return await historyDetailResponse.json() as HistorySessionDetailPayload;
}

async function waitForHistoryActionId(
  baseUrl: string,
  authHeaders: Record<string, string>,
  sessionId: string,
  expectedActionId: string,
  timeoutMs = 1_000,
): Promise<{
  taskId: string;
  requestId: string;
  actionId: string;
  actionType?: string;
}> {
  const startedAt = Date.now();

  while (true) {
    const historyDetailPayload = await readHistoryDetail(baseUrl, authHeaders, sessionId);
    const actionRequired = extractActionRequiredFromHistoryByActionId(historyDetailPayload, expectedActionId);

    if (actionRequired) {
      return actionRequired;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`history action did not reach actionId ${expectedActionId}`);
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 20);
      timer.unref?.();
    });
  }
}

function extractActionRequiredFromHistory(
  historyDetailPayload: HistorySessionDetailPayload,
): {
  taskId: string;
  requestId: string;
  actionId: string;
  actionType?: string;
} | null {
  const waitingTurn = historyDetailPayload.turns?.find((turn) => turn.status === "waiting");
  const actionRequiredEvent = waitingTurn?.events?.find((event) => event.type === "task.action_required");

  if (!actionRequiredEvent?.payloadJson) {
    return null;
  }

  const payload = JSON.parse(actionRequiredEvent.payloadJson) as {
    actionId?: string;
    actionType?: string;
  };
  const taskId = actionRequiredEvent.taskId ?? waitingTurn?.taskId;
  const requestId = actionRequiredEvent.requestId ?? waitingTurn?.requestId;

  if (!taskId || !requestId || !payload.actionId) {
    return null;
  }

  return {
    taskId,
    requestId,
    actionId: payload.actionId,
    ...(payload.actionType ? { actionType: payload.actionType } : {}),
  };
}

function extractActionRequiredFromHistoryByActionId(
  historyDetailPayload: HistorySessionDetailPayload,
  expectedActionId: string,
): {
  taskId: string;
  requestId: string;
  actionId: string;
  actionType?: string;
} | null {
  for (const turn of historyDetailPayload.turns ?? []) {
    if (turn.status !== "waiting") {
      continue;
    }

    for (const event of turn.events ?? []) {
      if (event.type !== "task.action_required" || !event.payloadJson) {
        continue;
      }

      const payload = JSON.parse(event.payloadJson) as {
        actionId?: string;
        actionType?: string;
      };

      if (payload.actionId !== expectedActionId) {
        continue;
      }

      const taskId = event.taskId ?? turn.taskId;
      const requestId = event.requestId ?? turn.requestId;

      if (!taskId || !requestId) {
        continue;
      }

      return {
        taskId,
        requestId,
        actionId: payload.actionId,
        ...(payload.actionType ? { actionType: payload.actionType } : {}),
      };
    }
  }

  return null;
}

function createAuthRuntime(snapshot: {
  authenticated: boolean;
  requiresOpenaiAuth: boolean;
}): CodexAuthRuntime {
  const accounts = [{
    accountId: "acc-cross-1",
    label: "Cross",
    accountEmail: "cross@example.com",
    codexHome: "/tmp/codex-cross",
  }];

  return {
    listAccounts: () => accounts,
    getActiveAccount: () => accounts[0] ?? null,
    readSnapshot: async () => snapshot,
    readThirdPartyProviderProfile: () => null,
  } as unknown as CodexAuthRuntime;
}

function writeWorkspaceDocs(
  workspace: string,
  options: {
    agents?: string;
    readmeTitle?: string;
  } = {},
): void {
  writeRuntimeFile(workspace, "AGENTS.md", options.agents ?? "workspace-rule");
  writeRuntimeFile(workspace, "README.md", `# ${options.readmeTitle ?? "workspace"}`);
  writeRuntimeFile(workspace, "memory/architecture/overview.md", "# architecture");
  writeRuntimeFile(workspace, "docs/memory/2026/03/feishu-cross-journey.md", "# feishu cross journey");
  writeRuntimeFile(workspace, "notes.txt", "cross journey note");
}

function writeRuntimeFile(root: string, path: string, content: string): void {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${content}\n`, "utf8");
}

function listenServer(server: Server): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server);
    });
    server.once("error", reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
