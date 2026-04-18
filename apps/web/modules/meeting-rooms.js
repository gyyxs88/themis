const ROOM_STATUSES = new Set(["open", "closing", "closed"]);

export function createDefaultMeetingRoomsState() {
  return {
    accessMode: "gateway_required",
    platformBaseUrl: "",
    ownerPrincipalId: "",
    loadingStatus: false,
    loadingRooms: false,
    loadingDetail: false,
    creating: false,
    streaming: false,
    errorMessage: "",
    noticeMessage: "",
    rooms: [],
    activeRoomId: "",
    activeRoom: null,
    createDraft: {
      organizationId: "",
      title: "",
      goal: "",
      participantAgentIdsText: "",
    },
    composerText: "",
  };
}

export function createMeetingRoomsController(app) {
  const { dom, utils } = app;
  let controlsBound = false;
  let statusRequestId = 0;
  let roomsRequestId = 0;
  let detailRequestId = 0;

  function bindControls() {
    if (controlsBound) {
      return;
    }

    controlsBound = true;
    const runSafely = async (action) => {
      try {
        await action();
      } catch {
        // Errors are already reflected in meetingRooms state for the UI.
      }
    };

    dom?.meetingRoomsRefreshButton?.addEventListener("click", () => {
      void runSafely(loadPanel);
    });

    dom?.meetingRoomsCreateOrganizationInput?.addEventListener("input", () => {
      updateCreateDraft({
        organizationId: dom.meetingRoomsCreateOrganizationInput.value,
      });
    });

    dom?.meetingRoomsCreateTitleInput?.addEventListener("input", () => {
      updateCreateDraft({
        title: dom.meetingRoomsCreateTitleInput.value,
      });
    });

    dom?.meetingRoomsCreateGoalInput?.addEventListener("input", () => {
      updateCreateDraft({
        goal: dom.meetingRoomsCreateGoalInput.value,
      });
      utils.autoResizeTextarea?.(dom.meetingRoomsCreateGoalInput);
    });

    dom?.meetingRoomsCreateParticipantsInput?.addEventListener("input", () => {
      updateCreateDraft({
        participantAgentIdsText: dom.meetingRoomsCreateParticipantsInput.value,
      });
      utils.autoResizeTextarea?.(dom.meetingRoomsCreateParticipantsInput);
    });

    dom?.meetingRoomsCreateButton?.addEventListener("click", () => {
      void runSafely(createRoom);
    });

    dom?.meetingRoomsList?.addEventListener("click", (event) => {
      const roomButton = event.target.closest?.("[data-meeting-room-id]");
      const roomId = normalizeText(roomButton?.dataset?.meetingRoomId);

      if (!roomId) {
        return;
      }

      void runSafely(() => openRoom(roomId));
    });

    dom?.meetingRoomsComposerInput?.addEventListener("input", () => {
      setState({
        composerText: dom.meetingRoomsComposerInput.value,
        noticeMessage: "",
      });
      utils.autoResizeTextarea?.(dom.meetingRoomsComposerInput);
      render();
    });

    dom?.meetingRoomsComposerInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey) || event.shiftKey) {
        return;
      }

      event.preventDefault();
      void runSafely(sendMessage);
    });

    dom?.meetingRoomsSendButton?.addEventListener("click", () => {
      void runSafely(sendMessage);
    });

  }

  function setState(patch) {
    app.runtime.meetingRooms = {
      ...app.runtime.meetingRooms,
      ...patch,
    };
  }

  function render() {
    app.renderer?.renderAll?.();
  }

  function updateCreateDraft(patch) {
    const current = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();
    setState({
      createDraft: {
        ...current.createDraft,
        ...patch,
      },
      noticeMessage: "",
    });
    render();
  }

  async function loadPanel() {
    await loadStatus();

    if ((app.runtime.meetingRooms?.accessMode ?? "gateway_required") === "platform_gateway") {
      await loadRooms({ refreshActive: true });
    }

    return app.runtime.meetingRooms;
  }

  async function loadStatus() {
    const requestId = ++statusRequestId;
    const current = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();

    setState({
      loadingStatus: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await fetch("/api/meeting-rooms/status");
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(resolveErrorMessage(data, "读取内部会议室入口状态失败。"));
      }

      if (requestId !== statusRequestId) {
        return app.runtime.meetingRooms;
      }

      setState({
        accessMode: normalizeAccessMode(data?.accessMode),
        platformBaseUrl: normalizeText(data?.platformBaseUrl),
        ownerPrincipalId: normalizeText(data?.ownerPrincipalId),
        loadingStatus: false,
        errorMessage: "",
      });
      render();
      return app.runtime.meetingRooms;
    } catch (error) {
      if (requestId !== statusRequestId) {
        return app.runtime.meetingRooms;
      }

      setState({
        ...current,
        loadingStatus: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function loadRooms(options = {}) {
    const requestId = ++roomsRequestId;
    const current = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();

    setState({
      loadingRooms: true,
      errorMessage: "",
      ...(options.preserveNoticeMessage ? {} : { noticeMessage: "" }),
    });
    render();

    try {
      const response = await fetch("/api/meeting-rooms/list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: options.status && ROOM_STATUSES.has(options.status) ? options.status : undefined,
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(resolveErrorMessage(data, "读取内部会议室列表失败。"));
      }

      if (requestId !== roomsRequestId) {
        return app.runtime.meetingRooms;
      }

      const rooms = normalizeRooms(data?.rooms);
      const currentActiveRoomId = normalizeText(current.activeRoomId);
      const activeRoomId = rooms.some((room) => room.roomId === currentActiveRoomId)
        ? currentActiveRoomId
        : rooms[0]?.roomId ?? "";
      const fallbackOrganizationId = current.createDraft.organizationId
        || rooms.find((room) => normalizeText(room.organizationId))?.organizationId
        || "";

      setState({
        rooms,
        activeRoomId,
        activeRoom: activeRoomId && current.activeRoom?.room?.roomId === activeRoomId
          ? current.activeRoom
          : activeRoomId
            ? null
            : null,
        loadingRooms: false,
        createDraft: {
          ...current.createDraft,
          organizationId: fallbackOrganizationId,
        },
      });
      render();

      if (activeRoomId && (options.refreshActive || current.activeRoom?.room?.roomId !== activeRoomId)) {
        await openRoom(activeRoomId, {
          quiet: true,
        });
      }

      return app.runtime.meetingRooms;
    } catch (error) {
      if (requestId !== roomsRequestId) {
        return app.runtime.meetingRooms;
      }

      setState({
        loadingRooms: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function openRoom(roomId, options = {}) {
    const normalizedRoomId = normalizeText(roomId);

    if (!normalizedRoomId) {
      return app.runtime.meetingRooms;
    }

    const requestId = ++detailRequestId;
    const current = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();
    const preservedRoom = current.activeRoom?.room?.roomId === normalizedRoomId ? current.activeRoom : null;

    setState({
      activeRoomId: normalizedRoomId,
      activeRoom: preservedRoom,
      loadingDetail: true,
      ...(options.quiet ? {} : { errorMessage: "" }),
    });
    render();

    try {
      const response = await fetch("/api/meeting-rooms/detail", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomId: normalizedRoomId,
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(resolveErrorMessage(data, "读取内部会议室详情失败。"));
      }

      if (requestId !== detailRequestId) {
        return app.runtime.meetingRooms;
      }

      const detail = normalizeRoomDetail(data);
      const nextState = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();

      setState({
        activeRoomId: normalizedRoomId,
        activeRoom: detail,
        loadingDetail: false,
        errorMessage: "",
        createDraft: {
          ...nextState.createDraft,
          organizationId: nextState.createDraft.organizationId || normalizeText(detail.room.organizationId),
        },
      });
      render();
      return app.runtime.meetingRooms;
    } catch (error) {
      if (requestId !== detailRequestId) {
        return app.runtime.meetingRooms;
      }

      setState({
        loadingDetail: false,
        ...(options.quiet ? {} : { errorMessage: error instanceof Error ? error.message : String(error) }),
      });
      render();
      if (!options.quiet) {
        throw error;
      }
      return app.runtime.meetingRooms;
    }
  }

  async function createRoom() {
    const current = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();
    const title = normalizeText(current.createDraft.title);
    const goal = normalizeText(current.createDraft.goal);
    const organizationId = normalizeText(current.createDraft.organizationId);
    const participantAgentIds = parseParticipantAgentIds(current.createDraft.participantAgentIdsText);

    if (current.accessMode !== "platform_gateway") {
      setState({
        errorMessage: "当前还没接通平台 gateway，暂时不能创建内部会议室。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    if (!title || !goal || !organizationId || !current.ownerPrincipalId) {
      setState({
        errorMessage: "创建会议室前，请先补全组织 ID、标题和讨论目标。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    setState({
      creating: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await fetch("/api/meeting-rooms/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organizationId,
          operatorPrincipalId: current.ownerPrincipalId,
          title,
          goal,
          participants: participantAgentIds.map((agentId) => ({
            agentId,
          })),
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(resolveErrorMessage(data, "创建内部会议室失败。"));
      }

      const detail = normalizeRoomDetail(data);
      const nextRooms = mergeRooms(app.runtime.meetingRooms?.rooms ?? [], detail.room);

      setState({
        rooms: nextRooms,
        activeRoomId: detail.room.roomId,
        activeRoom: detail,
        creating: false,
        errorMessage: "",
        noticeMessage: `会议室“${detail.room.title}”已创建。`,
        createDraft: {
          ...current.createDraft,
          organizationId,
          title: "",
          goal: "",
          participantAgentIdsText: "",
        },
      });
      render();
      return app.runtime.meetingRooms;
    } catch (error) {
      setState({
        creating: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function sendMessage(content = "") {
    const current = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();
    const roomId = normalizeText(current.activeRoomId);
    const nextContent = normalizeText(content || current.composerText);

    if (current.accessMode !== "platform_gateway") {
      setState({
        errorMessage: "当前还没接通平台 gateway，暂时不能发起会议讨论。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    if (!roomId || !nextContent || !current.ownerPrincipalId) {
      setState({
        errorMessage: "请先选择会议室，再输入这轮讨论内容。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    const optimisticMessage = createOptimisticMessage(roomId, nextContent);
    setState({
      streaming: true,
      errorMessage: "",
      noticeMessage: "",
      composerText: "",
      activeRoom: appendMeetingRoomMessage(current.activeRoom, optimisticMessage),
    });
    render();

    try {
      const response = await fetch("/api/meeting-rooms/message/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomId,
          content: nextContent,
          operatorPrincipalId: current.ownerPrincipalId,
        }),
      });

      if (!response.ok) {
        const data = await app.utils.safeReadJson(response);
        throw new Error(resolveErrorMessage(data, "发起会议轮次失败。"));
      }

      await consumeMeetingRoomStream(response, {
        roomId,
        optimisticMessageId: optimisticMessage.messageId,
      });

      try {
        await openRoom(roomId, { quiet: true });
      } catch {
        // Best effort refresh. Keep optimistic messages when detail sync is unavailable.
      }

      setState({
        streaming: false,
        noticeMessage: "本轮会议讨论已同步完成。",
      });
      render();
      return app.runtime.meetingRooms;
    } catch (error) {
      setState({
        streaming: false,
        composerText: nextContent,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function consumeMeetingRoomStream(response, context) {
    const body = response.body;

    if (body?.getReader) {
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

          applyStreamEvent(JSON.parse(trimmed), context);
        }
      }

      const trailing = buffer.trim();

      if (trailing) {
        applyStreamEvent(JSON.parse(trailing), context);
      }

      return;
    }

    const text = await response.text();
    const lines = text.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      applyStreamEvent(JSON.parse(trimmed), context);
    }
  }

  function applyStreamEvent(event, context) {
    const current = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();
    const activeRoom = current.activeRoom;

    if (!activeRoom || activeRoom.room?.roomId !== context.roomId) {
      return;
    }

    if (event?.event === "room.message.created") {
      setState({
        activeRoom: updateMeetingRoomMessage(activeRoom, context.optimisticMessageId, {
          messageId: normalizeText(event.messageId) || context.optimisticMessageId,
          roundId: normalizeText(event.roundId),
        }),
      });
      render();
      return;
    }

    if (event?.event === "room.agent.reply") {
      setState({
        activeRoom: appendMeetingRoomMessage(activeRoom, {
          messageId: normalizeText(event.messageId) || `reply-${Date.now()}`,
          roomId: context.roomId,
          roundId: normalizeText(event.roundId),
          speakerType: "managed_agent",
          speakerAgentId: normalizeText(event.participantAgentId),
          audience: "all_participants",
          content: `${normalizeText(event.participantAgentId) || "数字员工"} 已完成本轮回复，正在同步详情。`,
          messageKind: "status",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      });
      render();
      return;
    }

    if (event?.event === "room.agent.failed") {
      setState({
        activeRoom: appendMeetingRoomMessage(activeRoom, {
          messageId: `failure-${Date.now()}`,
          roomId: context.roomId,
          roundId: normalizeText(event.roundId),
          speakerType: "system",
          audience: "all_participants",
          content: `${normalizeText(event.participantAgentId) || "数字员工"} 回复失败：${normalizeText(event.failureMessage) || "未知错误"}`,
          messageKind: "error",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      });
      render();
    }
  }

  return {
    bindControls,
    loadStatus,
    loadRooms,
    openRoom,
    createRoom,
    sendMessage,
  };
}

function createOptimisticMessage(roomId, content) {
  const now = new Date().toISOString();

  return {
    messageId: `meeting-room-message-${Date.now()}`,
    roomId,
    speakerType: "themis",
    audience: "all_participants",
    content,
    messageKind: "message",
    createdAt: now,
    updatedAt: now,
  };
}

function appendMeetingRoomMessage(activeRoom, message) {
  if (!activeRoom) {
    return activeRoom;
  }

  const nextMessages = Array.isArray(activeRoom.messages) ? [...activeRoom.messages] : [];
  nextMessages.push(message);

  return {
    ...activeRoom,
    messages: nextMessages,
  };
}

function updateMeetingRoomMessage(activeRoom, messageId, patch) {
  if (!activeRoom) {
    return activeRoom;
  }

  return {
    ...activeRoom,
    messages: (Array.isArray(activeRoom.messages) ? activeRoom.messages : []).map((message) => (
      message.messageId === messageId
        ? { ...message, ...patch }
        : message
    )),
  };
}

function parseParticipantAgentIds(value) {
  return Array.from(new Set(
    String(value ?? "")
      .split(/[\n,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

function normalizeRooms(value) {
  return Array.isArray(value)
    ? value
      .map((room) => normalizeRoomRecord(room))
      .filter((room) => room.roomId)
    : [];
}

function normalizeRoomDetail(value) {
  return {
    room: normalizeRoomRecord(value?.room),
    participants: Array.isArray(value?.participants)
      ? value.participants.filter((participant) => normalizeText(participant?.participantId))
      : [],
    messages: Array.isArray(value?.messages)
      ? value.messages.filter((message) => normalizeText(message?.messageId))
      : [],
    rounds: Array.isArray(value?.rounds)
      ? value.rounds.filter((round) => normalizeText(round?.roundId))
      : [],
    resolutions: Array.isArray(value?.resolutions) ? value.resolutions : [],
    artifactRefs: Array.isArray(value?.artifactRefs) ? value.artifactRefs : [],
  };
}

function normalizeRoomRecord(value) {
  return {
    ...value,
    roomId: normalizeText(value?.roomId),
    organizationId: normalizeText(value?.organizationId),
    title: normalizeText(value?.title),
    goal: normalizeText(value?.goal),
    status: ROOM_STATUSES.has(value?.status) ? value.status : "open",
  };
}

function mergeRooms(rooms, incomingRoom) {
  const nextRooms = normalizeRooms(rooms).filter((room) => room.roomId !== incomingRoom.roomId);
  nextRooms.unshift(incomingRoom);
  return nextRooms;
}

function normalizeAccessMode(value) {
  return value === "platform_gateway" ? "platform_gateway" : "gateway_required";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveErrorMessage(payload, fallback) {
  if (payload && typeof payload === "object" && payload.error && typeof payload.error === "object") {
    const message = payload.error.message;

    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  return fallback;
}
