import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { Codex, Thread, ThreadEvent, ThreadOptions } from "@openai/codex-sdk";
import { AppServerActionBridge } from "../core/app-server-action-bridge.js";
import { AppServerTaskRuntime, type AppServerTaskRuntimeSession } from "../core/app-server-task-runtime.js";
import type { AppServerTurnInputPart } from "../core/codex-app-server.js";
import type { CodexAuthRuntime } from "../core/codex-auth.js";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { CodexThreadSessionStore } from "../core/codex-session-store.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  baseUrl: string;
  root: string;
  runtimeStore: SqliteCodexSessionRegistry;
  authHeaders: Record<string, string>;
  journeyCodex: JourneyCodexDouble;
  appServerJourneyState: AppServerJourneySessionState;
}

interface JourneyCodexDouble {
  capturedThreadOptions: ThreadOptions[];
  capturedPrompts: string[];
  calls: {
    start: ThreadOptions[];
    resume: Array<{ threadId: string; options: ThreadOptions }>;
  };
}

interface AppServerJourneySessionState {
  started: Array<{ cwd: string }>;
  resumed: Array<{ threadId: string; cwd: string }>;
  prompts: Array<string | AppServerTurnInputPart[]>;
  read: string[];
  approvalPlan: AppServerApprovalPlanEntry[];
  approvals: Array<{ id: string | number; method: string }>;
  respondedApprovals: Array<{ id: string | number; result: unknown }>;
  notificationHandler: ((notification: { method: string; params?: unknown }) => void) | null;
  serverRequestHandler: ((request: { id: string | number; method: string; params?: unknown }) => void) | null;
  resolveApproval: (() => void) | null;
}

type AppServerApprovalPlanEntry = {
  serverRequestId: string;
  approvalId: string;
  turnId: string;
  itemId: string;
  command: string;
  reason: string;
  waitForGate?: Promise<void>;
};

function stringifyAppServerTurnInput(input: string | AppServerTurnInputPart[] | undefined): string {
  if (typeof input === "string") {
    return input;
  }

  return JSON.stringify(input ?? []);
}

test("真实 Web 旅程在 app-server 下都能走通 owner 登录、workspace 保存、task stream 与 history 查询", async () => {
  await withHttpServer(async ({ baseUrl, root, runtimeStore, authHeaders, appServerJourneyState }) => {
    const sessionId = "session-web-journey-1";
    const workspace = join(root, "workspace");

    writeWorkspaceDocs(workspace);

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
    assert.equal(runtimeStore.getSessionTaskSettings(sessionId)?.settings.workspacePath, workspace);

    const taskResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: "请执行真实 web 旅程测试",
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
    assert.equal(runtimeStore.getSession(sessionId)?.threadId, "thread-app-web-journey-1");

    const resumedTaskResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: "请继续执行真实 web 旅程测试",
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(resumedTaskResponse.status, 200);

    const resumedNdjson = parseNdjson(await resumedTaskResponse.text());
    assert.ok(resumedNdjson.some((line) => line.kind === "result"));
    assert.deepEqual(resumedNdjson.slice(-1).map((line) => line.kind), ["done"]);

    const historyListResponse = await fetch(`${baseUrl}/api/history/sessions`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(historyListResponse.status, 200);

    const historyListPayload = await historyListResponse.json() as {
      sessions?: Array<{
        sessionId?: string;
      }>;
    };
    assert.ok(historyListPayload.sessions?.some((session) => session.sessionId === sessionId));

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
        events?: Array<{
          type?: string;
        }>;
        touchedFiles?: string[];
      }>;
    };

    assert.equal(historyDetailPayload.turns?.length, 2);
    assert.equal(appServerJourneyState.started.length, 1);
    assert.equal(appServerJourneyState.resumed.length, 1);
    assert.equal(appServerJourneyState.started[0]?.cwd, workspace);
    assert.equal(appServerJourneyState.resumed[0]?.threadId, "thread-app-web-journey-1");
    assert.equal(appServerJourneyState.resumed[0]?.cwd, workspace);
    assert.match(stringifyAppServerTurnInput(appServerJourneyState.prompts[0]), /真实 web 旅程测试/);
    assert.match(stringifyAppServerTurnInput(appServerJourneyState.prompts[1]), /继续执行真实 web 旅程测试/);
    assert.equal(runtimeStore.getSession(sessionId)?.threadId, "thread-app-web-journey-1");
    assert.deepEqual(historyDetailPayload.nativeThread, {
      threadId: "thread-app-web-journey-1",
      preview: "app-server native preview",
      turnCount: 2,
    });
    assert.deepEqual(appServerJourneyState.read, ["thread-app-web-journey-1"]);
    assert.equal(runtimeStore.getSession(sessionId)?.activeTaskId, undefined);
  });
});

