import { createId, nowIso } from "./utils.js";

export function createStoreModelHelpers(constants) {
  const { DEFAULT_ROLE, DEFAULT_WORKFLOW } = constants;

  function createDefaultThreadSettings() {
    return {
      model: "",
      reasoning: "",
      approvalPolicy: "",
    };
  }

  function createThread() {
    const timestamp = nowIso();
    return {
      id: createId("thread"),
      title: "新会话",
      createdAt: timestamp,
      updatedAt: timestamp,
      draftGoal: "",
      draftContext: "",
      settings: createDefaultThreadSettings(),
      serverThreadId: null,
      bootstrapTranscript: "",
      bootstrapMode: null,
      serverHistoryAvailable: false,
      storedTurnCount: 0,
      storedSummary: "",
      storedStatus: null,
      historyHydrated: true,
      turns: [],
    };
  }

  function createInitialState() {
    const thread = createThread();

    return {
      activeThreadId: thread.id,
      selectedWorkflow: DEFAULT_WORKFLOW,
      selectedRole: DEFAULT_ROLE,
      threads: [thread],
    };
  }

  function createTurn({ workflow, role, goal, inputText, options }) {
    return {
      id: createId("turn"),
      createdAt: nowIso(),
      workflow,
      role,
      goal,
      inputText,
      ...(options ? { options } : {}),
      requestId: null,
      taskId: null,
      serverThreadId: null,
      serverSessionId: null,
      sessionMode: null,
      state: "queued",
      steps: [
        {
          title: "准备执行",
          text: "正在连接 Themis 后端并等待任务回执。",
          tone: "neutral",
        },
      ],
      result: null,
    };
  }

  function normalizeState(value) {
    const threads = Array.isArray(value?.threads)
      ? value.threads.map(normalizeThread).filter(Boolean)
      : [];

    return {
      activeThreadId: typeof value?.activeThreadId === "string" ? value.activeThreadId : threads[0]?.id ?? null,
      selectedWorkflow: typeof value?.selectedWorkflow === "string" ? value.selectedWorkflow : DEFAULT_WORKFLOW,
      selectedRole: typeof value?.selectedRole === "string" ? value.selectedRole : DEFAULT_ROLE,
      threads: threads.length ? threads : [createThread()],
    };
  }

  function normalizeThread(thread) {
    if (!thread || typeof thread !== "object") {
      return null;
    }

    return {
      id: typeof thread.id === "string" ? thread.id : createId("thread"),
      title: typeof thread.title === "string" && thread.title.trim() ? thread.title : "新会话",
      createdAt: typeof thread.createdAt === "string" ? thread.createdAt : nowIso(),
      updatedAt: typeof thread.updatedAt === "string" ? thread.updatedAt : nowIso(),
      draftGoal: typeof thread.draftGoal === "string" ? thread.draftGoal : "",
      draftContext: typeof thread.draftContext === "string" ? thread.draftContext : "",
      settings: normalizeThreadSettings(thread.settings),
      serverThreadId: typeof thread.serverThreadId === "string" ? thread.serverThreadId : null,
      bootstrapTranscript: typeof thread.bootstrapTranscript === "string" ? thread.bootstrapTranscript : "",
      bootstrapMode: normalizeBootstrapMode(thread.bootstrapMode),
      serverHistoryAvailable: typeof thread.serverHistoryAvailable === "boolean" ? thread.serverHistoryAvailable : false,
      storedTurnCount: Number.isFinite(thread.storedTurnCount) ? Math.max(0, Number(thread.storedTurnCount)) : 0,
      storedSummary: typeof thread.storedSummary === "string" ? thread.storedSummary : "",
      storedStatus: typeof thread.storedStatus === "string" ? thread.storedStatus : null,
      historyHydrated: typeof thread.historyHydrated === "boolean" ? thread.historyHydrated : true,
      turns: Array.isArray(thread.turns) ? thread.turns.map(normalizeTurn).filter(Boolean) : [],
    };
  }

  function normalizeTurn(turn) {
    if (!turn || typeof turn !== "object") {
      return null;
    }

    return {
      id: typeof turn.id === "string" ? turn.id : createId("turn"),
      createdAt: typeof turn.createdAt === "string" ? turn.createdAt : nowIso(),
      workflow: typeof turn.workflow === "string" ? turn.workflow : DEFAULT_WORKFLOW,
      role: typeof turn.role === "string" ? turn.role : DEFAULT_ROLE,
      goal: typeof turn.goal === "string" ? turn.goal : "",
      inputText: typeof turn.inputText === "string" ? turn.inputText : "",
      options: normalizeTurnOptions(turn.options),
      requestId: typeof turn.requestId === "string" ? turn.requestId : null,
      taskId: typeof turn.taskId === "string" ? turn.taskId : null,
      serverThreadId: typeof turn.serverThreadId === "string" ? turn.serverThreadId : null,
      serverSessionId: typeof turn.serverSessionId === "string" ? turn.serverSessionId : null,
      sessionMode: typeof turn.sessionMode === "string" ? turn.sessionMode : null,
      state: typeof turn.state === "string" ? turn.state : "queued",
      steps: Array.isArray(turn.steps) ? turn.steps.map(normalizeStep).filter(Boolean) : [],
      result: normalizeResult(turn.result),
    };
  }

  function normalizeStep(step) {
    if (!step || typeof step !== "object") {
      return null;
    }

    return {
      title: typeof step.title === "string" ? step.title : "执行步骤",
      text: typeof step.text === "string" ? step.text : "",
      tone: typeof step.tone === "string" ? step.tone : "neutral",
      ...(step.metadata && typeof step.metadata === "object" ? { metadata: step.metadata } : {}),
    };
  }

  function normalizeThreadSettings(value) {
    if (!value || typeof value !== "object") {
      return createDefaultThreadSettings();
    }

    return {
      model: typeof value.model === "string" ? value.model : "",
      reasoning: typeof value.reasoning === "string" ? value.reasoning : "",
      approvalPolicy: typeof value.approvalPolicy === "string" ? value.approvalPolicy : "",
    };
  }

  function normalizeTurnOptions(value) {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    const normalized = {
      ...(typeof value.model === "string" && value.model ? { model: value.model } : {}),
      ...(typeof value.reasoning === "string" && value.reasoning ? { reasoning: value.reasoning } : {}),
      ...(typeof value.approvalPolicy === "string" && value.approvalPolicy
        ? { approvalPolicy: value.approvalPolicy }
        : {}),
    };

    return Object.keys(normalized).length ? normalized : undefined;
  }

  function normalizeResult(result) {
    if (!result || typeof result !== "object") {
      return null;
    }

    return {
      status: typeof result.status === "string" ? result.status : "completed",
      summary: typeof result.summary === "string" ? result.summary : "",
      ...(typeof result.output === "string" ? { output: result.output } : {}),
      ...(Array.isArray(result.touchedFiles) ? { touchedFiles: result.touchedFiles } : {}),
      ...(result.structuredOutput && typeof result.structuredOutput === "object"
        ? { structuredOutput: result.structuredOutput }
        : {}),
    };
  }

  function normalizeBootstrapMode(value) {
    if (value === "session-transcript" || value === "local-transcript") {
      return value;
    }

    return null;
  }

  return {
    createDefaultThreadSettings,
    createThread,
    createInitialState,
    createTurn,
    normalizeState,
    normalizeBootstrapMode,
  };
}
