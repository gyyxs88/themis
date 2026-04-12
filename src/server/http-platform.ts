import type { IncomingMessage, ServerResponse } from "node:http";
import type { ManagedAgentControlPlaneFacade } from "../core/managed-agent-control-plane-facade.js";
import {
  MANAGED_AGENT_NODE_STATUSES,
  MANAGED_AGENT_PRIORITIES,
  MANAGED_AGENT_WORK_ITEM_SOURCE_TYPES,
  type ManagedAgentNodeStatus,
  type ManagedAgentPriority,
  type ManagedAgentWorkItemSourceType,
} from "../types/index.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

interface PlatformAgentCreatePayload {
  ownerPrincipalId: string;
  agent: {
    displayName?: string;
    departmentRole: string;
    mission?: string;
    organizationId?: string;
    supervisorAgentId?: string;
  };
}

interface PlatformAgentListPayload {
  ownerPrincipalId: string;
}

interface PlatformAgentDetailPayload extends PlatformAgentListPayload {
  agentId: string;
}

interface PlatformWorkItemDispatchPayload extends PlatformAgentListPayload {
  workItem: {
    targetAgentId: string;
    sourceType?: ManagedAgentWorkItemSourceType;
    sourceAgentId?: string;
    sourcePrincipalId?: string;
    parentWorkItemId?: string;
    dispatchReason: string;
    goal: string;
    contextPacket?: unknown;
    priority?: ManagedAgentPriority;
    workspacePolicySnapshot?: unknown;
    runtimeProfileSnapshot?: unknown;
    scheduledAt?: string;
  };
}

interface PlatformWorkItemDetailPayload extends PlatformAgentListPayload {
  workItemId: string;
}

interface PlatformRunListPayload extends PlatformAgentListPayload {
  agentId?: string;
  workItemId?: string;
}

interface PlatformRunDetailPayload extends PlatformAgentListPayload {
  runId: string;
}

interface PlatformNodeRegisterPayload extends PlatformAgentListPayload {
  node: {
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
  };
}

interface PlatformNodeHeartbeatPayload extends PlatformAgentListPayload {
  node: {
    nodeId: string;
    status?: ManagedAgentNodeStatus;
    slotAvailable?: number;
    labels?: string[];
    workspaceCapabilities?: string[];
    credentialCapabilities?: string[];
    providerCapabilities?: string[];
    heartbeatTtlSeconds?: number;
  };
}

interface PlatformNodeListPayload extends PlatformAgentListPayload {
  organizationId?: string;
}

interface PlatformNodeDetailPayload extends PlatformAgentListPayload {
  nodeId: string;
}

interface PlatformWorkerPullPayload extends PlatformAgentListPayload {
  nodeId: string;
}

interface PlatformWorkerRunStatusPayload extends PlatformWorkerPullPayload {
  runId: string;
  leaseToken: string;
  status: "starting" | "running" | "heartbeat" | "waiting_human" | "waiting_agent" | "failed" | "cancelled";
  failureCode?: string;
  failureMessage?: string;
  waitingAction?: {
    actionType?: string;
    actionId?: string;
    prompt?: string;
    message?: string;
    choices?: unknown;
    inputSchema?: unknown;
    requestId?: string;
    taskId?: string;
  };
}

interface PlatformWorkerRunCompletePayload extends PlatformWorkerPullPayload {
  runId: string;
  leaseToken: string;
  result?: {
    summary: string;
    output?: unknown;
    touchedFiles?: string[];
    structuredOutput?: Record<string, unknown> | null;
    completedAt?: string;
  };
}

async function readAndNormalizePayload<T>(
  request: IncomingMessage,
  response: ServerResponse,
  normalize: (value: unknown) => T,
): Promise<T | null> {
  try {
    return normalize(await readJsonBody(request));
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, false), {
      error: createTaskError(error, false),
    });
    return null;
  }
}

function writePlatformError(response: ServerResponse, error: unknown): void {
  writeJson(response, resolveErrorStatusCode(error, true), {
    error: createTaskError(error, true),
  });
}

