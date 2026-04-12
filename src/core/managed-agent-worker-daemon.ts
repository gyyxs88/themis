import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type {
  TaskEvent,
  TaskRequest,
} from "../types/index.js";
import {
  AppServerTaskRuntime,
  AppServerTaskWaitingForActionError,
  isAppServerTaskWaitingForActionError,
} from "./app-server-task-runtime.js";
import { ManagedAgentPlatformWorkerClient } from "./managed-agent-platform-worker-client.js";
import type { ManagedAgentWorkerAssignedRun } from "./managed-agent-worker-service.js";
import { validateWorkspacePath } from "./session-workspace.js";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

export interface ManagedAgentWorkerDaemonNodeOptions {
  nodeId?: string;
  organizationId?: string;
  displayName: string;
  slotCapacity: number;
  slotAvailable?: number;
  labels?: string[];
  workspaceCapabilities?: string[];
  credentialCapabilities?: string[];
  providerCapabilities?: string[];
  heartbeatTtlSeconds?: number;
}

export interface ManagedAgentWorkerDaemonOptions {
  client: ManagedAgentPlatformWorkerClient;
  runtime: AppServerTaskRuntime;
  node: ManagedAgentWorkerDaemonNodeOptions;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  log?: (message: string) => void;
}

export interface ManagedAgentWorkerDaemonRunOnceResult {
  nodeId: string;
  executedRunId: string | null;
  result: "idle" | "completed" | "waiting_action" | "failed" | "cancelled";
}

class ManagedAgentWorkerBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagedAgentWorkerBoundaryError";
  }
}

export class ManagedAgentWorkerDaemon {
  private readonly client: ManagedAgentPlatformWorkerClient;
  private readonly runtime: AppServerTaskRuntime;
  private readonly node: ManagedAgentWorkerDaemonNodeOptions;
  private readonly pollIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly log: (message: string) => void;
  private currentNodeId: string | null;

  constructor(options: ManagedAgentWorkerDaemonOptions) {
    this.client = options.client;
    this.runtime = options.runtime;
    this.node = {
      ...options.node,
      slotAvailable: normalizePositiveInteger(options.node.slotAvailable) ?? options.node.slotCapacity,
    };
    this.pollIntervalMs = normalizePositiveInteger(options.pollIntervalMs) ?? DEFAULT_POLL_INTERVAL_MS;
    this.heartbeatIntervalMs = normalizePositiveInteger(options.heartbeatIntervalMs) ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.log = options.log ?? (() => {});
    this.currentNodeId = normalizeOptionalText(options.node.nodeId);
  }

  async runOnce(): Promise<ManagedAgentWorkerDaemonRunOnceResult> {
    const nodeId = await this.ensureNodeRegistered(this.idleSlotAvailable());
    await this.client.heartbeatNode({
      nodeId,
      slotAvailable: this.idleSlotAvailable(),
      ...this.buildNodeCapabilityPayload(),
    });

    const assigned = await this.client.pullAssignedRun(nodeId);

    if (!assigned) {
      return {
        nodeId,
        executedRunId: null,
        result: "idle",
      };
    }

    return await this.executeAssignedRun(nodeId, assigned);
  }

  async runLoop(signal?: AbortSignal): Promise<void> {
    try {
      while (!signal?.aborted) {
        await this.runOnce();
        await sleep(this.pollIntervalMs, signal);
      }
    } finally {
      await this.markNodeOffline().catch(() => {});
    }
  }

  async markNodeOffline(): Promise<void> {
    const nodeId = this.currentNodeId;

    if (!nodeId) {
      return;
    }

    await this.client.heartbeatNode({
      nodeId,
      status: "offline",
      slotAvailable: 0,
    });
  }

