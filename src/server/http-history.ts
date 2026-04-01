import type { ServerResponse } from "node:http";
import { readSessionNativeThreadSummary } from "../core/native-thread-summary.js";
import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskRuntimeRegistry } from "../types/index.js";
import { writeJson } from "./http-responses.js";

export function handleHistorySessions(
  url: URL,
  response: ServerResponse,
  store: SqliteCodexSessionRegistry,
  headOnly = false,
): void {
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "24", 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 24;
  const sessions = store.listRecentSessions(limit);

  writeJson(response, 200, { sessions }, headOnly);
}

export async function handleHistorySessionDetail(
  url: URL,
  response: ServerResponse,
  store: SqliteCodexSessionRegistry,
  runtimeRegistry?: TaskRuntimeRegistry,
  headOnly = false,
): Promise<void> {
  const sessionId = decodeURIComponent(url.pathname.slice("/api/history/sessions/".length)).trim();

  if (!sessionId) {
    writeJson(response, 400, {
      error: {
        code: "INVALID_REQUEST",
        message: "Missing session id.",
      },
    }, headOnly);
    return;
  }

  const turns = store.listSessionTurns(sessionId);

  if (!turns.length) {
    writeJson(response, 404, {
      error: {
        code: "NOT_FOUND",
        message: "No stored history was found for this session.",
      },
    }, headOnly);
    return;
  }

  const firstTurn = turns[0]!;
  const latestTurn = turns.at(-1) ?? firstTurn;
  const session = store.listRecentSessions(200).find((item) => item.sessionId === sessionId);
  const detailedTurns = turns.map((turn) => {
    const turnInput = store.getTurnInput(turn.requestId);

    return {
      ...turn,
      events: store.listTurnEvents(turn.requestId),
      touchedFiles: store.listTurnFiles(turn.requestId),
      ...(turnInput ? { input: turnInput } : {}),
    };
  });
  const nativeThread = await readNativeThreadSummary(store, sessionId, runtimeRegistry);

  writeJson(response, 200, {
    session: session ?? {
      sessionId,
      createdAt: firstTurn.createdAt,
      updatedAt: latestTurn.updatedAt ?? firstTurn.createdAt,
      turnCount: turns.length,
      latestTurn: {
        requestId: latestTurn.requestId,
        taskId: latestTurn.taskId,
        goal: latestTurn.goal,
        status: latestTurn.status,
        ...(latestTurn.summary ? { summary: latestTurn.summary } : {}),
        ...(latestTurn.sessionMode ? { sessionMode: latestTurn.sessionMode } : {}),
        ...(latestTurn.codexThreadId ? { codexThreadId: latestTurn.codexThreadId } : {}),
        updatedAt: latestTurn.updatedAt,
      },
    },
    turns: detailedTurns,
    ...(nativeThread ? { nativeThread } : {}),
  }, headOnly);
}

async function readNativeThreadSummary(
  store: SqliteCodexSessionRegistry,
  sessionId: string,
  runtimeRegistry?: TaskRuntimeRegistry,
): Promise<{ threadId: string; preview?: string; turnCount: number } | null> {
  const summary = await readSessionNativeThreadSummary(store, sessionId, runtimeRegistry);

  if (!summary) {
    return null;
  }

  return {
    threadId: summary.threadId,
    ...(summary.preview ? { preview: summary.preview } : {}),
    turnCount: summary.turnCount,
  };
}

function normalizeText(value: string | undefined | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
