import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type {
  ManagedAgentBootstrapProfile,
  StoredAgentMailboxEntryRecord,
  StoredAgentMessageRecord,
  StoredAgentRunRecord,
  StoredAgentWorkItemRecord,
  StoredManagedAgentRecord,
  TaskEvent,
  TaskOptions,
  TaskRequest,
  TaskResult,
} from "../types/index.js";
import {
  MANAGED_AGENT_BOOTSTRAP_MODE_AUTO_SPAWN,
  MANAGED_AGENT_INTERNAL_SOURCE_CHANNEL,
} from "../types/index.js";
import {
  AppServerTaskRuntime,
  type AppServerTaskExecutionController,
  AppServerTaskWaitingForActionError,
  isAppServerTaskWaitingForActionError,
} from "./app-server-task-runtime.js";
import {
  ManagedAgentCoordinationService,
  type CancelWorkItemInput,
  type CancelWorkItemResult,
  type SendAgentMessageResult,
} from "./managed-agent-coordination-service.js";
import {
  ManagedAgentSchedulerService,
  type ClaimNextRunnableWorkItemInput,
  type ManagedAgentSchedulerClaim,
  type ManagedAgentSchedulerTickResult,
} from "./managed-agent-scheduler-service.js";

const DEFAULT_EXECUTION_SCHEDULER_ID = "scheduler-main";

export interface ManagedAgentExecutionServiceOptions {
  registry: SqliteCodexSessionRegistry;
  runtime: AppServerTaskRuntime;
  coordinationService?: ManagedAgentCoordinationService;
  schedulerService?: ManagedAgentSchedulerService;
  defaultSchedulerId?: string;
}

export interface ManagedAgentExecutionRunNextInput extends ClaimNextRunnableWorkItemInput {}

export interface ManagedAgentExecutionOutcome {
  result: "completed" | "waiting_action" | "failed" | "cancelled";
  run: StoredAgentRunRecord;
  workItem: StoredAgentWorkItemRecord;
  taskResult?: TaskResult;
  failureMessage?: string;
  waitingFor?: "human" | "agent";
  notification?: {
    message?: StoredAgentMessageRecord;
    mailboxEntry?: StoredAgentMailboxEntryRecord;
  };
}

export interface ManagedAgentExecutionRunNextResult extends ManagedAgentSchedulerTickResult {
  execution: ManagedAgentExecutionOutcome | null;
}

interface ManagedAgentActiveExecution {
  runId: string;
  workItemId: string;
  controller: AbortController;
  executionController: AppServerTaskExecutionController | null;
  settled: Promise<ManagedAgentExecutionOutcome | null>;
  settle: (outcome: ManagedAgentExecutionOutcome | null) => void;
}

export class ManagedAgentExecutionService {
  private readonly registry: SqliteCodexSessionRegistry;
  private readonly runtime: AppServerTaskRuntime;
  private readonly coordinationService: ManagedAgentCoordinationService;
  private readonly schedulerService: ManagedAgentSchedulerService;
  private readonly defaultSchedulerId: string;
  private readonly activeExecutionsByRunId = new Map<string, ManagedAgentActiveExecution>();

  constructor(options: ManagedAgentExecutionServiceOptions) {
    this.registry = options.registry;
    this.runtime = options.runtime;
    this.coordinationService = options.coordinationService ?? new ManagedAgentCoordinationService({
      registry: options.registry,
    });
    this.schedulerService = options.schedulerService ?? new ManagedAgentSchedulerService({
      registry: options.registry,
    });
    this.defaultSchedulerId = normalizeOptionalText(options.defaultSchedulerId) ?? DEFAULT_EXECUTION_SCHEDULER_ID;
  }

  async runNext(input: ManagedAgentExecutionRunNextInput = {}): Promise<ManagedAgentExecutionRunNextResult> {
    const tick = this.schedulerService.tick({
      ...input,
      ...(normalizeOptionalText(input.schedulerId) ? {} : { schedulerId: this.defaultSchedulerId }),
    });

    if (!tick.claimed) {
      return {
        ...tick,
        execution: null,
      };
    }

    const execution = await this.executeClaim(tick.claimed, {
      now: normalizeOptionalText(input.now) ?? new Date().toISOString(),
    });

    return {
      ...tick,
      execution,
    };
  }

