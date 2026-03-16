import { nowIso, summarizeForSidebar } from "./utils.js";

export function createStoreHelpers({ app, getState, createDefaultThreadSettings, saveState }) {
  const { DEFAULT_ROLE, DEFAULT_WORKFLOW } = app.constants;

  function buildTaskOptions(settings) {
    const options = {
      ...(settings?.model ? { model: settings.model } : {}),
      ...(settings?.reasoning ? { reasoning: settings.reasoning } : {}),
      ...(settings?.approvalPolicy ? { approvalPolicy: settings.approvalPolicy } : {}),
    };

    return Object.keys(options).length ? options : undefined;
  }

  function shouldBootstrapThread(thread) {
    return Boolean(thread?.bootstrapTranscript && !thread?.serverThreadId);
  }

  function repairInterruptedTurns() {
    for (const thread of getState().threads) {
      for (const turn of thread.turns) {
        if (turn.state !== "queued" && turn.state !== "running") {
          continue;
        }

        turn.state = "cancelled";
        turn.result = turn.result ?? {
          status: "cancelled",
          summary: "浏览器刷新或会话关闭后，本次任务已中断。",
        };
        turn.steps.push({
          title: "会话已中断",
          text: "浏览器刷新或会话关闭后，本次任务未继续运行。",
          tone: "error",
        });
        thread.updatedAt = nowIso();
      }
    }

    saveState();
  }

  function buildThreadSummary(thread) {
    const state = getState();
    const latestTurn = thread?.turns.at(-1);
    const turnCount = app.history?.getDisplayTurnCount(thread) ?? thread?.turns.length ?? 0;
    const status = threadStatus(thread);

    return {
      threadId: thread?.id ?? null,
      title: thread?.title ?? "新会话",
      turnCount,
      workflow: latestTurn?.workflow ?? state.selectedWorkflow ?? DEFAULT_WORKFLOW,
      role: latestTurn?.role ?? state.selectedRole ?? DEFAULT_ROLE,
      settings: thread?.settings ?? createDefaultThreadSettings(),
      requestId: latestTurn?.requestId ?? null,
      taskId: latestTurn?.taskId ?? null,
      serverThreadId: thread?.serverThreadId ?? null,
      serverSessionId: thread?.id ?? null,
      sessionMode: latestTurn?.sessionMode ?? null,
      bootstrapMode: thread?.bootstrapMode ?? null,
      bootstrapPending: Boolean(thread?.bootstrapTranscript && !thread?.serverThreadId),
      serverHistoryAvailable: thread?.serverHistoryAvailable ?? false,
      storedTurnCount: thread?.storedTurnCount ?? 0,
      historyHydrated: thread?.historyHydrated ?? true,
      state: status,
      updatedAt: thread?.updatedAt ?? null,
    };
  }

  function describeBootstrapLabel(thread) {
    if (thread?.bootstrapMode === "session-transcript") {
      return "真实 Codex 会话的逐轮转录";
    }

    return "浏览器里保存的逐轮会话转录";
  }

  function describeBootstrapStatus(thread) {
    return `这是一个分叉会话。下一次发送时，会先把${describeBootstrapLabel(thread)}导入新的 Codex 会话。`;
  }

  function threadStatus(thread) {
    if (!thread) {
      return "idle";
    }

    const latestTurn = thread.turns.at(-1);
    return latestTurn?.state ?? thread.storedStatus ?? "idle";
  }

  function latestTurnMessage(turn) {
    if (turn.result?.summary && turn.state !== "running" && turn.state !== "queued") {
      return turn.result.summary;
    }

    return turn.steps.at(-1)?.text ?? "等待任务开始。";
  }

  function buildThreadPreview(thread) {
    if (!thread) {
      return "等待新的任务。";
    }

    if (app.runtime.historyHydratingThreadId === thread.id) {
      return "正在从本机历史载入完整记录。";
    }

    if (thread.bootstrapTranscript && !thread.serverThreadId) {
      return `分叉会话：下一次发送会先导入${describeBootstrapLabel(thread)}。`;
    }

    const latestTurn = thread.turns.at(-1);

    if (!latestTurn) {
      if (thread.storedSummary) {
        return summarizeForSidebar(thread.storedSummary);
      }

      return "还没有任务，发送第一条消息开始。";
    }

    if (latestTurn.state === "running" || latestTurn.state === "queued") {
      return summarizeForSidebar(latestTurn.steps.at(-1)?.text ?? latestTurn.goal);
    }

    if (latestTurn.result?.summary) {
      return summarizeForSidebar(latestTurn.result.summary);
    }

    if (thread.storedSummary) {
      return summarizeForSidebar(thread.storedSummary);
    }

    return summarizeForSidebar(latestTurn.goal);
  }

  function shouldShowThreadInList(thread, query = "") {
    const state = getState();

    if (!thread) {
      return false;
    }

    const hasContent = Boolean(
      thread.turns.length ||
      thread.storedTurnCount ||
      thread.bootstrapTranscript ||
      thread.draftGoal?.trim() ||
      thread.draftContext?.trim(),
    );

    if (!hasContent && thread.id !== state.activeThreadId) {
      return false;
    }

    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return true;
    }

    const latestTurn = thread.turns.at(-1);
    const searchable = [
      thread.title,
      thread.storedSummary,
      latestTurn?.goal,
      latestTurn?.inputText,
      latestTurn?.result?.summary,
      latestTurn?.result?.output,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchable.includes(normalizedQuery);
  }

  function syncThreadStoredState(thread, turn) {
    if (!thread || !turn) {
      return;
    }

    thread.storedTurnCount = Math.max(thread.turns.length, thread.storedTurnCount ?? 0);
    thread.storedStatus = turn.state ?? thread.storedStatus;
    thread.storedSummary = turn.result?.summary ?? turn.goal ?? thread.storedSummary;
    thread.serverHistoryAvailable = thread.serverHistoryAvailable || Boolean(turn.requestId || turn.taskId || thread.serverThreadId);
    thread.historyHydrated = true;
  }

  function isDefaultThreadTitle(title) {
    return !title || title === "新会话";
  }

  function buildLocalForkTranscript(thread) {
    const turns = thread.turns.map((turn, index) => renderLocalForkTurn(turn, index + 1));

    if (!turns.length) {
      return "";
    }

    const lines = [
      "Imported conversation transcript from an existing Themis browser session.",
      "Treat the following turns as conversation history that already happened.",
      "Do not answer these turns again. Use them as prior context for the next user request.",
      `Source thread title: ${thread.title}`,
    ];
    const selectedTurns = selectLocalBootstrapTurns(turns);

    if (selectedTurns.omittedCount > 0) {
      lines.push(`[Older ${selectedTurns.omittedCount} turns were omitted to stay within the context budget.]`);
    }

    lines.push(...selectedTurns.turns);
    return lines.join("\n\n");
  }

  function renderLocalForkTurn(turn, index) {
    const lines = [`[Turn ${index}]`, `Workflow: ${turn.workflow}`, `Role: ${turn.role}`, "User goal:", turn.goal];

    if (turn.inputText) {
      lines.push("User context:");
      lines.push(turn.inputText);
    }

    const assistantReply = turn.result?.output ?? turn.result?.summary ?? latestTurnMessage(turn);

    if (assistantReply) {
      lines.push("Assistant reply:");
      lines.push(assistantReply);
    }

    return lines.join("\n");
  }

  function selectLocalBootstrapTurns(turns) {
    const selected = [];
    let totalChars = 0;

    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turnText = turns[index];
      const nextLength = totalChars + turnText.length;

      if (selected.length >= 24 || (selected.length > 0 && nextLength > 24000)) {
        break;
      }

      selected.unshift(turnText);
      totalChars = nextLength;
    }

    return {
      turns: selected,
      omittedCount: Math.max(turns.length - selected.length, 0),
    };
  }

  return {
    buildTaskOptions,
    shouldBootstrapThread,
    repairInterruptedTurns,
    buildThreadSummary,
    describeBootstrapLabel,
    describeBootstrapStatus,
    threadStatus,
    latestTurnMessage,
    buildThreadPreview,
    shouldShowThreadInList,
    syncThreadStoredState,
    isDefaultThreadTitle,
    buildLocalForkTranscript,
  };
}