  private async ensureNodeRegistered(slotAvailable: number): Promise<string> {
    const result = await this.client.registerNode({
      ...(this.currentNodeId ? { nodeId: this.currentNodeId } : {}),
      ...(this.node.organizationId ? { organizationId: this.node.organizationId } : {}),
      displayName: this.node.displayName,
      slotCapacity: this.node.slotCapacity,
      slotAvailable,
      ...this.buildNodeCapabilityPayload(),
    });
    this.currentNodeId = result.node.nodeId;
    return result.node.nodeId;
  }

  private async executeAssignedRun(
    nodeId: string,
    assigned: ManagedAgentWorkerAssignedRun,
  ): Promise<ManagedAgentWorkerDaemonRunOnceResult> {
    const busySlotAvailable = Math.max(0, this.idleSlotAvailable() - 1);
    this.materializeAssignedRuntimeState(assigned);
    const contract = this.prepareExecutionContract(assigned.executionContract);
    const abortController = new AbortController();
    let currentRunStatus: "starting" | "running" | "waiting_human" | "waiting_agent" = "starting";

    await this.client.heartbeatNode({
      nodeId,
      slotAvailable: busySlotAvailable,
    });
    await this.client.updateRunStatus({
      ownerPrincipalId: "",
      nodeId,
      runId: assigned.run.runId,
      leaseToken: assigned.run.leaseToken,
      status: "starting",
    });
    this.log(`Worker Node 开始执行 run ${assigned.run.runId}`);

    const heartbeatTimer = setInterval(() => {
      void this.client.heartbeatNode({
        nodeId,
        slotAvailable: busySlotAvailable,
      }).catch(() => {});

      if (currentRunStatus === "waiting_human" || currentRunStatus === "waiting_agent") {
        return;
      }

      void this.client.updateRunStatus({
        ownerPrincipalId: "",
        nodeId,
        runId: assigned.run.runId,
        leaseToken: assigned.run.leaseToken,
        status: "heartbeat",
      }).catch(() => {});
    }, this.heartbeatIntervalMs);

    try {
      const taskResult = await this.runtime.runTaskAsPrincipal(
        contract.request,
        contract.context,
        {
          signal: abortController.signal,
          onEvent: async (event) => {
            await this.handleTaskEvent({
              nodeId,
              assigned,
              event,
              abortController,
              onStatusChanged: (status) => {
                currentRunStatus = status;
              },
            });
          },
        },
      );

      if (taskResult.status === "cancelled") {
        await this.client.updateRunStatus({
          ownerPrincipalId: "",
          nodeId,
          runId: assigned.run.runId,
          leaseToken: assigned.run.leaseToken,
          status: "cancelled",
          failureCode: "WORKER_NODE_CANCELLED",
          failureMessage: taskResult.summary,
        });
        return {
          nodeId,
          executedRunId: assigned.run.runId,
          result: "cancelled",
        };
      }

      await this.client.completeRun({
        ownerPrincipalId: "",
        nodeId,
        runId: assigned.run.runId,
        leaseToken: assigned.run.leaseToken,
        result: {
          summary: taskResult.summary,
          completedAt: taskResult.completedAt,
          ...(taskResult.output !== undefined ? { output: taskResult.output } : {}),
          ...(taskResult.touchedFiles !== undefined ? { touchedFiles: taskResult.touchedFiles } : {}),
          ...(taskResult.structuredOutput !== undefined ? { structuredOutput: taskResult.structuredOutput } : {}),
        },
      });
      return {
        nodeId,
        executedRunId: assigned.run.runId,
        result: "completed",
      };
    } catch (error) {
      if (isAppServerTaskWaitingForActionError(error)) {
        return {
          nodeId,
          executedRunId: assigned.run.runId,
          result: "waiting_action",
        };
      }

      const failureMessage = toErrorMessage(error);
      await this.client.updateRunStatus({
        ownerPrincipalId: "",
        nodeId,
        runId: assigned.run.runId,
        leaseToken: assigned.run.leaseToken,
        status: "failed",
        failureCode: error instanceof ManagedAgentWorkerBoundaryError
          ? "MANAGED_AGENT_EXECUTION_BOUNDARY_INVALID"
          : "WORKER_NODE_EXECUTION_FAILED",
        failureMessage,
      });
      return {
        nodeId,
        executedRunId: assigned.run.runId,
        result: "failed",
      };
    } finally {
      clearInterval(heartbeatTimer);
      await this.client.heartbeatNode({
        nodeId,
        slotAvailable: this.idleSlotAvailable(),
      }).catch(() => {});
    }
  }

