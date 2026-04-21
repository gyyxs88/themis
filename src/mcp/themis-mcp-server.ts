import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { resolve } from "node:path";
import {
  ManagedAgentCoordinationService,
  type DispatchWorkItemInput,
} from "../core/managed-agent-coordination-service.js";
import {
  type ManagedAgentControlPlaneFacadeLike,
  ManagedAgentControlPlaneFacade,
} from "../core/managed-agent-control-plane-facade.js";
import { createManagedAgentControlPlaneStoreFromEnv } from "../core/managed-agent-control-plane-bootstrap.js";
import { ManagedAgentNodeService } from "../core/managed-agent-node-service.js";
import {
  createManagedAgentPlatformGatewayFacade,
} from "../core/managed-agent-platform-gateway-facade.js";
import {
  ManagedAgentsService,
  type CreateManagedAgentInput,
  type ManagedAgentDetailView,
  type ManagedAgentExecutionBoundaryRuntimeProfileInput,
  type ManagedAgentExecutionBoundaryView,
  type ManagedAgentExecutionBoundaryWorkspacePolicyInput,
} from "../core/managed-agents-service.js";
import {
  readManagedAgentPlatformGatewayConfig,
} from "../core/managed-agent-platform-gateway-client.js";
import { ManagedAgentSchedulerService } from "../core/managed-agent-scheduler-service.js";
import { ManagedAgentWorkerService } from "../core/managed-agent-worker-service.js";
import { IdentityLinkService, type ChannelIdentityInput, type IdentityStatusSnapshot } from "../core/identity-link-service.js";
import { ScheduledTasksService } from "../core/scheduled-tasks-service.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import {
  APPROVAL_POLICIES,
  type ManagedAgentCardInput,
  MANAGED_AGENT_AUTONOMY_LEVELS,
  MANAGED_AGENT_CREATION_MODES,
  MANAGED_AGENT_EXPOSURE_POLICIES,
  MANAGED_AGENT_PRIORITIES,
  MANAGED_AGENT_STATUSES,
  MANAGED_AGENT_WORK_ITEM_SOURCE_TYPES,
  MEMORY_MODES,
  REASONING_LEVELS,
  SANDBOX_MODES,
  SCHEDULED_TASK_AUTOMATION_FAILURE_MODES,
  SCHEDULED_TASK_AUTOMATION_OUTPUT_MODES,
  SCHEDULED_TASK_STATUSES,
  TASK_ACCESS_MODES,
  WEB_SEARCH_MODES,
  type ScheduledTaskAutomationOptions,
  type ScheduledTaskRuntimeOptions,
  type StoredScheduledTaskRecord,
} from "../types/index.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_SERVER_VERSION = "0.1.0";
const JSON_RPC_VERSION = "2.0";
const DEFAULT_CHANNEL = "cli";
const DEFAULT_CHANNEL_USER_ID = "codex";
const DEFAULT_DISPLAY_NAME = "Codex";
const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_PARAMS = -32602;
const JSON_RPC_INTERNAL_ERROR = -32603;
const JSON_RPC_SERVER_NOT_INITIALIZED = -32002;
const MAX_LIST_LIMIT = 100;

type JsonRpcId = string | number | null;

interface JsonRpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcErrorShape;
}

interface JsonRpcRequestEnvelope {
  jsonrpc: string;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
}

interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ThemisMcpServerOptions {
  workingDirectory?: string;
  registry?: SqliteCodexSessionRegistry;
  identity?: ChannelIdentityInput;
  sessionId?: string;
  channelSessionKey?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  managedAgentControlPlaneFacade?: ManagedAgentControlPlaneFacadeLike;
}

export interface ThemisMcpServerRunOptions extends ThemisMcpServerOptions {
  input?: Readable;
  output?: Writable;
  errorOutput?: Writable;
}

interface CreateScheduledTaskToolArgs {
  goal: string;
  scheduledAt: string;
  timezone: string;
  inputText?: string;
  sessionId?: string;
  channelSessionKey?: string;
  options?: ScheduledTaskRuntimeOptions;
  automation?: ScheduledTaskAutomationOptions;
}

interface ListScheduledTasksToolArgs {
  statuses?: string[];
  limit?: number;
}

interface CancelScheduledTaskToolArgs {
  scheduledTaskId: string;
}

interface ListManagedAgentsToolArgs {
  organizationId?: string;
  statuses?: string[];
  limit?: number;
}

interface GetManagedAgentDetailToolArgs {
  agentId: string;
}

interface CreateManagedAgentToolArgs {
  departmentRole: string;
  displayName?: string;
  mission?: string;
  organizationId?: string;
  supervisorAgentId?: string;
  autonomyLevel?: CreateManagedAgentInput["autonomyLevel"];
  creationMode?: CreateManagedAgentInput["creationMode"];
  exposurePolicy?: CreateManagedAgentInput["exposurePolicy"];
}

interface UpdateManagedAgentCardToolArgs {
  agentId: string;
  card: ManagedAgentCardInput;
}

interface UpdateManagedAgentExecutionBoundaryToolArgs {
  agentId: string;
  workspacePolicy?: ManagedAgentExecutionBoundaryWorkspacePolicyInput;
  runtimeProfile?: ManagedAgentExecutionBoundaryRuntimeProfileInput;
}

interface DispatchWorkItemToolArgs {
  targetAgentId: string;
  projectId?: string;
  sourceType?: DispatchWorkItemInput["sourceType"];
  sourceAgentId?: string;
  parentWorkItemId?: string;
  dispatchReason: string;
  goal: string;
  contextPacket?: unknown;
  priority?: DispatchWorkItemInput["priority"];
  workspacePolicySnapshot?: Record<string, unknown>;
  runtimeProfileSnapshot?: Record<string, unknown>;
  scheduledAt?: string;
}

interface UpdateManagedAgentLifecycleToolArgs {
  agentId: string;
  action: "pause" | "resume" | "archive";
}

export class ThemisMcpServer {
  private readonly registry: SqliteCodexSessionRegistry;
  private readonly identityLinkService: IdentityLinkService;
  private readonly scheduledTasksService: ScheduledTasksService;
  private readonly managedAgentControlPlaneFacade: ManagedAgentControlPlaneFacadeLike;
  private readonly managedAgentOwnerPrincipalId: string | null;
  private readonly identityInput: ChannelIdentityInput;
  private readonly defaultSessionId: string | undefined;
  private readonly defaultChannelSessionKey: string | undefined;
  private readonly tools: McpToolDefinition[];
  private initialized = false;
  private initializeResponded = false;

