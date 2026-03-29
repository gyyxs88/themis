import { Codex, type Thread, type ThreadOptions } from "@openai/codex-sdk";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { RuntimeEngine, TaskRequest } from "../types/index.js";

export type CodexSessionMode = "ephemeral" | "created" | "resumed";

export interface CodexThreadSessionStoreOptions {
  codex?: Codex;
  sessionRegistry?: SqliteCodexSessionRegistry;
  databaseFile?: string;
  maxSessions?: number;
  sessionIdNamespace?: string;
}

export interface CodexSessionLease {
  sessionId?: string;
  thread: Thread;
  threadId?: string;
  sessionMode: CodexSessionMode;
  runtimeEngine?: RuntimeEngine;
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
  private readonly sessionIdNamespace: string;

  constructor(options: CodexThreadSessionStoreOptions = {}) {
    this.codex = options.codex ?? new Codex();
    this.sessionRegistry =
      options.sessionRegistry ??
      new SqliteCodexSessionRegistry({
        ...(options.databaseFile ? { databaseFile: options.databaseFile } : {}),
        ...(typeof options.maxSessions === "number" ? { maxSessions: options.maxSessions } : {}),
      });
    this.sessionIdNamespace = normalizeSessionId(options.sessionIdNamespace);
  }

  getSessionRegistry(): SqliteCodexSessionRegistry {
    return this.sessionRegistry;
  }

  async acquire(request: TaskRequest, threadOptions: ThreadOptions): Promise<CodexSessionLease> {
    const sessionId = normalizeSessionId(request.channelContext.sessionId);
    const storageSessionId = this.toStorageSessionId(sessionId);

    if (!sessionId) {
      return {
        thread: this.codex.startThread(threadOptions),
        sessionMode: "ephemeral",
        runtimeEngine: "sdk",
        release: async () => {},
      };
    }

    const taskId = request.taskId ?? request.requestId;
    const now = nowIso();
    const existing = this.sessionRegistry.getSession(storageSessionId);

    if (existing?.activeTaskId && existing.activeTaskId !== taskId) {
      throw new SessionBusyError(sessionId);
    }

    if (existing?.threadId) {
      this.sessionRegistry.saveSession({
        sessionId: storageSessionId,
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
        runtimeEngine: "sdk",
        release: async (finalThreadId) => {
          await this.release(storageSessionId, taskId, finalThreadId);
        },
      };
    }

    this.sessionRegistry.saveSession({
      sessionId: storageSessionId,
      threadId: existing?.threadId ?? "",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      activeTaskId: taskId,
    });

    return {
      sessionId,
      thread: this.codex.startThread(threadOptions),
      sessionMode: "created",
      runtimeEngine: "sdk",
      release: async (finalThreadId) => {
        await this.release(storageSessionId, taskId, finalThreadId);
      },
    };
  }

  async resolveThreadId(sessionId: string): Promise<string | null> {
    const normalized = normalizeSessionId(sessionId);

    if (!normalized) {
      return null;
    }

    return this.sessionRegistry.resolveThreadId(this.toStorageSessionId(normalized));
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

  private toStorageSessionId(sessionId: string): string {
    if (!sessionId || !this.sessionIdNamespace) {
      return sessionId;
    }

    return `${this.sessionIdNamespace}::${sessionId}`;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeSessionId(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}
