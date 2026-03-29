import { formatEventTitle, resolveToneFromTitle } from "./copy.js";

export function createStreamActions(app) {
  const { store } = app;

  async function consumeNdjsonStream(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) {
          continue;
        }

        handleStreamMessage(JSON.parse(trimmed));
      }
    }

    const trailing = buffer.trim();

    if (trailing) {
      handleStreamMessage(JSON.parse(trailing));
    }
  }

  function handleStreamMessage(message) {
    const turn = store.getActiveTurn();
    const thread = app.runtime.activeRunRef ? store.getThreadById(app.runtime.activeRunRef.threadId) : null;

    if (!turn || !thread || !app.runtime.activeRunRef) {
      return;
    }

    if (message.kind === "ack") {
      turn.requestId = message.requestId;
      turn.taskId = message.taskId;
      turn.state = "running";
      store.appendStep(turn, "任务已接收", "Themis 已接受你的请求，准备进入 Codex 执行阶段。");
      store.touchThread(app.runtime.activeRunRef.threadId);
      store.saveState();
      app.renderer.renderAll(shouldScrollRunningThread(thread.id));
      return;
    }

    if (message.kind === "event" || message.kind === "result" || message.kind === "error") {
      handleDeliveryMessage(thread, turn, message);
      store.touchThread(app.runtime.activeRunRef.threadId);
      store.saveState();
      app.renderer.renderAll(shouldScrollRunningThread(thread.id));
      return;
    }

    if (message.kind === "done") {
      finalizeTurn(thread, turn, message.result ?? {});
      store.syncThreadStoredState(thread, turn);
      store.clearActiveRun();
      app.renderer.renderAll(shouldScrollRunningThread(thread.id));
      if (app.runtime.pendingInterruptSubmit) {
        app.runtime.resumeInterruptedSubmit?.();
      }
      return;
    }

    if (message.kind === "fatal") {
      finalizeTurnError(turn, message.text ?? "执行失败");
      store.syncThreadStoredState(thread, turn);
      store.clearActiveRun();
      app.renderer.renderAll(shouldScrollRunningThread(thread.id));
      if (app.runtime.pendingInterruptSubmit) {
        app.runtime.resumeInterruptedSubmit?.();
      }
    }
  }

  function handleDeliveryMessage(thread, turn, message) {
    if (message.kind === "event") {
      store.applyRuntimeMetadata(thread, turn, message.metadata);

      if (message.title === "task.action_required") {
        turn.state = "waiting";
        turn.pendingAction = resolvePendingActionMetadata(message.metadata);
        store.appendStep(turn, "等待处理", message.text, "warning", message.metadata);
        return;
      }

      const handledAssistantMessage = syncAssistantMessage(turn, message);

      if (!handledAssistantMessage) {
        const tone = resolveToneFromTitle(message.title);
        store.appendStep(turn, formatEventTitle(message.title), message.text, tone, message.metadata);
      }

      if (message.title === "task.failed") {
        turn.pendingAction = null;
        turn.state = "failed";
        return;
      }

      if (message.title === "task.cancelled") {
        turn.pendingAction = null;
        turn.state = "cancelled";
        return;
      }

      if (message.title === "task.completed") {
        turn.pendingAction = null;
        turn.state = "completed";
        return;
      }

      turn.state = "running";
      return;
    }

    if (message.kind === "result") {
      store.applyRuntimeMetadata(thread, turn, message.metadata?.structuredOutput);
      store.appendStep(turn, "已生成结果", message.text, "success", message.metadata);
      return;
    }

    store.appendStep(turn, "执行错误", message.text, "error", message.metadata);
    turn.state = "failed";
  }

  function syncAssistantMessage(turn, message) {
    const metadata = message?.metadata;

    if (!metadata || typeof metadata !== "object" || metadata.itemType !== "agent_message") {
      return false;
    }

    const text = resolveAssistantMessageText(message, metadata);

    if (!text) {
      return false;
    }

    return store.upsertAssistantMessage(turn, typeof metadata.itemId === "string" ? metadata.itemId : null, text);
  }

  function resolveAssistantMessageText(message, metadata) {
    if (typeof metadata.itemText === "string" && metadata.itemText.trim()) {
      return metadata.itemText.trim();
    }

    if (
      typeof message?.text === "string" &&
      message.text.trim() &&
      message.text !== "Codex produced an assistant message."
    ) {
      return message.text.trim();
    }

    return "";
  }

  function finalizeTurn(thread, turn, result) {
    store.applyRuntimeMetadata(thread, turn, result.structuredOutput);
    turn.pendingAction = null;
    turn.state = result.status ?? "completed";
    turn.result = {
      status: result.status ?? "completed",
      summary: result.summary ?? "任务已完成。",
      ...(result.output ? { output: result.output } : {}),
      ...(result.touchedFiles?.length ? { touchedFiles: result.touchedFiles } : {}),
      ...(result.structuredOutput ? { structuredOutput: result.structuredOutput } : {}),
    };

    if (turn.state === "completed") {
      store.appendStep(turn, "任务完成", turn.result.summary, "success");
    }
  }

  function finalizeTurnCancelled(turn, summary) {
    turn.pendingAction = null;
    turn.state = "cancelled";
    turn.result = {
      status: "cancelled",
      summary,
    };
    store.appendStep(turn, "任务已取消", summary, "error");
  }

  function finalizeTurnError(turn, message) {
    turn.pendingAction = null;
    turn.state = "failed";
    turn.result = {
      status: "failed",
      summary: message,
    };
    store.appendStep(turn, "执行失败", message, "error");
  }

  function shouldScrollRunningThread(threadId) {
    return store.state.activeThreadId === threadId;
  }

  function resolvePendingActionMetadata(metadata) {
    if (!metadata || typeof metadata !== "object") {
      return null;
    }

    const directAction = normalizePendingAction(metadata);

    if (directAction) {
      return directAction;
    }

    return normalizePendingAction(metadata.action);
  }

  function normalizePendingAction(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const actionId = typeof value.actionId === "string" ? value.actionId : "";
    const actionType = typeof value.actionType === "string" ? value.actionType : "";

    if (!actionId || !actionType) {
      return null;
    }

    return {
      actionId,
      actionType,
      ...(typeof value.prompt === "string" ? { prompt: value.prompt } : {}),
      ...(Array.isArray(value.choices) ? { choices: value.choices.filter((choice) => typeof choice === "string") } : {}),
    };
  }

  return {
    consumeNdjsonStream,
    finalizeTurnCancelled,
    finalizeTurnError,
  };
}
