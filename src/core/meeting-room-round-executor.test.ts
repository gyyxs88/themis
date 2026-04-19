import assert from "node:assert/strict";
import test from "node:test";
import type {
  ManagedAgentPlatformMeetingRoomDetailResult,
  ManagedAgentPlatformMeetingRoomMessageCreateResult,
} from "../contracts/managed-agent-platform-meetings.js";
import type { TaskRequest, TaskResult } from "../types/task.js";
import type { AppServerTaskRuntime } from "./app-server-task-runtime.js";
import { MeetingRoomRoundExecutor } from "./meeting-room-round-executor.js";
import type { PlatformMeetingRoomGateway } from "./platform-meeting-room-gateway.js";

test("MeetingRoomRoundExecutor 会按房间串行 drain queued round", async () => {
  const delays: string[] = [];
  const eventsByRound = new Map<string, string[]>();
  const runtimeContexts: Array<Record<string, unknown>> = [];
  const detailState: ManagedAgentPlatformMeetingRoomDetailResult = {
    room: {
      roomId: "room-1",
      ownerPrincipalId: "principal-owner",
      organizationId: "org-1",
      title: "发布阻塞讨论",
      goal: "确认 prod 发布失败根因",
      status: "open",
      discussionMode: "moderated",
      createdByOperatorPrincipalId: "principal-owner",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    },
    participants: [{
      participantId: "participant-themis",
      roomId: "room-1",
      participantKind: "themis",
      principalId: "principal-owner",
      displayName: "Themis",
      roomRole: "host",
      entryMode: "blank",
      joinedAt: "2026-04-18T10:00:00.000Z",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    }, {
      participantId: "participant-agent",
      roomId: "room-1",
      participantKind: "managed_agent",
      principalId: "principal-agent",
      agentId: "agent-1",
      displayName: "后端·衡",
      roomRole: "participant",
      entryMode: "blank",
      roomSessionId: "meeting-room:room-1:participant:agent-1",
      joinedAt: "2026-04-18T10:00:00.000Z",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    }],
    rounds: [{
      roundId: "round-1",
      roomId: "room-1",
      triggerMessageId: "message-1",
      status: "running",
      targetParticipantIds: ["participant-agent"],
      respondedParticipantIds: [],
      startedAt: "2026-04-18T10:01:00.000Z",
      createdAt: "2026-04-18T10:01:00.000Z",
      updatedAt: "2026-04-18T10:01:00.000Z",
    }, {
      roundId: "round-2",
      roomId: "room-1",
      triggerMessageId: "message-2",
      status: "queued",
      targetParticipantIds: ["participant-agent"],
      respondedParticipantIds: [],
      createdAt: "2026-04-18T10:01:01.000Z",
      updatedAt: "2026-04-18T10:01:01.000Z",
    }],
    messages: [{
      messageId: "message-1",
      roomId: "room-1",
      speakerType: "themis",
      audience: "all_participants",
      content: "先给出第一轮判断。",
      messageKind: "message",
      createdAt: "2026-04-18T10:01:00.000Z",
      updatedAt: "2026-04-18T10:01:00.000Z",
    }, {
      messageId: "message-2",
      roomId: "room-1",
      speakerType: "themis",
      audience: "all_participants",
      content: "第二轮再给出收敛建议。",
      messageKind: "message",
      createdAt: "2026-04-18T10:01:01.000Z",
      updatedAt: "2026-04-18T10:01:01.000Z",
    }],
    resolutions: [],
    artifactRefs: [],
  };

  const fakeGateway = {
    async getRoomDetail() {
      return structuredClone(detailState);
    },
    async appendAgentReply(input: { roundId: string; content: string }) {
      detailState.messages.push({
        messageId: `reply-${input.roundId}`,
        roomId: "room-1",
        roundId: input.roundId,
        speakerType: "managed_agent",
        speakerAgentId: "agent-1",
        audience: "all_participants",
        content: input.content,
        messageKind: "message",
        createdAt: "2026-04-18T10:01:03.000Z",
        updatedAt: "2026-04-18T10:01:03.000Z",
      });
      const round = detailState.rounds.find((item) => item.roundId === input.roundId);
      if (!round) {
        throw new Error(`Round ${input.roundId} missing.`);
      }
      round.status = "completed";
      round.respondedParticipantIds = ["participant-agent"];
      round.completedAt = "2026-04-18T10:01:03.000Z";
      round.updatedAt = "2026-04-18T10:01:03.000Z";
      if (input.roundId === "round-1") {
        const queued = detailState.rounds.find((item) => item.roundId === "round-2");
        if (queued) {
          queued.status = "running";
          queued.startedAt = "2026-04-18T10:01:04.000Z";
          queued.updatedAt = "2026-04-18T10:01:04.000Z";
        }
      }
      return {
        room: structuredClone(detailState.room),
        round: structuredClone(round),
        message: structuredClone(detailState.messages[detailState.messages.length - 1]),
      };
    },
    async appendAgentFailure() {
      throw new Error("本测试不应进入失败分支。");
    },
  } as Pick<PlatformMeetingRoomGateway, "getRoomDetail" | "appendAgentReply" | "appendAgentFailure">;

  const fakeRuntime: Pick<AppServerTaskRuntime, "runTaskAsPrincipal"> = {
    async runTaskAsPrincipal(
      request: TaskRequest,
      context: {
        principalId: string;
        principalKind?: string;
        principalDisplayName?: string;
        principalOrganizationId?: string;
      },
    ): Promise<TaskResult> {
      runtimeContexts.push({
        principalId: context.principalId,
        principalKind: context.principalKind,
        principalDisplayName: context.principalDisplayName,
        principalOrganizationId: context.principalOrganizationId,
      });
      if (String(request.inputText ?? "").includes("Themis 刚才的问题：先给出第一轮判断。")) {
        delays.push("round-1-start");
        await new Promise((resolve) => setTimeout(resolve, 30));
        delays.push("round-1-end");
        return {
          taskId: "task-round-1",
          requestId: request.requestId,
          status: "completed",
          output: "第一轮判断：migration 超时。",
          summary: "第一轮判断：migration 超时。",
          completedAt: "2026-04-18T10:01:03.000Z",
        };
      }
      delays.push("round-2-run");
      return {
        taskId: "task-round-2",
        requestId: request.requestId,
        status: "completed",
        output: "第二轮建议：先补重试再重新发版。",
        summary: "第二轮建议：先补重试再重新发版。",
        completedAt: "2026-04-18T10:01:06.000Z",
      };
    },
  };

  const executor = new MeetingRoomRoundExecutor();
  const firstStarted: ManagedAgentPlatformMeetingRoomMessageCreateResult = {
    room: structuredClone(detailState.room),
    message: structuredClone(detailState.messages[0]!),
    round: structuredClone(detailState.rounds[0]!),
    targetParticipants: [structuredClone(detailState.participants[1]!)],
  };
  const secondStarted: ManagedAgentPlatformMeetingRoomMessageCreateResult = {
    room: structuredClone(detailState.room),
    message: structuredClone(detailState.messages[1]!),
    round: structuredClone(detailState.rounds[1]!),
    targetParticipants: [structuredClone(detailState.participants[1]!)],
  };

  await Promise.all([
    executor.enqueue({
      gateway: fakeGateway,
      runtime: fakeRuntime,
      started: firstStarted,
      onEvent(event) {
        const events = eventsByRound.get("round-1") ?? [];
        events.push(event.event);
        eventsByRound.set("round-1", events);
      },
    }),
    executor.enqueue({
      gateway: fakeGateway,
      runtime: fakeRuntime,
      started: secondStarted,
      onEvent(event) {
        const events = eventsByRound.get("round-2") ?? [];
        events.push(event.event);
        eventsByRound.set("round-2", events);
      },
    }),
  ]);

  assert.deepEqual(delays, ["round-1-start", "round-1-end", "round-2-run"]);
  assert.deepEqual(eventsByRound.get("round-1"), [
    "room.round.started",
    "room.agent.reply",
    "room.round.completed",
  ]);
  assert.deepEqual(eventsByRound.get("round-2"), [
    "room.round.queued",
    "room.round.started",
    "room.agent.reply",
    "room.round.completed",
  ]);
  assert.deepEqual(runtimeContexts, [
    {
      principalId: "principal-agent",
      principalKind: "managed_agent",
      principalDisplayName: "后端·衡",
      principalOrganizationId: "org-1",
    },
    {
      principalId: "principal-agent",
      principalKind: "managed_agent",
      principalDisplayName: "后端·衡",
      principalOrganizationId: "org-1",
    },
  ]);
});

