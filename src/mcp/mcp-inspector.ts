import { CodexAppServerSession } from "../core/codex-app-server.js";

export interface McpServerSummary {
  id: string;
  name: string;
  status: string;
  transport?: string;
  command?: string;
  args: string[];
  cwd?: string;
  enabled?: boolean;
  auth?: string;
  error?: string;
  message?: string;
  raw?: Record<string, unknown>;
}

export interface McpInspectorListResult {
  servers: McpServerSummary[];
}

interface McpSession {
  initialize(): Promise<void>;
  request<TResult>(method: string, params: unknown): Promise<TResult>;
  close(): Promise<void>;
}

export interface McpInspectorOptions {
  workingDirectory: string;
  createSession?: () => Promise<McpSession> | McpSession;
}

export class McpInspector {
  private readonly workingDirectory: string;
  private readonly createSession?: McpInspectorOptions["createSession"];

  constructor(options: McpInspectorOptions) {
    this.workingDirectory = options.workingDirectory;
    this.createSession = options.createSession;
  }

  async list(): Promise<McpInspectorListResult> {
    const session = await this.openSession();

    try {
      await session.initialize();
      const response = await session.request<{ data?: unknown }>("mcpServerStatus/list", {});

      return {
        servers: normalizeMcpServerList(response.data),
      };
    } finally {
      await session.close();
    }
  }

  async reload(): Promise<McpInspectorListResult> {
    const session = await this.openSession();

    try {
      await session.initialize();
      await session.request("config/mcpServer/reload", {});
    } finally {
      await session.close();
    }

    return this.list();
  }

  async probe(): Promise<McpInspectorListResult> {
    return this.reload();
  }

  private async openSession(): Promise<McpSession> {
    if (this.createSession) {
      return await this.createSession();
    }

    return new CodexAppServerSession(this.workingDirectory);
  }
}

export function normalizeMcpServerList(data: unknown): McpServerSummary[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((item) => normalizeServer(item));
}

function normalizeServer(value: unknown): McpServerSummary {
  const record = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
  const normalizedId = toOptionalString(record.id) ?? toOptionalString(record.name) ?? "unknown";
  const normalizedName = toOptionalString(record.name) ?? toOptionalString(record.id) ?? "unknown";
  const normalizedStatus = inferStatus(record);
  const normalized: McpServerSummary = {
    id: normalizedId,
    name: normalizedName,
    status: normalizedStatus,
    args: toStringArray(record.args),
  };
  const transport = toOptionalString(record.transport);
  const command = toOptionalString(record.command);
  const cwd = toOptionalString(record.cwd);
  const auth = toOptionalString(record.auth) ?? toOptionalString(record.authStatus);
  const error = toOptionalString(record.error);
  const message = toOptionalString(record.message);
  const enabled = typeof record.enabled === "boolean" ? record.enabled : undefined;
  const raw = buildRawRecord(record);

  if (transport) {
    normalized.transport = transport;
  }

  if (command) {
    normalized.command = command;
  }

  if (cwd) {
    normalized.cwd = cwd;
  }

  if (typeof enabled === "boolean") {
    normalized.enabled = enabled;
  }

  if (auth) {
    normalized.auth = auth;
  }

  if (error) {
    normalized.error = error;
  }

  if (message) {
    normalized.message = message;
  }

  if (raw) {
    normalized.raw = raw;
  }

  return normalized;
}

function toStringOrUnknown(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "unknown";
}

function inferStatus(record: Record<string, unknown>): string {
  const explicitStatus = toOptionalString(record.status);

  if (explicitStatus) {
    return explicitStatus;
  }

  const error = toOptionalString(record.error);
  const message = toOptionalString(record.message);

  if (error || message) {
    return "degraded";
  }

  const authStatus = toOptionalString(record.authStatus);
  const hasToolCollection = record.tools !== undefined || record.resources !== undefined || record.resourceTemplates !== undefined;
  const hasConfigPresence = toOptionalString(record.name) || toOptionalString(record.command) || Array.isArray(record.args) || authStatus;

  if (hasToolCollection || hasConfigPresence) {
    return "available";
  }

  return "unknown";
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function buildRawRecord(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const knownKeys = new Set([
    "id",
    "name",
    "status",
    "transport",
    "command",
    "args",
    "cwd",
    "enabled",
    "auth",
    "authStatus",
    "error",
    "message",
  ]);
  const rawEntries = Object.entries(record).filter(([key]) => !knownKeys.has(key));

  if (rawEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(rawEntries);
}
