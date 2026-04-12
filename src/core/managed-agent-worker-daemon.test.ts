import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  AppServerReverseRequest,
  AppServerThreadStartParams,
  CodexAppServerNotification,
} from "./codex-app-server.js";
import type {
  AppServerTaskRuntimeOptions,
  AppServerTaskRuntimeSession,
} from "./app-server-task-runtime.js";
import { AppServerTaskRuntime } from "./app-server-task-runtime.js";
import { CodexTaskRuntime } from "./codex-runtime.js";
import { ManagedAgentPlatformWorkerClient } from "./managed-agent-platform-worker-client.js";
import { ManagedAgentWorkerDaemon } from "./managed-agent-worker-daemon.js";
import { WebAccessService } from "./web-access.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "../server/http-server.js";

interface SessionDoubleState {
  started: AppServerThreadStartParams[];
  turns: Array<{
    threadId: string;
    input: string;
  }>;
  notificationHandler: ((notification: CodexAppServerNotification) => void) | null;
  serverRequestHandler: ((request: AppServerReverseRequest) => void) | null;
}

interface WorkerHarness {
  platformRoot: string;
  workerRoot: string;
  platformRuntimeStore: SqliteCodexSessionRegistry;
  platformRuntime: CodexTaskRuntime;
  workerRuntimeStore: SqliteCodexSessionRegistry;
  workerRuntime: AppServerTaskRuntime;
  baseUrl: string;
  secret: string;
  close: () => Promise<void>;
}

function createCompletionSessionFactory(): {
  state: SessionDoubleState;
  sessionFactory: AppServerTaskRuntimeOptions["sessionFactory"];
} {
  const state: SessionDoubleState = {
    started: [],
    turns: [],
    notificationHandler: null,
    serverRequestHandler: null,
  };

  return {
    state,
    sessionFactory: async (): Promise<AppServerTaskRuntimeSession> => ({
      initialize: async () => {},
      startThread: async (params) => {
        state.started.push({ ...params });
        return { threadId: "thread-worker-daemon-complete-1" };
      },
      resumeThread: async (threadId) => ({ threadId }),
      startTurn: async (threadId, input) => {
        const prompt = typeof input === "string" ? input : JSON.stringify(input);
        state.turns.push({ threadId, input: prompt });
        state.notificationHandler?.({
          method: "item/completed",
          params: {
            item: {
              type: "agentMessage",
              phase: "final_answer",
              text: "Worker daemon 已完成平台任务",
            },
          },
        });
        setTimeout(() => {
          state.notificationHandler?.({
            method: "turn/completed",
            params: {
              threadId,
              turn: {
                id: "turn-worker-daemon-complete-1",
                items: [],
                status: "completed",
                error: null,
              },
            },
          });
        }, 0);
        return { turnId: "turn-worker-daemon-complete-1" };
      },
      interruptTurn: async () => {},
      close: async () => {},
      onNotification: (handler) => {
        state.notificationHandler = handler;
      },
      onServerRequest: (handler) => {
        state.serverRequestHandler = handler;
      },
      respondToServerRequest: async () => {},
      rejectServerRequest: async () => {},
    }),
  };
}

function createWaitingSessionFactory(): {
  state: SessionDoubleState;
  sessionFactory: AppServerTaskRuntimeOptions["sessionFactory"];
} {
  const state: SessionDoubleState = {
    started: [],
    turns: [],
    notificationHandler: null,
    serverRequestHandler: null,
  };

  return {
    state,
    sessionFactory: async (): Promise<AppServerTaskRuntimeSession> => ({
      initialize: async () => {},
      startThread: async (params) => {
        state.started.push({ ...params });
        return { threadId: "thread-worker-daemon-waiting-1" };
      },
      resumeThread: async (threadId) => ({ threadId }),
      startTurn: async (threadId, input) => {
        const prompt = typeof input === "string" ? input : JSON.stringify(input);
        state.turns.push({ threadId, input: prompt });
        state.serverRequestHandler?.({
          id: "server-approval-worker-daemon-1",
          method: "item/commandExecution/requestApproval",
          params: {
            threadId,
            turnId: "turn-worker-daemon-waiting-1",
            itemId: "item-approval-worker-daemon-1",
            approvalId: "approval-worker-daemon-1",
            command: "git push origin main",
            reason: "Need approval",
          },
        });
        return { turnId: "turn-worker-daemon-waiting-1" };
      },
      interruptTurn: async () => {},
      close: async () => {},
      onNotification: (handler) => {
        state.notificationHandler = handler;
      },
      onServerRequest: (handler) => {
        state.serverRequestHandler = handler;
      },
      respondToServerRequest: async () => {},
      rejectServerRequest: async () => {},
    }),
  };
}

