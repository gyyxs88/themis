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
import {
  buildManagedAgentWorkItemSessionId,
  ManagedAgentExecutionService,
} from "./managed-agent-execution-service.js";
import { ManagedAgentsService } from "./managed-agents-service.js";
import { ManagedAgentSchedulerService } from "./managed-agent-scheduler-service.js";

interface SessionDoubleState {
  started: AppServerThreadStartParams[];
  resumed: Array<{ threadId: string; params: AppServerThreadStartParams }>;
  turns: Array<{
    threadId: string;
    input: string;
  }>;
  interruptedTurns: Array<{
    threadId: string;
    turnId: string;
  }>;
  respondedServerRequests: Array<{ id: string | number; result: unknown }>;
  rejectedServerRequests: Array<{ id: string | number; message: string }>;
  notificationHandler: ((notification: CodexAppServerNotification) => void) | null;
  serverRequestHandler: ((request: { id: string | number; method: string; params?: unknown }) => void) | null;
  closeCount: number;
}

function createServiceContext(overrides: {
  sessionFactory?: AppServerTaskRuntimeOptions["sessionFactory"];
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "themis-managed-agent-exec-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const managedAgentsService = new ManagedAgentsService({ registry });
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

  return {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    schedulerService,
    runtime,
    executionService,
  };
}

function createSessionFactory(overrides: {
  startThreadId?: string;
  startTurn?: (
    threadId: string,
    input: string,
    state: SessionDoubleState,
  ) => Promise<{ turnId: string }>;
  interruptTurn?: (
    threadId: string,
    turnId: string,
    state: SessionDoubleState,
  ) => Promise<void>;
} = {}): {
  state: SessionDoubleState;
  sessionFactory: AppServerTaskRuntimeOptions["sessionFactory"];
} {
  const state: SessionDoubleState = {
    started: [],
    resumed: [],
    turns: [],
    interruptedTurns: [],
    respondedServerRequests: [],
    rejectedServerRequests: [],
    notificationHandler: null,
    serverRequestHandler: null,
    closeCount: 0,
  };

  return {
    state,
    sessionFactory: async (): Promise<AppServerTaskRuntimeSession> => ({
      initialize: async () => {},
      startThread: async (params) => {
        state.started.push({ ...params });
        return { threadId: overrides.startThreadId ?? "thread-agent-exec-1" };
      },
      resumeThread: async (threadId, params) => {
        state.resumed.push({ threadId, params: { ...params } });
        return { threadId };
      },
      startTurn: async (threadId, input) => {
        const prompt = typeof input === "string" ? input : JSON.stringify(input);
        state.turns.push({ threadId, input: prompt });
        if (overrides.startTurn) {
          return await overrides.startTurn(threadId, prompt, state);
        }

        state.notificationHandler?.({
          method: "item/completed",
          params: {
            item: {
              type: "agentMessage",
              phase: "final_answer",
              text: "后端执行已完成",
            },
          },
        });
        scheduleTurnCompleted(state, "turn-agent-exec-1", threadId);
        return { turnId: "turn-agent-exec-1" };
      },
      interruptTurn: async (threadId, turnId) => {
        state.interruptedTurns.push({ threadId, turnId });

        if (overrides.interruptTurn) {
          await overrides.interruptTurn(threadId, turnId, state);
          return;
        }

        scheduleTurnCancelled(state, turnId, threadId);
      },
      close: async () => {
        state.closeCount += 1;
      },
      onNotification: (handler) => {
        state.notificationHandler = handler;
      },
      onServerRequest: (handler) => {
        state.serverRequestHandler = handler;
      },
      respondToServerRequest: async (id, result) => {
        state.respondedServerRequests.push({ id, result });
      },
      rejectServerRequest: async (id, error) => {
        state.rejectedServerRequests.push({
          id,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    }),
  };
}

function scheduleTurnCompleted(state: SessionDoubleState, turnId: string, threadId: string): void {
  setTimeout(() => {
    state.notificationHandler?.({
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
}

function scheduleTurnCancelled(state: SessionDoubleState, turnId: string, threadId: string): void {
  setTimeout(() => {
    state.notificationHandler?.({
      method: "turn/completed",
      params: {
        threadId,
        turn: {
          id: turnId,
          items: [],
          status: "cancelled",
          error: {
            message: "Turn cancelled by governance.",
          },
        },
      },
    });
  }, 0);
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out while waiting for async condition.");
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("ManagedAgentExecutionService 会把 claimed run 接到 app-server 内部执行，并向上游 agent 回包", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-agent-exec-complete-1",
  });
  const {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    executionService,
  } = createServiceContext({ sessionFactory });

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-06T11:00:00.000Z",
      updatedAt: "2026-04-06T11:00:00.000Z",
    });

    const frontend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "前端·岚",
      departmentRole: "前端",
      mission: "负责界面协作。",
      now: "2026-04-06T11:01:00.000Z",
    });
    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责服务端实现。",
      now: "2026-04-06T11:02:00.000Z",
    });

    coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: backend.agent.agentId,
      sourceType: "agent",
      sourceAgentId: frontend.agent.agentId,
      sourcePrincipalId: frontend.principal.principalId,
      dispatchReason: "把 API 闭环接起来",
      goal: "实现最小后端执行链",
      contextPacket: {
        api: "/api/agents/dispatch",
        note: "先做最小可用闭环",
      },
      priority: "high",
      now: "2026-04-06T11:03:00.000Z",
    });

    const result = await executionService.runNext({
      schedulerId: "scheduler-exec",
      now: "2026-04-06T11:04:00.000Z",
    });

    assert.equal(result.execution?.result, "completed");
    assert.equal(result.execution?.run.status, "completed");
    assert.equal(result.execution?.workItem.status, "completed");
    assert.equal(result.execution?.taskResult?.summary, "后端执行已完成");
    assert.equal(state.started.length, 1);
    assert.match(state.turns[0]?.input ?? "", /实现最小后端执行链/);
    assert.match(state.turns[0]?.input ?? "", /把 API 闭环接起来/);
    assert.match(state.turns[0]?.input ?? "", /\/api\/agents\/dispatch/);

    const sessionId = buildManagedAgentWorkItemSessionId(result.execution?.workItem.workItemId ?? "");
    const turns = registry.listSessionTurns(sessionId);
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.sourceChannel, "agent-internal");
    assert.equal(turns[0]?.userId, backend.agent.principalId);

    const frontendMailbox = coordinationService.listMailbox("principal-owner", frontend.agent.agentId);
    assert.equal(frontendMailbox.length, 1);
    assert.equal(frontendMailbox[0]?.message.messageType, "answer");
    assert.equal(
      (frontendMailbox[0]?.message.payload as { status?: string; summary?: string } | undefined)?.status,
      "completed",
    );
    assert.equal(
      (frontendMailbox[0]?.message.payload as { status?: string; summary?: string } | undefined)?.summary,
      "后端执行已完成",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentExecutionService 会完成 auto-created agent 的首次职责建档，并在完成后激活 agent", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-agent-bootstrap-1",
  });
  const {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    executionService,
  } = createServiceContext({ sessionFactory });

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-07T11:00:00.000Z",
      updatedAt: "2026-04-07T11:00:00.000Z",
    });

    const ops = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·曜",
      departmentRole: "运维",
      mission: "负责发布和值班。",
      now: "2026-04-07T11:01:00.000Z",
    });
    const preview = managedAgentsService.previewManagedAgentIdentity({
      ownerPrincipalId: "principal-owner",
      organizationId: ops.organization.organizationId,
      departmentRole: "运维",
    });
    const approved = managedAgentsService.approveSpawnSuggestion({
      ownerPrincipalId: "principal-owner",
      organizationId: ops.organization.organizationId,
      departmentRole: "运维",
      displayName: preview.displayName,
      mission: "负责运维值班与巡检分流。",
      supervisorAgentId: ops.agent.agentId,
      now: "2026-04-07T11:02:00.000Z",
    });

    assert.equal(approved.agent.status, "bootstrapping");
    assert.equal(approved.bootstrapWorkItem.status, "queued");

    const result = await executionService.runNext({
      schedulerId: "scheduler-main",
      now: "2026-04-07T11:03:00.000Z",
    });

    assert.equal(result.execution?.result, "completed");
    assert.equal(result.execution?.workItem.workItemId, approved.bootstrapWorkItem.workItemId);
    assert.equal(state.started.length, 1);
    assert.equal(state.started[0]?.cwd, root);
    assert.ok(state.turns[0]?.input.includes("首次职责建档"));
    assert.ok(state.turns[0]?.input.includes("不要直接面向人类"));

    const refreshed = registry.getManagedAgent(approved.agent.agentId);
    assert.equal(refreshed?.status, "active");
    assert.equal(refreshed?.bootstrapProfile?.state, "completed");
    assert.equal(refreshed?.bootstrapProfile?.bootstrapWorkItemId, approved.bootstrapWorkItem.workItemId);
    assert.equal(refreshed?.bootstrappedAt, result.execution?.run.completedAt);

    const workItem = registry.getAgentWorkItem(approved.bootstrapWorkItem.workItemId);
    assert.equal(workItem?.status, "completed");

    const supervisorMailbox = coordinationService.listMailbox("principal-owner", ops.agent.agentId);
    assert.equal(supervisorMailbox.length, 1);
    assert.equal(supervisorMailbox[0]?.message.messageType, "answer");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentExecutionService 遇到 action_required 时会转成 waiting_action，并向上游 agent 发 internal 消息", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-agent-exec-waiting-1",
    startTurn: async (threadId, _input, sessionState) => {
      sessionState.serverRequestHandler?.({
        id: "server-approval-1",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId,
          turnId: "turn-agent-waiting-1",
          itemId: "item-approval-1",
          approvalId: "approval-1",
          command: "git push origin main",
          reason: "Need approval",
        },
      });
      return { turnId: "turn-agent-waiting-1" };
    },
  });
  const {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    executionService,
  } = createServiceContext({ sessionFactory });

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-06T11:10:00.000Z",
      updatedAt: "2026-04-06T11:10:00.000Z",
    });

    const ops = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·砺",
      departmentRole: "运维",
      mission: "负责部署和值班。",
      now: "2026-04-06T11:11:00.000Z",
    });
    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·序",
      departmentRole: "后端",
      mission: "负责服务端实现。",
      now: "2026-04-06T11:12:00.000Z",
    });

    coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: ops.agent.agentId,
      sourceType: "agent",
      sourceAgentId: backend.agent.agentId,
      sourcePrincipalId: backend.principal.principalId,
      dispatchReason: "检查这次发布是否可以继续",
      goal: "确认是否需要执行推送命令",
      priority: "urgent",
      now: "2026-04-06T11:13:00.000Z",
    });

    const result = await executionService.runNext({
      schedulerId: "scheduler-exec",
      now: "2026-04-06T11:14:00.000Z",
    });

    assert.equal(result.execution?.result, "waiting_action");
    assert.equal(result.execution?.run.status, "waiting_action");
    assert.equal(result.execution?.workItem.status, "waiting_agent");
    assert.equal(result.execution?.waitingFor, "agent");
    assert.equal(state.rejectedServerRequests.length, 1);
    assert.match(state.rejectedServerRequests[0]?.message ?? "", /Need approval|git push origin main/);

    const backendMailbox = coordinationService.listMailbox("principal-owner", backend.agent.agentId);
    assert.equal(backendMailbox.length, 1);
    assert.equal(backendMailbox[0]?.message.messageType, "approval_request");
    assert.equal(
      (backendMailbox[0]?.message.payload as { status?: string; prompt?: string } | undefined)?.status,
      "waiting_action",
    );
    assert.match(
      (backendMailbox[0]?.message.payload as { status?: string; prompt?: string } | undefined)?.prompt ?? "",
      /Need approval|git push origin main/,
    );

    const sessionId = buildManagedAgentWorkItemSessionId(result.execution?.workItem.workItemId ?? "");
    const turns = registry.listSessionTurns(sessionId);
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.status, "waiting");
    assert.equal(turns[0]?.errorMessage ?? null, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentExecutionService 会在 mailbox 回复后复用同一个 work item session/thread 恢复执行", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-agent-resume-1",
    startTurn: async (threadId, _input, sessionState) => {
      if (sessionState.turns.length === 1) {
        sessionState.serverRequestHandler?.({
          id: "server-approval-resume-1",
          method: "item/commandExecution/requestApproval",
          params: {
            threadId,
            turnId: "turn-agent-resume-1",
            itemId: "item-approval-resume-1",
            approvalId: "approval-resume-1",
            command: "git push origin main",
            reason: "Need approval",
          },
        });
        return { turnId: "turn-agent-resume-1" };
      }

      sessionState.notificationHandler?.({
        method: "item/completed",
        params: {
          item: {
            type: "agentMessage",
            phase: "final_answer",
            text: "发布检查已继续执行",
          },
        },
      });
      scheduleTurnCompleted(sessionState, "turn-agent-resume-2", threadId);
      return { turnId: "turn-agent-resume-2" };
    },
  });
  const {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    executionService,
  } = createServiceContext({ sessionFactory });

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-06T11:20:00.000Z",
      updatedAt: "2026-04-06T11:20:00.000Z",
    });

    const ops = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·曜",
      departmentRole: "运维",
      mission: "负责发布和值班。",
      now: "2026-04-06T11:21:00.000Z",
    });
    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·策",
      departmentRole: "后端",
      mission: "负责服务端实现。",
      now: "2026-04-06T11:22:00.000Z",
    });

    coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: ops.agent.agentId,
      sourceType: "agent",
      sourceAgentId: backend.agent.agentId,
      sourcePrincipalId: backend.principal.principalId,
      dispatchReason: "发布前需要运维审批",
      goal: "确认是否可以继续执行发布命令",
      priority: "high",
      now: "2026-04-06T11:23:00.000Z",
    });

    const first = await executionService.runNext({
      schedulerId: "scheduler-exec",
      now: "2026-04-06T11:24:00.000Z",
    });
    assert.equal(first.execution?.result, "waiting_action");
    assert.equal(first.execution?.workItem.status, "waiting_agent");

    const approvalMailbox = coordinationService.listMailbox("principal-owner", backend.agent.agentId);
    assert.equal(approvalMailbox.length, 1);
    const approvalEntry = approvalMailbox[0]?.entry;
    assert.ok(approvalEntry?.mailboxEntryId);

    coordinationService.pullMailboxEntry(
      "principal-owner",
      backend.agent.agentId,
      "2026-04-06T11:25:00.000Z",
    );
    const replied = coordinationService.respondToMailboxEntry({
      ownerPrincipalId: "principal-owner",
      agentId: backend.agent.agentId,
      mailboxEntryId: approvalEntry?.mailboxEntryId ?? "",
      decision: "approve",
      inputText: "可以继续发布，同时确认 release note 已更新。",
      now: "2026-04-06T11:26:00.000Z",
    });
    assert.equal(replied.resumedWorkItem?.status, "queued");

    const second = await executionService.runNext({
      schedulerId: "scheduler-exec",
      now: "2026-04-06T11:27:00.000Z",
    });

    assert.equal(second.execution?.result, "completed");
    assert.equal(second.execution?.workItem.workItemId, first.execution?.workItem.workItemId);
    assert.equal(state.started.length, 1);
    assert.equal(state.resumed.length, 1);
    assert.equal(state.resumed[0]?.threadId, "thread-agent-resume-1");
    assert.match(state.turns[1]?.input ?? "", /审批结果：approve/);
    assert.match(state.turns[1]?.input ?? "", /可以继续发布/);

    const runs = registry.listAgentRunsByWorkItem(first.execution?.workItem.workItemId ?? "");
    assert.equal(runs.length, 2);
    assert.equal(runs[0]?.status, "completed");
    assert.equal(runs[1]?.status, "interrupted");

    const sessionId = buildManagedAgentWorkItemSessionId(first.execution?.workItem.workItemId ?? "");
    const turns = registry.listSessionTurns(sessionId);
    assert.equal(turns.length, 2);
    assert.equal(turns[0]?.status, "waiting");
    assert.equal(turns[1]?.status, "completed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentExecutionService 会在顶层治理回复后复用同一个 work item session/thread 恢复执行", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-human-resume-1",
    startTurn: async (threadId, _input, sessionState) => {
      if (sessionState.turns.length === 1) {
        sessionState.serverRequestHandler?.({
          id: "server-human-resume-1",
          method: "item/commandExecution/requestApproval",
          params: {
            threadId,
            turnId: "turn-human-resume-1",
            itemId: "item-human-resume-1",
            approvalId: "approval-human-resume-1",
            command: "deploy production",
            reason: "Need approval",
          },
        });
        return { turnId: "turn-human-resume-1" };
      }

      sessionState.notificationHandler?.({
        method: "item/completed",
        params: {
          item: {
            type: "agentMessage",
            phase: "final_answer",
            text: "人工审批后已继续执行发布任务",
          },
        },
      });
      scheduleTurnCompleted(sessionState, "turn-human-resume-2", threadId);
      return { turnId: "turn-human-resume-2" };
    },
  });
  const {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    executionService,
  } = createServiceContext({ sessionFactory });

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-06T11:30:00.000Z",
      updatedAt: "2026-04-06T11:30:00.000Z",
    });

    const ops = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·衡",
      departmentRole: "运维",
      mission: "负责发布和值班。",
      now: "2026-04-06T11:31:00.000Z",
    });

    coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: ops.agent.agentId,
      dispatchReason: "需要顶层入口审批发布命令",
      goal: "确认是否允许继续执行生产发布",
      priority: "high",
      now: "2026-04-06T11:32:00.000Z",
    });

    const first = await executionService.runNext({
      schedulerId: "scheduler-exec",
      now: "2026-04-06T11:33:00.000Z",
    });
    assert.equal(first.execution?.result, "waiting_action");
    assert.equal(first.execution?.waitingFor, "human");
    assert.equal(first.execution?.workItem.status, "waiting_human");
    assert.equal(
      (first.execution?.workItem.waitingActionRequest as { actionType?: string } | undefined)?.actionType,
      "approval",
    );

    const responded = coordinationService.respondToHumanWaitingWorkItem({
      ownerPrincipalId: "principal-owner",
      workItemId: first.execution?.workItem.workItemId ?? "",
      decision: "approve",
      inputText: "可以继续执行，但先确认监控面板正常。",
      now: "2026-04-06T11:34:00.000Z",
    });
    assert.equal(responded.workItem.status, "queued");

    const second = await executionService.runNext({
      schedulerId: "scheduler-exec",
      now: "2026-04-06T11:35:00.000Z",
    });

    assert.equal(second.execution?.result, "completed");
    assert.equal(second.execution?.workItem.workItemId, first.execution?.workItem.workItemId);
    assert.equal(state.started.length, 1);
    assert.equal(state.resumed.length, 1);
    assert.equal(state.resumed[0]?.threadId, "thread-human-resume-1");
    assert.match(state.turns[1]?.input ?? "", /顶层治理回复/);
    assert.match(state.turns[1]?.input ?? "", /approve/);
    assert.match(state.turns[1]?.input ?? "", /监控面板正常/);

    const runs = registry.listAgentRunsByWorkItem(first.execution?.workItem.workItemId ?? "");
    assert.equal(runs.length, 2);
    assert.equal(runs[0]?.status, "completed");
    assert.equal(runs[1]?.status, "interrupted");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentExecutionService 可以中断真正 running 的 run，并把 work item 正式取消收口", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-agent-cancel-running-1",
    startTurn: async () => ({
      turnId: "turn-agent-cancel-running-1",
    }),
  });
  const {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    executionService,
  } = createServiceContext({ sessionFactory });

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-07T07:00:00.000Z",
      updatedAt: "2026-04-07T07:00:00.000Z",
    });

    const frontend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "前端·岚",
      departmentRole: "前端",
      mission: "负责 Web 工作台。",
      now: "2026-04-07T07:01:00.000Z",
    });
    const ops = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·曜",
      departmentRole: "运维",
      mission: "负责发布和值班。",
      now: "2026-04-07T07:02:00.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: ops.agent.agentId,
      sourceType: "agent",
      sourceAgentId: frontend.agent.agentId,
      sourcePrincipalId: frontend.principal.principalId,
      dispatchReason: "准备执行生产发布前检查",
      goal: "持续执行直到被顶层取消",
      priority: "urgent",
      now: "2026-04-07T07:03:00.000Z",
    });

    const runPromise = executionService.runNext({
      schedulerId: "scheduler-exec",
      now: "2026-04-07T07:04:00.000Z",
    });

    await waitFor(() => {
      const run = registry.listAgentRunsByWorkItem(dispatched.workItem.workItemId)[0];
      return state.turns.length === 1 && run?.status === "running";
    });

    const cancelled = await executionService.cancelWorkItem({
      ownerPrincipalId: "principal-owner",
      workItemId: dispatched.workItem.workItemId,
      reason: "顶层决定停止这条发布链路。",
      now: "2026-04-07T07:05:00.000Z",
    });
    const settled = await runPromise;

    assert.equal(settled.execution?.result, "cancelled");
    assert.equal(settled.execution?.run.status, "cancelled");
    assert.equal(cancelled.workItem.status, "cancelled");
    assert.equal(cancelled.workItem.completedAt, "2026-04-07T07:05:00.000Z");
    assert.equal(state.interruptedTurns.length, 1);
    assert.equal(state.interruptedTurns[0]?.threadId, "thread-agent-cancel-running-1");
    assert.equal(state.interruptedTurns[0]?.turnId, "turn-agent-cancel-running-1");
    assert.equal(cancelled.notificationMessage?.messageType, "cancel");
    assert.equal(cancelled.notificationMessage?.toAgentId, frontend.agent.agentId);
    assert.equal(cancelled.notificationMailboxEntry?.ownerAgentId, frontend.agent.agentId);

    const run = registry.listAgentRunsByWorkItem(dispatched.workItem.workItemId)[0];
    assert.equal(run?.status, "cancelled");
    assert.equal(run?.failureCode, "WORK_ITEM_CANCELLED");

    const workItem = registry.getAgentWorkItem(dispatched.workItem.workItemId);
    assert.equal(workItem?.status, "cancelled");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