export async function handlePlatformAgentCreate(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformAgentCreatePayload);
  if (!payload) {
    return;
  }

  try {
    const result = facade.createManagedAgent({
      ownerPrincipalId: payload.ownerPrincipalId,
      departmentRole: payload.agent.departmentRole,
      ...(payload.agent.displayName ? { displayName: payload.agent.displayName } : {}),
      ...(payload.agent.mission ? { mission: payload.agent.mission } : {}),
      ...(payload.agent.organizationId ? { organizationId: payload.agent.organizationId } : {}),
      ...(payload.agent.supervisorAgentId ? { supervisorAgentId: payload.agent.supervisorAgentId } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      principal: result.principal,
      agent: result.agent,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformAgentList(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformOwnerPayload);
  if (!payload) {
    return;
  }

  try {
    const result = facade.listManagedAgents(payload.ownerPrincipalId);
    writeJson(response, 200, {
      ok: true,
      organizations: result.organizations,
      agents: result.agents,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformAgentDetail(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformAgentDetailPayload);
  if (!payload) {
    return;
  }

  try {
    const detail = facade.getManagedAgentDetailView(payload.ownerPrincipalId, payload.agentId);
    if (!detail) {
      throw new Error("Managed agent not found.");
    }

    writeJson(response, 200, {
      ok: true,
      organization: detail.organization,
      principal: detail.principal,
      agent: detail.agent,
      workspacePolicy: detail.workspacePolicy,
      runtimeProfile: detail.runtimeProfile,
      authAccounts: detail.authAccounts,
      thirdPartyProviders: detail.thirdPartyProviders,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformWorkItemDispatch(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformWorkItemDispatchPayload);
  if (!payload) {
    return;
  }

  try {
    const result = facade.dispatchWorkItem({
      ownerPrincipalId: payload.ownerPrincipalId,
      targetAgentId: payload.workItem.targetAgentId,
      ...(payload.workItem.sourceType ? { sourceType: payload.workItem.sourceType } : {}),
      ...(payload.workItem.sourceAgentId ? { sourceAgentId: payload.workItem.sourceAgentId } : {}),
      sourcePrincipalId: payload.workItem.sourcePrincipalId ?? payload.ownerPrincipalId,
      ...(payload.workItem.parentWorkItemId ? { parentWorkItemId: payload.workItem.parentWorkItemId } : {}),
      dispatchReason: payload.workItem.dispatchReason,
      goal: payload.workItem.goal,
      ...(hasOwn(payload.workItem, "contextPacket") ? { contextPacket: payload.workItem.contextPacket } : {}),
      ...(payload.workItem.priority ? { priority: payload.workItem.priority } : {}),
      ...(hasOwn(payload.workItem, "workspacePolicySnapshot")
        ? { workspacePolicySnapshot: payload.workItem.workspacePolicySnapshot }
        : {}),
      ...(hasOwn(payload.workItem, "runtimeProfileSnapshot")
        ? { runtimeProfileSnapshot: payload.workItem.runtimeProfileSnapshot }
        : {}),
      ...(payload.workItem.scheduledAt ? { scheduledAt: payload.workItem.scheduledAt } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      targetAgent: result.targetAgent,
      workItem: result.workItem,
      ...(result.dispatchMessage ? { dispatchMessage: result.dispatchMessage } : {}),
      ...(result.mailboxEntry ? { mailboxEntry: result.mailboxEntry } : {}),
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformWorkItemDetail(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformWorkItemDetailPayload);
  if (!payload) {
    return;
  }

  try {
    const detail = facade.getWorkItemDetailView(payload.ownerPrincipalId, payload.workItemId);
    if (!detail) {
      throw new Error("Work item not found.");
    }

    writeJson(response, 200, {
      ok: true,
      organization: detail.organization,
      workItem: detail.workItem,
      targetAgent: detail.targetAgent,
      sourceAgent: detail.sourceAgent,
      sourcePrincipal: detail.sourcePrincipal,
      messages: detail.messages,
      collaboration: detail.collaboration,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformRunList(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformRunListPayload);
  if (!payload) {
    return;
  }

  try {
    const runs = facade.listRuns({
      ownerPrincipalId: payload.ownerPrincipalId,
      ...(payload.agentId ? { agentId: payload.agentId } : {}),
      ...(payload.workItemId ? { workItemId: payload.workItemId } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      runs,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformRunDetail(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformRunDetailPayload);
  if (!payload) {
    return;
  }

  try {
    const detail = facade.getRunDetailView(payload.ownerPrincipalId, payload.runId);
    if (!detail) {
      throw new Error("Run not found.");
    }

    writeJson(response, 200, {
      ok: true,
      organization: detail.organization,
      targetAgent: detail.targetAgent,
      workItem: detail.workItem,
      run: detail.run,
      executionLease: detail.executionLease,
      node: detail.node,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformNodeRegister(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformNodeRegisterPayload);
  if (!payload) {
    return;
  }

  try {
    const result = facade.registerNode({
      ownerPrincipalId: payload.ownerPrincipalId,
      ...(payload.node.organizationId ? { organizationId: payload.node.organizationId } : {}),
      ...(payload.node.nodeId ? { nodeId: payload.node.nodeId } : {}),
      displayName: payload.node.displayName,
      slotCapacity: payload.node.slotCapacity,
      ...(payload.node.slotAvailable !== undefined ? { slotAvailable: payload.node.slotAvailable } : {}),
      ...(payload.node.labels ? { labels: payload.node.labels } : {}),
      ...(payload.node.workspaceCapabilities ? { workspaceCapabilities: payload.node.workspaceCapabilities } : {}),
      ...(payload.node.credentialCapabilities ? { credentialCapabilities: payload.node.credentialCapabilities } : {}),
      ...(payload.node.providerCapabilities ? { providerCapabilities: payload.node.providerCapabilities } : {}),
      ...(payload.node.heartbeatTtlSeconds !== undefined
        ? { heartbeatTtlSeconds: payload.node.heartbeatTtlSeconds }
        : {}),
    });

    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      node: result.node,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformNodeHeartbeat(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformNodeHeartbeatPayload);
  if (!payload) {
    return;
  }

  try {
    const result = facade.heartbeatNode({
      ownerPrincipalId: payload.ownerPrincipalId,
      nodeId: payload.node.nodeId,
      ...(payload.node.status ? { status: payload.node.status } : {}),
      ...(payload.node.slotAvailable !== undefined ? { slotAvailable: payload.node.slotAvailable } : {}),
      ...(payload.node.labels ? { labels: payload.node.labels } : {}),
      ...(payload.node.workspaceCapabilities ? { workspaceCapabilities: payload.node.workspaceCapabilities } : {}),
      ...(payload.node.credentialCapabilities ? { credentialCapabilities: payload.node.credentialCapabilities } : {}),
      ...(payload.node.providerCapabilities ? { providerCapabilities: payload.node.providerCapabilities } : {}),
      ...(payload.node.heartbeatTtlSeconds !== undefined
        ? { heartbeatTtlSeconds: payload.node.heartbeatTtlSeconds }
        : {}),
    });

    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      node: result.node,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformNodeList(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformNodeListPayload);
  if (!payload) {
    return;
  }

  try {
    const nodes = facade.listNodes(payload.ownerPrincipalId, payload.organizationId);
    writeJson(response, 200, {
      ok: true,
      nodes,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformNodeDetail(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformNodeDetailPayload);
  if (!payload) {
    return;
  }

  try {
    const detail = facade.getNodeDetailView(payload.ownerPrincipalId, payload.nodeId);
    if (!detail) {
      throw new Error("Managed agent node not found.");
    }

    writeJson(response, 200, {
      ok: true,
      organization: detail.organization,
      node: detail.node,
      leaseSummary: detail.leaseSummary,
      activeExecutionLeases: detail.activeExecutionLeases,
      recentExecutionLeases: detail.recentExecutionLeases,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformNodeDrain(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  await handlePlatformNodeGovernanceAction(request, response, facade, "draining");
}

export async function handlePlatformNodeOffline(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  await handlePlatformNodeGovernanceAction(request, response, facade, "offline");
}

export async function handlePlatformWorkerRunPull(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformWorkerPullPayload);
  if (!payload) {
    return;
  }

  try {
    const assigned = facade.pullAssignedRun(payload);
    writeJson(response, 200, {
      ok: true,
      ...(assigned ? {
        organization: assigned.organization,
        node: assigned.node,
        targetAgent: assigned.targetAgent,
        workItem: assigned.workItem,
        run: assigned.run,
        executionLease: assigned.executionLease,
        executionContract: assigned.executionContract,
      } : {
        organization: null,
        node: null,
        targetAgent: null,
        workItem: null,
        run: null,
        executionLease: null,
        executionContract: null,
      }),
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformWorkerRunUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformWorkerRunStatusPayload);
  if (!payload) {
    return;
  }

  try {
    const result = facade.updateWorkerRunStatus(payload);
    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      node: result.node,
      targetAgent: result.targetAgent,
      workItem: result.workItem,
      run: result.run,
      executionLease: result.executionLease,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformWorkerRunComplete(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformWorkerRunCompletePayload);
  if (!payload) {
    return;
  }

  try {
    const result = facade.completeWorkerRun(payload);
    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      node: result.node,
      targetAgent: result.targetAgent,
      workItem: result.workItem,
      run: result.run,
      executionLease: result.executionLease,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

function normalizePlatformAgentCreatePayload(value: unknown): PlatformAgentCreatePayload {
  if (!isRecord(value) || !isRecord(value.agent)) {
    throw new Error("Request body.agent must be an object.");
  }

  const displayName = readOptionalString(value.agent.displayName);
  const mission = readOptionalString(value.agent.mission);
  const organizationId = readOptionalString(value.agent.organizationId);
  const supervisorAgentId = readOptionalString(value.agent.supervisorAgentId);

  return {
    ownerPrincipalId: readRequiredString(value.ownerPrincipalId, "ownerPrincipalId"),
    agent: {
      departmentRole: readRequiredString(value.agent.departmentRole, "agent.departmentRole"),
      ...(displayName ? { displayName } : {}),
      ...(mission ? { mission } : {}),
      ...(organizationId ? { organizationId } : {}),
      ...(supervisorAgentId ? { supervisorAgentId } : {}),
    },
  };
}

function normalizePlatformOwnerPayload(value: unknown): PlatformAgentListPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ownerPrincipalId: readRequiredString(value.ownerPrincipalId, "ownerPrincipalId"),
  };
}

function normalizePlatformAgentDetailPayload(value: unknown): PlatformAgentDetailPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    agentId: readRequiredString(value.agentId, "agentId"),
  };
}

function normalizePlatformWorkItemDispatchPayload(value: unknown): PlatformWorkItemDispatchPayload {
  if (!isRecord(value) || !isRecord(value.workItem)) {
    throw new Error("Request body.workItem must be an object.");
  }

  const sourceType = readOptionalEnum(
    value.workItem.sourceType,
    MANAGED_AGENT_WORK_ITEM_SOURCE_TYPES,
    "workItem.sourceType",
  );
  const priority = readOptionalEnum(
    value.workItem.priority,
    MANAGED_AGENT_PRIORITIES,
    "workItem.priority",
  );
  const sourceAgentId = readOptionalString(value.workItem.sourceAgentId);
  const sourcePrincipalId = readOptionalString(value.workItem.sourcePrincipalId);
  const parentWorkItemId = readOptionalString(value.workItem.parentWorkItemId);
  const scheduledAt = readOptionalString(value.workItem.scheduledAt);

  return {
    ...normalizePlatformOwnerPayload(value),
    workItem: {
      targetAgentId: readRequiredString(value.workItem.targetAgentId, "workItem.targetAgentId"),
      ...(sourceType ? { sourceType } : {}),
      ...(sourceAgentId ? { sourceAgentId } : {}),
      ...(sourcePrincipalId ? { sourcePrincipalId } : {}),
      ...(parentWorkItemId ? { parentWorkItemId } : {}),
      dispatchReason: readRequiredString(value.workItem.dispatchReason, "workItem.dispatchReason"),
      goal: readRequiredString(value.workItem.goal, "workItem.goal"),
      ...(hasOwn(value.workItem, "contextPacket") ? { contextPacket: value.workItem.contextPacket } : {}),
      ...(priority ? { priority } : {}),
      ...(hasOwn(value.workItem, "workspacePolicySnapshot")
        ? { workspacePolicySnapshot: value.workItem.workspacePolicySnapshot }
        : {}),
      ...(hasOwn(value.workItem, "runtimeProfileSnapshot")
        ? { runtimeProfileSnapshot: value.workItem.runtimeProfileSnapshot }
        : {}),
      ...(scheduledAt ? { scheduledAt } : {}),
    },
  };
}

function normalizePlatformWorkItemDetailPayload(value: unknown): PlatformWorkItemDetailPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    workItemId: readRequiredString(value.workItemId, "workItemId"),
  };
}

function normalizePlatformRunListPayload(value: unknown): PlatformRunListPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const agentId = readOptionalString(value.agentId);
  const workItemId = readOptionalString(value.workItemId);

  return {
    ...normalizePlatformOwnerPayload(value),
    ...(agentId ? { agentId } : {}),
    ...(workItemId ? { workItemId } : {}),
  };
}

function normalizePlatformRunDetailPayload(value: unknown): PlatformRunDetailPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    runId: readRequiredString(value.runId, "runId"),
  };
}

function normalizePlatformNodeRegisterPayload(value: unknown): PlatformNodeRegisterPayload {
  if (!isRecord(value) || !isRecord(value.node)) {
    throw new Error("Request body.node must be an object.");
  }

  const organizationId = readOptionalString(value.node.organizationId);
  const nodeId = readOptionalString(value.node.nodeId);
  const slotAvailable = readOptionalNumber(value.node.slotAvailable);
  const heartbeatTtlSeconds = readOptionalPositiveInteger(value.node.heartbeatTtlSeconds, "node.heartbeatTtlSeconds");

  return {
    ...normalizePlatformOwnerPayload(value),
    node: {
      ...(organizationId ? { organizationId } : {}),
      ...(nodeId ? { nodeId } : {}),
      displayName: readRequiredString(value.node.displayName, "node.displayName"),
      slotCapacity: readRequiredPositiveInteger(value.node.slotCapacity, "node.slotCapacity"),
      ...(slotAvailable !== undefined ? { slotAvailable } : {}),
      ...(Array.isArray(value.node.labels) ? { labels: readStringArray(value.node.labels) } : {}),
      ...(Array.isArray(value.node.workspaceCapabilities)
        ? { workspaceCapabilities: readStringArray(value.node.workspaceCapabilities) }
        : {}),
      ...(Array.isArray(value.node.credentialCapabilities)
        ? { credentialCapabilities: readStringArray(value.node.credentialCapabilities) }
        : {}),
      ...(Array.isArray(value.node.providerCapabilities)
        ? { providerCapabilities: readStringArray(value.node.providerCapabilities) }
        : {}),
      ...(heartbeatTtlSeconds !== undefined ? { heartbeatTtlSeconds } : {}),
    },
  };
}

function normalizePlatformNodeHeartbeatPayload(value: unknown): PlatformNodeHeartbeatPayload {
  if (!isRecord(value) || !isRecord(value.node)) {
    throw new Error("Request body.node must be an object.");
  }

  const status = readOptionalEnum(value.node.status, MANAGED_AGENT_NODE_STATUSES, "node.status");
  const slotAvailable = readOptionalNumber(value.node.slotAvailable);
  const heartbeatTtlSeconds = readOptionalPositiveInteger(value.node.heartbeatTtlSeconds, "node.heartbeatTtlSeconds");

  return {
    ...normalizePlatformOwnerPayload(value),
    node: {
      nodeId: readRequiredString(value.node.nodeId, "node.nodeId"),
      ...(status ? { status } : {}),
      ...(slotAvailable !== undefined ? { slotAvailable } : {}),
      ...(Array.isArray(value.node.labels) ? { labels: readStringArray(value.node.labels) } : {}),
      ...(Array.isArray(value.node.workspaceCapabilities)
        ? { workspaceCapabilities: readStringArray(value.node.workspaceCapabilities) }
        : {}),
      ...(Array.isArray(value.node.credentialCapabilities)
        ? { credentialCapabilities: readStringArray(value.node.credentialCapabilities) }
        : {}),
      ...(Array.isArray(value.node.providerCapabilities)
        ? { providerCapabilities: readStringArray(value.node.providerCapabilities) }
        : {}),
      ...(heartbeatTtlSeconds !== undefined ? { heartbeatTtlSeconds } : {}),
    },
  };
}

function normalizePlatformNodeListPayload(value: unknown): PlatformNodeListPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const organizationId = readOptionalString(value.organizationId);

  return {
    ...normalizePlatformOwnerPayload(value),
    ...(organizationId ? { organizationId } : {}),
  };
}

function normalizePlatformNodeDetailPayload(value: unknown): PlatformNodeDetailPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    nodeId: readRequiredString(value.nodeId, "nodeId"),
  };
}

function normalizePlatformWorkerPullPayload(value: unknown): PlatformWorkerPullPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    nodeId: readRequiredString(value.nodeId, "nodeId"),
  };
}

function normalizePlatformWorkerRunStatusPayload(value: unknown): PlatformWorkerRunStatusPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const status = readOptionalEnum(
    value.status,
    ["starting", "running", "heartbeat", "waiting_human", "waiting_agent", "failed", "cancelled"] as const,
    "status",
  );

  if (!status) {
    throw new Error("status is required.");
  }

  const failureCode = readOptionalString(value.failureCode);
  const failureMessage = readOptionalString(value.failureMessage);
  const waitingAction = normalizePlatformWorkerWaitingAction(value.waitingAction);

  return {
    ...normalizePlatformWorkerPullPayload(value),
    runId: readRequiredString(value.runId, "runId"),
    leaseToken: readRequiredString(value.leaseToken, "leaseToken"),
    status,
    ...(failureCode ? { failureCode } : {}),
    ...(failureMessage ? { failureMessage } : {}),
    ...(waitingAction && Object.keys(waitingAction).length > 0 ? { waitingAction } : {}),
  };
}

function normalizePlatformWorkerRunCompletePayload(value: unknown): PlatformWorkerRunCompletePayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const result = normalizePlatformWorkerCompletionResult(value.result);

  return {
    ...normalizePlatformWorkerPullPayload(value),
    runId: readRequiredString(value.runId, "runId"),
    leaseToken: readRequiredString(value.leaseToken, "leaseToken"),
    ...(result ? { result } : {}),
  };
}

function normalizePlatformWorkerWaitingAction(value: unknown): PlatformWorkerRunStatusPayload["waitingAction"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const actionType = readOptionalString(value.actionType);
  const actionId = readOptionalString(value.actionId);
  const prompt = readOptionalString(value.prompt);
  const message = readOptionalString(value.message);
  const requestId = readOptionalString(value.requestId);
  const taskId = readOptionalString(value.taskId);

  const waitingAction = {
    ...(actionType ? { actionType } : {}),
    ...(actionId ? { actionId } : {}),
    ...(prompt ? { prompt } : {}),
    ...(message ? { message } : {}),
    ...(hasOwn(value, "choices") ? { choices: value.choices } : {}),
    ...(hasOwn(value, "inputSchema") ? { inputSchema: value.inputSchema } : {}),
    ...(requestId ? { requestId } : {}),
    ...(taskId ? { taskId } : {}),
  };

  return Object.keys(waitingAction).length > 0 ? waitingAction : undefined;
}

function normalizePlatformWorkerCompletionResult(value: unknown): PlatformWorkerRunCompletePayload["result"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const completedAt = readOptionalString(value.completedAt);
  return {
    summary: readRequiredString(value.summary, "result.summary"),
    ...(hasOwn(value, "output") ? { output: value.output } : {}),
    ...(Array.isArray(value.touchedFiles) ? { touchedFiles: readStringArray(value.touchedFiles) } : {}),
    ...(isRecord(value.structuredOutput) || value.structuredOutput === null
      ? { structuredOutput: value.structuredOutput as Record<string, unknown> | null }
      : {}),
    ...(completedAt ? { completedAt } : {}),
  };
}

function readRequiredString(value: unknown, fieldName: string): string {
  const normalized = readOptionalString(value);

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.floor(value);
}

function readOptionalEnum<T extends readonly string[]>(
  value: unknown,
  candidates: T,
  fieldName: string,
): T[number] | undefined {
  const normalized = readOptionalString(value);

  if (!normalized) {
    return undefined;
  }

  if (!candidates.includes(normalized)) {
    throw new Error(`${fieldName} is invalid.`);
  }

  return normalized as T[number];
}

function readOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} is invalid.`);
  }

  return value;
}

function readRequiredPositiveInteger(value: unknown, fieldName: string): number {
  const normalized = readOptionalPositiveInteger(value, fieldName);

  if (normalized === undefined) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function readStringArray(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function handlePlatformNodeGovernanceAction(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
  action: "draining" | "offline",
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformNodeDetailPayload);
  if (!payload) {
    return;
  }

  try {
    const result = action === "draining"
      ? facade.markNodeDraining({
        ownerPrincipalId: payload.ownerPrincipalId,
        nodeId: payload.nodeId,
      })
      : facade.markNodeOffline({
        ownerPrincipalId: payload.ownerPrincipalId,
        nodeId: payload.nodeId,
      });

    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      node: result.node,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}