test("MeetingRoomRoundExecutor 会在平台终止后停止执行排队轮次", async () => {
  const events: string[] = [];
  let detailCalls = 0;
  let runtimeCalls = 0;
  const queuedDetail: ManagedAgentPlatformMeetingRoomDetailResult = {
    room: {
      roomId: "room-terminated",
      ownerPrincipalId: "principal-owner",
      organizationId: "org-1",
      title: "异常循环止损",
      goal: "确认是否需要终止讨论",
      status: "open",
      discussionMode: "moderated",
      createdByOperatorPrincipalId: "principal-owner",
      createdAt: "2026-04-19T10:00:00.000Z",
      updatedAt: "2026-04-19T10:00:00.000Z",
    },
    participants: [{
      participantId: "participant-agent",
      roomId: "room-terminated",
      participantKind: "managed_agent",
      principalId: "principal-agent",
      agentId: "agent-1",
      displayName: "后端·衡",
      roomRole: "participant",
      entryMode: "blank",
      joinedAt: "2026-04-19T10:00:00.000Z",
      createdAt: "2026-04-19T10:00:00.000Z",
      updatedAt: "2026-04-19T10:00:00.000Z",
    }],
    rounds: [{
      roundId: "round-terminated",
      roomId: "room-terminated",
      triggerMessageId: "message-terminated",
      status: "queued",
      targetParticipantIds: ["participant-agent"],
      respondedParticipantIds: [],
      createdAt: "2026-04-19T10:00:00.000Z",
      updatedAt: "2026-04-19T10:00:00.000Z",
    }],
    messages: [{
      messageId: "message-terminated",
      roomId: "room-terminated",
      speakerType: "themis",
      audience: "all_participants",
      content: "请先给出是否需要继续讨论的判断。",
      messageKind: "message",
      createdAt: "2026-04-19T10:00:00.000Z",
      updatedAt: "2026-04-19T10:00:00.000Z",
    }],
    resolutions: [],
    artifactRefs: [],
  };

  const terminatedDetail: ManagedAgentPlatformMeetingRoomDetailResult = {
    ...structuredClone(queuedDetail),
    room: {
      ...structuredClone(queuedDetail.room),
      status: "terminated",
      terminatedAt: "2026-04-19T10:00:05.000Z",
      terminatedByOperatorPrincipalId: "principal-owner",
      terminationReason: "平台值班判断当前会议进入异常循环。",
      updatedAt: "2026-04-19T10:00:05.000Z",
    },
    rounds: [{
      ...structuredClone(queuedDetail.rounds[0]!),
      status: "failed",
      completedAt: "2026-04-19T10:00:05.000Z",
      failureMessage: "平台已终止会议：平台值班判断当前会议进入异常循环。",
      updatedAt: "2026-04-19T10:00:05.000Z",
    }],
  };

  const fakeGateway = {
    async getRoomDetail() {
      detailCalls += 1;
      return detailCalls === 1 ? structuredClone(queuedDetail) : structuredClone(terminatedDetail);
    },
    async appendAgentReply() {
      throw new Error("终止后不应继续写回复。");
    },
    async appendAgentFailure() {
      throw new Error("终止后不应继续写失败回执。");
    },
  } as Pick<PlatformMeetingRoomGateway, "getRoomDetail" | "appendAgentReply" | "appendAgentFailure">;

  const fakeRuntime: Pick<AppServerTaskRuntime, "runTaskAsPrincipal"> = {
    async runTaskAsPrincipal(): Promise<TaskResult> {
      runtimeCalls += 1;
      throw new Error("终止后不应继续调 runtime。");
    },
  };

  const executor = new MeetingRoomRoundExecutor();
  await executor.enqueue({
    gateway: fakeGateway,
    runtime: fakeRuntime,
    started: {
      room: structuredClone(queuedDetail.room),
      message: structuredClone(queuedDetail.messages[0]!),
      round: structuredClone(queuedDetail.rounds[0]!),
      targetParticipants: [structuredClone(queuedDetail.participants[0]!)],
    },
    onEvent(event) {
      events.push(event.event);
    },
  });

  assert.equal(runtimeCalls, 0);
  assert.deepEqual(events, ["room.round.queued"]);
});

