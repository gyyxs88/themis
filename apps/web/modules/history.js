import { formatEventTitle, formatStatusLabel, resolveToneFromTitle } from "./copy.js";
import { nowIso, parseJsonText } from "./utils.js";

export function createHistoryController(app) {
  const { MAX_THREAD_COUNT } = app.constants;

  function getDisplayTurnCount(thread) {
    if (!thread) {
      return 0;
    }

    return Math.max(thread.turns.length, thread.storedTurnCount ?? 0);
  }

  function threadNeedsHistoryHydration(thread, force = false) {
    if (!thread) {
      return false;
    }

    if (force) {
      return Boolean(thread.serverHistoryAvailable && getDisplayTurnCount(thread) > 0);
    }

    return Boolean(
      thread.serverHistoryAvailable &&
      thread.storedTurnCount > 0 &&
      (!thread.historyHydrated || thread.turns.length !== thread.storedTurnCount),
    );
  }

  async function refreshHistoryFromServer(options = {}) {
    if (app.runtime.historySyncBusy) {
      return;
    }

    app.runtime.historySyncBusy = true;
    app.renderer.renderAll();

    try {
      const response = await fetch(`/api/history/sessions?limit=${MAX_THREAD_COUNT}`);
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "拉取历史会话失败。");
      }

      mergeHistorySessions(data?.sessions ?? []);
      app.store.saveState();
      app.renderer.renderAll();

      if (options.force && app.store.state.activeThreadId) {
        await ensureThreadHistoryLoaded(app.store.state.activeThreadId, { force: true });
        await app.sessionSettings.loadThreadSettings(app.store.state.activeThreadId, { quiet: true });
      } else if (app.store.state.activeThreadId) {
        await ensureThreadHistoryLoaded(app.store.state.activeThreadId);
        await app.sessionSettings.loadThreadSettings(app.store.state.activeThreadId, { quiet: true });
      }
    } catch (error) {
      console.error("History sync failed.", error);
    } finally {
      app.runtime.historySyncBusy = false;
      app.renderer.renderAll();
    }
  }

  function mergeHistorySessions(sessions) {
    for (const session of sessions) {
      upsertThreadFromHistorySummary(session);
    }

    app.store.trimThreads();
  }

  function upsertThreadFromHistorySummary(summary) {
    if (!summary?.sessionId) {
      return;
    }

    let thread = app.store.getThreadById(summary.sessionId);

    if (!thread) {
      thread = app.store.createThread();
      thread.id = summary.sessionId;
      app.store.state.threads.push(thread);
    }

    thread.createdAt = app.store.pickEarlierTimestamp(thread.createdAt, summary.createdAt);
    thread.updatedAt = app.store.pickLaterTimestamp(thread.updatedAt, summary.updatedAt);
    thread.title = app.store.isDefaultThreadTitle(thread.title) || !thread.turns.length
      ? app.store.titleFromGoal(summary.latestTurn?.goal ?? thread.title)
      : thread.title;
    thread.serverThreadId = summary.threadId ?? summary.latestTurn?.codexThreadId ?? thread.serverThreadId;
    thread.serverHistoryAvailable = true;
    thread.storedTurnCount = Math.max(summary.turnCount ?? 0, thread.turns.length);
    thread.storedSummary = summary.latestTurn?.summary ?? summary.latestTurn?.goal ?? thread.storedSummary;
    thread.storedStatus = summary.latestTurn?.status ?? thread.storedStatus;

    if (!thread.turns.length) {
      thread.historyHydrated = false;
    }
  }

  async function ensureThreadHistoryLoaded(threadId, options = {}) {
    const thread = app.store.getThreadById(threadId);

    if (!thread || !thread.serverHistoryAvailable || !threadNeedsHistoryHydration(thread, options.force)) {
      return;
    }

    app.runtime.historyHydratingThreadId = threadId;
    app.renderer.renderAll();

    try {
      const response = await fetch(`/api/history/sessions/${encodeURIComponent(threadId)}`);
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        const error = new Error(data?.error?.message ?? "载入会话详情失败。");
        error.statusCode = response.status;
        throw error;
      }

      applyHistorySessionDetail(data);
      app.store.saveState();
      app.renderer.renderAll(true);
      await app.sessionSettings.loadThreadSettings(threadId, { quiet: true });
    } catch (error) {
      if (error?.statusCode === 404) {
        thread.historyHydrated = true;
        thread.storedTurnCount = Math.max(thread.turns.length, thread.storedTurnCount ?? 0);

        if (thread.turns.length) {
          const latestTurn = thread.turns.at(-1);
          thread.storedSummary = latestTurn?.result?.summary ?? latestTurn?.goal ?? thread.storedSummary;
          thread.storedStatus = latestTurn?.state ?? thread.storedStatus;
          app.store.setTransientStatus(threadId, "本机完整历史暂不可用，已继续使用浏览器中保存的记录。");
        } else {
          app.store.setTransientStatus(threadId, "这个会话目前只有摘要，暂时没有可恢复的完整任务记录。");
        }

        app.store.saveState();
        app.renderer.renderAll();
        return;
      }

      app.store.setTransientStatus(threadId, error?.message ?? "载入会话详情失败。");
      app.renderer.renderAll();
    } finally {
      app.runtime.historyHydratingThreadId = null;
      app.renderer.renderAll();
    }
  }

  async function attachConversationById(conversationId) {
    const normalizedConversationId = typeof conversationId === "string" ? conversationId.trim() : "";

    if (!normalizedConversationId) {
      return {
        foundHistory: false,
        thread: null,
      };
    }

    let thread = app.store.getThreadById(normalizedConversationId);

    if (!thread) {
      thread = app.store.createThread();
      thread.id = normalizedConversationId;
      thread.title = `会话 ${normalizedConversationId.slice(0, 12)}`;
      thread.historyHydrated = true;
      app.store.state.threads.unshift(thread);
    }

    app.store.state.activeThreadId = thread.id;
    app.store.trimThreads();
    app.store.saveState();
    app.renderer.renderAll(true);

    app.runtime.historyHydratingThreadId = thread.id;
    app.renderer.renderAll();

    try {
      const response = await fetch(`/api/history/sessions/${encodeURIComponent(thread.id)}`);
      const data = await app.utils.safeReadJson(response);

      if (response.ok) {
        applyHistorySessionDetail(data);
        thread = app.store.getThreadById(thread.id) ?? thread;
        await app.sessionSettings.loadThreadSettings(thread.id, { quiet: true });
        app.store.saveState();
        app.renderer.renderAll(true);
        return {
          foundHistory: true,
          thread,
        };
      }

      if (response.status !== 404) {
        throw new Error(data?.error?.message ?? "载入会话详情失败。");
      }

      thread.serverHistoryAvailable = false;
      thread.serverThreadId = null;
      thread.storedTurnCount = 0;
      thread.storedSummary = "";
      thread.storedStatus = null;
      thread.historyHydrated = true;
      await app.sessionSettings.loadThreadSettings(thread.id, { quiet: true });
      app.store.saveState();
      app.renderer.renderAll(true);

      return {
        foundHistory: false,
        thread,
      };
    } finally {
      app.runtime.historyHydratingThreadId = null;
      app.renderer.renderAll();
    }
  }

  function applyHistorySessionDetail(data) {
    const session = data?.session;

    if (!session?.sessionId) {
      return;
    }

    let thread = app.store.getThreadById(session.sessionId);

    if (!thread) {
      thread = app.store.createThread();
      thread.id = session.sessionId;
      app.store.state.threads.push(thread);
    }

    thread.title = app.store.titleFromGoal(session.latestTurn?.goal ?? thread.title);
    thread.createdAt = app.store.pickEarlierTimestamp(thread.createdAt, session.createdAt);
    thread.updatedAt = app.store.pickLaterTimestamp(thread.updatedAt, session.updatedAt);
    thread.serverThreadId = session.threadId ?? session.latestTurn?.codexThreadId ?? thread.serverThreadId;
    thread.serverHistoryAvailable = true;
    thread.storedTurnCount = Math.max(session.turnCount ?? 0, thread.storedTurnCount ?? 0);
    thread.storedSummary = session.latestTurn?.summary ?? session.latestTurn?.goal ?? thread.storedSummary;
    thread.storedStatus = session.latestTurn?.status ?? thread.storedStatus;
    thread.historyHydrated = true;
    thread.turns = Array.isArray(data?.turns) ? data.turns.map(mapStoredTurnToLocalTurn).filter(Boolean) : [];
    thread.storedTurnCount = Math.max(thread.storedTurnCount ?? 0, thread.turns.length);

    if (thread.turns.length) {
      thread.updatedAt = thread.turns.at(-1)?.createdAt ?? thread.updatedAt;
    }
  }

  function mapStoredTurnToLocalTurn(turn) {
    if (!turn || typeof turn !== "object") {
      return null;
    }

    const result = buildResultFromStoredTurn(turn);
    const assistantMessages = buildAssistantMessagesFromStoredTurnEvents(turn.events);
    const steps = buildStepsFromStoredTurnEvents(turn.events, turn);

    return {
      id:
        (typeof turn.taskId === "string" && turn.taskId) ||
        (typeof turn.requestId === "string" && turn.requestId) ||
        app.utils.createId("turn"),
      createdAt: typeof turn.createdAt === "string" ? turn.createdAt : nowIso(),
      goal: typeof turn.goal === "string" ? turn.goal : "",
      inputText: typeof turn.inputText === "string" ? turn.inputText : "",
      options: parseJsonText(turn.optionsJson),
      requestId: typeof turn.requestId === "string" ? turn.requestId : null,
      taskId: typeof turn.taskId === "string" ? turn.taskId : null,
      serverThreadId: typeof turn.codexThreadId === "string" ? turn.codexThreadId : null,
      serverSessionId: typeof turn.sessionId === "string" ? turn.sessionId : null,
      sessionMode: typeof turn.sessionMode === "string" ? turn.sessionMode : null,
      state: typeof turn.status === "string" ? turn.status : "completed",
      assistantMessages,
      steps,
      result,
    };
  }

  function buildStepsFromStoredTurnEvents(events, turn) {
    if (Array.isArray(events) && events.length) {
      const steps = events
        .map((event) => {
          const metadata = parseStoredEventPayload(event);

          if (metadata?.itemType === "agent_message") {
            return null;
          }

          return {
            title: formatEventTitle(event.type),
            text: event.message ?? latestStoredTurnMessage(turn),
            tone: resolveToneFromTitle(event.type),
            ...(metadata ? { metadata } : {}),
          };
        })
        .filter(Boolean);

      if (steps.length) {
        return steps;
      }
    }

    return [
      {
        title: formatStatusLabel(turn.status ?? "completed"),
        text: latestStoredTurnMessage(turn),
        tone: turn.status === "failed" ? "error" : "success",
      },
    ];
  }

  function buildAssistantMessagesFromStoredTurnEvents(events) {
    if (!Array.isArray(events) || !events.length) {
      return [];
    }

    const messages = [];

    for (const event of events) {
      const metadata = parseStoredEventPayload(event);

      if (metadata?.itemType !== "agent_message") {
        continue;
      }

      const text = resolveStoredAssistantMessageText(event, metadata);

      if (!text) {
        continue;
      }

      const messageId = typeof metadata.itemId === "string" && metadata.itemId
        ? metadata.itemId
        : app.utils.createId("assistant-msg");
      const existing = messages.find((message) => message.id === messageId);

      if (existing) {
        existing.text = text;
      } else {
        messages.push({ id: messageId, text });
      }
    }

    return messages;
  }

  function buildResultFromStoredTurn(turn) {
    const structuredOutput = parseJsonText(turn.structuredOutputJson);
    const touchedFiles = Array.isArray(turn.touchedFiles) ? turn.touchedFiles : [];
    const summary = typeof turn.summary === "string" && turn.summary
      ? turn.summary
      : typeof turn.errorMessage === "string" && turn.errorMessage
        ? turn.errorMessage
        : typeof turn.goal === "string"
          ? turn.goal
          : "任务已完成。";

    return {
      status: typeof turn.status === "string" ? turn.status : "completed",
      summary,
      ...(typeof turn.output === "string" && turn.output ? { output: turn.output } : {}),
      ...(touchedFiles.length ? { touchedFiles } : {}),
      ...(structuredOutput && typeof structuredOutput === "object" ? { structuredOutput } : {}),
    };
  }

  function latestStoredTurnMessage(turn) {
    return turn?.summary || turn?.errorMessage || turn?.goal || "已载入历史记录。";
  }

  function parseStoredEventPayload(event) {
    return event?.payloadJson ? parseJsonText(event.payloadJson) : null;
  }

  function resolveStoredAssistantMessageText(event, metadata) {
    if (typeof metadata?.itemText === "string" && metadata.itemText.trim()) {
      return metadata.itemText.trim();
    }

    if (
      typeof event?.message === "string" &&
      event.message.trim() &&
      event.message !== "Codex produced an assistant message."
    ) {
      return event.message.trim();
    }

    return "";
  }

  return {
    attachConversationById,
    getDisplayTurnCount,
    threadNeedsHistoryHydration,
    refreshHistoryFromServer,
    ensureThreadHistoryLoaded,
  };
}