  async cancelWorkItem(input: CancelWorkItemInput): Promise<CancelWorkItemResult> {
    const now = new Date().toISOString();

    try {
      const result = this.coordinationService.cancelWorkItem(input);
      this.updateBootstrapLifecycleAfterGovernanceCancel(
        result.workItem,
        result.workItem.completedAt ?? now,
        input.reason,
      );
      return result;
    } catch (error) {
      if (!isActiveRunCancellationError(error)) {
        throw error;
      }
    }

    const activeExecutions = this.listActiveExecutionsForWorkItem(input.workItemId);

    if (activeExecutions.length === 0) {
      throw new Error("Work item has active runs and cannot be cancelled yet.");
    }

    await Promise.all(activeExecutions.map(async (execution) => {
      const interruptPromise = execution.executionController?.interrupt().catch(() => {}) ?? Promise.resolve();
      execution.controller.abort(new Error("WORK_ITEM_CANCELLED"));
      await interruptPromise;
    }));

    await Promise.all(activeExecutions.map(async (execution) => {
      await execution.settled;
    }));

    const result = this.coordinationService.cancelWorkItem(input);
    this.updateBootstrapLifecycleAfterGovernanceCancel(
      result.workItem,
      result.workItem.completedAt ?? now,
      input.reason,
    );
    return result;
  }

  async executeClaim(
    claim: ManagedAgentSchedulerClaim,
    input: {
      now?: string;
    } = {},
  ): Promise<ManagedAgentExecutionOutcome> {
    const now = normalizeOptionalText(input.now) ?? new Date().toISOString();
    const leaseToken = claim.run.leaseToken;
    let run = this.schedulerService.markRunStarting(claim.run.runId, leaseToken, now);
    let waitingNotification: SendAgentMessageResult | null = null;
    const controller = new AbortController();
    const request = this.buildTaskRequest(claim, now);
    const activeExecution = this.registerActiveExecution(run.runId, claim.workItem.workItemId, controller);
    let outcome: ManagedAgentExecutionOutcome | null = null;

    try {
      const taskContext = request.channelContext.sessionId
        ? {
            principalId: claim.targetAgent.principalId,
            conversationId: request.channelContext.sessionId,
          }
        : {
            principalId: claim.targetAgent.principalId,
          };
      const taskResult = await this.runtime.runTaskAsPrincipal(request, taskContext, {
        signal: controller.signal,
        onExecutionReady: (executionController) => {
          activeExecution.executionController = executionController;
        },
        onEvent: async (event) => {
          run = await this.handleTaskEvent({
            claim,
            run,
            event,
            controller,
            onWaitingNotification: (notification) => {
              waitingNotification = notification;
            },
          });
        },
      });

      if (taskResult.status === "cancelled") {
        run = this.schedulerService.cancelRun(
          run.runId,
          leaseToken,
          "WORK_ITEM_CANCELLED",
          taskResult.summary,
          taskResult.completedAt,
        );
        this.updateBootstrapLifecycleAfterCancelledRun(claim, taskResult);
        outcome = {
          result: "cancelled",
          run,
          workItem: this.registry.getAgentWorkItem(claim.workItem.workItemId) ?? claim.workItem,
          taskResult,
        };
        return outcome;
      }

      run = this.schedulerService.completeRun(run.runId, leaseToken, taskResult.completedAt);
      this.updateBootstrapLifecycleAfterCompletion(claim, taskResult);
      const completionNotification = this.sendCompletionNotification(claim, run, taskResult);

      outcome = {
        result: "completed",
        run,
        workItem: this.registry.getAgentWorkItem(claim.workItem.workItemId) ?? claim.workItem,
        taskResult,
        ...(completionNotification ? { notification: completionNotification } : {}),
      };
      return outcome;
    } catch (error) {
      if (isAppServerTaskWaitingForActionError(error)) {
        outcome = {
          result: "waiting_action",
          run,
          workItem: this.registry.getAgentWorkItem(claim.workItem.workItemId) ?? claim.workItem,
          waitingFor: error.waitingFor,
          ...toExecutionNotification(waitingNotification),
        };
        return outcome;
      }

      const failureMessage = toErrorMessage(error);
      run = this.schedulerService.failRun(
        run.runId,
        leaseToken,
        "APP_SERVER_INTERNAL_EXECUTION_FAILED",
        failureMessage,
        new Date().toISOString(),
      );
      this.updateBootstrapLifecycleAfterFailure(claim, failureMessage, run.completedAt ?? new Date().toISOString());
      const failureNotification = this.sendFailureNotification(claim, run, failureMessage);

      outcome = {
        result: "failed",
        run,
        workItem: this.registry.getAgentWorkItem(claim.workItem.workItemId) ?? claim.workItem,
        failureMessage,
        ...(failureNotification ? { notification: failureNotification } : {}),
      };
      return outcome;
    } finally {
      activeExecution.settle(outcome);
      this.activeExecutionsByRunId.delete(run.runId);
    }
  }

