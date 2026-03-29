import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { RuntimeEngine } from "../types/index.js";

export interface StoredSessionThreadReference {
  engine: RuntimeEngine | null;
  threadId: string | null;
}

export function resolveStoredSessionThreadReference(
  store: SqliteCodexSessionRegistry,
  sessionId: string,
): StoredSessionThreadReference {
  const storedThreadId = normalizeText(store.resolveThreadId(sessionId));
  const turns = store.listSessionTurns(sessionId);
  let newestCompletedOrFailedThreadId: string | null = null;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];

    if (!turn || (turn.status !== "completed" && turn.status !== "failed")) {
      continue;
    }

    const session = parseStructuredSession(turn.structuredOutputJson);
    const turnThreadId = normalizeText(session?.threadId) || normalizeText(turn.codexThreadId);

    if (!newestCompletedOrFailedThreadId && turnThreadId) {
      newestCompletedOrFailedThreadId = turnThreadId;
    }

    const engine = normalizeRuntimeEngine(session?.engine);

    if (!engine) {
      continue;
    }

    if (storedThreadId && newestCompletedOrFailedThreadId && storedThreadId !== newestCompletedOrFailedThreadId) {
      return {
        engine: "app-server",
        threadId: storedThreadId,
      };
    }

    return {
      engine,
      threadId: storedThreadId || newestCompletedOrFailedThreadId || null,
    };
  }

  return {
    engine: null,
    threadId: storedThreadId || newestCompletedOrFailedThreadId || null,
  };
}

function parseStructuredSession(structuredOutputJson: string | undefined): {
  engine?: string;
  threadId?: string;
} | null {
  if (!structuredOutputJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(structuredOutputJson) as {
      session?: {
        engine?: unknown;
        threadId?: unknown;
      };
    };
    const session = parsed.session;

    if (!session || typeof session !== "object") {
      return null;
    }

    return {
      ...(typeof session.engine === "string" ? { engine: session.engine } : {}),
      ...(typeof session.threadId === "string" ? { threadId: session.threadId } : {}),
    };
  } catch {
    return null;
  }
}

function normalizeRuntimeEngine(value: string | undefined): RuntimeEngine | null {
  return value === "sdk" || value === "app-server" ? value : null;
}

function normalizeText(value: string | undefined | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