test("MeetingRoomRoundExecutor 会在平台终止导致回写失败时优雅结束", async () => {
  const events: Array<{ event: string; failureMessage: string | undefined }> = [];
  const detail: ManagedAgentPlatformMeetingRoomDetailResult = {
    room: {
      roomId: "room-append-failure",
      ownerPrincipalId: "principal-owner",
      organizationId: "org-1",
      title: "终止中的讨论",
      goal: "验证回写失败时不炸流",
      status: "open",
      discussionMode: "moderated",
      createdByOperatorPrincipalId: "principal-owner",
      createdAt: "2026-04-19T10:00:00.000Z",
      updatedAt: "2026-04-19T10:00:00.000Z",
    },
    participants: [{
      participantId: "participant-agent",
      roomId: "room-append-failure",
      participantKind: "managed_agent",
      principalId: "principal-agent",
      agentId: "agent-1",
      displayName: "后端·衡",
      roomRole: "participant",
      entryMode: "blank",
      joinedAt: "2026-04-19T10:00:00.000Z",
      createdAt: "2026-04-19T10:00:00.000Z",
      updatedAt: "2026-04-19T10:00:00.000Z",
    }],
    rounds: [{
      roundId: "round-append-failure",
      roomId: "room-append-failure",
      triggerMessageId: "message-append-failure",
      status: "running",
      targetParticipantIds: ["participant-agent"],
      respondedParticipantIds: [],
      startedAt: "2026-04-19T10:00:00.000Z",
      createdAt: "2026-04-19T10:00:00.000Z",
      updatedAt: "2026-04-19T10:00:00.000Z",
    }],
    messages: [{
      messageId: "message-append-failure",
      roomId: "room-append-failure",
      speakerType: "themis",
      audience: "all_participants",
      content: "请给出你的判断。",
      messageKind: "message",
      createdAt: "2026-04-19T10:00:00.000Z",
      updatedAt: "2026-04-19T10:00:00.000Z",
    }],
    resolutions: [],
    artifactRefs: [],
  };

  const terminationError = new Error("Meeting room room-append-failure 已被平台终止，不能继续写入数字员工回复。");
  const fakeGateway = {
    async getRoomDetail() {
      return structuredClone(detail);
    },
    async appendAgentReply() {
      throw terminationError;
    },
    async appendAgentFailure() {
      throw new Error("Meeting room room-append-failure 已被平台终止，不能继续写入失败回执。");
    },
  } as Pick<PlatformMeetingRoomGateway, "getRoomDetail" | "appendAgentReply" | "appendAgentFailure">;

  const fakeRuntime: Pick<AppServerTaskRuntime, "runTaskAsPrincipal"> = {
    async runTaskAsPrincipal(request: TaskRequest): Promise<TaskResult> {
      return {
        taskId: "task-append-failure",
        requestId: request.requestId,
        status: "completed",
        output: "已经给出判断。",
        summary: "已经给出判断。",
        completedAt: "2026-04-19T10:00:03.000Z",
      };
    },
  };

  const executor = new MeetingRoomRoundExecutor();
  await executor.enqueue({
    gateway: fakeGateway,
    runtime: fakeRuntime,
    started: {
      room: structuredClone(detail.room),
      message: structuredClone(detail.messages[0]!),
      round: structuredClone(detail.rounds[0]!),
      targetParticipants: [structuredClone(detail.participants[0]!)],
    },
    onEvent(event) {
      events.push({
        event: event.event,
        failureMessage: "failureMessage" in event ? event.failureMessage : undefined,
      });
    },
  });

  assert.deepEqual(events, [{
    event: "room.round.started",
    failureMessage: undefined,
  }, {
    event: "room.agent.failed",
    failureMessage: "Meeting room room-append-failure 已被平台终止，不能继续写入数字员工回复。",
  }]);
});

