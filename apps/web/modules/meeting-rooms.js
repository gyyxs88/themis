const ROOM_STATUSES = new Set(["open", "closing", "closed"]);
const DISCUSSION_MODES = new Set(["moderated", "collaborative"]);
const ENTRY_MODES = new Set(["blank", "active_work_context", "selected_context"]);
const ARTIFACT_REF_TYPES = new Set([
  "work_item",
  "handoff",
  "managed_agent_timeline",
  "conversation_summary",
  "document",
]);

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
    creatingResolution: false,
    promotingResolutionId: "",
    closingRoom: false,
    errorMessage: "",
    noticeMessage: "",
    rooms: [],
    activeRoomId: "",
    activeRoom: null,
    createDraft: {
      organizationId: "",
      title: "",
      goal: "",
      discussionMode: "moderated",
      participantSpecsText: "",
    },
    addParticipantsText: "",
    selectedTargetParticipantIds: [],
    selectedResolutionSourceMessageIds: [],
    resolutionDraft: {
      title: "",
      summary: "",
    },
    resolutionPromotionTargetAgentIds: {},
    closingSummaryText: "",
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

    dom?.meetingRoomsCreateDiscussionModeSelect?.addEventListener("change", () => {
      updateCreateDraft({
        discussionMode: normalizeDiscussionMode(dom.meetingRoomsCreateDiscussionModeSelect.value),
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
        participantSpecsText: dom.meetingRoomsCreateParticipantsInput.value,
      });
      utils.autoResizeTextarea?.(dom.meetingRoomsCreateParticipantsInput);
    });

    dom?.meetingRoomsCreateButton?.addEventListener("click", () => {
      void runSafely(createRoom);
    });

    dom?.meetingRoomsAddParticipantsInput?.addEventListener("input", () => {
      setState({
        addParticipantsText: dom.meetingRoomsAddParticipantsInput.value,
        noticeMessage: "",
      });
      utils.autoResizeTextarea?.(dom.meetingRoomsAddParticipantsInput);
      render();
    });

    dom?.meetingRoomsAddParticipantsButton?.addEventListener("click", () => {
      void runSafely(addParticipants);
    });

    dom?.meetingRoomsList?.addEventListener("click", (event) => {
      const roomButton = event.target.closest?.("[data-meeting-room-id]");
      const roomId = normalizeText(roomButton?.dataset?.meetingRoomId);

      if (!roomId) {
        return;
      }

      void runSafely(() => openRoom(roomId));
    });

    dom?.meetingRoomsActiveMessages?.addEventListener("change", (event) => {
      const input = event.target.closest?.("[data-meeting-room-resolution-source-message-id]");
      const messageId = normalizeText(input?.dataset?.meetingRoomResolutionSourceMessageId);

      if (!messageId) {
        return;
      }

      toggleResolutionSourceMessage(messageId, Boolean(input.checked));
    });

    dom?.meetingRoomsTargetParticipantsList?.addEventListener("change", (event) => {
      const input = event.target.closest?.("[data-meeting-room-target-participant-id]");
      const participantId = normalizeText(input?.dataset?.meetingRoomTargetParticipantId);

      if (!participantId) {
        return;
      }

      toggleTargetParticipant(participantId, Boolean(input.checked));
    });

    dom?.meetingRoomsResolutionTitleInput?.addEventListener("input", () => {
      updateResolutionDraft({
        title: dom.meetingRoomsResolutionTitleInput.value,
      });
    });

    dom?.meetingRoomsResolutionSummaryInput?.addEventListener("input", () => {
      updateResolutionDraft({
        summary: dom.meetingRoomsResolutionSummaryInput.value,
      });
      utils.autoResizeTextarea?.(dom.meetingRoomsResolutionSummaryInput);
    });

    dom?.meetingRoomsCreateResolutionButton?.addEventListener("click", () => {
      void runSafely(createResolution);
    });

    dom?.meetingRoomsResolutionsList?.addEventListener("change", (event) => {
      const select = event.target.closest?.("[data-meeting-room-promote-target-resolution-id]");
      const resolutionId = normalizeText(select?.dataset?.meetingRoomPromoteTargetResolutionId);

      if (!resolutionId) {
        return;
      }

      updateResolutionPromotionTarget(resolutionId, normalizeText(select.value));
    });

    dom?.meetingRoomsResolutionsList?.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-meeting-room-promote-resolution-id]");
      const resolutionId = normalizeText(button?.dataset?.meetingRoomPromoteResolutionId);

      if (!resolutionId) {
        return;
      }

      void runSafely(() => promoteResolution(resolutionId));
    });

    dom?.meetingRoomsCloseSummaryInput?.addEventListener("input", () => {
      setState({
        closingSummaryText: dom.meetingRoomsCloseSummaryInput.value,
        noticeMessage: "",
      });
      utils.autoResizeTextarea?.(dom.meetingRoomsCloseSummaryInput);
      render();
    });

    dom?.meetingRoomsCloseButton?.addEventListener("click", () => {
      void runSafely(closeRoom);
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

  function updateResolutionDraft(patch) {
    const current = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();
    setState({
      resolutionDraft: {
        ...current.resolutionDraft,
        ...patch,
      },
      noticeMessage: "",
    });
    render();
  }

  function toggleTargetParticipant(participantId, checked) {
    const current = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();
    const selected = new Set(
      normalizeSelectedTargetParticipantIds(
        current.selectedTargetParticipantIds,
        listManagedParticipantIds(current.activeRoom),
      ),
    );

    if (checked) {
      selected.add(participantId);
    } else {
      selected.delete(participantId);
    }

    setState({
      selectedTargetParticipantIds: Array.from(selected),
      noticeMessage: "",
    });
    render();
  }

  function toggleResolutionSourceMessage(messageId, checked) {
    const current = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();
    const selected = new Set(
      normalizeSelectedResolutionSourceMessageIds(
        current.selectedResolutionSourceMessageIds,
        current.activeRoom,
      ),
    );

    if (checked) {
      selected.add(messageId);
    } else {
      selected.delete(messageId);
    }

    setState({
      selectedResolutionSourceMessageIds: Array.from(selected),
      noticeMessage: "",
    });
    render();
  }

  function updateResolutionPromotionTarget(resolutionId, agentId) {
    const current = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();
    setState({
      resolutionPromotionTargetAgentIds: {
        ...(current.resolutionPromotionTargetAgentIds ?? {}),
        [resolutionId]: agentId,
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
      const previousManagedParticipantIds = listManagedParticipantIds(current.activeRoom);
      const nextState = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();

      setState({
        activeRoomId: normalizedRoomId,
        activeRoom: detail,
        loadingDetail: false,
        errorMessage: "",
        addParticipantsText: "",
        closingSummaryText: normalizeText(detail.room?.closingSummary),
        selectedTargetParticipantIds: deriveTargetParticipantSelection(
          detail,
          nextState.selectedTargetParticipantIds,
          previousManagedParticipantIds,
        ),
        selectedResolutionSourceMessageIds: normalizeSelectedResolutionSourceMessageIds(
          nextState.selectedResolutionSourceMessageIds,
          detail,
        ),
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
    const discussionMode = normalizeDiscussionMode(current.createDraft.discussionMode);
    const participants = parseParticipantSpecs(current.createDraft.participantSpecsText);

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
          discussionMode,
          participants: participants.map((participant) => ({
            agentId: participant.agentId,
            entryMode: participant.entryMode,
            ...(participant.selectedArtifactRefs?.length
              ? { selectedArtifactRefs: participant.selectedArtifactRefs }
              : {}),
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
        addParticipantsText: "",
        selectedTargetParticipantIds: listManagedParticipantIds(detail),
        selectedResolutionSourceMessageIds: [],
        resolutionDraft: {
          title: "",
          summary: "",
        },
        closingSummaryText: normalizeText(detail.room?.closingSummary),
        createDraft: {
          ...current.createDraft,
          organizationId,
          title: "",
          goal: "",
          participantSpecsText: "",
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

  async function addParticipants() {
    const current = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();
    const roomId = normalizeText(current.activeRoomId);
    const participants = parseParticipantSpecs(current.addParticipantsText);
    const previousManagedParticipantIds = listManagedParticipantIds(current.activeRoom);

    if (current.accessMode !== "platform_gateway") {
      setState({
        errorMessage: "当前还没接通平台 gateway，暂时不能动态拉员工进场。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    if (!roomId || participants.length === 0) {
      setState({
        errorMessage: "请先选择会议室，并输入至少一个待加入员工。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    setState({
      streaming: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await fetch("/api/meeting-rooms/participants/add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomId,
          participants: participants.map((participant) => ({
            agentId: participant.agentId,
            entryMode: participant.entryMode,
            ...(participant.selectedArtifactRefs?.length
              ? { selectedArtifactRefs: participant.selectedArtifactRefs }
              : {}),
          })),
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(resolveErrorMessage(data, "补充会议室参与者失败。"));
      }

      const detail = normalizeRoomDetail(data);
      setState({
        activeRoom: detail,
        rooms: mergeRooms(app.runtime.meetingRooms?.rooms ?? [], detail.room),
        streaming: false,
        addParticipantsText: "",
        noticeMessage: "新参与者已加入当前会议室。",
        selectedTargetParticipantIds: deriveTargetParticipantSelection(
          detail,
          current.selectedTargetParticipantIds,
          previousManagedParticipantIds,
        ),
        selectedResolutionSourceMessageIds: normalizeSelectedResolutionSourceMessageIds(
          current.selectedResolutionSourceMessageIds,
          detail,
        ),
      });
      render();
      return app.runtime.meetingRooms;
    } catch (error) {
      setState({
        streaming: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function createResolution() {
    const current = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();
    const roomId = normalizeText(current.activeRoomId);
    const activeRoom = current.activeRoom?.room?.roomId === roomId ? current.activeRoom : null;
    const title = normalizeText(current.resolutionDraft?.title);
    const summary = normalizeText(current.resolutionDraft?.summary);
    const sourceMessageIds = normalizeSelectedResolutionSourceMessageIds(
      current.selectedResolutionSourceMessageIds,
      activeRoom,
    );

    if (current.accessMode !== "platform_gateway") {
      setState({
        errorMessage: "当前还没接通平台 gateway，暂时不能沉淀会议结论。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    if (!roomId || !title || !summary || sourceMessageIds.length === 0) {
      setState({
        errorMessage: "请先选择至少一条会议消息，并补全结论标题与摘要。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    if (normalizeText(activeRoom?.room?.status) === "closed") {
      setState({
        errorMessage: "当前会议室已关闭，只能回看，不能再新增会议结论。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    setState({
      creatingResolution: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await fetch("/api/meeting-rooms/resolutions/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomId,
          sourceMessageIds,
          title,
          summary,
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(resolveErrorMessage(data, "创建会议结论失败。"));
      }

      const detail = normalizeRoomDetail(data);
      setState({
        activeRoom: detail,
        rooms: mergeRooms(app.runtime.meetingRooms?.rooms ?? [], detail.room),
        creatingResolution: false,
        errorMessage: "",
        noticeMessage: `会议结论“${title}”已沉淀。`,
        selectedResolutionSourceMessageIds: [],
        resolutionDraft: {
          title: "",
          summary: "",
        },
      });
      render();
      return app.runtime.meetingRooms;
    } catch (error) {
      setState({
        creatingResolution: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function promoteResolution(resolutionId) {
    const current = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();
    const roomId = normalizeText(current.activeRoomId);
    const activeRoom = current.activeRoom?.room?.roomId === roomId ? current.activeRoom : null;
    const normalizedResolutionId = normalizeText(resolutionId);
    const targetAgentId = resolveMeetingRoomPromoteTargetAgentId(
      activeRoom,
      current.resolutionPromotionTargetAgentIds,
      normalizedResolutionId,
    );

    if (current.accessMode !== "platform_gateway") {
      setState({
        errorMessage: "当前还没接通平台 gateway，暂时不能提升会议结论。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    if (!roomId || !normalizedResolutionId || !targetAgentId) {
      setState({
        errorMessage: "请先选择要提升的会议结论和目标员工。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    if (normalizeText(activeRoom?.room?.status) === "closed") {
      setState({
        errorMessage: "当前会议室已关闭，只能回看，不能再提升会议结论。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    setState({
      promotingResolutionId: normalizedResolutionId,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await fetch("/api/meeting-rooms/resolutions/promote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomId,
          resolutionId: normalizedResolutionId,
          targetAgentId,
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(resolveErrorMessage(data, "提升会议结论失败。"));
      }

      const detail = normalizeRoomDetail(data);
      setState({
        activeRoom: detail,
        rooms: mergeRooms(app.runtime.meetingRooms?.rooms ?? [], detail.room),
        promotingResolutionId: "",
        errorMessage: "",
        noticeMessage: "会议结论已提升为正式 work item。",
      });
      render();
      return app.runtime.meetingRooms;
    } catch (error) {
      setState({
        promotingResolutionId: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function closeRoom() {
    const current = app.runtime.meetingRooms ?? createDefaultMeetingRoomsState();
    const roomId = normalizeText(current.activeRoomId);
    const closingSummary = normalizeText(current.closingSummaryText);
    const activeRoom = current.activeRoom?.room?.roomId === roomId ? current.activeRoom : null;

    if (current.accessMode !== "platform_gateway") {
      setState({
        errorMessage: "当前还没接通平台 gateway，暂时不能关闭会议室。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    if (!roomId || !closingSummary) {
      setState({
        errorMessage: "关闭会议室前，请先填写本次会议的收口说明。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    if (normalizeText(activeRoom?.room?.status) === "closed") {
      setState({
        errorMessage: "当前会议室已经关闭，无需重复收口。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    setState({
      closingRoom: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await fetch("/api/meeting-rooms/close", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomId,
          closingSummary,
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(resolveErrorMessage(data, "关闭会议室失败。"));
      }

      const detail = normalizeRoomDetail(data);
      setState({
        activeRoom: detail,
        rooms: mergeRooms(app.runtime.meetingRooms?.rooms ?? [], detail.room),
        closingRoom: false,
        errorMessage: "",
        noticeMessage: `会议室“${detail.room.title}”已关闭。`,
        closingSummaryText: normalizeText(detail.room?.closingSummary),
      });
      render();
      return app.runtime.meetingRooms;
    } catch (error) {
      setState({
        closingRoom: false,
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
    const activeRoom = current.activeRoom?.room?.roomId === roomId ? current.activeRoom : null;
    const managedParticipantIds = listManagedParticipantIds(activeRoom);
    const selectedTargetParticipantIds = normalizeSelectedTargetParticipantIds(
      current.selectedTargetParticipantIds,
      managedParticipantIds,
    );

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

    if (normalizeText(activeRoom?.room?.status) === "closed") {
      setState({
        errorMessage: "当前会议室已关闭，只能回看，不能继续发起讨论。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    if (managedParticipantIds.length === 0) {
      setState({
        errorMessage: "当前会议室还没有数字员工，请先拉员工进场。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    if (selectedTargetParticipantIds.length === 0) {
      setState({
        errorMessage: "请至少选择一位本轮发言对象。",
        noticeMessage: "",
      });
      render();
      return current;
    }

    const targetingSubset = selectedTargetParticipantIds.length < managedParticipantIds.length;
    const optimisticMessage = createOptimisticMessage(roomId, nextContent, {
      audience: targetingSubset ? "selected_participants" : "all_participants",
      visibleParticipantIds: targetingSubset ? selectedTargetParticipantIds : [],
    });
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
          ...(targetingSubset
            ? {
                audience: "selected_participants",
                targetParticipantIds: selectedTargetParticipantIds,
              }
            : {}),
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

    if (event?.event === "room.round.queued") {
      setState({
        noticeMessage: "当前房间已有进行中的轮次，这条发言已进入队列。",
        activeRoom: appendMeetingRoomMessage(activeRoom, {
          messageId: `queued-${Date.now()}`,
          roomId: context.roomId,
          roundId: normalizeText(event.roundId),
          speakerType: "system",
          audience: "all_participants",
          content: "本轮讨论已进入队列，等待上一轮收口后自动开始。",
          messageKind: "status",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      });
      render();
      return;
    }

    if (event?.event === "room.round.started") {
      setState({
        activeRoom: appendMeetingRoomMessage(activeRoom, {
          messageId: `started-${Date.now()}`,
          roomId: context.roomId,
          roundId: normalizeText(event.roundId),
          speakerType: "system",
          audience: "all_participants",
          content: `${normalizeText(event.participantAgentId) || "数字员工"} 已开始处理本轮发言。`,
          messageKind: "status",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
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
          audience: normalizeMeetingMessageAudience(event.audience),
          content: normalizeText(event.content) || `${normalizeText(event.participantAgentId) || "数字员工"} 已完成本轮回复。`,
          messageKind: "message",
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
          audience: "themis_only",
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
    addParticipants,
    createResolution,
    promoteResolution,
    closeRoom,
    sendMessage,
  };
}

function createOptimisticMessage(roomId, content, options = {}) {
  const now = new Date().toISOString();

  return {
    messageId: `meeting-room-message-${Date.now()}`,
    roomId,
    speakerType: "themis",
    audience: options.audience ?? "all_participants",
    ...(Array.isArray(options.visibleParticipantIds) && options.visibleParticipantIds.length > 0
      ? { visibleParticipantIds: options.visibleParticipantIds }
      : {}),
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

function parseParticipantSpecs(value) {
  const participants = [];
  const seen = new Set();

  for (const token of String(value ?? "")
    .split(/[\n,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)) {
    const [agentIdRaw, entryModeRaw, ...entryContextChunks] = token.split(":");
    const agentId = normalizeText(agentIdRaw);
    const entryMode = normalizeEntryMode(entryModeRaw);
    const selectedArtifactRefs = parseSelectedArtifactRefs(entryContextChunks.join(":"), entryMode);

    if (!agentId || seen.has(agentId)) {
      continue;
    }

    seen.add(agentId);
    participants.push({
      agentId,
      entryMode,
      ...(selectedArtifactRefs.length > 0 ? { selectedArtifactRefs } : {}),
    });
  }

  return participants;
}

function parseSelectedArtifactRefs(value, entryMode) {
  if (entryMode !== "selected_context") {
    return [];
  }

  return String(value ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [refTypeRaw, ...refIdParts] = item.split("=");
      const refType = normalizeArtifactRefType(refTypeRaw);
      const refId = normalizeText(refIdParts.join("="));

      return refType && refId
        ? { refType, refId }
        : null;
    })
    .filter(Boolean);
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
    discussionMode: normalizeDiscussionMode(value?.discussionMode),
  };
}

function normalizeMeetingMessageAudience(value) {
  return value === "themis_only" || value === "selected_participants"
    ? value
    : "all_participants";
}

function normalizeArtifactRefType(value) {
  const normalized = normalizeText(value).toLowerCase();
  return ARTIFACT_REF_TYPES.has(normalized) ? normalized : "";
}

function mergeRooms(rooms, incomingRoom) {
  const nextRooms = normalizeRooms(rooms).filter((room) => room.roomId !== incomingRoom.roomId);
  nextRooms.unshift(incomingRoom);
  return nextRooms;
}

function listManagedParticipantIds(activeRoom) {
  return Array.isArray(activeRoom?.participants)
    ? activeRoom.participants
      .filter((participant) => participant?.participantKind === "managed_agent" && !participant?.leftAt)
      .map((participant) => normalizeText(participant?.participantId))
      .filter(Boolean)
    : [];
}

function listManagedParticipants(activeRoom) {
  return Array.isArray(activeRoom?.participants)
    ? activeRoom.participants.filter((participant) => participant?.participantKind === "managed_agent" && !participant?.leftAt)
    : [];
}

function normalizeSelectedTargetParticipantIds(selectedTargetParticipantIds, validParticipantIds) {
  const validSet = new Set(validParticipantIds);
  return Array.from(new Set(
    Array.isArray(selectedTargetParticipantIds)
      ? selectedTargetParticipantIds
        .map((value) => normalizeText(value))
        .filter((value) => validSet.has(value))
      : [],
  ));
}

function listResolvableMessageIds(activeRoom) {
  return Array.isArray(activeRoom?.messages)
    ? activeRoom.messages
      .filter((message) => isResolvableMeetingRoomMessage(message))
      .map((message) => normalizeText(message?.messageId))
      .filter(Boolean)
    : [];
}

function normalizeSelectedResolutionSourceMessageIds(selectedMessageIds, activeRoom) {
  const validSet = new Set(listResolvableMessageIds(activeRoom));
  return Array.from(new Set(
    Array.isArray(selectedMessageIds)
      ? selectedMessageIds
        .map((value) => normalizeText(value))
        .filter((value) => validSet.has(value))
      : [],
  ));
}

function isResolvableMeetingRoomMessage(message) {
  const messageId = normalizeText(message?.messageId);
  if (!messageId) {
    return false;
  }

  const messageKind = normalizeText(message?.messageKind);
  const speakerType = normalizeText(message?.speakerType);

  if (messageKind === "status") {
    return false;
  }

  return speakerType === "themis" || speakerType === "managed_agent";
}

function deriveTargetParticipantSelection(detail, previousSelectedTargetParticipantIds = [], previousManagedParticipantIds = []) {
  const nextManagedParticipantIds = listManagedParticipantIds(detail);

  if (nextManagedParticipantIds.length === 0) {
    return [];
  }

  const previousValidSelection = normalizeSelectedTargetParticipantIds(
    previousSelectedTargetParticipantIds,
    previousManagedParticipantIds,
  );
  const preserved = normalizeSelectedTargetParticipantIds(
    previousSelectedTargetParticipantIds,
    nextManagedParticipantIds,
  );
  const previousAllSelected = previousManagedParticipantIds.length > 0
    && previousValidSelection.length >= previousManagedParticipantIds.length;

  if (previousAllSelected || previousSelectedTargetParticipantIds.length === 0) {
    return nextManagedParticipantIds;
  }

  return preserved.length > 0 ? preserved : nextManagedParticipantIds;
}

function resolveMeetingRoomPromoteTargetAgentId(activeRoom, targetAgentIds, resolutionId) {
  const participants = listManagedParticipants(activeRoom);
  const validAgentIds = participants
    .map((participant) => normalizeText(participant?.agentId))
    .filter(Boolean);
  const configuredAgentId = normalizeText(targetAgentIds?.[resolutionId]);

  if (validAgentIds.includes(configuredAgentId)) {
    return configuredAgentId;
  }

  return validAgentIds[0] ?? "";
}

function normalizeAccessMode(value) {
  return value === "platform_gateway" ? "platform_gateway" : "gateway_required";
}

function normalizeDiscussionMode(value) {
  return DISCUSSION_MODES.has(value) ? value : "moderated";
}

function normalizeEntryMode(value) {
  return ENTRY_MODES.has(value) ? value : "blank";
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