  private async handleTaskEvent(input: {
    claim: ManagedAgentSchedulerClaim;
    run: StoredAgentRunRecord;
    event: TaskEvent;
    controller: AbortController;
    onWaitingNotification: (notification: SendAgentMessageResult | null) => void;
  }): Promise<StoredAgentRunRecord> {
    const now = normalizeOptionalText(input.event.timestamp) ?? new Date().toISOString();
    const leaseToken = input.run.leaseToken;

    if (input.event.type === "task.started") {
      return this.schedulerService.markRunRunning(input.run.runId, leaseToken, now);
    }

    if (input.event.type === "task.action_required") {
      const waitingFor = input.claim.workItem.sourceAgentId ? "agent" : "human";
      const nextRun = this.schedulerService.markRunWaiting(input.run.runId, leaseToken, waitingFor, now);
      this.persistWaitingActionRequest(input.claim.workItem.workItemId, input.event, waitingFor, now);
      this.updateBootstrapLifecycleAfterWaiting(input.claim, waitingFor, now);
      const notification = this.sendWaitingNotification(input.claim, nextRun, input.event, waitingFor);
      input.onWaitingNotification(notification);
      input.controller.abort(new AppServerTaskWaitingForActionError(
        waitingFor,
        normalizeOptionalText(input.event.message) ?? "Managed agent task is waiting for follow-up action.",
      ));
      return nextRun;
    }

    if (input.run.status === "running" && shouldHeartbeatOnEvent(input.event)) {
      return this.schedulerService.heartbeatRun(input.run.runId, leaseToken, now);
    }

    return input.run;
  }

  private persistWaitingActionRequest(
    workItemId: string,
    event: TaskEvent,
    waitingFor: "human" | "agent",
    now: string,
  ): void {
    const workItem = this.registry.getAgentWorkItem(workItemId);

    if (!workItem) {
      return;
    }

    this.registry.saveAgentWorkItem({
      ...workItem,
      status: waitingFor === "human" ? "waiting_human" : "waiting_agent",
      waitingActionRequest: {
        waitingFor,
        actionId: event.payload?.actionId ?? null,
        actionType: event.payload?.actionType ?? null,
        prompt: event.payload?.prompt ?? event.message ?? null,
        choices: event.payload?.choices ?? null,
        inputSchema: event.payload?.inputSchema ?? null,
        requestId: event.requestId,
        taskId: event.taskId,
        updatedAt: now,
      },
      latestHumanResponse: undefined,
      updatedAt: now,
    });
  }

  private buildTaskRequest(claim: ManagedAgentSchedulerClaim, now: string): TaskRequest {
    const sessionId = buildManagedAgentWorkItemSessionId(claim.workItem.workItemId);
    const workspacePath = resolveWorkspacePath(claim.workItem.workspacePolicySnapshot);
    const inputText = buildExecutionInputText(this.registry, claim);
    const options = resolveTaskOptions(claim.workItem.runtimeProfileSnapshot);

    if (workspacePath) {
      this.saveSessionWorkspace(sessionId, workspacePath, now);
    }

    return {
      requestId: `agent-run-request:${claim.run.runId}`,
      taskId: claim.run.runId,
      sourceChannel: MANAGED_AGENT_INTERNAL_SOURCE_CHANNEL,
      user: {
        userId: claim.targetAgent.principalId,
        displayName: claim.targetAgent.displayName,
      },
      goal: claim.workItem.goal,
      ...(inputText ? { inputText } : {}),
      ...(options ? { options } : {}),
      channelContext: {
        sessionId,
        channelSessionKey: sessionId,
      },
      createdAt: now,
    };
  }