test("MeetingRoomRoundExecutor 会把入场上下文快照渲染成可读提示词", async () => {
  let capturedInputText = "";
  const detailState: ManagedAgentPlatformMeetingRoomDetailResult = {
    room: {
      roomId: "room-context",
      ownerPrincipalId: "principal-owner",
      organizationId: "org-1",
      title: "发布阻塞讨论",
      goal: "确认 prod 发布失败根因",
      status: "open",
      discussionMode: "moderated",
      createdByOperatorPrincipalId: "principal-owner",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    },
    participants: [{
      participantId: "participant-themis",
      roomId: "room-context",
      participantKind: "themis",
      principalId: "principal-owner",
      displayName: "Themis",
      roomRole: "host",
      entryMode: "blank",
      joinedAt: "2026-04-18T10:00:00.000Z",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    }, {
      participantId: "participant-agent",
      roomId: "room-context",
      participantKind: "managed_agent",
      principalId: "principal-agent",
      agentId: "agent-1",
      displayName: "后端·衡",
      roomRole: "participant",
      entryMode: "active_work_context",
      entryContextSnapshotJson: {
        mode: "active_work_context",
        generatedAt: "2026-04-18T09:59:00.000Z",
        currentWorkItem: {
          workItemId: "work-item-active",
          status: "waiting_human",
          priority: "high",
          goal: "排查 prod 发布失败",
          dispatchReason: "发布阻塞排查",
          waitingFor: "human",
          latestWaitingMessage: "需要 DBA 确认 migration 锁冲突。",
          latestHumanResponse: "先按 migration 锁冲突排查。",
          latestHandoffSummary: "怀疑 migration 锁冲突导致超时。",
          updatedAt: "2026-04-18T09:58:00.000Z",
        },
        latestHandoff: {
          summary: "已定位到 migration 锁等待。",
          blockers: ["需要 DBA 确认阻塞会话"],
          recommendedNextActions: ["拉取 innodb 锁等待信息"],
          updatedAt: "2026-04-18T09:57:00.000Z",
        },
      },
      roomSessionId: "meeting-room:room-context:participant:agent-1",
      joinedAt: "2026-04-18T10:00:00.000Z",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    }],
    rounds: [{
      roundId: "round-context",
      roomId: "room-context",
      triggerMessageId: "message-context",
      status: "running",
      targetParticipantIds: ["participant-agent"],
      respondedParticipantIds: [],
      startedAt: "2026-04-18T10:01:00.000Z",
      createdAt: "2026-04-18T10:01:00.000Z",
      updatedAt: "2026-04-18T10:01:00.000Z",
    }],
    messages: [{
      messageId: "message-context",
      roomId: "room-context",
      speakerType: "themis",
      audience: "all_participants",
      content: "请给出你目前最可信的判断。",
      messageKind: "message",
      createdAt: "2026-04-18T10:01:00.000Z",
      updatedAt: "2026-04-18T10:01:00.000Z",
    }],
    resolutions: [],
    artifactRefs: [],
  };

  const fakeGateway = {
    async getRoomDetail() {
      return structuredClone(detailState);
    },
    async appendAgentReply(input: { roundId: string; content: string }) {
      const round = detailState.rounds[0];
      assert.ok(round);
      round.status = "completed";
      round.respondedParticipantIds = ["participant-agent"];
      round.completedAt = "2026-04-18T10:01:03.000Z";
      round.updatedAt = "2026-04-18T10:01:03.000Z";

      return {
        room: structuredClone(detailState.room),
        round: structuredClone(round),
        message: {
          messageId: "reply-context",
          roomId: "room-context",
          roundId: input.roundId,
          speakerType: "managed_agent",
          speakerAgentId: "agent-1",
          audience: "all_participants",
          content: input.content,
          messageKind: "message",
          createdAt: "2026-04-18T10:01:03.000Z",
          updatedAt: "2026-04-18T10:01:03.000Z",
        },
      };
    },
    async appendAgentFailure() {
      throw new Error("本测试不应进入失败分支。");
    },
  } as Pick<PlatformMeetingRoomGateway, "getRoomDetail" | "appendAgentReply" | "appendAgentFailure">;

  const fakeRuntime: Pick<AppServerTaskRuntime, "runTaskAsPrincipal"> = {
    async runTaskAsPrincipal(request: TaskRequest): Promise<TaskResult> {
      capturedInputText = String(request.inputText ?? "");
      return {
        taskId: "task-context",
        requestId: request.requestId,
        status: "completed",
        output: "当前最可信的根因是 migration 锁冲突。",
        summary: "当前最可信的根因是 migration 锁冲突。",
        completedAt: "2026-04-18T10:01:03.000Z",
      };
    },
  };

  const executor = new MeetingRoomRoundExecutor();
  await executor.enqueue({
    gateway: fakeGateway,
    runtime: fakeRuntime,
    started: {
      room: structuredClone(detailState.room),
      message: structuredClone(detailState.messages[0]!),
      round: structuredClone(detailState.rounds[0]!),
      targetParticipants: [structuredClone(detailState.participants[1]!)],
    },
  });

  assert.match(capturedInputText, /入场方式：带当前工作上下文/);
  assert.match(capturedInputText, /当前工作项：排查 prod 发布失败/);
  assert.match(capturedInputText, /等待人：Themis/);
  assert.match(capturedInputText, /最新交接：已定位到 migration 锁等待。/);
  assert.ok(!capturedInputText.includes('{"mode":"active_work_context"'));
});