  constructor(options: ThemisMcpServerOptions = {}) {
    const workingDirectory = options.workingDirectory ?? process.cwd();

    this.registry = options.registry ?? new SqliteCodexSessionRegistry({
      databaseFile: resolve(workingDirectory, "infra/local/themis.db"),
    });
    this.identityLinkService = new IdentityLinkService(this.registry);
    this.scheduledTasksService = new ScheduledTasksService({
      registry: this.registry,
    });
    const managedAgentControlPlane = resolveManagedAgentControlPlane({
      workingDirectory,
      registry: this.registry,
      ...(options.env ? { env: options.env } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.managedAgentControlPlaneFacade
        ? { managedAgentControlPlaneFacade: options.managedAgentControlPlaneFacade }
        : {}),
    });
    this.managedAgentControlPlaneFacade = managedAgentControlPlane.facade;
    this.managedAgentOwnerPrincipalId = managedAgentControlPlane.ownerPrincipalId;
    const displayName = normalizeText(options.identity?.displayName) ?? DEFAULT_DISPLAY_NAME;
    this.identityInput = {
      channel: normalizeText(options.identity?.channel) ?? DEFAULT_CHANNEL,
      channelUserId: normalizeText(options.identity?.channelUserId) ?? DEFAULT_CHANNEL_USER_ID,
      displayName,
    };
    this.defaultSessionId = normalizeText(options.sessionId);
    this.defaultChannelSessionKey = normalizeText(options.channelSessionKey);
    this.tools = buildToolDefinitions();
  }

  async handleMessage(rawMessage: string): Promise<string | null> {
    const parsed = parseJsonRpcMessage(rawMessage);

    if ("parseError" in parsed) {
      return JSON.stringify(createErrorResponse(null, parsed.parseError.code, parsed.parseError.message));
    }

    const response = await this.handleRequest(parsed.request);
    return response ? JSON.stringify(response) : null;
  }

  private async handleRequest(request: JsonRpcRequestEnvelope): Promise<JsonRpcResponse | null> {
    const method = typeof request.method === "string" ? request.method.trim() : "";
    const hasId = Object.prototype.hasOwnProperty.call(request, "id");
    const responseId = isValidJsonRpcId(request.id) ? request.id : null;

    if (request.jsonrpc !== JSON_RPC_VERSION || !method) {
      return hasId
        ? createErrorResponse(responseId, JSON_RPC_INVALID_REQUEST, "Invalid JSON-RPC request.")
        : null;
    }

    if (!hasId) {
      return this.handleNotification(method, request.params);
    }

    try {
      switch (method) {
        case "initialize":
          return createResultResponse(responseId, this.handleInitialize(request.params));
        case "ping":
          return createResultResponse(responseId, {});
        case "tools/list":
          this.requireInitialized(method);
          return createResultResponse(responseId, {
            tools: this.tools,
          });
        case "tools/call":
          this.requireInitialized(method);
          return createResultResponse(responseId, await this.handleToolCall(request.params));
        default:
          return createErrorResponse(responseId, JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
    } catch (error) {
      if (error instanceof JsonRpcProtocolError) {
        return createErrorResponse(responseId, error.code, error.message, error.data);
      }

      const message = error instanceof Error ? error.message : String(error);
      return createErrorResponse(responseId, JSON_RPC_INTERNAL_ERROR, message);
    }
  }

  private handleNotification(method: string, params: unknown): null {
    if (method === "notifications/initialized") {
      this.initialized = true;
      return null;
    }

    if (method === "notifications/cancelled") {
      return null;
    }

    if (method === "initialized") {
      this.initialized = true;
      return null;
    }

    void params;
    return null;
  }

  private handleInitialize(_params: unknown): Record<string, unknown> {
    this.initializeResponded = true;
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "themis",
        title: "Themis Coordination Tools",
        version: MCP_SERVER_VERSION,
      },
      instructions: [
        "This MCP server manages Themis scheduled tasks and managed agents.",
        "Use explicit scheduledAt timestamps and a concrete timezone for scheduled tasks.",
        "Use managed agent tools to create and govern digital employees, update employee dossiers, update execution boundaries, and dispatch work.",
      ].join(" "),
    };
  }

  private requireInitialized(method: string): void {
    if (!this.initializeResponded || !this.initialized) {
      throw new JsonRpcProtocolError(
        JSON_RPC_SERVER_NOT_INITIALIZED,
        `Server has not completed initialization. Cannot call ${method} yet.`,
      );
    }
  }

  private async handleToolCall(params: unknown): Promise<Record<string, unknown>> {
    const payload = expectRecord(params, "tools/call params must be an object.");
    const name = expectRequiredText(payload.name, "Tool name is required.");
    const argumentsValue = payload.arguments;
    const argumentsRecord = argumentsValue === undefined
      ? {}
      : expectRecord(argumentsValue, "Tool arguments must be an object.");

    switch (name) {
      case "create_scheduled_task":
        return this.runToolSafely(() => this.createScheduledTask(argumentsRecord));
      case "list_scheduled_tasks":
        return this.runToolSafely(() => this.listScheduledTasks(argumentsRecord));
      case "cancel_scheduled_task":
        return this.runToolSafely(() => this.cancelScheduledTask(argumentsRecord));
      case "list_managed_agents":
        return this.runToolSafely(() => this.listManagedAgents(argumentsRecord));
      case "get_managed_agent_detail":
        return this.runToolSafely(() => this.getManagedAgentDetail(argumentsRecord));
      case "create_managed_agent":
        return this.runToolSafely(() => this.createManagedAgent(argumentsRecord));
      case "update_managed_agent_card":
        return this.runToolSafely(() => this.updateManagedAgentCard(argumentsRecord));
      case "update_managed_agent_execution_boundary":
        return this.runToolSafely(() => this.updateManagedAgentExecutionBoundary(argumentsRecord));
      case "dispatch_work_item":
        return this.runToolSafely(() => this.dispatchWorkItem(argumentsRecord));
      case "update_managed_agent_lifecycle":
        return this.runToolSafely(() => this.updateManagedAgentLifecycle(argumentsRecord));
      default:
        throw new JsonRpcProtocolError(JSON_RPC_INVALID_PARAMS, `Unknown tool: ${name}`);
    }
  }

