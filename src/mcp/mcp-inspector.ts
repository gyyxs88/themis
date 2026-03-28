import { CodexAppServerSession } from "../core/codex-app-server.js";

export interface McpServerSummary {
  id: string;
  name: string;
  status: string;
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
        servers: normalizeServerList(response.data),
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

function normalizeServerList(data: unknown): McpServerSummary[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((item) => normalizeServer(item));
}

function normalizeServer(value: unknown): McpServerSummary {
  const record = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};

  return {
    id: toStringOrUnknown(record.id),
    name: toStringOrUnknown(record.name),
    status: toStringOrUnknown(record.status),
  };
}

function toStringOrUnknown(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "unknown";
}
