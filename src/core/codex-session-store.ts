import { Codex, type Thread, type ThreadOptions } from "@openai/codex-sdk";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskRequest } from "../types/index.js";

export type CodexSessionMode = "ephemeral" | "created" | "resumed";

export interface CodexThreadSessionStoreOptions {
  codex?: Codex;
  sessionRegistry?: SqliteCodexSessionRegistry;
  databaseFile?: string;
  legacyRegistryFile?: string;
  maxSessions?: number;
}

export interface CodexSessionLease {
  sessionId?: string;
  thread: Thread;
  threadId?: string;
  sessionMode: CodexSessionMode;
  release: (finalThreadId?: string | null) => Promise<void>;
}

export class SessionBusyError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session ${sessionId} is already running another Codex task.`);
    this.name = "SessionBusyError";
    this.sessionId = sessionId;
  }
}

export class CodexThreadSessionStore {
  private readonly codex: Codex;
  private readonly sessionRegistry: SqliteCodexSessionRegistry;

  constructor(options: CodexThreadSessionStoreOptions = {}) {
    this.codex = options.codex ?? new Codex();
    this.sessionRegistry =
      options.sessionRegistry ??
      new SqliteCodexSessionRegistry({
        ...(options.databaseFile ? { databaseFile: options.databaseFile } : {}),
        ...(options.legacyRegistryFile ? { legacyRegistryFile: options.legacyRegistryFile } : {}),
        ...(typeof options.maxSessions === "number" ? { maxSessions: options.maxSessions } : {}),
      });
  }

  getSessionRegistry(): SqliteCodexSessionRegistry {
    return this.sessionRegistry;
  }

  async acquire(request: TaskRequest, threadOptions: ThreadOptions): Promise<CodexSessionLease> {
    const sessionId = request.channelContext.sessionId?.trim();

    if (!sessionId) {
      return {
        thread: this.codex.startThread(threadOptions),
        sessionMode: "ephemeral",
        release: async () => {},
      };
    }

    const taskId = request.taskId ?? request.requestId;
    const now = nowIso();
    const existing = this.sessionRegistry.getSession(sessionId);

    if (existing?.activeTaskId && existing.activeTaskId !== taskId) {
      throw new SessionBusyError(sessionId);
    }

    if (existing?.threadId) {
      this.sessionRegistry.saveSession({
        sessionId,
        threadId: existing.threadId,
        createdAt: existing.createdAt,
        updatedAt: now,
        activeTaskId: taskId,
      });

      return {
        sessionId,
        threadId: existing.threadId,
        thread: this.codex.resumeThread(existing.threadId, threadOptions),
        sessionMode: "resumed",
        release: async (finalThreadId) => {
          await this.release(sessionId, taskId, finalThreadId);
        },
      };
    }

    this.sessionRegistry.saveSession({
      sessionId,
      threadId: existing?.threadId ?? "",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      activeTaskId: taskId,
    });

    return {
      sessionId,
      thread: this.codex.startThread(threadOptions),
      sessionMode: "created",
      release: async (finalThreadId) => {
        await this.release(sessionId, taskId, finalThreadId);
      },
    };
  }

  async reset(sessionId: string): Promise<boolean> {
    const normalized = sessionId.trim();

    if (!normalized) {
      return false;
    }

    const current = this.sessionRegistry.getSession(normalized);

    if (!current) {
      return false;
    }

    if (current.activeTaskId) {
      throw new SessionBusyError(normalized);
    }

    return this.sessionRegistry.deleteSession(normalized);
  }

  async resolveThreadId(sessionId: string): Promise<string | null> {
    const normalized = sessionId.trim();

    if (!normalized) {
      return null;
    }

    return this.sessionRegistry.resolveThreadId(normalized);
  }

  private async release(sessionId: string, taskId: string, finalThreadId?: string | null): Promise<void> {
    const current = this.sessionRegistry.getSession(sessionId);

    if (!current || current.activeTaskId !== taskId) {
      return;
    }

    const resolvedThreadId = finalThreadId?.trim() || current.threadId || "";

    if (!resolvedThreadId) {
      this.sessionRegistry.deleteSession(sessionId);
      return;
    }

    this.sessionRegistry.saveSession({
      sessionId,
      threadId: resolvedThreadId,
      createdAt: current.createdAt,
      updatedAt: nowIso(),
    });
    this.sessionRegistry.pruneInactiveSessions();
  }
}

function nowIso(): string {
  return new Date().toISOString();
}
