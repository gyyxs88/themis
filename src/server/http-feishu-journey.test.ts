import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { AppServerActionBridge } from "../core/app-server-action-bridge.js";
import type { AppServerReverseRequest } from "../core/codex-app-server.js";
import { AppServerTaskRuntime, type AppServerTaskRuntimeSession } from "../core/app-server-task-runtime.js";
import type { CodexAuthRuntime } from "../core/codex-auth.js";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { FeishuChannelService } from "../channels/feishu/service.js";
import { FeishuSessionStore } from "../channels/feishu/session-store.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type {
  TaskPendingActionSubmitRequest,
  TaskRequest,
  TaskResult,
  TaskRuntimeFacade,
  TaskRuntimeRunHooks,
} from "../types/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

const JOURNEY_THREAD_ID = "thread-web-feishu-journey-1";
const JOURNEY_ACTION_ID = "input-web-feishu-1";
const JOURNEY_PRINCIPAL_ID = "principal-local-owner";
const MIXED_APPROVAL_ACTION_ID = "approval-web-feishu-mixed-1";
const MIXED_INPUT_ACTION_ID = "input-web-feishu-mixed-2";

test("真实 Web->飞书 journey 在 app-server 下会走通 /use + direct-text takeover 收口", async () => {
  await withHttpFeishuJourneyServer({
    scenario: "single-user-input",
    run: async ({ baseUrl, root, runtimeStore, authHeaders, feishu }) => {
    const sessionId = "session-web-feishu-journey-1";
    const workspace = join(root, "workspace-feishu-journey");

    seedCompletedWebOwnerPersona(runtimeStore);
    writeWorkspaceDocs(workspace, {
      readmeTitle: "workspace-feishu-journey",
    });

    const saveWorkspaceResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/settings`, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        settings: {
          workspacePath: workspace,
        },
      }),
    });

    assert.equal(saveWorkspaceResponse.status, 200);

    const streamResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: "请先等待我补充输入，再根据补充内容继续执行",
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
      "missing user-input action_required",
    );
    const actionRequiredLine = partialLines.find(
      (line) => line.kind === "event" && line.title === "task.action_required",
    );

    assert.ok(actionRequiredLine);
    assert.equal(actionRequiredLine?.metadata?.actionId, JOURNEY_ACTION_ID, JSON.stringify(actionRequiredLine));
    assert.equal(actionRequiredLine?.metadata?.actionType, "user-input", JSON.stringify(actionRequiredLine));
    await reader.cancel();

    const restoredAction = await waitForHistoryActionId(baseUrl, authHeaders, sessionId, JOURNEY_ACTION_ID);
    assert.equal(restoredAction.actionType, "user-input");

    await feishu.handleCommand("use", [sessionId]);
    const switchMessages = feishu.takeMessages().join("\n");
    assert.match(switchMessages, new RegExp(`已切换到会话：${sessionId}`));
    assert.equal(feishu.getCurrentSessionId(), sessionId);

    const beforeTaskRuntimeCalls = feishu.getTaskRuntimeCalls();

    await feishu.handleMessageEventText("这是来自飞书的补充上下文");

    const feishuMessages = feishu.takeMessages().join("\n");
    assert.match(feishuMessages, /已提交补充输入。/);
    assert.deepEqual(feishu.getTaskRuntimeCalls(), beforeTaskRuntimeCalls);
    await waitFor(
      () => feishu.getResolvedActionSubmissions().some((entry) => entry.actionId === JOURNEY_ACTION_ID),
      "single journey did not record resolved input submission",
    );
    const singleSubmission = feishu.getResolvedActionSubmissions().find((entry) => entry.actionId === JOURNEY_ACTION_ID);
    assert.deepEqual(singleSubmission, {
      taskId: restoredAction.taskId,
      requestId: restoredAction.requestId,
      actionId: JOURNEY_ACTION_ID,
      inputText: "这是来自飞书的补充上下文",
    });

    const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    assert.equal(completedHistory.turns?.length, 1);
    assert.equal(completedHistory.turns?.[0]?.status, "completed");
    assert.ok(completedHistory.turns?.[0]?.events?.some((event) => event.type === "task.action_required"));
    },
  });
});

test("真实 Web->飞书 mixed recovery journey 在 app-server 下会走通 approval -> user-input -> direct-text takeover 收口", async () => {
  await withHttpFeishuJourneyServer({
    scenario: "approval-then-input",
    run: async ({ baseUrl, root, runtimeStore, authHeaders, feishu }) => {
    const sessionId = "session-web-feishu-mixed-journey-1";
    const workspace = join(root, "workspace-feishu-mixed-journey");
    seedCompletedWebOwnerPersona(runtimeStore);
    writeWorkspaceDocs(workspace, {
      readmeTitle: "workspace-feishu-mixed-journey",
    });

    const saveWorkspaceResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/settings`, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        settings: {
          workspacePath: workspace,
        },
      }),
    });

    assert.equal(saveWorkspaceResponse.status, 200);

    const streamResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: "请先等待审批，再等待我补充输入，最后继续执行",
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(streamResponse.status, 200);
    assert.ok(streamResponse.body);

    const reader = createNdjsonStreamReader(streamResponse.body!);
    const firstPartialLines = await withTimeout(
      reader.readUntil((lines) => lines.some((line) => line.kind === "event" && line.title === "task.action_required")),
      "missing approval action_required",
    );
    const firstActionRequiredLine = firstPartialLines.find(
      (line) => line.kind === "event" && line.title === "task.action_required",
    );
    const firstActionId = firstActionRequiredLine?.metadata?.actionId;
    const firstActionType = firstActionRequiredLine?.metadata?.actionType;

    assert.ok(firstActionRequiredLine);
    assert.equal(firstActionId, MIXED_APPROVAL_ACTION_ID, JSON.stringify(firstActionRequiredLine));
    assert.equal(firstActionType, "approval", JSON.stringify(firstActionRequiredLine));

    const firstAction = await waitForHistoryActionId(baseUrl, authHeaders, sessionId, MIXED_APPROVAL_ACTION_ID);
    assert.equal(firstAction.actionType, "approval");

    await feishu.handleCommand("use", [sessionId]);
    const switchMessages = feishu.takeMessages().join("\n");
    assert.match(switchMessages, new RegExp(`已切换到会话：${sessionId}`));
    assert.equal(feishu.getCurrentSessionId(), sessionId);

    const beforeTaskRuntimeCalls = feishu.getTaskRuntimeCalls();
    const historyBeforeApproval = await readHistoryDetail(baseUrl, authHeaders, sessionId);

    assert.equal(
      extractActionRequiredFromHistoryByActionId(historyBeforeApproval, MIXED_INPUT_ACTION_ID),
      null,
    );

    await feishu.handleCommand("approve", [MIXED_APPROVAL_ACTION_ID]);

    await waitFor(
      () => feishu.getResolvedActionSubmissions().some((entry) => entry.actionId === MIXED_APPROVAL_ACTION_ID),
      "mixed journey did not record approval submission",
    );
    const firstSubmission = feishu.getResolvedActionSubmissions().find((entry) => entry.actionId === MIXED_APPROVAL_ACTION_ID);
    assert.deepEqual(firstSubmission, {
      taskId: firstAction.taskId,
      requestId: firstAction.requestId,
      actionId: MIXED_APPROVAL_ACTION_ID,
      decision: "approve",
    });
    assert.deepEqual(feishu.getTaskRuntimeCalls(), beforeTaskRuntimeCalls);

    const secondPartialLines = await withTimeout(
      reader.readUntil((lines) => lines.filter((line) => line.kind === "event" && line.title === "task.action_required").length >= 2),
      "missing second user-input action_required",
    );
    const secondActionRequiredLine = [...secondPartialLines].reverse().find(
      (line) => line.kind === "event" && line.title === "task.action_required",
    );

    assert.ok(secondActionRequiredLine);
    assert.equal(secondActionRequiredLine?.metadata?.actionId, MIXED_INPUT_ACTION_ID, JSON.stringify(secondActionRequiredLine));
    assert.equal(secondActionRequiredLine?.metadata?.actionType, "user-input", JSON.stringify(secondActionRequiredLine));

    const secondAction = await waitForHistoryActionId(baseUrl, authHeaders, sessionId, MIXED_INPUT_ACTION_ID);
    assert.equal(secondAction.actionType, "user-input");

    await feishu.handleMessageEventText("这是来自飞书的 mixed recovery 最终补充");

    const messages = feishu.takeMessages().join("\n");
    assert.match(messages, /已提交补充输入。/);
    assert.deepEqual(feishu.getTaskRuntimeCalls(), beforeTaskRuntimeCalls);

    await waitFor(
      () => feishu.getResolvedActionSubmissions().some((entry) => entry.actionId === MIXED_INPUT_ACTION_ID),
      "mixed journey did not record input submission",
    );
    const submissions = feishu.getResolvedActionSubmissions();
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions.find((entry) => entry.actionId === MIXED_INPUT_ACTION_ID), {
      taskId: firstAction.taskId,
      requestId: firstAction.requestId,
      actionId: MIXED_INPUT_ACTION_ID,
      inputText: "这是来自飞书的 mixed recovery 最终补充",
    });

    const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    assert.equal(completedHistory.turns?.length, 1);
    assert.equal(completedHistory.turns?.[0]?.status, "completed");
    assert.equal(
      completedHistory.turns?.[0]?.events?.filter((event) => event.type === "task.action_required").length,
      2,
    );
    await reader.cancel();
    },
  });
});

