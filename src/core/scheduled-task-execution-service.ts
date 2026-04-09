import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type {
  ChannelId,
  StoredScheduledTaskRecord,
  StoredScheduledTaskRunRecord,
  TaskRequest,
  TaskResult,
} from "../types/index.js";
import {
  AppServerTaskRuntime,
  type AppServerTaskExecutionController,
} from "./app-server-task-runtime.js";
import {
  ScheduledTaskSchedulerService,
  type ClaimNextDueScheduledTaskInput,
  type ScheduledTaskSchedulerClaim,
  type ScheduledTaskSchedulerTickResult,
} from "./scheduled-task-scheduler-service.js";

const DEFAULT_EXECUTION_SCHEDULER_ID = "scheduler-scheduled-main";

export interface ScheduledTaskExecutionServiceOptions {
  registry: SqliteCodexSessionRegistry;
  runtime: AppServerTaskRuntime;
  schedulerService?: ScheduledTaskSchedulerService;
  defaultSchedulerId?: string;
  onExecutionFinished?: (notification: ScheduledTaskExecutionNotification) => Promise<void> | void;
}

export interface ScheduledTaskExecutionOutcome {
  result: "completed" | "failed" | "cancelled";
  claim: ScheduledTaskSchedulerClaim;
  taskResult?: TaskResult;
  failureMessage?: string;
}

export interface ScheduledTaskExecutionRunNextResult extends ScheduledTaskSchedulerTickResult {
  execution: ScheduledTaskExecutionOutcome | null;
}

export interface ScheduledTaskExecutionNotification {
  claim: ScheduledTaskSchedulerClaim;
  outcome: ScheduledTaskExecutionOutcome;
  task: StoredScheduledTaskRecord;
  run: StoredScheduledTaskRunRecord;
}

interface ScheduledTaskActiveExecution {
  runId: string;
  controller: AbortController;
  executionController: AppServerTaskExecutionController | null;
}

export class ScheduledTaskExecutionService {
  private readonly registry: SqliteCodexSessionRegistry;
  private readonly runtime: AppServerTaskRuntime;
  private readonly schedulerService: ScheduledTaskSchedulerService;
  private readonly defaultSchedulerId: string;
  private readonly onExecutionFinished: ((notification: ScheduledTaskExecutionNotification) => Promise<void> | void) | null;
  private readonly activeExecutionsByRunId = new Map<string, ScheduledTaskActiveExecution>();

  constructor(options: ScheduledTaskExecutionServiceOptions) {
    this.registry = options.registry;
    this.runtime = options.runtime;
    this.schedulerService = options.schedulerService ?? new ScheduledTaskSchedulerService({
      registry: options.registry,
    });
    this.defaultSchedulerId = normalizeOptionalText(options.defaultSchedulerId) ?? DEFAULT_EXECUTION_SCHEDULER_ID;
    this.onExecutionFinished = options.onExecutionFinished ?? null;
  }