  private saveSessionWorkspace(sessionId: string, workspacePath: string, now: string): void {
    const existing = this.registry.getSessionTaskSettings(sessionId);
    this.registry.saveSessionTaskSettings({
      sessionId,
      settings: {
        ...(existing?.settings ?? {}),
        workspacePath,
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  private registerActiveExecution(
    runId: string,
    workItemId: string,
    controller: AbortController,
  ): ManagedAgentActiveExecution {
    const deferred = createDeferred<ManagedAgentExecutionOutcome | null>();
    const activeExecution: ManagedAgentActiveExecution = {
      runId,
      workItemId,
      controller,
      executionController: null,
      settled: deferred.promise,
      settle: deferred.resolve,
    };
    this.activeExecutionsByRunId.set(runId, activeExecution);
    return activeExecution;
  }

  private listActiveExecutionsForWorkItem(workItemId: string): ManagedAgentActiveExecution[] {
    const normalizedWorkItemId = normalizeOptionalText(workItemId);

    if (!normalizedWorkItemId) {
      return [];
    }

    return [...this.activeExecutionsByRunId.values()].filter((execution) =>
      execution.workItemId === normalizedWorkItemId
    );
  }

  private sendWaitingNotification(
    claim: ManagedAgentSchedulerClaim,
    run: StoredAgentRunRecord,
    event: TaskEvent,
    waitingFor: "human" | "agent",
  ): SendAgentMessageResult | null {
    const sourceAgentId = normalizeOptionalText(claim.workItem.sourceAgentId);

    if (!sourceAgentId) {
      return null;
    }

    return this.coordinationService.sendAgentMessage({
      ownerPrincipalId: claim.organization.ownerPrincipalId,
      fromAgentId: claim.targetAgent.agentId,
      toAgentId: sourceAgentId,
      workItemId: claim.workItem.workItemId,
      runId: run.runId,
      messageType: resolveWaitingMessageType(event),
      payload: {
        status: "waiting_action",
        waitingFor,
        actionType: event.payload?.actionType,
        actionId: event.payload?.actionId,
        prompt: event.payload?.prompt ?? event.message ?? null,
        choices: event.payload?.choices,
        inputSchema: event.payload?.inputSchema,
        requestId: event.requestId,
        taskId: event.taskId,
      },
      priority: claim.workItem.priority,
      requiresAck: true,
      now: event.timestamp,
    });
  }

  private sendCompletionNotification(
    claim: ManagedAgentSchedulerClaim,
    run: StoredAgentRunRecord,
    result: TaskResult,
  ): {
    message?: StoredAgentMessageRecord;
    mailboxEntry?: StoredAgentMailboxEntryRecord;
  } | null {
    const sourceAgentId = normalizeOptionalText(claim.workItem.sourceAgentId);

    if (!sourceAgentId) {
      return null;
    }

    const notification = this.coordinationService.sendAgentMessage({
      ownerPrincipalId: claim.organization.ownerPrincipalId,
      fromAgentId: claim.targetAgent.agentId,
      toAgentId: sourceAgentId,
      workItemId: claim.workItem.workItemId,
      runId: run.runId,
      messageType: "answer",
      payload: {
        status: "completed",
        summary: result.summary,
        output: result.output ?? null,
        touchedFiles: result.touchedFiles ?? [],
        structuredOutput: result.structuredOutput ?? null,
        completedAt: result.completedAt,
      },
      priority: claim.workItem.priority,
      now: result.completedAt,
    });
    this.coordinationService.createAgentHandoff({
      ownerPrincipalId: claim.organization.ownerPrincipalId,
      fromAgentId: claim.targetAgent.agentId,
      toAgentId: sourceAgentId,
      workItemId: claim.workItem.workItemId,
      sourceMessageId: notification.message.messageId,
      sourceRunId: run.runId,
      summary: normalizeOptionalText(result.summary) ?? claim.workItem.goal,
      attachedArtifacts: Array.isArray(result.touchedFiles) ? result.touchedFiles : [],
      payload: {
        status: "completed",
        summary: result.summary,
        output: result.output ?? null,
        structuredOutput: result.structuredOutput ?? null,
        touchedFiles: result.touchedFiles ?? [],
        completedAt: result.completedAt,
      },
      now: result.completedAt,
    });

    return {
      message: notification.message,
      mailboxEntry: notification.mailboxEntry,
    };
  }

  private sendFailureNotification(
    claim: ManagedAgentSchedulerClaim,
    run: StoredAgentRunRecord,
    failureMessage: string,
  ): {
    message?: StoredAgentMessageRecord;
    mailboxEntry?: StoredAgentMailboxEntryRecord;
  } | null {
    const sourceAgentId = normalizeOptionalText(claim.workItem.sourceAgentId);

    if (!sourceAgentId) {
      return null;
    }

    const notification = this.coordinationService.sendAgentMessage({
      ownerPrincipalId: claim.organization.ownerPrincipalId,
      fromAgentId: claim.targetAgent.agentId,
      toAgentId: sourceAgentId,
      workItemId: claim.workItem.workItemId,
      runId: run.runId,
      messageType: "status_update",
      payload: {
        status: "failed",
        failureCode: run.failureCode ?? "APP_SERVER_INTERNAL_EXECUTION_FAILED",
        failureMessage,
        completedAt: run.completedAt ?? null,
      },
      priority: claim.workItem.priority,
      now: run.completedAt ?? new Date().toISOString(),
    });

    return {
      message: notification.message,
      mailboxEntry: notification.mailboxEntry,
    };
  }

  private updateBootstrapLifecycleAfterWaiting(
    claim: ManagedAgentSchedulerClaim,
    waitingFor: "human" | "agent",
    now: string,
  ): void {
    this.updateManagedAgentBootstrapState(claim.workItem, claim.targetAgent.agentId, {
      bootstrapState: waitingFor === "agent" ? "waiting_agent" : "waiting_human",
      updatedAt: now,
    });
  }

  private updateBootstrapLifecycleAfterCompletion(
    claim: ManagedAgentSchedulerClaim,
    result: TaskResult,
  ): void {
    this.updateManagedAgentBootstrapState(claim.workItem, claim.targetAgent.agentId, {
      agentStatus: "active",
      bootstrapState: "completed",
      summary: result.summary,
      output: result.output ?? result.structuredOutput ?? null,
      completedAt: result.completedAt,
      updatedAt: result.completedAt,
    });
  }

  private updateBootstrapLifecycleAfterFailure(
    claim: ManagedAgentSchedulerClaim,
    failureMessage: string,
    now: string,
  ): void {
    this.updateManagedAgentBootstrapState(claim.workItem, claim.targetAgent.agentId, {
      agentStatus: "degraded",
      bootstrapState: "failed",
      failureMessage,
      completedAt: now,
      updatedAt: now,
    });
  }

  private updateBootstrapLifecycleAfterCancelledRun(
    claim: ManagedAgentSchedulerClaim,
    result: TaskResult,
  ): void {
    this.updateManagedAgentBootstrapState(claim.workItem, claim.targetAgent.agentId, {
      agentStatus: "degraded",
      bootstrapState: "cancelled",
      failureMessage: result.summary ?? "Bootstrap onboarding run was cancelled.",
      completedAt: result.completedAt,
      updatedAt: result.completedAt,
    });
  }

  private updateBootstrapLifecycleAfterGovernanceCancel(
    workItem: StoredAgentWorkItemRecord,
    now: string,
    reason?: string,
  ): void {
    this.updateManagedAgentBootstrapState(workItem, workItem.targetAgentId, {
      agentStatus: "degraded",
      bootstrapState: "cancelled",
      failureMessage: normalizeOptionalText(reason) ?? "Bootstrap onboarding was cancelled by governance.",
      completedAt: now,
      updatedAt: now,
    });
  }

  private updateManagedAgentBootstrapState(
    workItem: StoredAgentWorkItemRecord,
    targetAgentId: string,
    patch: {
      agentStatus?: StoredManagedAgentRecord["status"];
      bootstrapState: "pending" | "waiting_human" | "waiting_agent" | "completed" | "failed" | "cancelled";
      summary?: string;
      output?: unknown;
      failureMessage?: string;
      completedAt?: string;
      updatedAt: string;
    },
  ): void {
    const bootstrapPacket = resolveBootstrapContextPacket(workItem.contextPacket);

    if (!bootstrapPacket) {
      return;
    }

    const agent = this.registry.getManagedAgent(targetAgentId);

    if (!agent) {
      return;
    }

    const previousProfile = asRecord(agent.bootstrapProfile);
    const sourceSuggestionId = normalizeOptionalText(previousProfile?.sourceSuggestionId)
      ?? normalizeOptionalText(bootstrapPacket.sourceSuggestionId);
    const supervisorAgentId = normalizeOptionalText(previousProfile?.supervisorAgentId)
      ?? normalizeOptionalText(asRecord(bootstrapPacket.supervisor)?.agentId);
    const supervisorDisplayName = normalizeOptionalText(previousProfile?.supervisorDisplayName)
      ?? normalizeOptionalText(asRecord(bootstrapPacket.supervisor)?.displayName);
    const nextProfile: ManagedAgentBootstrapProfile = {
      mode: MANAGED_AGENT_BOOTSTRAP_MODE_AUTO_SPAWN,
      state: patch.bootstrapState,
      bootstrapWorkItemId: normalizeOptionalText(previousProfile?.bootstrapWorkItemId)
        ?? normalizeOptionalText(bootstrapPacket.bootstrapWorkItemId)
        ?? workItem.workItemId,
      ...(sourceSuggestionId ? { sourceSuggestionId } : {}),
      ...(supervisorAgentId ? { supervisorAgentId } : {}),
      ...(supervisorDisplayName ? { supervisorDisplayName } : {}),
      dispatchReason: normalizeOptionalText(previousProfile?.dispatchReason) ?? workItem.dispatchReason,
      goal: normalizeOptionalText(previousProfile?.goal) ?? workItem.goal,
      creationReason: normalizeOptionalText(previousProfile?.creationReason)
        ?? normalizeOptionalText(asRecord(bootstrapPacket.auditFacts)?.creationReason)
        ?? workItem.dispatchReason,
      expectedScope: normalizeOptionalText(previousProfile?.expectedScope)
        ?? normalizeOptionalText(asRecord(bootstrapPacket.auditFacts)?.expectedScope)
        ?? "",
      insufficiencyReason: normalizeOptionalText(previousProfile?.insufficiencyReason)
        ?? normalizeOptionalText(asRecord(bootstrapPacket.auditFacts)?.insufficiencyReason)
        ?? "",
      namingBasis: normalizeOptionalText(previousProfile?.namingBasis)
        ?? normalizeOptionalText(asRecord(bootstrapPacket.auditFacts)?.namingBasis)
        ?? "",
      collaborationContract: (
        asRecord(previousProfile?.collaborationContract)
        ?? asRecord(bootstrapPacket.collaborationContract)
        ?? {
          communicationMode: "agent_only",
          humanExposurePolicy: agent.exposurePolicy,
          escalationRoute: "必要时经由组织级入口升级。",
        }
      ) as ManagedAgentBootstrapProfile["collaborationContract"],
      checklist: Array.isArray(previousProfile?.checklist)
        ? previousProfile.checklist
        : Array.isArray(bootstrapPacket.checklist)
          ? bootstrapPacket.checklist
          : [],
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.output !== undefined ? { output: patch.output } : {}),
      ...(patch.failureMessage !== undefined ? { failureMessage: patch.failureMessage } : {}),
      createdAt: normalizeOptionalText(previousProfile?.createdAt) ?? patch.updatedAt,
      updatedAt: patch.updatedAt,
      ...(patch.completedAt ? { completedAt: patch.completedAt } : {}),
    };

    this.registry.saveManagedAgent({
      ...agent,
      ...(patch.agentStatus ? { status: patch.agentStatus } : {}),
      bootstrapProfile: nextProfile,
      ...(patch.agentStatus === "active" && patch.completedAt ? { bootstrappedAt: patch.completedAt } : {}),
      updatedAt: patch.updatedAt,
    });
  }
}

export function buildManagedAgentWorkItemSessionId(workItemId: string): string {
  return `agent-work-item:${workItemId.trim()}`;
}

function resolveWaitingMessageType(event: TaskEvent): "approval_request" | "question" {
  return event.payload?.actionType === "approval" ? "approval_request" : "question";
}

function resolveBootstrapContextPacket(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  return normalizeOptionalText(record.systemTaskKind) === MANAGED_AGENT_BOOTSTRAP_MODE_AUTO_SPAWN
    ? record
    : null;
}

function shouldHeartbeatOnEvent(event: TaskEvent): boolean {
  return event.type === "task.progress"
    || event.type === "task.context_built"
    || event.type === "task.memory_updated";
}

function buildExecutionInputText(
  registry: SqliteCodexSessionRegistry,
  claim: ManagedAgentSchedulerClaim,
): string | null {
  const sections: string[] = [
    `派工说明：${claim.workItem.dispatchReason}`,
    `优先级：${claim.workItem.priority}`,
    `来源类型：${claim.workItem.sourceType}`,
  ];
  const sourceAgent = normalizeOptionalText(claim.workItem.sourceAgentId)
    ? registry.getManagedAgent(claim.workItem.sourceAgentId as string)
    : null;
  const sourcePrincipal = registry.getPrincipal(claim.workItem.sourcePrincipalId);

  if (sourceAgent) {
    sections.push(`上游 agent：${sourceAgent.displayName}`);
  } else if (sourcePrincipal?.displayName?.trim()) {
    sections.push(`发起方：${sourcePrincipal.displayName.trim()}`);
  }

  if (normalizeOptionalText(claim.workItem.parentWorkItemId)) {
    sections.push(`父 work item：${claim.workItem.parentWorkItemId}`);
  }

  if (claim.workItem.contextPacket !== undefined) {
    sections.push(`上下文包(JSON)：\n${serializeJson(claim.workItem.contextPacket)}`);
  }

  const resumeContext = buildResumeContext(registry, claim.workItem);

  if (resumeContext) {
    sections.push(`最新上游回复：\n${resumeContext}`);
  }

  return sections.join("\n\n").trim() || null;
}

function buildResumeContext(
  registry: SqliteCodexSessionRegistry,
  workItem: StoredAgentWorkItemRecord,
): string | null {
  const humanResumeContext = buildHumanResumeContext(workItem);

  if (humanResumeContext) {
    return humanResumeContext;
  }

  const sourceAgentId = normalizeOptionalText(workItem.sourceAgentId);

  if (!sourceAgentId) {
    return null;
  }

  const messages = registry.listAgentMessagesByWorkItem(workItem.workItemId);
  const latestWaitingMessage = [...messages].reverse().find((message) =>
    message.fromAgentId === workItem.targetAgentId
    && message.toAgentId === sourceAgentId
    && (message.messageType === "approval_request" || message.messageType === "question")
  );

  if (!latestWaitingMessage) {
    return null;
  }

  const resumeMessages = messages.filter((message) =>
    message.toAgentId === workItem.targetAgentId
    && (message.messageType === "approval_result" || message.messageType === "answer")
    && (
      message.parentMessageId === latestWaitingMessage.messageId
      || message.createdAt > latestWaitingMessage.createdAt
    )
  );

  if (resumeMessages.length === 0) {
    return null;
  }

  const sourceAgent = registry.getManagedAgent(sourceAgentId);
  const sourceLabel = sourceAgent?.displayName ?? sourceAgentId;

  return resumeMessages
    .map((message) => formatResumeMessage(sourceLabel, message))
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function buildHumanResumeContext(workItem: StoredAgentWorkItemRecord): string | null {
  const response = asRecord(workItem.latestHumanResponse);

  if (!response) {
    return null;
  }

  const waitingAction = asRecord(workItem.waitingActionRequest);
  const actionType = normalizeOptionalText(asString(waitingAction?.actionType));
  const prompt = normalizeOptionalText(asString(waitingAction?.prompt));
  const decision = normalizeOptionalText(asString(response.decision));
  const inputText = normalizeOptionalText(asString(response.inputText));
  const payload = response.payload;
  const extraKeys = Object.keys(response).filter((key) =>
    !["sourceType", "actionType", "decision", "inputText", "respondedAt"].includes(key)
  );
  const details = payload !== undefined
    ? serializeJson(payload)
    : extraKeys.length > 0
      ? serializeJson(response)
      : null;

  return [
    `- 顶层治理回复${actionType ? `（${actionType}）` : ""}${decision ? `：${decision}` : ""}`,
    prompt ? `  原等待提示：${prompt}` : null,
    inputText ? `  补充：${inputText}` : null,
    details ? `  详情：${details}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatResumeMessage(sourceLabel: string, message: StoredAgentMessageRecord): string | null {
  const payload = asRecord(message.payload);

  if (message.messageType === "approval_result") {
    const decision = normalizeOptionalText(payload?.decision);
    const inputText = normalizeOptionalText(payload?.inputText);
    const extras = payload && Object.keys(payload).length > 0
      ? serializeJson(payload)
      : null;

    return [
      `- ${sourceLabel} 的审批结果：${decision ?? "unknown"}`,
      inputText ? `  补充：${inputText}` : null,
      !inputText && extras ? `  详情：${extras}` : null,
    ].filter((line): line is string => Boolean(line)).join("\n");
  }

  if (message.messageType === "answer") {
    const inputText = normalizeOptionalText(payload?.inputText);
    const nestedPayload = payload?.payload;
    const details = nestedPayload !== undefined
      ? serializeJson(nestedPayload)
      : payload && Object.keys(payload).length > (inputText ? 1 : 0)
        ? serializeJson(payload)
        : null;

    return [
      `- ${sourceLabel} 的回复：${inputText ?? "已给出结构化回复"}`,
      details ? `  详情：${details}` : null,
    ].filter((line): line is string => Boolean(line)).join("\n");
  }

  return null;
}

function resolveTaskOptions(snapshot: unknown): TaskOptions | undefined {
  const record = asRecord(snapshot);

  if (!record) {
    return undefined;
  }

  const options: TaskOptions = {};

  assignOptionalTaskOptionString(options, "profile", record.profile);
  assignOptionalTaskOptionString(options, "languageStyle", record.languageStyle);
  assignOptionalTaskOptionString(options, "assistantMbti", record.assistantMbti);
  assignOptionalTaskOptionString(options, "styleNotes", record.styleNotes);
  assignOptionalTaskOptionString(options, "assistantSoul", record.assistantSoul);
  assignOptionalTaskOptionString(options, "authAccountId", record.authAccountId);
  assignOptionalTaskOptionString(options, "model", record.model);
  assignOptionalTaskOptionString(options, "reasoning", record.reasoning);
  assignOptionalTaskOptionString(options, "memoryMode", record.memoryMode);
  assignOptionalTaskOptionString(options, "sandboxMode", record.sandboxMode);
  assignOptionalTaskOptionString(options, "webSearchMode", record.webSearchMode);
  assignOptionalTaskOptionString(options, "approvalPolicy", record.approvalPolicy);
  assignOptionalTaskOptionString(options, "accessMode", record.accessMode);
  assignOptionalTaskOptionString(options, "thirdPartyProviderId", record.thirdPartyProviderId);

  if (typeof record.networkAccessEnabled === "boolean") {
    options.networkAccessEnabled = record.networkAccessEnabled;
  }

  if (Array.isArray(record.additionalDirectories)) {
    const additionalDirectories = record.additionalDirectories
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (additionalDirectories.length > 0) {
      options.additionalDirectories = additionalDirectories;
    }
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

function resolveWorkspacePath(snapshot: unknown): string | null {
  const record = asRecord(snapshot);
  return normalizeOptionalText(record?.workspacePath);
}

function assignOptionalTaskOptionString(
  target: TaskOptions,
  key: keyof TaskOptions,
  value: unknown,
): void {
  const normalized = normalizeOptionalText(value);

  if (normalized) {
    (target as Record<string, unknown>)[key] = normalized;
  }
}

function serializeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function isActiveRunCancellationError(error: unknown): boolean {
  return error instanceof Error && error.message === "Work item has active runs and cannot be cancelled yet.";
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toExecutionNotification(
  notification: SendAgentMessageResult | null,
): {
  notification?: {
    message?: StoredAgentMessageRecord;
    mailboxEntry?: StoredAgentMailboxEntryRecord;
  };
} {
  if (!notification) {
    return {};
  }

  return {
    notification: {
      message: notification.message,
      mailboxEntry: notification.mailboxEntry,
    },
  };
}