test("Journey session respondToServerRequest 会按 request id 严格匹配当前 waiting reverse request", async (t) => {
  await t.test("single-user-input strict match", async () => {
    const singleState = createJourneySessionState({
      scenario: "single-user-input",
      workingDirectory: "/tmp/themis-feishu-journey-single",
    });
    const singleSession = createJourneySession(singleState);
    const singleRequests: AppServerReverseRequest[] = [];

    singleSession.onServerRequest((request) => {
      singleRequests.push(request);
    });

    await singleSession.initialize();
    await singleSession.startThread({
      cwd: singleState.workingDirectory,
      persistExtendedHistory: true,
    });
    const singleTurn = singleSession.startTurn(JOURNEY_THREAD_ID, "single journey");
    const singleRespondToServerRequest = singleSession.respondToServerRequest;

    assert.ok(singleRespondToServerRequest);
    await waitFor(() => singleRequests.length === 1, "single scenario did not emit requestUserInput");

    await assert.rejects(
      singleRespondToServerRequest("wrong-single-request-id", {
        answers: {
          reply: {
            answers: ["ignored"],
          },
        },
      }),
      /Unexpected reverse request id/,
    );

    await singleRespondToServerRequest(singleRequests[0]?.id ?? "", {
      answers: {
        reply: {
          answers: ["single strict match"],
        },
      },
    });
    await singleTurn;
    await singleSession.close();
  });

  await t.test("approval-then-input strict match", async () => {
    const mixedState = createJourneySessionState({
      scenario: "approval-then-input",
      workingDirectory: "/tmp/themis-feishu-journey-mixed",
      mixedRecoveryInputDelayMs: 0,
    });
    const mixedSession = createJourneySession(mixedState);
    const mixedRequests: AppServerReverseRequest[] = [];

    mixedSession.onServerRequest((request) => {
      mixedRequests.push(request);
    });

    await mixedSession.initialize();
    await mixedSession.startThread({
      cwd: mixedState.workingDirectory,
      persistExtendedHistory: true,
    });
    const mixedTurn = mixedSession.startTurn(JOURNEY_THREAD_ID, "mixed journey");
    const mixedRespondToServerRequest = mixedSession.respondToServerRequest;

    assert.ok(mixedRespondToServerRequest);
    await waitFor(() => mixedRequests.length === 1, "mixed scenario did not emit approval request");

    await assert.rejects(
      mixedRespondToServerRequest("wrong-mixed-approval-id", {
        decision: "accept",
      }),
      /Unexpected reverse request id/,
    );

    await mixedRespondToServerRequest(mixedRequests[0]?.id ?? "", {
      decision: "accept",
    });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    await waitFor(() => mixedRequests.length === 2, "mixed scenario did not emit user-input request");

    await assert.rejects(
      mixedRespondToServerRequest("wrong-mixed-input-id", {
        answers: {
          reply: {
            answers: ["ignored"],
          },
        },
      }),
      /Unexpected reverse request id/,
    );

    await mixedRespondToServerRequest(mixedRequests[1]?.id ?? "", {
      answers: {
        reply: {
          answers: ["mixed strict match"],
        },
      },
    });
    await mixedTurn;
    await mixedSession.close();
  });

});

