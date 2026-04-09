import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { resolve } from "node:path";
import { IdentityLinkService, type ChannelIdentityInput, type IdentityStatusSnapshot } from "../core/identity-link-service.js";
import { ScheduledTasksService } from "../core/scheduled-tasks-service.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import {
  APPROVAL_POLICIES,
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

export class ThemisMcpServer {
  private readonly registry: SqliteCodexSessionRegistry;
  private readonly identityLinkService: IdentityLinkService;
  private readonly scheduledTasksService: ScheduledTasksService;
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
        title: "Themis Scheduled Tasks",
        version: MCP_SERVER_VERSION,
      },
      instructions: [
        "This MCP server manages Themis scheduled tasks.",
        "Use explicit scheduledAt timestamps and a concrete timezone.",
        "This first cut only supports one-time tasks.",
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

  private ensureIdentity(): IdentityStatusSnapshot {
    return this.identityLinkService.ensureIdentity(this.identityInput);
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

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
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

function isValidJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === "string" || typeof value === "number";
}