test("真实 Web 旅程在 app-server 下会走通 action_required -> /api/tasks/actions -> 收口", async () => {
  await withHttpServer(async ({ baseUrl, root, runtimeStore, authHeaders, appServerJourneyState }) => {
    const sessionId = "session-web-journey-action-1";
    const workspace = join(root, "workspace-action");
    seedCompletedWebOwnerPersona(runtimeStore);

    writeWorkspaceDocs(workspace, {
      readmeTitle: "workspace-action",
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
        goal: "请等待审批后继续执行",
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
      "missing action_required",
    );
    const actionRequiredLine = partialLines.find(
      (line) => line.kind === "event" && line.title === "task.action_required",
    );

    assert.ok(actionRequiredLine);
    assert.deepEqual(partialLines.slice(0, 1).map((line) => line.kind), ["ack"]);
    assert.equal(actionRequiredLine?.metadata?.actionId, "approval-web-1", JSON.stringify(actionRequiredLine));
    assert.equal(actionRequiredLine?.metadata?.actionType, "approval", JSON.stringify(actionRequiredLine));
    assert.match(String(actionRequiredLine?.text ?? ""), /审批|approve|Need approval/);

    const actionSubmitResponse = await fetch(`${baseUrl}/api/tasks/actions`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskId: actionRequiredLine?.taskId,
        requestId: actionRequiredLine?.requestId,
        actionId: actionRequiredLine?.metadata?.actionId,
        decision: "approve",
      }),
    });

    assert.equal(actionSubmitResponse.status, 200);
    assert.deepEqual(await actionSubmitResponse.json(), {
      ok: true,
    });

    const remainingLines = await withTimeout(reader.readAll(), "stream did not finish after action submit");
    const ndjson = [...partialLines, ...remainingLines];

    assert.ok(ndjson.some((line) => line.kind === "result"));
    assert.deepEqual(ndjson.slice(-1).map((line) => line.kind), ["done"]);
    assert.deepEqual(appServerJourneyState.approvals, [{
      id: "server-approval-web-1",
      method: "item/commandExecution/requestApproval",
    }]);
    assert.deepEqual(appServerJourneyState.respondedApprovals, [{
      id: "server-approval-web-1",
      result: {
        decision: "accept",
      },
    }]);

    const historyDetailResponse = await fetch(`${baseUrl}/api/history/sessions/${sessionId}`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(historyDetailResponse.status, 200);

    const historyDetailPayload = await historyDetailResponse.json() as {
      turns?: Array<{
        status?: string;
        events?: Array<{
          type?: string;
        }>;
      }>;
    };

    assert.equal(historyDetailPayload.turns?.length, 1);
    assert.equal(historyDetailPayload.turns?.[0]?.status, "completed");
    assert.ok(historyDetailPayload.turns?.[0]?.events?.some((event) => event.type === "task.action_required"));
    assert.equal(runtimeStore.getSession(sessionId)?.threadId, "thread-app-web-journey-1");
  }, {
    appServerRequiresApproval: true,
  });
});