async function createWorkerHarness(
  sessionFactory: AppServerTaskRuntimeOptions["sessionFactory"],
): Promise<WorkerHarness> {
  const platformRoot = mkdtempSync(join(tmpdir(), "themis-platform-worker-daemon-platform-"));
  const workerRoot = mkdtempSync(join(tmpdir(), "themis-platform-worker-daemon-worker-"));
  const platformRuntimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(platformRoot, "infra/local/themis.db"),
  });
  const platformRuntime = new CodexTaskRuntime({
    workingDirectory: platformRoot,
    runtimeStore: platformRuntimeStore,
  });
  const workerRuntimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(workerRoot, "infra/local/themis.db"),
  });
  workerRuntimeStore.saveAuthAccount({
    accountId: "default",
    label: "默认账号",
    codexHome: join(workerRoot, "infra/local/codex-auth/default"),
    isActive: true,
    createdAt: "2026-04-12T22:59:00.000Z",
    updatedAt: "2026-04-12T22:59:00.000Z",
  });
  const workerRuntime = new AppServerTaskRuntime({
    workingDirectory: workerRoot,
    runtimeStore: workerRuntimeStore,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
  const secret = "worker-daemon-secret";
  const webAccess = new WebAccessService({ registry: platformRuntimeStore });
  webAccess.createToken({
    label: "worker-daemon",
    secret,
  });
  const server = createThemisHttpServer({
    runtime: platformRuntime,
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address.");
  }

  return {
    platformRoot,
    workerRoot,
    platformRuntimeStore,
    platformRuntime,
    workerRuntimeStore,
    workerRuntime,
    baseUrl: `http://127.0.0.1:${address.port}`,
    secret,
    close: async () => {
      await closeServer(listeningServer);
      rmSync(platformRoot, { recursive: true, force: true });
      rmSync(workerRoot, { recursive: true, force: true });
    },
  };
}

test("ManagedAgentWorkerDaemon 会通过平台 HTTP 注册节点、拉取 run 并完成执行收口", async () => {
  const { state, sessionFactory } = createCompletionSessionFactory();
  const harness = await createWorkerHarness(sessionFactory);

  try {
    harness.platformRuntimeStore.savePrincipal({
      principalId: "principal-owner",
      displayName: "平台负责人",
      kind: "human_user",
      createdAt: "2026-04-12T23:00:00.000Z",
      updatedAt: "2026-04-12T23:00:00.000Z",
    });

    const backend = harness.platformRuntime.getManagedAgentsService().createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·序",
      departmentRole: "后端",
      mission: "负责上游派工。",
      now: "2026-04-12T23:01:00.000Z",
    });
    const workerAgent = harness.platformRuntime.getManagedAgentsService().createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "执行·远",
      departmentRole: "执行",
      mission: "负责远端 Worker Node 执行。",
      now: "2026-04-12T23:02:00.000Z",
    });

    const client = new ManagedAgentPlatformWorkerClient({
      baseUrl: harness.baseUrl,
      ownerPrincipalId: "principal-owner",
      webAccessToken: harness.secret,
    });
    const daemon = new ManagedAgentWorkerDaemon({
      client,
      runtime: harness.workerRuntime,
      node: {
        displayName: "Worker Node A",
        slotCapacity: 1,
        slotAvailable: 1,
        credentialCapabilities: ["default"],
        workspaceCapabilities: [harness.workerRoot],
      },
    });

    const first = await daemon.runOnce();
    assert.equal(first.result, "idle");
    assert.ok(first.nodeId);

    const dispatched = harness.platformRuntime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: workerAgent.agent.agentId,
      sourceType: "agent",
      sourceAgentId: backend.agent.agentId,
      sourcePrincipalId: backend.principal.principalId,
      dispatchReason: "worker-daemon-http",
      goal: "验证真正 daemon 通过平台 HTTP 收口完成结果。",
      workspacePolicySnapshot: {
        workspacePath: harness.workerRoot,
      },
      now: "2026-04-12T23:03:00.000Z",
    });

    const claim = harness.platformRuntime.getManagedAgentSchedulerService().claimNextRunnableWorkItem({
      schedulerId: "scheduler-worker-daemon-http",
    });
    assert.equal(claim?.node?.nodeId, first.nodeId);

    const second = await daemon.runOnce();
    assert.equal(second.result, "completed");
    assert.equal(second.executedRunId, claim?.run.runId ?? null);
    assert.equal(state.started.length, 1);
    assert.match(state.turns[0]?.input ?? "", /真正 daemon/);

    const platformRun = harness.platformRuntimeStore.getAgentRun(claim?.run.runId ?? "");
    const platformWorkItem = harness.platformRuntimeStore.getAgentWorkItem(dispatched.workItem.workItemId);
    assert.equal(platformRun?.status, "completed");
    assert.equal(platformWorkItem?.status, "completed");
    assert.equal(harness.platformRuntimeStore.getActiveAgentExecutionLeaseByRun(claim?.run.runId ?? ""), null);

    const backendMailbox = harness.platformRuntime.getManagedAgentCoordinationService().listMailbox(
      "principal-owner",
      backend.agent.agentId,
    );
    assert.equal(backendMailbox.length, 1);
    assert.equal(backendMailbox[0]?.message.messageType, "answer");
    assert.match(String((backendMailbox[0]?.message.payload as { summary?: string } | undefined)?.summary ?? ""), /Worker daemon/);
    const handoffs = harness.platformRuntimeStore.listAgentHandoffsByWorkItem(dispatched.workItem.workItemId);
    assert.equal(handoffs.length, 1);

    const localAgent = harness.workerRuntimeStore.getManagedAgent(workerAgent.agent.agentId);
    const localWorkspacePolicy = harness.workerRuntimeStore.getAgentWorkspacePolicy(workerAgent.agent.defaultWorkspacePolicyId ?? "");
    const localRuntimeProfile = harness.workerRuntimeStore.getAgentRuntimeProfile(workerAgent.agent.defaultRuntimeProfileId ?? "");
    const localWorkspace = harness.workerRuntimeStore.getSessionTaskSettings(`agent-work-item:${dispatched.workItem.workItemId}`);
    assert.equal(localAgent?.principalId, workerAgent.agent.principalId);
    assert.equal(localAgent?.defaultWorkspacePolicyId, workerAgent.agent.defaultWorkspacePolicyId);
    assert.equal(localAgent?.defaultRuntimeProfileId, workerAgent.agent.defaultRuntimeProfileId);
    assert.equal(localWorkspacePolicy?.workspacePath, harness.workerRoot);
    assert.equal(localRuntimeProfile?.authAccountId, "default");
    assert.equal(localWorkspace?.settings.workspacePath, harness.workerRoot);
  } finally {
    await harness.close();
  }
});