  private async handleTaskEvent(input: {
    nodeId: string;
    assigned: ManagedAgentWorkerAssignedRun;
    event: TaskEvent;
    abortController: AbortController;
    onStatusChanged: (status: "starting" | "running" | "waiting_human" | "waiting_agent") => void;
  }): Promise<void> {
    if (input.event.type === "task.started") {
      input.onStatusChanged("running");
      await this.client.updateRunStatus({
        ownerPrincipalId: "",
        nodeId: input.nodeId,
        runId: input.assigned.run.runId,
        leaseToken: input.assigned.run.leaseToken,
        status: "running",
      });
      return;
    }

    if (input.event.type !== "task.action_required") {
      return;
    }

    const waitingFor = input.assigned.workItem.sourceAgentId ? "agent" : "human";
    const status = waitingFor === "agent" ? "waiting_agent" : "waiting_human";
    const actionType = normalizeOptionalText(asString(input.event.payload?.actionType));
    const actionId = normalizeOptionalText(asString(input.event.payload?.actionId));
    const prompt = normalizeOptionalText(asString(input.event.payload?.prompt))
      ?? normalizeOptionalText(input.event.message)
      ?? "Worker node task is waiting for follow-up action.";
    const requestId = normalizeOptionalText(input.event.requestId);
    const taskId = normalizeOptionalText(input.event.taskId);
    input.onStatusChanged(status);
    await this.client.updateRunStatus({
      ownerPrincipalId: "",
      nodeId: input.nodeId,
      runId: input.assigned.run.runId,
      leaseToken: input.assigned.run.leaseToken,
      status,
      waitingAction: {
        ...(actionType ? { actionType } : {}),
        ...(actionId ? { actionId } : {}),
        prompt,
        ...(input.event.payload?.choices !== undefined ? { choices: input.event.payload.choices } : {}),
        ...(input.event.payload?.inputSchema !== undefined ? { inputSchema: input.event.payload.inputSchema } : {}),
        ...(requestId ? { requestId } : {}),
        ...(taskId ? { taskId } : {}),
      },
    });
    input.abortController.abort(new AppServerTaskWaitingForActionError(
      waitingFor,
      normalizeOptionalText(input.event.message) ?? "Worker node task is waiting for follow-up action.",
    ));
  }

  private materializeAssignedRuntimeState(assigned: ManagedAgentWorkerAssignedRun): void {
    const runtimeStore = this.runtime.getRuntimeStore();
    const now = new Date().toISOString();
    const {
      defaultWorkspacePolicyId: _ignoredWorkspacePolicyId,
      defaultRuntimeProfileId: _ignoredRuntimeProfileId,
      ...targetAgentRecord
    } = assigned.targetAgent;

    this.ensurePrincipalRecord(
      runtimeStore,
      assigned.organization.ownerPrincipalId,
      assigned.organization.organizationId,
      "human_user",
      assigned.organization.displayName,
      assigned.organization.createdAt,
      now,
    );
    this.ensurePrincipalRecord(
      runtimeStore,
      assigned.targetAgent.createdByPrincipalId,
      assigned.organization.organizationId,
      "human_user",
      assigned.organization.displayName,
      assigned.targetAgent.createdAt,
      now,
    );
    if (assigned.targetAgent.supervisorPrincipalId) {
      this.ensurePrincipalRecord(
        runtimeStore,
        assigned.targetAgent.supervisorPrincipalId,
        assigned.organization.organizationId,
        "managed_agent",
        assigned.targetAgent.supervisorPrincipalId,
        assigned.targetAgent.createdAt,
        now,
      );
    }
    runtimeStore.saveOrganization(assigned.organization);
    runtimeStore.savePrincipal({
      principalId: assigned.targetAgent.principalId,
      organizationId: assigned.organization.organizationId,
      displayName: assigned.targetAgent.displayName,
      kind: "managed_agent",
      createdAt: assigned.targetAgent.createdAt,
      updatedAt: now,
    });
    runtimeStore.saveManagedAgent({
      ...targetAgentRecord,
      updatedAt: now,
    });

    const defaultWorkspacePolicyId = this.materializeWorkspacePolicy(runtimeStore, assigned, now);
    const defaultRuntimeProfileId = this.materializeRuntimeProfile(runtimeStore, assigned, now);

    runtimeStore.saveManagedAgent({
      ...targetAgentRecord,
      ...(defaultWorkspacePolicyId ? { defaultWorkspacePolicyId } : {}),
      ...(defaultRuntimeProfileId ? { defaultRuntimeProfileId } : {}),
      updatedAt: now,
    });
  }