  private async runToolSafely(
    callback: () => Promise<Record<string, unknown>> | Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    try {
      return await callback();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  }

  private createScheduledTask(argumentsRecord: Record<string, unknown>): Record<string, unknown> {
    const args = normalizeCreateScheduledTaskToolArgs(argumentsRecord);
    const identity = this.ensureIdentity();
    const sessionId = args.sessionId ?? this.defaultSessionId;
    const channelSessionKey = args.channelSessionKey ?? this.defaultChannelSessionKey;
    const task = this.scheduledTasksService.createTask({
      principalId: identity.principalId,
      sourceChannel: this.identityInput.channel,
      channelUserId: this.identityInput.channelUserId,
      ...(this.identityInput.displayName ? { displayName: this.identityInput.displayName } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(channelSessionKey ? { channelSessionKey } : {}),
      goal: args.goal,
      ...(args.inputText ? { inputText: args.inputText } : {}),
      ...(args.options ? { options: args.options } : {}),
      ...(args.automation ? { automation: args.automation } : {}),
      timezone: args.timezone,
      scheduledAt: args.scheduledAt,
    });

    const structuredContent = {
      identity,
      task,
    };

    return createToolResult(
      `已创建定时任务 ${task.scheduledTaskId}，将在 ${task.scheduledAt} (${task.timezone}) 执行。`,
      structuredContent,
    );
  }

  private listScheduledTasks(argumentsRecord: Record<string, unknown>): Record<string, unknown> {
    const args = normalizeListScheduledTasksToolArgs(argumentsRecord);
    const identity = this.ensureIdentity();
    let tasks = this.scheduledTasksService.listTasks(identity.principalId);

    if (args.statuses) {
      const wanted = new Set(args.statuses);
      tasks = tasks.filter((task) => wanted.has(task.status));
    }

    if (typeof args.limit === "number") {
      tasks = tasks.slice(0, args.limit);
    }

    const structuredContent = {
      identity,
      tasks,
    };

    return createToolResult(buildListSummary(tasks), structuredContent);
  }

  private cancelScheduledTask(argumentsRecord: Record<string, unknown>): Record<string, unknown> {
    const args = normalizeCancelScheduledTaskToolArgs(argumentsRecord);
    const identity = this.ensureIdentity();
    const task = this.scheduledTasksService.cancelTask({
      ownerPrincipalId: identity.principalId,
      scheduledTaskId: args.scheduledTaskId,
    });
    const structuredContent = {
      identity,
      task,
    };

    return createToolResult(
      `已取消定时任务 ${task.scheduledTaskId}。`,
      structuredContent,
    );
  }

  private async listManagedAgents(argumentsRecord: Record<string, unknown>): Promise<Record<string, unknown>> {
    const args = normalizeListManagedAgentsToolArgs(argumentsRecord);
    const identity = this.ensureIdentity();
    const ownerPrincipalId = this.resolveManagedAgentOwnerPrincipalId(identity);
    const result = await this.managedAgentControlPlaneFacade.listManagedAgents(ownerPrincipalId);
    let organizations = result.organizations;
    let agents = result.agents;

    if (args.organizationId) {
      organizations = organizations.filter((organization) => organization.organizationId === args.organizationId);
      agents = agents.filter((agent) => agent.organizationId === args.organizationId);
    }

    if (args.statuses) {
      const wantedStatuses = new Set(args.statuses);
      agents = agents.filter((agent) => wantedStatuses.has(agent.status));
    }

    if (typeof args.limit === "number") {
      agents = agents.slice(0, args.limit);
    }

    return createToolResult(
      buildManagedAgentListSummary(agents),
      {
        identity,
        ownerPrincipalId,
        organizations,
        agents,
      },
    );
  }

  private async getManagedAgentDetail(argumentsRecord: Record<string, unknown>): Promise<Record<string, unknown>> {
    const args = normalizeGetManagedAgentDetailToolArgs(argumentsRecord);
    const identity = this.ensureIdentity();
    const ownerPrincipalId = this.resolveManagedAgentOwnerPrincipalId(identity);
    const detail = await this.managedAgentControlPlaneFacade.getManagedAgentDetailView(ownerPrincipalId, args.agentId);

    if (!detail) {
      throw new Error("Managed agent does not exist.");
    }

    return createToolResult(
      buildManagedAgentDetailSummary(detail),
      {
        identity,
        ownerPrincipalId,
        organization: detail.organization,
        principal: detail.principal,
        agent: detail.agent,
        workspacePolicy: detail.workspacePolicy,
        runtimeProfile: detail.runtimeProfile,
        authAccounts: detail.authAccounts,
        thirdPartyProviders: detail.thirdPartyProviders,
      },
    );
  }

  private async createManagedAgent(argumentsRecord: Record<string, unknown>): Promise<Record<string, unknown>> {
    const args = normalizeCreateManagedAgentToolArgs(argumentsRecord);
    const identity = this.ensureIdentity();
    const ownerPrincipalId = this.resolveManagedAgentOwnerPrincipalId(identity);
    const result = await this.managedAgentControlPlaneFacade.createManagedAgent({
      ownerPrincipalId,
      departmentRole: args.departmentRole,
      ...(args.displayName ? { displayName: args.displayName } : {}),
      ...(args.mission ? { mission: args.mission } : {}),
      ...(args.organizationId ? { organizationId: args.organizationId } : {}),
      ...(args.supervisorAgentId ? { supervisorAgentId: args.supervisorAgentId } : {}),
      ...(args.autonomyLevel ? { autonomyLevel: args.autonomyLevel } : {}),
      ...(args.creationMode ? { creationMode: args.creationMode } : {}),
      ...(args.exposurePolicy ? { exposurePolicy: args.exposurePolicy } : {}),
    });

    return createToolResult(
      `已创建员工 ${result.agent.displayName}（${result.agent.agentId}），当前状态 ${result.agent.status}。`,
      {
        identity,
        ownerPrincipalId,
        organization: result.organization,
        principal: result.principal,
        agent: result.agent,
      },
    );
  }

  private async updateManagedAgentCard(argumentsRecord: Record<string, unknown>): Promise<Record<string, unknown>> {
    const args = normalizeUpdateManagedAgentCardToolArgs(argumentsRecord);
    const identity = this.ensureIdentity();
    const ownerPrincipalId = this.resolveManagedAgentOwnerPrincipalId(identity);
    const detail = await this.managedAgentControlPlaneFacade.updateManagedAgentCard({
      ownerPrincipalId,
      agentId: args.agentId,
      card: args.card,
    });

    return createToolResult(
      buildManagedAgentDetailSummary(detail),
      {
        identity,
        ownerPrincipalId,
        organization: detail.organization,
        principal: detail.principal,
        agent: detail.agent,
        workspacePolicy: detail.workspacePolicy,
        runtimeProfile: detail.runtimeProfile,
        authAccounts: detail.authAccounts,
        thirdPartyProviders: detail.thirdPartyProviders,
      },
    );
  }

  private async updateManagedAgentExecutionBoundary(
    argumentsRecord: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const args = normalizeUpdateManagedAgentExecutionBoundaryToolArgs(argumentsRecord);
    const identity = this.ensureIdentity();
    const ownerPrincipalId = this.resolveManagedAgentOwnerPrincipalId(identity);
    const result = await this.managedAgentControlPlaneFacade.updateManagedAgentExecutionBoundary({
      ownerPrincipalId,
      agentId: args.agentId,
      ...(args.workspacePolicy ? { workspacePolicy: args.workspacePolicy } : {}),
      ...(args.runtimeProfile ? { runtimeProfile: args.runtimeProfile } : {}),
    });

    return createToolResult(
      buildManagedAgentExecutionBoundarySummary(result),
      {
        identity,
        ownerPrincipalId,
        agent: result.agent,
        workspacePolicy: result.workspacePolicy,
        runtimeProfile: result.runtimeProfile,
      },
    );
  }

  private async dispatchWorkItem(argumentsRecord: Record<string, unknown>): Promise<Record<string, unknown>> {
    const args = normalizeDispatchWorkItemToolArgs(argumentsRecord);
    const identity = this.ensureIdentity();
    const ownerPrincipalId = this.resolveManagedAgentOwnerPrincipalId(identity);
    const result = await this.managedAgentControlPlaneFacade.dispatchWorkItem({
      ownerPrincipalId,
      targetAgentId: args.targetAgentId,
      ...(args.projectId ? { projectId: args.projectId } : {}),
      ...(args.sourceType ? { sourceType: args.sourceType } : {}),
      ...(args.sourceAgentId ? { sourceAgentId: args.sourceAgentId } : {}),
      ...(args.parentWorkItemId ? { parentWorkItemId: args.parentWorkItemId } : {}),
      dispatchReason: args.dispatchReason,
      goal: args.goal,
      ...(hasOwn(args, "contextPacket") ? { contextPacket: args.contextPacket } : {}),
      ...(args.priority ? { priority: args.priority } : {}),
      ...(hasOwn(args, "workspacePolicySnapshot") ? { workspacePolicySnapshot: args.workspacePolicySnapshot } : {}),
      ...(hasOwn(args, "runtimeProfileSnapshot") ? { runtimeProfileSnapshot: args.runtimeProfileSnapshot } : {}),
      ...(args.scheduledAt ? { scheduledAt: args.scheduledAt } : {}),
    });
    const targetAgent = await this.resolveDispatchTargetAgent(ownerPrincipalId, args.targetAgentId, result.targetAgent);

    return createToolResult(
      `已向员工 ${targetAgent?.displayName ?? args.targetAgentId}（${targetAgent?.agentId ?? args.targetAgentId}）派发工作项 ${result.workItem.workItemId}。`,
      {
        identity,
        ownerPrincipalId,
        organization: result.organization,
        ...(targetAgent ? { targetAgent } : {}),
        workItem: result.workItem,
        ...(result.dispatchMessage ? { dispatchMessage: result.dispatchMessage } : {}),
        ...(result.mailboxEntry ? { mailboxEntry: result.mailboxEntry } : {}),
      },
    );
  }

  private async updateManagedAgentLifecycle(argumentsRecord: Record<string, unknown>): Promise<Record<string, unknown>> {
    const args = normalizeUpdateManagedAgentLifecycleToolArgs(argumentsRecord);
    const identity = this.ensureIdentity();
    const ownerPrincipalId = this.resolveManagedAgentOwnerPrincipalId(identity);
    const ownerView = await this.managedAgentControlPlaneFacade.updateManagedAgentLifecycle({
      ownerPrincipalId,
      agentId: args.agentId,
      action: args.action,
    });

    if (!ownerView) {
      throw new Error("Managed agent does not exist.");
    }

    return createToolResult(
      `已将员工 ${ownerView.agent.displayName}（${ownerView.agent.agentId}）切换为 ${ownerView.agent.status}。`,
      {
        identity,
        ownerPrincipalId,
        organization: ownerView.organization,
        principal: ownerView.principal,
        agent: ownerView.agent,
      },
    );
  }

  private ensureIdentity(): IdentityStatusSnapshot {
    return this.identityLinkService.ensureIdentity(this.identityInput);
  }

  private resolveManagedAgentOwnerPrincipalId(identity: IdentityStatusSnapshot): string {
    return this.managedAgentOwnerPrincipalId ?? identity.principalId;
  }

  private async resolveDispatchTargetAgent(
    ownerPrincipalId: string,
    targetAgentId: string,
    targetAgent?: ManagedAgentDetailView["agent"],
  ): Promise<ManagedAgentDetailView["agent"] | null> {
    if (targetAgent) {
      return targetAgent;
    }

    const detail = await this.managedAgentControlPlaneFacade.getManagedAgentDetailView(ownerPrincipalId, targetAgentId);
    return detail?.agent ?? null;
  }
}

export async function runThemisMcpServer(options: ThemisMcpServerRunOptions = {}): Promise<void> {
  const server = new ThemisMcpServer(options);
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  const reader = createInterface({
    input,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of reader) {
      const message = line.trim();

      if (!message) {
        continue;
      }

      const response = await server.handleMessage(message);

      if (response) {
        output.write(`${response}\n`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorOutput.write(`Themis MCP server failed: ${message}\n`);
    throw error;
  } finally {
    reader.close();
  }
}

class JsonRpcProtocolError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "JsonRpcProtocolError";
    this.code = code;
    this.data = data;
  }
}

function parseJsonRpcMessage(rawMessage: string):
  | { request: JsonRpcRequestEnvelope }
  | { parseError: JsonRpcProtocolError } {
  try {
    const parsed = JSON.parse(rawMessage);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        parseError: new JsonRpcProtocolError(JSON_RPC_INVALID_REQUEST, "JSON-RPC message must be an object."),
      };
    }

    return {
      request: parsed as JsonRpcRequestEnvelope,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      parseError: new JsonRpcProtocolError(JSON_RPC_PARSE_ERROR, `Failed to parse JSON-RPC message: ${message}`),
    };
  }
}

function buildToolDefinitions(): McpToolDefinition[] {
  return [
    {
      name: "create_scheduled_task",
      title: "Create Scheduled Task",
      description: "创建一条 Themis 单次定时任务。scheduledAt 必须是明确时间，timezone 必须是具体时区。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          goal: {
            type: "string",
            description: "到点后要执行的任务目标。",
          },
          scheduledAt: {
            type: "string",
            description: "执行时间，建议传 ISO-8601 时间字符串。",
          },
          timezone: {
            type: "string",
            description: "时区，例如 Asia/Shanghai 或 +08:00。",
          },
          inputText: {
            type: "string",
            description: "补充给执行任务的输入文本。",
          },
          sessionId: {
            type: "string",
            description: "可选。希望复用的会话 id。",
          },
          channelSessionKey: {
            type: "string",
            description: "可选。希望复用的渠道会话 key。",
          },
          options: buildRuntimeOptionsSchema(),
          automation: buildAutomationOptionsSchema(),
        },
        required: ["goal", "scheduledAt", "timezone"],
      },
    },
    {
      name: "list_scheduled_tasks",
      title: "List Scheduled Tasks",
      description: "列出当前 identity 下的 Themis 定时任务，可按状态过滤。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          statuses: {
            type: "array",
            description: "可选。只返回这些状态的任务。",
            items: {
              type: "string",
              enum: [...SCHEDULED_TASK_STATUSES],
            },
          },
          limit: {
            type: "integer",
            description: "可选。限制返回条数，1 到 100。",
            minimum: 1,
            maximum: MAX_LIST_LIMIT,
          },
        },
      },
    },
    {
      name: "cancel_scheduled_task",
      title: "Cancel Scheduled Task",
      description: "取消一条尚未开始执行的 Themis 定时任务。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          scheduledTaskId: {
            type: "string",
            description: "要取消的定时任务 id。",
          },
        },
        required: ["scheduledTaskId"],
      },
    },
    {
      name: "list_managed_agents",
      title: "List Managed Agents",
      description: "列出当前 Themis 员工队伍，可按组织、状态和数量过滤。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          organizationId: {
            type: "string",
            description: "可选。只返回指定组织下的员工。",
          },
          statuses: {
            type: "array",
            description: "可选。只返回这些状态的员工。",
            items: {
              type: "string",
              enum: [...MANAGED_AGENT_STATUSES],
            },
          },
          limit: {
            type: "integer",
            description: "可选。限制返回条数，1 到 100。",
            minimum: 1,
            maximum: MAX_LIST_LIMIT,
          },
        },
      },
    },
    {
      name: "get_managed_agent_detail",
      title: "Get Managed Agent Detail",
      description: "读取指定员工的详细信息，包括当前执行边界。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          agentId: {
            type: "string",
            description: "要查询的员工 id。",
          },
        },
        required: ["agentId"],
      },
    },
    {
      name: "create_managed_agent",
      title: "Create Managed Agent",
      description: "创建一名新的 Themis 员工。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          departmentRole: {
            type: "string",
            description: "岗位或职责，例如 后端、前端、运维、交付经理。",
          },
          displayName: {
            type: "string",
            description: "可选。员工显示名。",
          },
          mission: {
            type: "string",
            description: "可选。员工使命描述。",
          },
          organizationId: {
            type: "string",
            description: "可选。所属组织 id。",
          },
          supervisorAgentId: {
            type: "string",
            description: "可选。直属 supervisor 员工 id。",
          },
          autonomyLevel: {
            type: "string",
            enum: [...MANAGED_AGENT_AUTONOMY_LEVELS],
          },
          creationMode: {
            type: "string",
            enum: [...MANAGED_AGENT_CREATION_MODES],
          },
          exposurePolicy: {
            type: "string",
            enum: [...MANAGED_AGENT_EXPOSURE_POLICIES],
          },
        },
        required: ["departmentRole"],
      },
    },
    {
      name: "update_managed_agent_card",
      title: "Update Managed Agent Card",
      description: "更新员工档案，包括编号、能力标签、职责范围、协作偏好和评审摘要。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          agentId: {
            type: "string",
            description: "要更新的员工 id。",
          },
          card: buildManagedAgentCardInputSchema(),
        },
        required: ["agentId", "card"],
      },
    },
    {
      name: "update_managed_agent_execution_boundary",
      title: "Update Managed Agent Execution Boundary",
      description: "更新员工的工作区和运行时边界。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          agentId: {
            type: "string",
            description: "要更新的员工 id。",
          },
          workspacePolicy: buildManagedAgentWorkspacePolicySchema(),
          runtimeProfile: buildManagedAgentRuntimeProfileSchema(),
        },
        required: ["agentId"],
      },
    },
    {
      name: "dispatch_work_item",
      title: "Dispatch Work Item",
      description: "给指定员工派发一条新工作项。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          targetAgentId: {
            type: "string",
            description: "目标员工 id。",
          },
          projectId: {
            type: "string",
            description: "可选。关联项目 id。",
          },
          sourceType: {
            type: "string",
            enum: [...MANAGED_AGENT_WORK_ITEM_SOURCE_TYPES],
          },
          sourceAgentId: {
            type: "string",
            description: "可选。当 sourceType=agent 时，填写来源员工 id。",
          },
          parentWorkItemId: {
            type: "string",
            description: "可选。父工作项 id。",
          },
          dispatchReason: {
            type: "string",
            description: "派工原因或一句话标题。",
          },
          goal: {
            type: "string",
            description: "这次派工的具体目标。",
          },
          contextPacket: {
            type: "object",
            description: "可选。补充上下文对象。",
          },
          priority: {
            type: "string",
            enum: [...MANAGED_AGENT_PRIORITIES],
          },
          workspacePolicySnapshot: {
            type: "object",
            description: "可选。覆盖默认工作区快照。",
          },
          runtimeProfileSnapshot: {
            type: "object",
            description: "可选。覆盖默认运行时快照。",
          },
          scheduledAt: {
            type: "string",
            description: "可选。指定计划开始时间。",
          },
        },
        required: ["targetAgentId", "dispatchReason", "goal"],
      },
    },
    {
      name: "update_managed_agent_lifecycle",
      title: "Update Managed Agent Lifecycle",
      description: "暂停、恢复或归档员工。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          agentId: {
            type: "string",
            description: "要更新的员工 id。",
          },
          action: {
            type: "string",
            enum: ["pause", "resume", "archive"],
          },
        },
        required: ["agentId", "action"],
      },
    },
  ];
}

function buildRuntimeOptionsSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      profile: { type: "string" },
      languageStyle: { type: "string" },
      assistantMbti: { type: "string" },
      styleNotes: { type: "string" },
      assistantSoul: { type: "string" },
      authAccountId: { type: "string" },
      model: { type: "string" },
      reasoning: {
        type: "string",
        enum: [...REASONING_LEVELS],
      },
      memoryMode: {
        type: "string",
        enum: [...MEMORY_MODES],
      },
      sandboxMode: {
        type: "string",
        enum: [...SANDBOX_MODES],
      },
      webSearchMode: {
        type: "string",
        enum: [...WEB_SEARCH_MODES],
      },
      networkAccessEnabled: {
        type: "boolean",
      },
      approvalPolicy: {
        type: "string",
        enum: [...APPROVAL_POLICIES],
      },
      accessMode: {
        type: "string",
        enum: [...TASK_ACCESS_MODES],
      },
      thirdPartyProviderId: {
        type: "string",
      },
      additionalDirectories: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
  };
}

function buildAutomationOptionsSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      outputMode: {
        type: "string",
        enum: [...SCHEDULED_TASK_AUTOMATION_OUTPUT_MODES],
      },
      jsonSchema: {
        type: "object",
      },
      onInvalidJson: {
        type: "string",
        enum: [...SCHEDULED_TASK_AUTOMATION_FAILURE_MODES],
      },
      onSchemaMismatch: {
        type: "string",
        enum: [...SCHEDULED_TASK_AUTOMATION_FAILURE_MODES],
      },
    },
  };
}

function buildManagedAgentWorkspacePolicySchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      displayName: { type: "string" },
      workspacePath: { type: "string" },
      additionalDirectories: {
        type: "array",
        items: {
          type: "string",
        },
      },
      allowNetworkAccess: {
        type: "boolean",
      },
    },
    required: ["workspacePath"],
  };
}

function buildManagedAgentRuntimeProfileSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      displayName: { type: "string" },
      model: { type: "string" },
      reasoning: {
        type: "string",
        enum: [...REASONING_LEVELS],
      },
      memoryMode: {
        type: "string",
        enum: [...MEMORY_MODES],
      },
      sandboxMode: {
        type: "string",
        enum: [...SANDBOX_MODES],
      },
      webSearchMode: {
        type: "string",
        enum: [...WEB_SEARCH_MODES],
      },
      networkAccessEnabled: {
        type: "boolean",
      },
      approvalPolicy: {
        type: "string",
        enum: [...APPROVAL_POLICIES],
      },
      accessMode: {
        type: "string",
        enum: [...TASK_ACCESS_MODES],
      },
      authAccountId: {
        type: "string",
      },
      thirdPartyProviderId: {
        type: "string",
      },
    },
  };
}

function buildManagedAgentCardInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      employeeCode: { type: "string" },
      title: { type: "string" },
      domainTags: {
        type: "array",
        items: { type: "string" },
      },
      skillTags: {
        type: "array",
        items: { type: "string" },
      },
      responsibilitySummary: { type: "string" },
      allowedScopes: {
        type: "array",
        items: { type: "string" },
      },
      forbiddenScopes: {
        type: "array",
        items: { type: "string" },
      },
      workStyle: { type: "string" },
      collaborationNotes: { type: "string" },
      representativeProjects: {
        type: "array",
        items: { type: "string" },
      },
      currentFocus: { type: "string" },
      reviewSummary: { type: "string" },
      lastReviewedAt: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
    },
  };
}