test("真实 Web 旅程在 app-server 下会在 action_required 断流后保留 waiting turn，并允许后续提交 action 恢复完成", async () => {
  await withHttpServer(async ({ baseUrl, root, runtimeStore, authHeaders }) => {
    const sessionId = "session-web-journey-action-recovery-1";
    const workspace = join(root, "workspace-action-recovery");
    seedCompletedWebOwnerPersona(runtimeStore);

    writeWorkspaceDocs(workspace, {
      readmeTitle: "workspace-action-recovery",
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
        goal: "请等待审批并在断流后恢复",
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
      "missing action_required before disconnect",
    );
    const actionRequiredLine = partialLines.find(
      (line) => line.kind === "event" && line.title === "task.action_required",
    );

    assert.ok(actionRequiredLine);
    await reader.cancel();

    const waitingHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "waiting");
    assert.equal(waitingHistory.turns?.length, 1);
    const restoredAction = extractActionRequiredFromHistory(waitingHistory);

    assert.ok(restoredAction);
    assert.equal(restoredAction.actionId, "approval-web-1");
    assert.equal(restoredAction.actionType, "approval");

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

    const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    assert.equal(completedHistory.turns?.length, 1);
    assert.equal(completedHistory.turns?.[0]?.status, "completed");
    assert.ok(completedHistory.turns?.[0]?.events?.some((event) => event.type === "task.action_required"));
    assert.equal(runtimeStore.getSession(sessionId)?.threadId, "thread-app-web-journey-1");
  }, {
    appServerRequiresApproval: true,
  });
});

test("真实 Web 旅程在 app-server 下会补齐双 waiting action 的长恢复链", async () => {
  await withHttpServer(async ({ baseUrl, root, runtimeStore, authHeaders, appServerJourneyState }) => {
    const sessionId = "session-web-journey-action-recovery-2";
    const workspace = join(root, "workspace-action-recovery-2");
    seedCompletedWebOwnerPersona(runtimeStore);

    writeWorkspaceDocs(workspace, {
      readmeTitle: "workspace-action-recovery-2",
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
        goal: "请等待两轮审批后继续执行",
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
      "missing first action_required before disconnect",
    );
    const firstActionRequiredLine = partialLines.find(
      (line) => line.kind === "event" && line.title === "task.action_required",
    );

    assert.ok(firstActionRequiredLine);
    assert.deepEqual(partialLines.slice(0, 1).map((line) => line.kind), ["ack"]);
    assert.equal(firstActionRequiredLine?.metadata?.actionId, "approval-web-1", JSON.stringify(firstActionRequiredLine));
    assert.equal(firstActionRequiredLine?.metadata?.actionType, "approval", JSON.stringify(firstActionRequiredLine));
    assert.match(String(firstActionRequiredLine?.text ?? ""), /审批|approve|Need approval/);

    await reader.cancel();

    const waitingHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "waiting");
    const firstAction = extractActionRequiredFromHistory(waitingHistory);

    assert.ok(firstAction);
    assert.equal(firstAction.actionId, "approval-web-1");
    assert.equal(firstAction.actionType, "approval");

    const firstActionSubmitResponse = await fetch(`${baseUrl}/api/tasks/actions`, {
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

    assert.equal(firstActionSubmitResponse.status, 200);
    assert.deepEqual(await firstActionSubmitResponse.json(), {
      ok: true,
    });

    const runningHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "running");
    assert.equal(runningHistory.turns?.length, 1);
    assert.equal(runningHistory.turns?.[0]?.status, "running");

    const secondAction = await waitForHistoryActionId(baseUrl, authHeaders, sessionId, "approval-web-2");
    assert.equal(secondAction.actionId, "approval-web-2");
    assert.equal(secondAction.actionType, "approval");

    const restoredSecondAction = await waitForHistoryActionId(baseUrl, authHeaders, sessionId, "approval-web-2");
    assert.equal(restoredSecondAction.taskId, secondAction.taskId);
    assert.equal(restoredSecondAction.requestId, secondAction.requestId);
    assert.equal(restoredSecondAction.actionId, "approval-web-2");
    assert.equal(restoredSecondAction.actionType, "approval");

    const secondActionSubmitResponse = await fetch(`${baseUrl}/api/tasks/actions`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskId: restoredSecondAction.taskId,
        requestId: restoredSecondAction.requestId,
        actionId: restoredSecondAction.actionId,
        decision: "approve",
      }),
    });

    assert.equal(secondActionSubmitResponse.status, 200);
    assert.deepEqual(await secondActionSubmitResponse.json(), {
      ok: true,
    });

    const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    assert.equal(completedHistory.turns?.length, 1);
    assert.equal(completedHistory.turns?.[0]?.status, "completed");
    assert.ok(completedHistory.turns?.[0]?.events?.some((event) => event.type === "task.action_required"));
    assert.equal(runtimeStore.getSession(sessionId)?.threadId, "thread-app-web-journey-1");
    assert.deepEqual(appServerJourneyState.approvals, [
      {
        id: "server-approval-web-1",
        method: "item/commandExecution/requestApproval",
      },
      {
        id: "server-approval-web-2",
        method: "item/commandExecution/requestApproval",
      },
    ]);
    assert.deepEqual(appServerJourneyState.respondedApprovals.map((item) => item.id), [
      "server-approval-web-1",
      "server-approval-web-2",
    ]);
    assert.deepEqual(appServerJourneyState.respondedApprovals, [
      {
        id: "server-approval-web-1",
        result: {
          decision: "accept",
        },
      },
      {
        id: "server-approval-web-2",
        result: {
          decision: "accept",
        },
      },
    ]);
  }, {
    appServerApprovalPlan: [
      {
        serverRequestId: "server-approval-web-1",
        approvalId: "approval-web-1",
        turnId: "turn-app-web-journey-action-2",
        itemId: "item-app-web-journey-approval-1",
        command: "rm -rf tmp",
        reason: "Need approval 1",
      },
      {
        serverRequestId: "server-approval-web-2",
        approvalId: "approval-web-2",
        turnId: "turn-app-web-journey-action-2",
        itemId: "item-app-web-journey-approval-2",
        command: "rm -rf tmp",
        reason: "Need approval 2",
      },
    ],
  });
});