test("ManagedAgentWorkerDaemon 会把 waiting_action 通过平台 HTTP 回传并保留平台侧治理上下文", async () => {
  const { sessionFactory } = createWaitingSessionFactory();
  const harness = await createWorkerHarness(sessionFactory);

  try {
    harness.platformRuntimeStore.savePrincipal({
      principalId: "principal-owner",
      displayName: "平台负责人",
      kind: "human_user",
      createdAt: "2026-04-12T23:10:00.000Z",
      updatedAt: "2026-04-12T23:10:00.000Z",
    });

    const backend = harness.platformRuntime.getManagedAgentsService().createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·问",
      departmentRole: "后端",
      mission: "负责处理等待审批。",
      now: "2026-04-12T23:11:00.000Z",
    });
    const workerAgent = harness.platformRuntime.getManagedAgentsService().createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "执行·等",
      departmentRole: "执行",
      mission: "负责远端等待态。",
      now: "2026-04-12T23:12:00.000Z",
    });

    const client = new ManagedAgentPlatformWorkerClient({
      baseUrl: harness.baseUrl,
      ownerPrincipalId: "principal-owner",
      webAccessToken: harness.secret,
    });
    const daemon = new ManagedAgentWorkerDaemon({
      client,
      runtime: harness.workerRuntime,
      node: {
        displayName: "Worker Node B",
        slotCapacity: 1,
        slotAvailable: 1,
        credentialCapabilities: ["default"],
        workspaceCapabilities: [harness.workerRoot],
      },
    });

    const first = await daemon.runOnce();
    assert.equal(first.result, "idle");

    const dispatched = harness.platformRuntime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: workerAgent.agent.agentId,
      sourceType: "agent",
      sourceAgentId: backend.agent.agentId,
      sourcePrincipalId: backend.principal.principalId,
      dispatchReason: "worker-daemon-http-waiting",
      goal: "验证真正 daemon 通过平台 HTTP 回传 waiting。",
      workspacePolicySnapshot: {
        workspacePath: harness.workerRoot,
      },
      now: "2026-04-12T23:13:00.000Z",
    });

    const claim = harness.platformRuntime.getManagedAgentSchedulerService().claimNextRunnableWorkItem({
      schedulerId: "scheduler-worker-daemon-waiting",
    });
    assert.equal(claim?.node?.nodeId, first.nodeId);

    const second = await daemon.runOnce();
    assert.equal(second.result, "waiting_action");
    assert.equal(second.executedRunId, claim?.run.runId ?? null);

    const platformRun = harness.platformRuntimeStore.getAgentRun(claim?.run.runId ?? "");
    const platformWorkItem = harness.platformRuntimeStore.getAgentWorkItem(dispatched.workItem.workItemId);
    assert.equal(platformRun?.status, "waiting_action");
    assert.equal(platformWorkItem?.status, "waiting_agent");
    assert.match(String((platformWorkItem?.waitingActionRequest as { prompt?: string } | undefined)?.prompt ?? ""), /Need approval|git push origin main/);

    const backendMailbox = harness.platformRuntime.getManagedAgentCoordinationService().listMailbox(
      "principal-owner",
      backend.agent.agentId,
    );
    assert.equal(backendMailbox.length, 1);
    assert.equal(backendMailbox[0]?.message.messageType, "approval_request");
    assert.equal(
      (backendMailbox[0]?.message.payload as { status?: string } | undefined)?.status,
      "waiting_action",
    );
  } finally {
    await harness.close();
  }
});

function listenServer(server: Server): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
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