  async runNext(input: ClaimNextDueScheduledTaskInput = {}): Promise<ScheduledTaskExecutionRunNextResult> {
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

  async executeClaim(
    claim: ScheduledTaskSchedulerClaim,
    input: {
      now?: string;
    } = {},
  ): Promise<ScheduledTaskExecutionOutcome> {
    const now = normalizeOptionalText(input.now) ?? new Date().toISOString();
    const request = buildTaskRequest(claim, now);
    const controller = new AbortController();
    const activeExecution: ScheduledTaskActiveExecution = {
      runId: claim.run.runId,
      controller,
      executionController: null,
    };
    this.activeExecutionsByRunId.set(claim.run.runId, activeExecution);
    const initialRunInput = {
      requestId: request.requestId,
      ...(request.taskId ? { taskId: request.taskId } : {}),
      now,
    };

    let run = this.schedulerService.markRunRunning(claim.run.runId, claim.run.leaseToken, initialRunInput);
    const conversationId = resolveConversationId(claim.task);

    try {
      const taskContext = {
        principalId: claim.task.principalId,
        ...(conversationId ? { conversationId } : {}),
      };
      const taskResult = await this.runtime.runTaskAsPrincipal(request, taskContext, {
        signal: controller.signal,
        onExecutionReady: (executionController) => {
          activeExecution.executionController = executionController;
        },
        onEvent: async (event) => {
          if (event.status === "running") {
            run = this.schedulerService.heartbeatRun(claim.run.runId, claim.run.leaseToken, event.timestamp);
          }
        },
      });

      if (taskResult.status === "cancelled") {
        this.schedulerService.cancelRun(run.runId, claim.run.leaseToken, taskResult.summary, taskResult.completedAt);
        return await this.finishExecution(claim, {
          result: "cancelled",
          claim,
          taskResult,
        });
      }

      if (taskResult.status === "failed") {
        const failInput = {
          requestId: taskResult.requestId,
          ...(taskResult.taskId ? { taskId: taskResult.taskId } : {}),
          failureMessage: taskResult.summary,
          ...(taskResult.output ? { output: taskResult.output } : {}),
          ...(taskResult.structuredOutput ? { structuredOutput: taskResult.structuredOutput } : {}),
          completedAt: taskResult.completedAt,
        };
        this.schedulerService.failRun(run.runId, claim.run.leaseToken, failInput);
        return await this.finishExecution(claim, {
          result: "failed",
          claim,
          taskResult,
          failureMessage: taskResult.summary,
        });
      }

      const completeInput = {
        requestId: taskResult.requestId,
        ...(taskResult.taskId ? { taskId: taskResult.taskId } : {}),
        summary: taskResult.summary,
        ...(taskResult.output ? { output: taskResult.output } : {}),
        ...(taskResult.structuredOutput ? { structuredOutput: taskResult.structuredOutput } : {}),
        completedAt: taskResult.completedAt,
      };
      this.schedulerService.completeRun(run.runId, claim.run.leaseToken, completeInput);
      return await this.finishExecution(claim, {
        result: "completed",
        claim,
        taskResult,
      });
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : String(error);
      const failInput = {
        requestId: request.requestId,
        ...(request.taskId ? { taskId: request.taskId } : {}),
        failureMessage,
        completedAt: new Date().toISOString(),
      };
      this.schedulerService.failRun(run.runId, claim.run.leaseToken, failInput);
      return await this.finishExecution(claim, {
        result: "failed",
        claim,
        failureMessage,
      });
    } finally {
      this.activeExecutionsByRunId.delete(claim.run.runId);
    }
  }

  interruptRun(runId: string): Promise<void> {
    const activeExecution = this.activeExecutionsByRunId.get(runId);

    if (!activeExecution) {
      return Promise.resolve();
    }

    activeExecution.controller.abort(new Error("SCHEDULED_TASK_CANCELLED"));
    return activeExecution.executionController?.interrupt() ?? Promise.resolve();
  }

  private async finishExecution(
    claim: ScheduledTaskSchedulerClaim,
    outcome: ScheduledTaskExecutionOutcome,
  ): Promise<ScheduledTaskExecutionOutcome> {
    const task = this.registry.getScheduledTask(claim.task.scheduledTaskId) ?? claim.task;
    const run = this.registry.getScheduledTaskRun(claim.run.runId) ?? claim.run;

    if (this.onExecutionFinished) {
      try {
        await this.onExecutionFinished({
          claim,
          outcome,
          task,
          run,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[themis/scheduled] 执行回执失败：${message}`);
      }
    }

    return outcome;
  }
}

function buildTaskRequest(claim: ScheduledTaskSchedulerClaim, now: string): TaskRequest {
  const request: TaskRequest = {
    requestId: createId("scheduled-request"),
    taskId: createId("scheduled-task-exec"),
    sourceChannel: claim.task.sourceChannel as ChannelId,
    user: {
      userId: claim.task.channelUserId,
      ...(claim.task.displayName ? { displayName: claim.task.displayName } : {}),
    },
    goal: claim.task.goal,
    ...(claim.task.inputText ? { inputText: claim.task.inputText } : {}),
    ...(claim.task.options ? { options: claim.task.options } : {}),
    channelContext: {
      ...(claim.task.sessionId ? { sessionId: claim.task.sessionId } : {}),
      ...(claim.task.channelSessionKey ? { channelSessionKey: claim.task.channelSessionKey } : {}),
    },
    createdAt: now,
  };

  return applyAutomationInstruction(request, claim.task.automation);
}

function applyAutomationInstruction(
  request: TaskRequest,
  automation: ScheduledTaskSchedulerClaim["task"]["automation"],
): TaskRequest {
  if (!automation || resolveAutomationOutputMode(automation) !== "json") {
    return request;
  }

  const sections = [
    "Automation output contract:",
    "- This run is in automation mode.",
    "- Return exactly one valid JSON value and nothing else.",
    "- Do not wrap the JSON in Markdown code fences.",
    "- Do not add commentary before or after the JSON.",
  ];

  if (automation.jsonSchema) {
    sections.push(
      "The JSON output should conform to this schema:",
      JSON.stringify(automation.jsonSchema, null, 2),
    );
  }

  const instruction = sections.join("\n");
  const normalizedInputText = typeof request.inputText === "string" ? request.inputText.trim() : "";

  return {
    ...request,
    inputText: normalizedInputText ? `${normalizedInputText}\n\n${instruction}` : instruction,
  };
}

function resolveAutomationOutputMode(
  automation: NonNullable<ScheduledTaskSchedulerClaim["task"]["automation"]>,
): "text" | "json" {
  if (automation.outputMode === "json" || automation.jsonSchema || automation.onInvalidJson || automation.onSchemaMismatch) {
    return "json";
  }

  return "text";
}

function resolveConversationId(task: ScheduledTaskSchedulerClaim["task"]): string | undefined {
  return normalizeOptionalText(task.sessionId) ?? normalizeOptionalText(task.channelSessionKey);
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