function normalizeCreateScheduledTaskToolArgs(value: Record<string, unknown>): CreateScheduledTaskToolArgs {
  const options = value.options === undefined
    ? undefined
    : expectRecord(value.options, "options must be an object.") as ScheduledTaskRuntimeOptions;
  const automation = value.automation === undefined
    ? undefined
    : expectRecord(value.automation, "automation must be an object.") as ScheduledTaskAutomationOptions;

  return {
    goal: expectRequiredText(value.goal, "goal is required."),
    scheduledAt: expectRequiredText(value.scheduledAt, "scheduledAt is required."),
    timezone: expectRequiredText(value.timezone, "timezone is required."),
    ...(normalizeOptionalMultilineText(value.inputText) ? { inputText: normalizeOptionalMultilineText(value.inputText) as string } : {}),
    ...(normalizeText(value.sessionId) ? { sessionId: normalizeText(value.sessionId) as string } : {}),
    ...(normalizeText(value.channelSessionKey) ? { channelSessionKey: normalizeText(value.channelSessionKey) as string } : {}),
    ...(options ? { options } : {}),
    ...(automation ? { automation } : {}),
  };
}

function normalizeListScheduledTasksToolArgs(value: Record<string, unknown>): ListScheduledTasksToolArgs {
  let statuses: string[] | undefined;

  if (value.statuses !== undefined) {
    if (!Array.isArray(value.statuses)) {
      throw new JsonRpcProtocolError(JSON_RPC_INVALID_PARAMS, "statuses must be an array.");
    }

    statuses = value.statuses.map((item) => {
      const status = expectRequiredText(item, "statuses items must be non-empty strings.");

      if (!SCHEDULED_TASK_STATUSES.includes(status as StoredScheduledTaskRecord["status"])) {
        throw new JsonRpcProtocolError(JSON_RPC_INVALID_PARAMS, `Unsupported scheduled task status: ${status}`);
      }

      return status;
    });
  }

  let limit: number | undefined;

  if (value.limit !== undefined) {
    if (typeof value.limit !== "number" || !Number.isInteger(value.limit)) {
      throw new JsonRpcProtocolError(JSON_RPC_INVALID_PARAMS, "limit must be an integer.");
    }

    if (value.limit < 1 || value.limit > MAX_LIST_LIMIT) {
      throw new JsonRpcProtocolError(JSON_RPC_INVALID_PARAMS, `limit must be between 1 and ${MAX_LIST_LIMIT}.`);
    }

    limit = value.limit;
  }

  return {
    ...(statuses ? { statuses } : {}),
    ...(typeof limit === "number" ? { limit } : {}),
  };
}

function normalizeCancelScheduledTaskToolArgs(value: Record<string, unknown>): CancelScheduledTaskToolArgs {
  return {
    scheduledTaskId: expectRequiredText(value.scheduledTaskId, "scheduledTaskId is required."),
  };
}

function normalizeListManagedAgentsToolArgs(value: Record<string, unknown>): ListManagedAgentsToolArgs {
  let statuses: string[] | undefined;

  if (value.statuses !== undefined) {
    if (!Array.isArray(value.statuses)) {
      throw new JsonRpcProtocolError(JSON_RPC_INVALID_PARAMS, "statuses must be an array.");
    }

    statuses = value.statuses.map((item) => expectEnumText(
      item,
      MANAGED_AGENT_STATUSES,
      "statuses items must be managed agent statuses.",
    ));
  }

  const limit = normalizeOptionalListLimit(value.limit);

  return {
    ...(normalizeText(value.organizationId) ? { organizationId: normalizeText(value.organizationId) as string } : {}),
    ...(statuses ? { statuses } : {}),
    ...(typeof limit === "number" ? { limit } : {}),
  };
}

function normalizeGetManagedAgentDetailToolArgs(value: Record<string, unknown>): GetManagedAgentDetailToolArgs {
  return {
    agentId: expectRequiredText(value.agentId, "agentId is required."),
  };
}

function normalizeCreateManagedAgentToolArgs(value: Record<string, unknown>): CreateManagedAgentToolArgs {
  return {
    departmentRole: expectRequiredText(value.departmentRole, "departmentRole is required."),
    ...(normalizeText(value.displayName) ? { displayName: normalizeText(value.displayName) as string } : {}),
    ...(normalizeOptionalMultilineText(value.mission) ? { mission: normalizeOptionalMultilineText(value.mission) as string } : {}),
    ...(normalizeText(value.organizationId) ? { organizationId: normalizeText(value.organizationId) as string } : {}),
    ...(normalizeText(value.supervisorAgentId) ? { supervisorAgentId: normalizeText(value.supervisorAgentId) as string } : {}),
    ...(value.autonomyLevel !== undefined
      ? { autonomyLevel: expectEnumText(value.autonomyLevel, MANAGED_AGENT_AUTONOMY_LEVELS, "Unsupported autonomyLevel.") }
      : {}),
    ...(value.creationMode !== undefined
      ? { creationMode: expectEnumText(value.creationMode, MANAGED_AGENT_CREATION_MODES, "Unsupported creationMode.") }
      : {}),
    ...(value.exposurePolicy !== undefined
      ? { exposurePolicy: expectEnumText(value.exposurePolicy, MANAGED_AGENT_EXPOSURE_POLICIES, "Unsupported exposurePolicy.") }
      : {}),
  };
}

function normalizeUpdateManagedAgentCardToolArgs(
  value: Record<string, unknown>,
): UpdateManagedAgentCardToolArgs {
  return {
    agentId: expectRequiredText(value.agentId, "agentId is required."),
    card: normalizeManagedAgentCardInput(
      expectRecord(value.card, "card must be an object."),
    ),
  };
}

function normalizeUpdateManagedAgentExecutionBoundaryToolArgs(
  value: Record<string, unknown>,
): UpdateManagedAgentExecutionBoundaryToolArgs {
  const workspacePolicy = value.workspacePolicy === undefined
    ? undefined
    : normalizeManagedAgentWorkspacePolicyInput(
      expectRecord(value.workspacePolicy, "workspacePolicy must be an object."),
    );
  const runtimeProfile = value.runtimeProfile === undefined
    ? undefined
    : normalizeManagedAgentRuntimeProfileInput(
      expectRecord(value.runtimeProfile, "runtimeProfile must be an object."),
    );

  if (!workspacePolicy && !runtimeProfile) {
    throw new JsonRpcProtocolError(
      JSON_RPC_INVALID_PARAMS,
      "At least one of workspacePolicy or runtimeProfile is required.",
    );
  }

  return {
    agentId: expectRequiredText(value.agentId, "agentId is required."),
    ...(workspacePolicy ? { workspacePolicy } : {}),
    ...(runtimeProfile ? { runtimeProfile } : {}),
  };
}

