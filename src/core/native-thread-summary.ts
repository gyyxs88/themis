import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { RuntimeEngine, TaskRuntimeRegistry } from "../types/index.js";
import { resolveTaskRuntime } from "../types/index.js";
import { resolveStoredSessionThreadReference } from "./session-thread-reference.js";

export interface SessionNativeThreadSummary {
  engine: RuntimeEngine;
  threadId: string;
  preview?: string;
  status?: string;
  cwd?: string;
  turnCount: number;
}

export async function readSessionNativeThreadSummary(
  store: SqliteCodexSessionRegistry,
  sessionId: string,
  runtimeRegistry?: TaskRuntimeRegistry,
): Promise<SessionNativeThreadSummary | null> {
  if (!runtimeRegistry) {
    return null;
  }

  const reference = resolveStoredSessionThreadReference(store, sessionId);
  if (reference.engine === "sdk") {
    return null;
  }

  const resolvedThreadId = reference.threadId ?? normalizeText(store.getSession(sessionId)?.threadId);
  const runtime = reference.engine === "app-server"
    ? resolveTaskRuntime(runtimeRegistry, reference.engine)
    : runtimeRegistry.runtimes?.["app-server"] ?? null;

  if (!resolvedThreadId || !runtime || typeof runtime.readThreadSnapshot !== "function") {
    return null;
  }

  try {
    const snapshot = await runtime.readThreadSnapshot({
      threadId: resolvedThreadId,
      includeTurns: true,
    });

    if (!snapshot) {
      return null;
    }

    return {
      engine: "app-server",
      threadId: snapshot.threadId,
      ...(snapshot.preview ? { preview: snapshot.preview } : {}),
      ...(snapshot.status ? { status: snapshot.status } : {}),
      ...(snapshot.cwd ? { cwd: snapshot.cwd } : {}),
      turnCount: snapshot.turnCount,
    };
  } catch {
    return null;
  }
}

function normalizeText(value: string | undefined | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
