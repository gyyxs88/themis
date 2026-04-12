import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type {
  AppServerThreadStartParams,
  CodexAppServerNotification,
} from "./codex-app-server.js";
import type {
  AppServerTaskRuntimeOptions,
  AppServerTaskRuntimeSession,
} from "./app-server-task-runtime.js";
import { AppServerTaskRuntime } from "./app-server-task-runtime.js";
import { ManagedAgentCoordinationService } from "./managed-agent-coordination-service.js";
import { ManagedAgentExecutionService } from "./managed-agent-execution-service.js";
import { ManagedAgentsService } from "./managed-agents-service.js";
import { ManagedAgentSchedulerService } from "./managed-agent-scheduler-service.js";
import { ManagedAgentWorkerExecutionService } from "./managed-agent-worker-execution-service.js";
import { ManagedAgentWorkerService } from "./managed-agent-worker-service.js";

interface SessionDoubleState {
  started: AppServerThreadStartParams[];
  turns: Array<{
    threadId: string;
    input: string;
  }>;
  notificationHandler: ((notification: CodexAppServerNotification) => void) | null;
}

function createServiceContext(overrides: {
  sessionFactory?: AppServerTaskRuntimeOptions["sessionFactory"];
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "themis-managed-agent-worker-execution-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const managedAgentsService = new ManagedAgentsService({
    registry,
    workingDirectory: root,
  });
  const coordinationService = new ManagedAgentCoordinationService({ registry });
  const schedulerService = new ManagedAgentSchedulerService({
    registry,
    leaseTtlMs: 60_000,
  });
  const runtime = new AppServerTaskRuntime({
    workingDirectory: root,
    runtimeStore: registry,
    ...(overrides.sessionFactory ? { sessionFactory: overrides.sessionFactory } : {}),
  });
  const executionService = new ManagedAgentExecutionService({
    registry,
    runtime,
    coordinationService,
    schedulerService,
  });
  const workerService = new ManagedAgentWorkerService({
    registry,
    schedulerService,
  });
  const workerExecutionService = new ManagedAgentWorkerExecutionService({
    workerService,
    executionService,
  });

  return {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    executionService,
    workerExecutionService,
  };
}

function createSessionFactory(): {
  state: SessionDoubleState;
  sessionFactory: AppServerTaskRuntimeOptions["sessionFactory"];
} {
  const state: SessionDoubleState = {
    started: [],
    turns: [],
    notificationHandler: null,
  };

  return {
    state,
    sessionFactory: async (): Promise<AppServerTaskRuntimeSession> => ({
      initialize: async () => {},
      startThread: async (params) => {
        state.started.push({ ...params });
        return { threadId: "thread-worker-node-1" };
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
              text: "Worker Node 已完成任务",
            },
          },
        });
        setTimeout(() => {
          state.notificationHandler?.({
            method: "turn/completed",
            params: {
              threadId,
              turn: {
                id: "turn-worker-node-1",
                items: [],
                status: "completed",
                error: null,
              },
            },
          });
        }, 0);
        return { turnId: "turn-worker-node-1" };
      },
      interruptTurn: async () => {},
      close: async () => {},
      onNotification: (handler) => {
        state.notificationHandler = handler;
      },
      onServerRequest: () => {},
      respondToServerRequest: async () => {},
      rejectServerRequest: async () => {},
    }),
  };
}

test("ManagedAgentWorkerExecutionService 会拉取本节点 assigned run，并在 Worker 侧真正执行完成", async () => {
  const { state, sessionFactory } = createSessionFactory();
  const {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    executionService,
    workerExecutionService,
  } = createServiceContext({ sessionFactory });

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "平台负责人",
      createdAt: "2026-04-12T21:00:00.000Z",
      updatedAt: "2026-04-12T21:00:00.000Z",
    });

    const created = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端经理",
      departmentRole: "后端",
      mission: "负责 Worker Node 执行原型。",
      now: "2026-04-12T21:01:00.000Z",
    });

    registry.saveManagedAgentNode({
      nodeId: "node-worker-a",
      organizationId: created.organization.organizationId,
      displayName: "Worker Node A",
      status: "online",
      slotCapacity: 1,
      slotAvailable: 1,
      labels: ["linux"],
      workspaceCapabilities: [root],
      credentialCapabilities: [],
      providerCapabilities: [],
      heartbeatTtlSeconds: 300,
      lastHeartbeatAt: "2026-04-12T21:01:30.000Z",
      createdAt: "2026-04-12T21:01:30.000Z",
      updatedAt: "2026-04-12T21:01:30.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: created.agent.agentId,
      dispatchReason: "worker-execution-prototype",
      goal: "验证 Worker Node 原型可以真正执行分配给本节点的 run。",
      now: "2026-04-12T21:02:00.000Z",
    });

    const platformTick = await executionService.runNext({
      schedulerId: "scheduler-worker-node",
      now: "2026-04-12T21:03:00.000Z",
    });

    assert.equal(platformTick.claimed?.node?.nodeId, "node-worker-a");
    assert.equal(platformTick.execution, null);
    assert.equal(state.started.length, 0);

    const executed = await workerExecutionService.runNextAssigned({
      ownerPrincipalId: "principal-owner",
      nodeId: "node-worker-a",
      now: "2026-04-12T21:03:10.000Z",
    });

    assert.equal(executed?.assigned.workItem.workItemId, dispatched.workItem.workItemId);
    assert.equal(executed?.execution.result, "completed");
    assert.equal(executed?.execution.run.status, "completed");
    assert.equal(executed?.execution.workItem.status, "completed");
    assert.equal(registry.getManagedAgentNode("node-worker-a")?.slotAvailable, 1);
    assert.equal(registry.getActiveAgentExecutionLeaseByRun(platformTick.claimed?.run.runId ?? ""), null);
    assert.equal(state.started.length, 1);
    assert.match(state.turns[0]?.input ?? "", /Worker Node 原型/);

    const none = await workerExecutionService.runNextAssigned({
      ownerPrincipalId: "principal-owner",
      nodeId: "node-worker-a",
      now: "2026-04-12T21:04:00.000Z",
    });
    assert.equal(none, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