function normalizeDispatchWorkItemToolArgs(value: Record<string, unknown>): DispatchWorkItemToolArgs {
  return {
    targetAgentId: expectRequiredText(value.targetAgentId, "targetAgentId is required."),
    ...(normalizeText(value.projectId) ? { projectId: normalizeText(value.projectId) as string } : {}),
    ...(value.sourceType !== undefined
      ? { sourceType: expectEnumText(value.sourceType, MANAGED_AGENT_WORK_ITEM_SOURCE_TYPES, "Unsupported sourceType.") }
      : {}),
    ...(normalizeText(value.sourceAgentId) ? { sourceAgentId: normalizeText(value.sourceAgentId) as string } : {}),
    ...(normalizeText(value.parentWorkItemId) ? { parentWorkItemId: normalizeText(value.parentWorkItemId) as string } : {}),
    dispatchReason: expectRequiredText(value.dispatchReason, "dispatchReason is required."),
    goal: expectRequiredText(value.goal, "goal is required."),
    ...(hasOwn(value, "contextPacket") ? { contextPacket: value.contextPacket } : {}),
    ...(value.priority !== undefined
      ? { priority: expectEnumText(value.priority, MANAGED_AGENT_PRIORITIES, "Unsupported priority.") }
      : {}),
    ...(hasOwn(value, "workspacePolicySnapshot")
      ? { workspacePolicySnapshot: expectRecord(value.workspacePolicySnapshot, "workspacePolicySnapshot must be an object.") }
      : {}),
    ...(hasOwn(value, "runtimeProfileSnapshot")
      ? { runtimeProfileSnapshot: expectRecord(value.runtimeProfileSnapshot, "runtimeProfileSnapshot must be an object.") }
      : {}),
    ...(normalizeText(value.scheduledAt) ? { scheduledAt: normalizeText(value.scheduledAt) as string } : {}),
  };
}

function normalizeUpdateManagedAgentLifecycleToolArgs(
  value: Record<string, unknown>,
): UpdateManagedAgentLifecycleToolArgs {
  return {
    agentId: expectRequiredText(value.agentId, "agentId is required."),
    action: expectEnumText(value.action, ["pause", "resume", "archive"] as const, "Unsupported lifecycle action."),
  };
}

function normalizeManagedAgentWorkspacePolicyInput(
  value: Record<string, unknown>,
): ManagedAgentExecutionBoundaryWorkspacePolicyInput {
  const additionalDirectories = value.additionalDirectories === undefined
    ? undefined
    : normalizeStringArray(value.additionalDirectories, "additionalDirectories must be an array of strings.");

  return {
    workspacePath: expectRequiredText(value.workspacePath, "workspacePolicy.workspacePath is required."),
    ...(normalizeText(value.displayName) ? { displayName: normalizeText(value.displayName) as string } : {}),
    ...(additionalDirectories ? { additionalDirectories } : {}),
    ...(hasOwn(value, "allowNetworkAccess")
      ? { allowNetworkAccess: expectBoolean(value.allowNetworkAccess, "workspacePolicy.allowNetworkAccess must be a boolean.") }
      : {}),
  };
}

function normalizeManagedAgentCardInput(value: Record<string, unknown>): ManagedAgentCardInput {
  const card: ManagedAgentCardInput = {};

  if (hasOwn(value, "employeeCode")) {
    card.employeeCode = expectRequiredText(value.employeeCode, "card.employeeCode is required.");
  }

  if (hasOwn(value, "title")) {
    card.title = expectRequiredText(value.title, "card.title is required.");
  }

  if (hasOwn(value, "domainTags")) {
    card.domainTags = normalizeStringArray(value.domainTags, "card.domainTags must be an array of strings.");
  }

  if (hasOwn(value, "skillTags")) {
    card.skillTags = normalizeStringArray(value.skillTags, "card.skillTags must be an array of strings.");
  }

  if (hasOwn(value, "responsibilitySummary")) {
    card.responsibilitySummary = expectRequiredText(
      value.responsibilitySummary,
      "card.responsibilitySummary is required.",
    );
  }

  if (hasOwn(value, "allowedScopes")) {
    card.allowedScopes = normalizeStringArray(value.allowedScopes, "card.allowedScopes must be an array of strings.");
  }

  if (hasOwn(value, "forbiddenScopes")) {
    card.forbiddenScopes = normalizeStringArray(value.forbiddenScopes, "card.forbiddenScopes must be an array of strings.");
  }

  if (hasOwn(value, "workStyle")) {
    setOptionalRecordField(card, "workStyle", normalizeOptionalMultilineText(value.workStyle) ?? undefined);
  }

  if (hasOwn(value, "collaborationNotes")) {
    setOptionalRecordField(card, "collaborationNotes", normalizeOptionalMultilineText(value.collaborationNotes) ?? undefined);
  }

  if (hasOwn(value, "representativeProjects")) {
    card.representativeProjects = normalizeStringArray(
      value.representativeProjects,
      "card.representativeProjects must be an array of strings.",
    );
  }

  if (hasOwn(value, "currentFocus")) {
    setOptionalRecordField(card, "currentFocus", normalizeOptionalMultilineText(value.currentFocus) ?? undefined);
  }

  if (hasOwn(value, "reviewSummary")) {
    setOptionalRecordField(card, "reviewSummary", normalizeOptionalMultilineText(value.reviewSummary) ?? undefined);
  }

  if (hasOwn(value, "lastReviewedAt")) {
    card.lastReviewedAt = value.lastReviewedAt === null
      ? null
      : expectRequiredText(value.lastReviewedAt, "card.lastReviewedAt must be a string or null.");
  }

  return card;
}

function normalizeManagedAgentRuntimeProfileInput(
  value: Record<string, unknown>,
): ManagedAgentExecutionBoundaryRuntimeProfileInput {
  const result: ManagedAgentExecutionBoundaryRuntimeProfileInput = {
    ...(normalizeText(value.displayName) ? { displayName: normalizeText(value.displayName) as string } : {}),
    ...(normalizeText(value.model) ? { model: normalizeText(value.model) as string } : {}),
    ...(value.reasoning !== undefined
      ? { reasoning: expectEnumText(value.reasoning, REASONING_LEVELS, "Unsupported runtimeProfile.reasoning.") }
      : {}),
    ...(value.memoryMode !== undefined
      ? { memoryMode: expectEnumText(value.memoryMode, MEMORY_MODES, "Unsupported runtimeProfile.memoryMode.") }
      : {}),
    ...(value.sandboxMode !== undefined
      ? { sandboxMode: expectEnumText(value.sandboxMode, SANDBOX_MODES, "Unsupported runtimeProfile.sandboxMode.") }
      : {}),
    ...(value.webSearchMode !== undefined
      ? { webSearchMode: expectEnumText(value.webSearchMode, WEB_SEARCH_MODES, "Unsupported runtimeProfile.webSearchMode.") }
      : {}),
    ...(hasOwn(value, "networkAccessEnabled")
      ? { networkAccessEnabled: expectBoolean(
        value.networkAccessEnabled,
        "runtimeProfile.networkAccessEnabled must be a boolean.",
      ) }
      : {}),
    ...(value.approvalPolicy !== undefined
      ? { approvalPolicy: expectEnumText(
        value.approvalPolicy,
        APPROVAL_POLICIES,
        "Unsupported runtimeProfile.approvalPolicy.",
      ) }
      : {}),
    ...(value.accessMode !== undefined
      ? { accessMode: expectEnumText(value.accessMode, TASK_ACCESS_MODES, "Unsupported runtimeProfile.accessMode.") }
      : {}),
    ...(normalizeText(value.authAccountId) ? { authAccountId: normalizeText(value.authAccountId) as string } : {}),
    ...(normalizeText(value.thirdPartyProviderId)
      ? { thirdPartyProviderId: normalizeText(value.thirdPartyProviderId) as string }
      : {}),
  };

  if (Object.keys(result).length === 0) {
    throw new JsonRpcProtocolError(JSON_RPC_INVALID_PARAMS, "runtimeProfile must not be empty.");
  }

  return result;
}

function createResultResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    result,
  };
}

function createErrorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function createToolResult(summary: string, structuredContent: Record<string, unknown>): Record<string, unknown> {
  return {
    content: [
      {
        type: "text",
        text: summary,
      },
      {
        type: "text",
        text: JSON.stringify(structuredContent),
      },
    ],
    structuredContent,
    isError: false,
  };
}

function buildListSummary(tasks: StoredScheduledTaskRecord[]): string {
  if (tasks.length === 0) {
    return "当前没有匹配的定时任务。";
  }

  return [
    `共找到 ${tasks.length} 条定时任务。`,
    ...tasks.map((task, index) => `${index + 1}. [${task.status}] ${task.scheduledTaskId} @ ${task.scheduledAt} - ${task.goal}`),
  ].join("\n");
}

function buildManagedAgentListSummary(
  agents: Array<{ agentId: string; displayName: string; departmentRole: string; status: string }>,
): string {
  if (agents.length === 0) {
    return "当前没有匹配的员工。";
  }

  return [
    `共找到 ${agents.length} 名员工。`,
    ...agents.map((agent, index) =>
      `${index + 1}. [${agent.status}] ${agent.displayName} (${agent.departmentRole}) - ${agent.agentId}`),
  ].join("\n");
}

function buildManagedAgentDetailSummary(detail: ManagedAgentDetailView): string {
  const workspacePath = detail.workspacePolicy?.workspacePath ?? "<unset>";
  const model = detail.runtimeProfile?.model ?? "<default>";
  const card = detail.agent.agentCard;
  const allowedScopes = Array.isArray(card?.allowedScopes) && card.allowedScopes.length
    ? card.allowedScopes.join("；")
    : "<unset>";
  const currentFocus = normalizeText(card?.currentFocus) ?? "<unset>";

  return [
    `员工 ${detail.agent.displayName}（${detail.agent.agentId}）当前状态 ${detail.agent.status}。`,
    `员工编号：${card?.employeeCode ?? "<unset>"}`,
    `角色：${detail.agent.departmentRole}`,
    `职责摘要：${card?.responsibilitySummary ?? detail.agent.mission}`,
    `允许范围：${allowedScopes}`,
    `当前重点：${currentFocus}`,
    `workspace：${workspacePath}`,
    `model：${model}`,
  ].join("\n");
}

function buildManagedAgentExecutionBoundarySummary(result: ManagedAgentExecutionBoundaryView): string {
  const workspacePath = result.workspacePolicy.workspacePath;
  const model = result.runtimeProfile.model ?? "<default>";

  return [
    `已更新员工 ${result.agent.displayName}（${result.agent.agentId}）的执行边界。`,
    `workspace：${workspacePath}`,
    `model：${model}`,
  ].join("\n");
}

function expectRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new JsonRpcProtocolError(JSON_RPC_INVALID_PARAMS, message);
  }

  return value as Record<string, unknown>;
}

function expectRequiredText(value: unknown, message: string): string {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new JsonRpcProtocolError(JSON_RPC_INVALID_PARAMS, message);
  }

  return normalized;
}

function expectEnumText<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  message: string,
): T[number] {
  const normalized = expectRequiredText(value, message);

  if (!allowed.includes(normalized as T[number])) {
    throw new JsonRpcProtocolError(JSON_RPC_INVALID_PARAMS, message);
  }

  return normalized as T[number];
}

function expectBoolean(value: unknown, message: string): boolean {
  if (typeof value !== "boolean") {
    throw new JsonRpcProtocolError(JSON_RPC_INVALID_PARAMS, message);
  }

  return value;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function setOptionalRecordField(target: object, key: string, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}

function normalizeOptionalMultilineText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

  return normalized ? normalized : undefined;
}

function normalizeOptionalListLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new JsonRpcProtocolError(JSON_RPC_INVALID_PARAMS, "limit must be an integer.");
  }

  if (value < 1 || value > MAX_LIST_LIMIT) {
    throw new JsonRpcProtocolError(JSON_RPC_INVALID_PARAMS, `limit must be between 1 and ${MAX_LIST_LIMIT}.`);
  }

  return value;
}

function normalizeStringArray(value: unknown, message: string): string[] {
  if (!Array.isArray(value)) {
    throw new JsonRpcProtocolError(JSON_RPC_INVALID_PARAMS, message);
  }

  return value.map((item) => expectRequiredText(item, message));
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isValidJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === "string" || typeof value === "number";
}

function resolveManagedAgentControlPlane(options: {
  workingDirectory: string;
  registry: SqliteCodexSessionRegistry;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  managedAgentControlPlaneFacade?: ManagedAgentControlPlaneFacadeLike;
}): {
  facade: ManagedAgentControlPlaneFacadeLike;
  ownerPrincipalId: string | null;
} {
  if (options.managedAgentControlPlaneFacade) {
    return {
      facade: options.managedAgentControlPlaneFacade,
      ownerPrincipalId: null,
    };
  }

  const gatewayConfig = readManagedAgentPlatformGatewayConfig(options.env);

  if (gatewayConfig) {
    return {
      facade: createManagedAgentPlatformGatewayFacade({
        ...gatewayConfig,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      }),
      ownerPrincipalId: gatewayConfig.ownerPrincipalId,
    };
  }

  const controlPlaneStore = createManagedAgentControlPlaneStoreFromEnv({
    workingDirectory: options.workingDirectory,
    runtimeStore: options.registry,
    ...(options.env ? { env: options.env } : {}),
  });
  const coordinationService = new ManagedAgentCoordinationService({
    registry: controlPlaneStore.coordinationStore,
  });
  const schedulerService = new ManagedAgentSchedulerService({
    registry: controlPlaneStore.schedulerStore,
  });
  const nodeService = new ManagedAgentNodeService({
    registry: controlPlaneStore.nodeStore,
  });
  const workerService = new ManagedAgentWorkerService({
    registry: controlPlaneStore.workerStore,
    nodeService,
    schedulerService,
  });
  const managedAgentsService = new ManagedAgentsService({
    registry: controlPlaneStore.managedAgentsStore,
    workingDirectory: options.workingDirectory,
  });

  return {
    facade: new ManagedAgentControlPlaneFacade({
      managedAgentsService,
      coordinationService,
      schedulerService,
      nodeService,
      workerService,
    }),
    ownerPrincipalId: null,
  };
}