test("真实 Web 旅程在 app-server 下会在更长 running 与多次 history/detail 交错后才进入第二轮 waiting", async () => {
  let releaseSecondApprovalGate: (() => void) | null = null;
  const secondApprovalGate = new Promise<void>((resolve) => {
    releaseSecondApprovalGate = resolve;
  });

  await withHttpServer(async ({ baseUrl, root, runtimeStore, authHeaders }) => {
    const sessionId = "session-web-journey-running-history-tail-1";
    const workspace = join(root, "workspace-running-history-tail");
    seedCompletedWebOwnerPersona(runtimeStore);

    writeWorkspaceDocs(workspace, {
      readmeTitle: "workspace-running-history-tail",
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
        goal: "请在长 running 和多次 history 轮询后再进入第二轮审批",
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
      "missing first action_required before disconnect",
    );
    await reader.cancel();

    const firstWaitingHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "waiting");
    const firstAction = extractActionRequiredFromHistory(firstWaitingHistory);
    assert.ok(firstAction);

    const firstActionSubmitResponse = await fetch(`${baseUrl}/api/tasks/actions`, {
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
    assert.equal(firstActionSubmitResponse.status, 200);

    const runningHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "running");
    assert.equal(runningHistory.turns?.[0]?.status, "running");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const historyDetail = await readHistoryDetail(baseUrl, authHeaders, sessionId);
      assert.equal(historyDetail.turns?.[0]?.status, "running");
      assert.equal(extractActionRequiredFromHistory(historyDetail), null);
    }

    releaseSecondApprovalGate?.();

    const secondAction = await waitForHistoryActionId(baseUrl, authHeaders, sessionId, "approval-web-2");
    assert.equal(secondAction.actionId, "approval-web-2");

    const secondActionSubmitResponse = await fetch(`${baseUrl}/api/tasks/actions`, {
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
    assert.equal(secondActionSubmitResponse.status, 200);
    assert.deepEqual(await secondActionSubmitResponse.json(), {
      ok: true,
    });

    const completedHistory = await waitForHistoryTurnStatus(baseUrl, authHeaders, sessionId, "completed");
    assert.equal(completedHistory.turns?.[0]?.status, "completed");
  }, {
    appServerApprovalPlan: [
      {
        serverRequestId: "server-approval-web-1",
        approvalId: "approval-web-1",
        turnId: "turn-app-web-journey-running-1",
        itemId: "item-app-web-journey-approval-1",
        command: "rm -rf tmp",
        reason: "Need approval 1",
      },
      {
        serverRequestId: "server-approval-web-2",
        approvalId: "approval-web-2",
        turnId: "turn-app-web-journey-running-2",
        itemId: "item-app-web-journey-approval-2",
        command: "git push",
        reason: "Need approval 2",
        waitForGate: secondApprovalGate,
      },
    ],
  });
});

async function withHttpServer(
  run: (context: TestServerContext) => Promise<void>,
  options: {
    appServerRequiresApproval?: boolean;
    appServerApprovalPlan?: AppServerApprovalPlanEntry[];
  } = {},
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-web-journey-"));
  const controlDirectory = join(root, "control");
  mkdirSync(controlDirectory, { recursive: true });
  writeWorkspaceDocs(controlDirectory, {
    agents: "control-rule",
    readmeTitle: "control",
  });

  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const { codex, journeyCodex } = createJourneyCodexDouble();
  const journeyStore = new CodexThreadSessionStore({
    codex,
    sessionRegistry: runtimeStore,
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
    sessionStore: journeyStore,
  });
  const actionBridge = new AppServerActionBridge();
  const appServerJourneyState = createAppServerJourneySessionState(
    options.appServerApprovalPlan ?? (options.appServerRequiresApproval
      ? [{
          serverRequestId: "server-approval-web-1",
          approvalId: "approval-web-1",
          turnId: "turn-app-web-journey-action-1",
          itemId: "item-app-web-journey-approval-1",
          command: "rm -rf tmp",
          reason: "Need approval",
        }]
      : []),
  );
  const appServerRuntime = new AppServerTaskRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
    actionBridge,
    sessionFactory: async (): Promise<AppServerTaskRuntimeSession> => ({
      initialize: async () => {},
      startThread: async (params) => {
        appServerJourneyState.started.push({ cwd: params.cwd });
        return { threadId: "thread-app-web-journey-1" };
      },
      resumeThread: async (threadId, params) => {
        appServerJourneyState.resumed.push({ threadId, cwd: params.cwd });
        return { threadId };
      },
      readThread: async (threadId) => {
        appServerJourneyState.read.push(threadId);
        return {
          threadId,
          preview: "app-server native preview",
          status: "idle",
          cwd: controlDirectory,
          createdAt: "2026-03-29T08:00:00.000Z",
          updatedAt: "2026-03-29T08:05:00.000Z",
          turnCount: 2,
          turns: [],
        };
      },
      startTurn: async (_threadId, prompt) => {
        appServerJourneyState.prompts.push(prompt);
        const completionTurnId = "turn-app-web-journey-1";
        const completionMessage = "真实 web 旅程测试已完成";

        for (const approval of appServerJourneyState.approvalPlan) {
          await approval.waitForGate;
          appServerJourneyState.approvals.push({
            id: approval.serverRequestId,
            method: "item/commandExecution/requestApproval",
          });
          const approvalResolved = new Promise<void>((resolve) => {
            appServerJourneyState.resolveApproval = resolve;
          });
          appServerJourneyState.serverRequestHandler?.({
            id: approval.serverRequestId,
            method: "item/commandExecution/requestApproval",
            params: {
              threadId: "thread-app-web-journey-1",
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
                text: "第一轮审批通过，继续处理后续步骤。",
              },
            });
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, 300);
              timer.unref?.();
            });
          }
        }

        setTimeout(() => {
          appServerJourneyState.notificationHandler?.({
            method: "item/completed",
            params: {
              threadId: "thread-app-web-journey-1",
              turnId: completionTurnId,
              item: {
                type: "agentMessage",
                id: "item-app-web-journey-final-1",
                text: completionMessage,
                phase: "final_answer",
                memoryCitation: null,
              },
            },
          });
          appServerJourneyState.notificationHandler?.({
            method: "turn/completed",
            params: {
              threadId: "thread-app-web-journey-1",
              turn: {
                id: completionTurnId,
                items: [],
                status: "completed",
                error: null,
              },
            },
          });
        }, 0);

        return { turnId: completionTurnId };
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
  const server = createThemisHttpServer({
    runtime,
    runtimeRegistry: {
      defaultRuntime: runtime,
      runtimes: {
        "app-server": appServerRuntime,
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
    await run({
      baseUrl,
      root,
      runtimeStore,
      authHeaders,
      journeyCodex,
      appServerJourneyState,
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
}

function createJourneyCodexDouble(): {
  codex: Codex;
  journeyCodex: JourneyCodexDouble;
} {
  const capturedThreadOptions: ThreadOptions[] = [];
  const capturedPrompts: string[] = [];
  const calls = {
    start: [] as ThreadOptions[],
    resume: [] as Array<{ threadId: string; options: ThreadOptions }>,
  };

  return {
    codex: {
      startThread(options: ThreadOptions) {
        calls.start.push(options);
        capturedThreadOptions.push(options);
        return createJourneyThread(options);
      },
      resumeThread(threadId: string, options: ThreadOptions) {
        calls.resume.push({ threadId, options });
        capturedThreadOptions.push(options);
        return createJourneyThread(options);
      },
    } as Codex,
    journeyCodex: {
      calls,
      capturedThreadOptions,
      capturedPrompts,
    },
  };

  function createJourneyThread(threadOptions: ThreadOptions): Thread {
    return {
      id: "thread-web-journey-1",
      runStreamed: async (prompt: string) => {
        capturedPrompts.push(prompt);
        const workspace = String(threadOptions.workingDirectory ?? "");

        return {
          events: createThreadEvents(workspace),
        };
      },
    } as Thread;
  }
}

function createAppServerJourneySessionState(
  approvalPlan: AppServerApprovalPlanEntry[] = [],
): AppServerJourneySessionState {
  return {
    started: [],
    resumed: [],
    prompts: [],
    read: [],
    approvalPlan,
    approvals: [],
    respondedApprovals: [],
    notificationHandler: null,
    serverRequestHandler: null,
    resolveApproval: null,
  };
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

async function waitForHistoryTurnStatus(
  baseUrl: string,
  authHeaders: Record<string, string>,
  sessionId: string,
  expectedStatus: string,
  timeoutMs = 1_000,
): Promise<HistorySessionDetailPayload> {
  const startedAt = Date.now();

  while (true) {
    const historyDetailResponse = await fetch(`${baseUrl}/api/history/sessions/${sessionId}`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(historyDetailResponse.status, 200);

    const historyDetailPayload = await historyDetailResponse.json() as HistorySessionDetailPayload;

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

async function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = 1000): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      timer.unref?.();
    }),
  ]);
}

type HistorySessionDetailPayload = {
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
};

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
    principalId: "principal-local-owner",
    displayName: "test-owner",
    createdAt: now,
    updatedAt: now,
  });
  runtimeStore.savePrincipalPersonaProfile({
    principalId: "principal-local-owner",
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

function writeRuntimeFile(root: string, path: string, content: string): void {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${content}\n`, "utf8");
}

function createThreadEvents(workspace: string): AsyncGenerator<ThreadEvent> {
  const events: ThreadEvent[] = [
    {
      type: "thread.started",
      thread_id: "thread-web-journey-1",
    },
    {
      type: "turn.started",
    },
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        id: "item-web-journey-message",
        text: "真实 web 旅程测试已完成",
      },
    },
    {
      type: "item.completed",
      item: {
        type: "file_change",
        id: "item-web-journey-file",
        status: "completed",
        changes: [
          {
            path: join(workspace, "notes.txt"),
            kind: "update",
          },
        ],
      },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 1,
        cached_input_tokens: 0,
        output_tokens: 1,
      },
    },
  ];

  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

function createAuthRuntime(snapshot: {
  authenticated: boolean;
  requiresOpenaiAuth: boolean;
}): CodexAuthRuntime {
  return {
    readSnapshot: async () => snapshot,
    readThirdPartyProviderProfile: () => null,
  } as unknown as CodexAuthRuntime;
}