test("Journey session rejectServerRequest 不应把 CLIENT_DISCONNECTED 直接等价成 session closed", async () => {
  const state = createJourneySessionState({
    scenario: "approval-then-input",
    workingDirectory: "/tmp/themis-feishu-journey-reject-close",
    mixedRecoveryInputDelayMs: 0,
  });
  const session = createJourneySession(state);
  const requests: AppServerReverseRequest[] = [];

  session.onServerRequest((request) => {
    requests.push(request);
  });

  await session.initialize();
  await session.startThread({
    cwd: state.workingDirectory,
    persistExtendedHistory: true,
  });

  const turnPromise = session.startTurn(JOURNEY_THREAD_ID, "journey reject close semantics");
  let turnSettled = false;
  void turnPromise.finally(() => {
    turnSettled = true;
  });
  await waitFor(() => requests.length === 1, "approval request was not emitted");
  const rejectServerRequest = session.rejectServerRequest;
  assert.ok(rejectServerRequest);

  await rejectServerRequest(requests[0]?.id ?? "", new Error("CLIENT_DISCONNECTED"));

  assert.equal(state.feishuState.lastRejectedServerRequestError, "CLIENT_DISCONNECTED");
  assert.equal(requests.length, 1);
  assert.equal(state.currentTurnStatus, "waiting");

  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(requests.length, 1);
  assert.equal(state.currentTurnStatus, "waiting");
  assert.equal(turnSettled, false);

  await session.close();
  await turnPromise;
  assert.equal(state.currentTurnStatus, "completed");
});

test("Journey session 在 user-input 完成后会发出 turn/completed，避免 runtime 一直等待", async () => {
  const state = createJourneySessionState({
    scenario: "single-user-input",
    workingDirectory: "/tmp/themis-feishu-journey-complete",
  });
  const session = createJourneySession(state);
  const notifications: Array<{ method: string; params?: unknown }> = [];
  const requests: AppServerReverseRequest[] = [];

  session.onNotification((notification) => {
    notifications.push(notification);
  });
  session.onServerRequest((request) => {
    requests.push(request);
  });

  const startTurnPromise = session.startTurn(JOURNEY_THREAD_ID, "请等待补充输入");
  await waitFor(() => requests.length === 1, "missing user-input reverse request");
  const respondToServerRequest = session.respondToServerRequest;
  assert.ok(respondToServerRequest);
  await respondToServerRequest(requests[0]?.id ?? "", {
    answers: {
      reply: {
        answers: ["这是新的补充输入"],
      },
    },
  });
  await startTurnPromise;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

  assert.equal(
    notifications.some((notification) => notification.method === "turn/completed"),
    true,
  );
});