  private prepareExecutionContract(
    contract: ManagedAgentWorkerAssignedRun["executionContract"],
  ): ManagedAgentWorkerAssignedRun["executionContract"] {
    const runtimeStore = this.runtime.getRuntimeStore();
    const sessionId = normalizeOptionalText(contract.request.channelContext.sessionId)
      ?? normalizeOptionalText(contract.request.channelContext.channelSessionKey);

    if (!sessionId) {
      throw new ManagedAgentWorkerBoundaryError("Worker execution contract is missing sessionId.");
    }

    const workspacePath = this.validateExecutionWorkspacePath(contract.workspacePath ?? this.runtime.getWorkingDirectory());
    const request = this.normalizeExecutionRequest(contract.request, workspacePath);
    const existing = runtimeStore.getSessionTaskSettings(sessionId);
    const now = new Date().toISOString();

    runtimeStore.saveSessionTaskSettings({
      sessionId,
      settings: {
        ...(existing?.settings ?? {}),
        workspacePath,
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    return {
      ...contract,
      request,
      workspacePath,
    };
  }

  private normalizeExecutionRequest(request: TaskRequest, workspacePath: string): TaskRequest {
    const currentOptions = request.options ?? {};
    const rawAdditionalDirectories = Array.isArray(currentOptions.additionalDirectories)
      ? currentOptions.additionalDirectories
      : [];
    const additionalDirectories = rawAdditionalDirectories
      .map((directory) => this.validateExecutionWorkspacePath(directory))
      .filter((directory) => directory !== workspacePath);

    return {
      ...request,
      options: {
        ...currentOptions,
        ...(additionalDirectories.length > 0 ? { additionalDirectories: dedupeStrings(additionalDirectories) } : {}),
      },
    };
  }

  private validateExecutionWorkspacePath(path: string): string {
    try {
      return validateWorkspacePath(path);
    } catch (error) {
      throw new ManagedAgentWorkerBoundaryError(toErrorMessage(error));
    }
  }

  private idleSlotAvailable(): number {
    return normalizePositiveInteger(this.node.slotAvailable) ?? this.node.slotCapacity;
  }

  private materializeWorkspacePolicy(
    runtimeStore: SqliteCodexSessionRegistry,
    assigned: ManagedAgentWorkerAssignedRun,
    now: string,
  ): string | null {
    const snapshot = assigned.workItem.workspacePolicySnapshot;
    const policyId = normalizeOptionalText(assigned.targetAgent.defaultWorkspacePolicyId)
      ?? normalizeOptionalText(snapshot?.policyId);

    if (!policyId) {
      return null;
    }

    if (runtimeStore.getAgentWorkspacePolicy(policyId)) {
      return policyId;
    }

    const workspacePath = normalizeOptionalText(snapshot?.workspacePath);

    if (!workspacePath) {
      return null;
    }

    runtimeStore.saveAgentWorkspacePolicy({
      policyId,
      organizationId: assigned.organization.organizationId,
      ownerAgentId: assigned.targetAgent.agentId,
      displayName: normalizeOptionalText(snapshot?.displayName) ?? `${assigned.targetAgent.displayName} 默认工作区`,
      workspacePath,
      additionalDirectories: Array.isArray(snapshot?.additionalDirectories) ? snapshot.additionalDirectories : [],
      allowNetworkAccess: snapshot?.allowNetworkAccess ?? true,
      createdAt: assigned.targetAgent.createdAt,
      updatedAt: now,
    });
    return policyId;
  }

  private materializeRuntimeProfile(
    runtimeStore: SqliteCodexSessionRegistry,
    assigned: ManagedAgentWorkerAssignedRun,
    now: string,
  ): string | null {
    const snapshot = assigned.workItem.runtimeProfileSnapshot;
    const profileId = normalizeOptionalText(assigned.targetAgent.defaultRuntimeProfileId)
      ?? normalizeOptionalText(snapshot?.profileId);

    if (!profileId) {
      return null;
    }

    if (runtimeStore.getAgentRuntimeProfile(profileId)) {
      return profileId;
    }

    runtimeStore.saveAgentRuntimeProfile({
      profileId,
      organizationId: assigned.organization.organizationId,
      ownerAgentId: assigned.targetAgent.agentId,
      displayName: normalizeOptionalText(snapshot?.displayName) ?? `${assigned.targetAgent.displayName} 默认运行配置`,
      ...(snapshot ?? {}),
      createdAt: assigned.targetAgent.createdAt,
      updatedAt: now,
    });
    return profileId;
  }

  private ensurePrincipalRecord(
    runtimeStore: SqliteCodexSessionRegistry,
    principalId: string,
    organizationId: string,
    kind: "human_user" | "managed_agent" | "system",
    displayName: string,
    createdAt: string,
    now: string,
  ): void {
    const normalizedPrincipalId = normalizeOptionalText(principalId);

    if (!normalizedPrincipalId) {
      return;
    }

    const existing = runtimeStore.getPrincipal(normalizedPrincipalId);
    runtimeStore.savePrincipal({
      principalId: normalizedPrincipalId,
      organizationId: normalizeOptionalText(existing?.organizationId) ?? organizationId,
      displayName: normalizeOptionalText(existing?.displayName) ?? displayName,
      kind: existing?.kind ?? kind,
      createdAt: existing?.createdAt ?? createdAt,
      updatedAt: now,
    });
  }

  private buildNodeCapabilityPayload(): {
    labels?: string[];
    workspaceCapabilities?: string[];
    credentialCapabilities?: string[];
    providerCapabilities?: string[];
    heartbeatTtlSeconds?: number;
  } {
    const heartbeatTtlSeconds = normalizePositiveInteger(this.node.heartbeatTtlSeconds);

    return {
      ...(this.node.labels ? { labels: this.node.labels } : {}),
      ...(this.node.workspaceCapabilities ? { workspaceCapabilities: this.node.workspaceCapabilities } : {}),
      ...(this.node.credentialCapabilities ? { credentialCapabilities: this.node.credentialCapabilities } : {}),
      ...(this.node.providerCapabilities ? { providerCapabilities: this.node.providerCapabilities } : {}),
      ...(heartbeatTtlSeconds ? { heartbeatTtlSeconds } : {}),
    };
  }
}

export async function runManagedAgentWorkerDaemon(
  options: ManagedAgentWorkerDaemonOptions & {
    signal?: AbortSignal;
    once?: boolean;
  },
): Promise<void> {
  const daemon = new ManagedAgentWorkerDaemon(options);

  if (options.once) {
    await daemon.runOnce();
    return;
  }

  await daemon.runLoop(options.signal);
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeOptionalText(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizePositiveInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