test("MeetingRoomRoundExecutor 会让 collaborative 模式在提示词里真正生效", async () => {
  let capturedInputText = "";
  const detailState: ManagedAgentPlatformMeetingRoomDetailResult = {
    room: {
      roomId: "room-collab",
      ownerPrincipalId: "principal-owner",
      organizationId: "org-1",
      title: "发布复盘",
      goal: "一起收敛原因和动作",
      status: "open",
      discussionMode: "collaborative",
      createdByOperatorPrincipalId: "principal-owner",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    },
    participants: [{
      participantId: "participant-themis",
      roomId: "room-collab",
      participantKind: "themis",
      principalId: "principal-owner",
      displayName: "Themis",
      roomRole: "host",
      entryMode: "blank",
      joinedAt: "2026-04-18T10:00:00.000Z",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    }, {
      participantId: "participant-agent",
      roomId: "room-collab",
      participantKind: "managed_agent",
      principalId: "principal-agent",
      agentId: "agent-1",
      displayName: "后端·衡",
      roomRole: "participant",
      entryMode: "blank",
      roomSessionId: "meeting-room:room-collab:participant:agent-1",
      joinedAt: "2026-04-18T10:00:00.000Z",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    }],
    rounds: [{
      roundId: "round-collab",
      roomId: "room-collab",
      triggerMessageId: "message-collab",
      status: "running",
      targetParticipantIds: ["participant-agent"],
      respondedParticipantIds: [],
      startedAt: "2026-04-18T10:01:00.000Z",
      createdAt: "2026-04-18T10:01:00.000Z",
      updatedAt: "2026-04-18T10:01:00.000Z",
    }],
    messages: [{
      messageId: "message-collab",
      roomId: "room-collab",
      speakerType: "themis",
      audience: "all_participants",
      content: "大家直接讨论各自的判断并互相挑战。",
      messageKind: "message",
      createdAt: "2026-04-18T10:01:00.000Z",
      updatedAt: "2026-04-18T10:01:00.000Z",
    }],
    resolutions: [],
    artifactRefs: [],
  };

  const fakeGateway = {
    async getRoomDetail() {
      return structuredClone(detailState);
    },
    async appendAgentReply(input: { roundId: string; content: string }) {
      return {
        room: structuredClone(detailState.room),
        round: {
          ...structuredClone(detailState.rounds[0]!),
          status: "completed",
          respondedParticipantIds: ["participant-agent"],
          completedAt: "2026-04-18T10:01:03.000Z",
          updatedAt: "2026-04-18T10:01:03.000Z",
        },
        message: {
          messageId: "reply-collab",
          roomId: "room-collab",
          roundId: input.roundId,
          speakerType: "managed_agent",
          speakerAgentId: "agent-1",
          audience: "all_participants",
          content: input.content,
          messageKind: "message",
          createdAt: "2026-04-18T10:01:03.000Z",
          updatedAt: "2026-04-18T10:01:03.000Z",
        },
      };
    },
    async appendAgentFailure() {
      throw new Error("本测试不应进入失败分支。");
    },
  } as Pick<PlatformMeetingRoomGateway, "getRoomDetail" | "appendAgentReply" | "appendAgentFailure">;

  const fakeRuntime: Pick<AppServerTaskRuntime, "runTaskAsPrincipal"> = {
    async runTaskAsPrincipal(request: TaskRequest): Promise<TaskResult> {
      capturedInputText = String(request.inputText ?? "");
      return {
        taskId: "task-collab",
        requestId: request.requestId,
        status: "completed",
        output: "我同意先讨论证据和风险。",
        summary: "我同意先讨论证据和风险。",
        completedAt: "2026-04-18T10:01:03.000Z",
      };
    },
  };

  const executor = new MeetingRoomRoundExecutor();
  await executor.enqueue({
    gateway: fakeGateway,
    runtime: fakeRuntime,
    started: {
      room: structuredClone(detailState.room),
      message: structuredClone(detailState.messages[0]!),
      round: structuredClone(detailState.rounds[0]!),
      targetParticipants: [structuredClone(detailState.participants[1]!)],
    },
  });

  assert.match(capturedInputText, /讨论模式：协作模式/);
  assert.match(capturedInputText, /你可以直接回应其他数字员工已经给出的观点/);
  assert.ok(!capturedInputText.includes("按 Themis 提问逐条作答"));
});