test("真实 Web->飞书 mixed recovery 在 approval 后立即断流时仍会通过 /use + direct-text takeover 收口", async () => {
  await withHttpFeishuJourneyServer({
    scenario: "approval-then-input",
    run: async ({ baseUrl, root, runtimeStore, authHeaders, feishu }) => {
      const sessionId = "session-web-feishu-detached-mixed-journey-1";
      const workspace = join(root, "workspace-feishu-detached-mixed-journey");
      seedCompletedWebOwnerPersona(runtimeStore);
      writeWorkspaceDocs(workspace, {
        readmeTitle: "workspace-feishu-detached-mixed-journey",
      });

      try {
        const saveWorkspaceResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/settings`, {
          method: "PUT",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            settings: {
              workspacePath: workspace,
            },
          }),
        });
        assert.equal(saveWorkspaceResponse.status, 200);

        const streamResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionId,
            goal: "请先等待审批，再等待我补充输入，最后继续执行",
            options: {
              runtimeEngine: "app-server",
            },
          }),
        });
        assert.equal(streamResponse.status, 200);
        assert.ok(streamResponse.body);

        const reader = createNdjsonStreamReader(streamResponse.body!);
        await withTimeout(
          reader.readUntil((lines) => lines.some((line) => line.kind === "event" && line.title === "task.action_required")),
          "missing detached mixed approval action_required",
        );

        const firstAction = await waitForHistoryActionId(baseUrl, authHeaders, sessionId, MIXED_APPROVAL_ACTION_ID);
        assert.equal(firstAction.actionType, "approval");

        await feishu.handleCommand("use", [sessionId]);
        const switchMessages = feishu.takeMessages().join("\n");
        assert.match(switchMessages, new RegExp(`已切换到会话：${sessionId}`));
        assert.equal(feishu.getCurrentSessionId(), sessionId);
        const beforeTaskRuntimeCalls = feishu.getTaskRuntimeCalls();

        await feishu.handleCommand("approve", [MIXED_APPROVAL_ACTION_ID]);
        await reader.cancel();

        const restoredSecondAction = await waitForHistoryActionId(baseUrl, authHeaders, sessionId, MIXED_INPUT_ACTION_ID, 200);
        assert.ok(restoredSecondAction);
        assert.equal(restoredSecondAction.actionType, "user-input");

        await feishu.handleMessageEventText("这是 detached mixed recovery 的最终补充");

        const messages = feishu.takeMessages().join("\n");
        assert.match(messages, /已提交补充输入。/);
        assert.deepEqual(feishu.getTaskRuntimeCalls(), beforeTaskRuntimeCalls);

        const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
        assert.equal(completedHistory.turns?.[0]?.status, "completed");
        assert.equal(
          completedHistory.turns?.[0]?.events?.filter((event) => event.type === "task.action_required").length,
          2,
        );
      } finally {
        await feishu.closeActiveSession();
      }
    },
  });
});

interface FeishuJourneyHarnessContext {
  chatId: string;
  messageId: string;
  userId: string;
  text: string;
}

interface FeishuJourneyHarnessResult {
  baseUrl: string;
  root: string;
  runtimeStore: SqliteCodexSessionRegistry;
  authHeaders: Record<string, string>;
  feishu: FeishuJourneyHarness;
}

interface FeishuJourneyHarness {
  handleCommand(name: string, args: string[]): Promise<void>;
  handleMessageEventText(text: string): Promise<void>;
  takeMessages(): string[];
  peekMessages(): string[];
  takeSingleMessage(): string;
  getTaskRuntimeCalls(): { sdk: number; appServer: number };
  getResolvedActionSubmissions(): TaskPendingActionSubmitRequest[];
  getCurrentSessionId(): string | null;
  getLastRejectedServerRequestError(): string | null;
  closeActiveSession(): Promise<void>;
}

type FeishuJourneyScenario = "single-user-input" | "approval-then-input";

interface UserInputJourneySessionState {
  taskRuntimeCalls: { sdk: number; appServer: number };
  resolvedActionSubmissions: TaskPendingActionSubmitRequest[];
  lastRejectedServerRequestError: string | null;
}

interface JourneyScenarioState {
  scenario: FeishuJourneyScenario;
  workingDirectory: string;
  mixedRecoveryInputDelayMs: number;
  feishuState: UserInputJourneySessionState;
  activeSession: AppServerTaskRuntimeSession | null;
  activeRunTaskPromise: Promise<TaskResult> | null;
  activeRunTaskSettledPromise: Promise<void> | null;
  currentTaskId: string;
  currentRequestId: string;
  currentThreadId: string;
  currentTurnStatus: "queued" | "running" | "waiting" | "completed";
  currentInputText: string | null;
}

type JourneyPendingServerRequest =
  | {
    id: string | number;
    kind: "approval";
    resolve: (value: { decision?: string } | null) => void;
  }
  | {
    id: string | number;
    kind: "input";
    actionId: string;
    resolve: (value: { answers?: Record<string, { answers: string[] }> } | null) => void;
  };

interface HistorySessionDetailPayload {
  turns?: Array<{
    status?: string;
    requestId?: string;
    taskId?: string;
    events?: Array<{
      type?: string;
      requestId?: string;
      taskId?: string;
      payloadJson?: string;
    }>;
  }>;
}

async function withHttpFeishuJourneyServer(
  input: {
    scenario?: FeishuJourneyScenario;
    run: (context: FeishuJourneyHarnessResult) => Promise<void>;
  },
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-feishu-journey-"));
  const controlDirectory = join(root, "control");
  mkdirSync(controlDirectory, { recursive: true });
  writeWorkspaceDocs(controlDirectory, {
    agents: "control-rule",
    readmeTitle: "control",
  });

  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const actionBridge = new AppServerActionBridge();
  const baseRuntime = new CodexTaskRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
  });
  const journeyState = createJourneySessionState({
    scenario: input.scenario ?? "single-user-input",
    workingDirectory: controlDirectory,
  });
  const journey = createJourneyRuntime({
    state: journeyState,
    runtimeStore,
    actionBridge,
  });
  const feishu = createFeishuJourneyHarness({
    root,
    runtimeStore,
    runtime: baseRuntime,
    state: journeyState,
    runtimeRegistry: {
      defaultRuntime: journey.runtime,
      runtimes: {
        "app-server": journey.runtime,
      },
    },
    actionBridge,
  });
  const server = createThemisHttpServer({
    runtime: baseRuntime,
    runtimeRegistry: {
      defaultRuntime: journey.runtime,
      runtimes: {
        "app-server": journey.runtime,
      },
    },
    actionBridge,
    authRuntime: createAuthRuntime({
      authenticated: false,
      requiresOpenaiAuth: false,
    }),
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

  try {
    await input.run({
      baseUrl,
      root,
      runtimeStore,
      authHeaders,
      feishu,
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
}

function createFeishuJourneyHarness(input: {
  root: string;
  runtimeStore: SqliteCodexSessionRegistry;
  runtime: CodexTaskRuntime;
  state: JourneyScenarioState;
  runtimeRegistry: {
    defaultRuntime: TaskRuntimeFacade;
    runtimes: Partial<Record<"sdk" | "app-server", TaskRuntimeFacade>>;
  };
  actionBridge: AppServerActionBridge;
}): FeishuJourneyHarness {
  const sessionStore = new FeishuSessionStore({
    filePath: join(input.root, "infra/local/feishu-sessions.json"),
  });
  const messages: string[] = [];
  const context: FeishuJourneyHarnessContext = {
    chatId: "chat-feishu-journey-1",
    messageId: "message-feishu-journey-1",
    userId: "user-feishu-journey-1",
    text: "",
  };
  const service = new FeishuChannelService({
    runtime: input.runtime,
    runtimeRegistry: input.runtimeRegistry,
    actionBridge: input.actionBridge,
    authRuntime: createAuthRuntime({
      authenticated: false,
      requiresOpenaiAuth: false,
    }),
    taskTimeoutMs: 5_000,
    sessionStore,
    logger: createJourneyLogger(),
  });
  const safeSendText = async (_chatId: string, text: string): Promise<void> => {
    messages.push(text);
  };

  (service as unknown as { safeSendText: typeof safeSendText }).safeSendText = safeSendText;
  (service as unknown as { client: unknown }).client = {
    im: {
      v1: {
        message: {
          create: async ({ data }: { data: { content: string } }) => {
            messages.push(extractFeishuRenderedText(data.content));
            return {
              data: {
                message_id: "msg-created-1",
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

  function conversationKey() {
    return {
      chatId: context.chatId,
      userId: context.userId,
    };
  }

  return {
    async handleCommand(name: string, args: string[]) {
      await (service as unknown as {
        handleCommand(command: { name: string; args: string[]; raw: string }, incomingContext: FeishuJourneyHarnessContext): Promise<void>;
      }).handleCommand({ name, args, raw: `/${name} ${args.join(" ")}`.trim() }, context);
    },
    async handleMessageEventText(text: string) {
      await (service as unknown as {
        handleMessageReceiveEvent(incomingContext: FeishuJourneyHarnessContext): Promise<void>;
      }).handleMessageReceiveEvent({ ...context, text });
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
    getTaskRuntimeCalls() {
      return { ...input.state.feishuState.taskRuntimeCalls };
    },
    getResolvedActionSubmissions() {
      return [...input.state.feishuState.resolvedActionSubmissions];
    },
    getCurrentSessionId() {
      return sessionStore.getActiveSessionId(conversationKey());
    },
    getLastRejectedServerRequestError() {
      return input.state.feishuState.lastRejectedServerRequestError;
    },
    async closeActiveSession() {
      const session = input.state.activeSession;

      if (!session) {
        return;
      }

      input.state.activeSession = null;
      await session.close();

      if (input.state.activeRunTaskSettledPromise) {
        await input.state.activeRunTaskSettledPromise;
      }
    },
  };
}

function createJourneySessionState(input: {
  scenario: FeishuJourneyScenario;
  workingDirectory: string;
  mixedRecoveryInputDelayMs?: number;
}): JourneyScenarioState {
  return {
    scenario: input.scenario,
    workingDirectory: input.workingDirectory,
    mixedRecoveryInputDelayMs: input.mixedRecoveryInputDelayMs ?? 30,
    feishuState: {
      taskRuntimeCalls: {
        sdk: 0,
        appServer: 0,
      },
      resolvedActionSubmissions: [],
      lastRejectedServerRequestError: null,
    },
    activeSession: null,
    activeRunTaskPromise: null,
    activeRunTaskSettledPromise: null,
    currentTaskId: "task-web-feishu-journey-1",
    currentRequestId: "request-web-feishu-journey-1",
    currentThreadId: JOURNEY_THREAD_ID,
    currentTurnStatus: "queued",
    currentInputText: null,
  };
}

function createJourneyRuntime(input: {
  state: JourneyScenarioState;
  runtimeStore: SqliteCodexSessionRegistry;
  actionBridge: AppServerActionBridge;
}): {
  runtime: TaskRuntimeFacade;
  state: JourneyScenarioState;
} {
  const appServerRuntime = new AppServerTaskRuntime({
    workingDirectory: input.state.workingDirectory,
    runtimeStore: input.runtimeStore,
    actionBridge: input.actionBridge,
    sessionFactory: async (): Promise<AppServerTaskRuntimeSession> => {
      const session = createJourneySession(input.state);
      input.state.activeSession = session;
      return session;
    },
  });

  return {
    state: input.state,
    runtime: {
      async runTask(request: TaskRequest, hooks: TaskRuntimeRunHooks = {}): Promise<TaskResult> {
        input.state.feishuState.taskRuntimeCalls.appServer += 1;
        input.state.currentTaskId = request.taskId ?? "task-web-feishu-journey-1";
        input.state.currentRequestId = request.requestId;
        input.state.currentThreadId = JOURNEY_THREAD_ID;
        input.state.currentTurnStatus = "queued";
        input.state.currentInputText = null;
        const runTaskPromise = appServerRuntime.runTask(request, hooks);
        const runTaskSettledPromise = runTaskPromise.then(() => undefined, () => undefined);
        input.state.activeRunTaskPromise = runTaskPromise;
        input.state.activeRunTaskSettledPromise = runTaskSettledPromise;

        try {
          return await runTaskPromise;
        } finally {
          if (input.state.activeRunTaskPromise === runTaskPromise) {
            input.state.activeRunTaskPromise = null;
          }
          if (input.state.activeRunTaskSettledPromise === runTaskSettledPromise) {
            input.state.activeRunTaskSettledPromise = null;
          }
        }
      },
      getRuntimeStore: () => appServerRuntime.getRuntimeStore(),
      getIdentityLinkService: () => appServerRuntime.getIdentityLinkService(),
      getPrincipalSkillsService: () => appServerRuntime.getPrincipalSkillsService(),
      ...(typeof appServerRuntime.startReview === "function"
        ? { startReview: appServerRuntime.startReview.bind(appServerRuntime) }
        : {}),
      ...(typeof appServerRuntime.steerTurn === "function"
        ? { steerTurn: appServerRuntime.steerTurn.bind(appServerRuntime) }
        : {}),
      ...(typeof appServerRuntime.readThreadSnapshot === "function"
        ? { readThreadSnapshot: appServerRuntime.readThreadSnapshot.bind(appServerRuntime) }
        : {}),
    },
  };
}

function createJourneySession(state: JourneyScenarioState): AppServerTaskRuntimeSession {
  let notificationHandler: ((notification: { method: string; params?: unknown }) => void) | null = null;
  let serverRequestHandler: ((request: AppServerReverseRequest) => void) | null = null;
  let pendingServerRequest: JourneyPendingServerRequest | null = null;
  let sessionClosed = false;
  let resolveSessionClosed!: () => void;
  const sessionClosedPromise = new Promise<void>((resolve) => {
    resolveSessionClosed = resolve;
  });
  const waitForSessionClosedOrDelay = (promise: Promise<void>, delayMs: number): Promise<void> => new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    const timer = setTimeout(() => {
      setImmediate(finish);
    }, delayMs);
    promise.then(() => {
      clearTimeout(timer);
      finish();
    });
  });

  const waitForApprovalResponse = (requestId: string | number): Promise<{ decision?: string } | null> => new Promise((resolve) => {
    assert.equal(pendingServerRequest, null, "Unexpected overlapping reverse requests.");
    pendingServerRequest = {
      id: requestId,
      kind: "approval",
      resolve,
    };
  });
  const waitForInputResponse = (
    requestId: string | number,
    actionId: string,
  ): Promise<{ answers?: Record<string, { answers: string[] }> } | null> => new Promise((resolve) => {
    assert.equal(pendingServerRequest, null, "Unexpected overlapping reverse requests.");
    pendingServerRequest = {
      id: requestId,
      kind: "input",
      actionId,
      resolve,
    };
  });

  return {
    initialize: async () => {},
    startThread: async () => {
      state.currentThreadId = JOURNEY_THREAD_ID;
      state.currentTurnStatus = "queued";
      state.currentInputText = null;
      return { threadId: JOURNEY_THREAD_ID };
    },
    resumeThread: async (threadId) => {
      state.currentThreadId = threadId;
      state.currentTurnStatus = "queued";
      state.currentInputText = null;
      return { threadId };
    },
    readThread: async (threadId) => ({
      threadId,
      preview: "app-server native preview",
      status: state.currentTurnStatus,
      cwd: state.workingDirectory,
      createdAt: "2026-03-31T12:00:00.000Z",
      updatedAt: state.currentInputText ? "2026-03-31T12:00:01.000Z" : "2026-03-31T12:00:00.000Z",
      turnCount: state.currentTurnStatus === "queued" ? 0 : 1,
      turns: [],
    }),
    startTurn: async () => {
      if (state.scenario === "single-user-input") {
        state.currentTurnStatus = "running";
        const inputRequestId = "server-input-web-feishu-1";
        const inputResponsePromise = waitForInputResponse(inputRequestId, JOURNEY_ACTION_ID);
        serverRequestHandler?.({
          id: inputRequestId,
          method: "item/tool/requestUserInput",
          params: {
            threadId: JOURNEY_THREAD_ID,
            turnId: "turn-web-feishu-journey-1",
            itemId: JOURNEY_ACTION_ID,
            questions: [
              {
                id: "reply",
                question: "请补充来自飞书的上下文",
              },
            ],
          },
        });
        state.currentTurnStatus = "waiting";

        const inputResponse = await inputResponsePromise;
        const inputText = requireJourneyInputText(inputResponse);

        notificationHandler?.({
          method: "item/agentMessage/delta",
          params: {
            itemId: "item-app-feishu-journey-1",
            text: `已按补充输入继续：${inputText}`,
          },
        });
        state.currentTurnStatus = "completed";
        setTimeout(() => {
          notificationHandler?.({
            method: "item/completed",
            params: {
              threadId: JOURNEY_THREAD_ID,
              turnId: "turn-web-feishu-journey-1",
              item: {
                type: "agentMessage",
                id: "item-app-feishu-journey-final-1",
                text: `已按补充输入继续：${inputText}`,
                phase: "final_answer",
                memoryCitation: null,
              },
            },
          });
          notificationHandler?.({
            method: "turn/completed",
            params: {
              threadId: JOURNEY_THREAD_ID,
              turn: {
                id: "turn-web-feishu-journey-1",
                items: [],
                status: "completed",
                error: null,
              },
            },
          });
        }, 0);
        return { turnId: "turn-web-feishu-journey-1" };
      }

      state.currentTurnStatus = "running";
      const approvalRequestId = "server-approval-web-feishu-mixed-1";
      const approvalResponsePromise = waitForApprovalResponse(approvalRequestId);
      serverRequestHandler?.({
        id: approvalRequestId,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: JOURNEY_THREAD_ID,
          turnId: "turn-web-feishu-mixed-1",
          itemId: MIXED_APPROVAL_ACTION_ID,
          approvalId: MIXED_APPROVAL_ACTION_ID,
          command: "codex app-server mixed recovery",
          reason: "Need first approval before requesting final input.",
        },
      });
      state.currentTurnStatus = "waiting";

      const approvalResponse = await Promise.race([
        approvalResponsePromise,
        sessionClosedPromise,
      ]);
      if (sessionClosed) {
        state.currentTurnStatus = "completed";
        return { turnId: "turn-web-feishu-mixed-1" };
      }
      assert.equal(approvalResponse?.decision, "accept");
      notificationHandler?.({
        method: "item/agentMessage/delta",
        params: {
          itemId: "item-app-feishu-mixed-running-1",
          text: "第一轮审批已通过，继续等待补充输入。",
        },
      });

      if (state.mixedRecoveryInputDelayMs > 0) {
        await waitForSessionClosedOrDelay(sessionClosedPromise, state.mixedRecoveryInputDelayMs);
      }

      if (sessionClosed) {
        state.currentTurnStatus = "completed";
        return { turnId: "turn-web-feishu-mixed-1" };
      }

      const inputRequestId = "server-input-web-feishu-mixed-2";
      const inputResponsePromise = waitForInputResponse(inputRequestId, MIXED_INPUT_ACTION_ID);
      serverRequestHandler?.({
        id: inputRequestId,
        method: "item/tool/requestUserInput",
        params: {
          threadId: JOURNEY_THREAD_ID,
          turnId: "turn-web-feishu-mixed-1",
          itemId: MIXED_INPUT_ACTION_ID,
          questions: [
            {
              id: "reply",
              question: "请补充 mixed recovery 的最终上下文",
            },
          ],
        },
      });
      state.currentTurnStatus = "waiting";

      const inputResponse = await Promise.race([
        inputResponsePromise,
        sessionClosedPromise,
      ]);
      if (sessionClosed) {
        state.currentTurnStatus = "completed";
        return { turnId: "turn-web-feishu-mixed-1" };
      }
      const inputText = requireJourneyInputText(inputResponse);

      notificationHandler?.({
        method: "item/agentMessage/delta",
        params: {
          itemId: "item-app-feishu-mixed-complete-1",
          text: `mixed recovery 已按补充输入继续：${inputText}`,
        },
      });
      state.currentTurnStatus = "completed";
      setTimeout(() => {
        notificationHandler?.({
          method: "item/completed",
          params: {
            threadId: JOURNEY_THREAD_ID,
            turnId: "turn-web-feishu-mixed-1",
            item: {
              type: "agentMessage",
              id: "item-app-feishu-mixed-final-1",
              text: `mixed recovery 已按补充输入继续：${inputText}`,
              phase: "final_answer",
              memoryCitation: null,
            },
          },
        });
        notificationHandler?.({
          method: "turn/completed",
          params: {
            threadId: JOURNEY_THREAD_ID,
            turn: {
              id: "turn-web-feishu-mixed-1",
              items: [],
              status: "completed",
              error: null,
            },
          },
        });
      }, 0);
      return { turnId: "turn-web-feishu-mixed-1" };
    },
    close: async () => {
      sessionClosed = true;
      resolveSessionClosed();
      state.activeSession = null;
    },
    onNotification: (handler) => {
      notificationHandler = handler;
    },
    onServerRequest: (handler) => {
      serverRequestHandler = handler;
    },
    respondToServerRequest: async (id, result) => {
      if (!pendingServerRequest) {
        throw new Error(`Unexpected reverse request id: ${String(id)} (no pending reverse request).`);
      }

      if (pendingServerRequest.id !== id) {
        throw new Error(
          `Unexpected reverse request id: ${String(id)} (expected ${String(pendingServerRequest.id)}).`,
        );
      }

      const activeRequest = pendingServerRequest;
      pendingServerRequest = null;

      if (activeRequest.kind === "approval") {
        state.feishuState.resolvedActionSubmissions.push({
          taskId: state.currentTaskId,
          requestId: state.currentRequestId,
          actionId: MIXED_APPROVAL_ACTION_ID,
          decision: "approve",
        });
        activeRequest.resolve(result as { decision?: string } | null);
        return;
      }

      const inputText = requireJourneyInputText(result);
      state.currentInputText = inputText;
      state.feishuState.resolvedActionSubmissions.push({
        taskId: state.currentTaskId,
        requestId: state.currentRequestId,
        actionId: activeRequest.actionId,
        inputText,
      });
      activeRequest.resolve(result as { answers?: Record<string, { answers: string[] }> } | null);
    },
    rejectServerRequest: async (id, error) => {
      if (pendingServerRequest && pendingServerRequest.id === id) {
        pendingServerRequest = null;
      }

      state.feishuState.lastRejectedServerRequestError = error instanceof Error
        ? error.message
        : String(error);

      if (state.feishuState.lastRejectedServerRequestError === "CLIENT_DISCONNECTED") {
        return;
      }

      throw error;
    },
  };
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
    });
  }
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

async function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = 1_000): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      timer.unref?.();
    }),
  ]);
}

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(message);
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 20);
      timer.unref?.();
    });
  }
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

function extractReplyInputText(result: unknown): string | null {
  const record = asRecord(result);
  const answers = asRecord(record?.answers);
  const reply = asRecord(answers?.reply);
  const replyAnswers = Array.isArray(reply?.answers) ? reply.answers : [];
  const text = typeof replyAnswers[0] === "string" ? replyAnswers[0].trim() : "";
  return text || null;
}

function requireJourneyInputText(result: unknown): string {
  const inputText = extractReplyInputText(result);

  if (!inputText) {
    throw new Error("requestUserInput response did not include answers.reply.answers[0].");
  }

  return inputText;
}

function listenServer(server: Server): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function seedCompletedWebOwnerPersona(runtimeStore: SqliteCodexSessionRegistry): void {
  const now = "2026-03-29T09:00:00.000Z";
  runtimeStore.savePrincipal({
    principalId: JOURNEY_PRINCIPAL_ID,
    displayName: "test-owner",
    createdAt: now,
    updatedAt: now,
  });
  runtimeStore.savePrincipalPersonaProfile({
    principalId: JOURNEY_PRINCIPAL_ID,
    profile: {
      preferredAddress: "乐意",
      workSummary: "负责 Themis 的设计与开发",
      collaborationStyle: "先给结论，再逐步拆解关键取舍",
      assistantLanguageStyle: "直接、清楚、不过度客套",
    },
    createdAt: now,
    updatedAt: now,
    completedAt: now,
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
  writeRuntimeFile(workspace, "docs/memory/2026/03/web-journey.md", "# web journey");
  writeRuntimeFile(workspace, "notes.txt", "journey note");
}

function writeRuntimeFile(root: string, path: string, content: string): void {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${content}\n`, "utf8");
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

function createJourneyLogger(): {
  info: () => void;
  warn: () => void;
  error: () => void;
} {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function createAuthRuntime(snapshot: {
  authenticated: boolean;
  requiresOpenaiAuth: boolean;
}): CodexAuthRuntime {
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

  return {
    readSnapshot: async () => snapshot,
    readThirdPartyProviderProfile: () => null,
    listAccounts: () => accounts,
    getActiveAccount: () => accounts[0] ?? null,
  } as unknown as CodexAuthRuntime;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}
