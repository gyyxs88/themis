import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultMeetingRoomsState, createMeetingRoomsController } from "./meeting-rooms.js";

test("meeting room loadStatus + loadRooms 会读取 gateway 状态和房间列表", async () => {
  const state = createDefaultMeetingRoomsState();
  const calls = [];
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(init.body) : null,
      });

      if (url === "/api/meeting-rooms/status") {
        return new Response(JSON.stringify({
          accessMode: "platform_gateway",
          platformBaseUrl: "https://platform.example.com",
          ownerPrincipalId: "principal-owner",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url === "/api/meeting-rooms/detail") {
        return new Response(JSON.stringify({
          room: {
            roomId: "room-1",
            organizationId: "org-1",
            title: "发布阻塞讨论",
            goal: "找根因",
            status: "open",
          },
          participants: [],
          messages: [],
          rounds: [],
          resolutions: [],
          artifactRefs: [],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        rooms: [{
          roomId: "room-1",
          organizationId: "org-1",
          title: "发布阻塞讨论",
          goal: "找根因",
          status: "open",
          createdAt: "2026-04-18T10:00:00.000Z",
          updatedAt: "2026-04-18T10:00:00.000Z",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const app = createMeetingRoomAppStub(state);
    const controller = createMeetingRoomsController(app);

    await controller.loadStatus();
    await controller.loadRooms();

    assert.equal(calls[0]?.url, "/api/meeting-rooms/status");
    assert.equal(calls[1]?.url, "/api/meeting-rooms/list");
    assert.equal(app.runtime.meetingRooms.accessMode, "platform_gateway");
    assert.equal(app.runtime.meetingRooms.rooms.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("meeting room createRoom 会提交 discussionMode、参与者 entryMode 和 selected_context 材料", async () => {
  const state = createDefaultMeetingRoomsState();
  state.accessMode = "platform_gateway";
  state.ownerPrincipalId = "principal-owner";
  state.createDraft = {
    organizationId: "org-1",
    title: "发布阻塞讨论",
    goal: "找根因",
    discussionMode: "collaborative",
    participantSpecsText: "agent-1:active_work_context agent-2 agent-3:selected_context:work_item=work-item-1|document=doc-prd",
  };
  const calls = [];
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(init.body) : null,
      });

      assert.equal(url, "/api/meeting-rooms/create");
      return new Response(JSON.stringify({
        room: {
          roomId: "room-1",
          organizationId: "org-1",
          title: "发布阻塞讨论",
          goal: "找根因",
          status: "open",
          discussionMode: "collaborative",
        },
        participants: [{
          participantId: "participant-agent-1",
          roomId: "room-1",
          participantKind: "managed_agent",
          principalId: "principal-agent-1",
          agentId: "agent-1",
          displayName: "后端·衡",
          roomRole: "participant",
          entryMode: "active_work_context",
          joinedAt: "2026-04-18T10:00:00.000Z",
          createdAt: "2026-04-18T10:00:00.000Z",
          updatedAt: "2026-04-18T10:00:00.000Z",
        }, {
          participantId: "participant-agent-2",
          roomId: "room-1",
          participantKind: "managed_agent",
          principalId: "principal-agent-2",
          agentId: "agent-2",
          displayName: "测试·澄",
          roomRole: "participant",
          entryMode: "blank",
          joinedAt: "2026-04-18T10:00:00.000Z",
          createdAt: "2026-04-18T10:00:00.000Z",
          updatedAt: "2026-04-18T10:00:00.000Z",
        }, {
          participantId: "participant-agent-3",
          roomId: "room-1",
          participantKind: "managed_agent",
          principalId: "principal-agent-3",
          agentId: "agent-3",
          displayName: "产品·岚",
          roomRole: "participant",
          entryMode: "selected_context",
          joinedAt: "2026-04-18T10:00:00.000Z",
          createdAt: "2026-04-18T10:00:00.000Z",
          updatedAt: "2026-04-18T10:00:00.000Z",
        }],
        messages: [],
        rounds: [],
        resolutions: [],
        artifactRefs: [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const app = createMeetingRoomAppStub(state);
    const controller = createMeetingRoomsController(app);
    await controller.createRoom();

    assert.equal(calls[0]?.url, "/api/meeting-rooms/create");
    assert.equal(calls[0]?.body?.discussionMode, "collaborative");
    assert.deepEqual(calls[0]?.body?.participants, [{
      agentId: "agent-1",
      entryMode: "active_work_context",
    }, {
      agentId: "agent-2",
      entryMode: "blank",
    }, {
      agentId: "agent-3",
      entryMode: "selected_context",
      selectedArtifactRefs: [{
        refType: "work_item",
        refId: "work-item-1",
      }, {
        refType: "document",
        refId: "doc-prd",
      }],
    }]);
    assert.deepEqual(app.runtime.meetingRooms.selectedTargetParticipantIds, [
      "participant-agent-1",
      "participant-agent-2",
      "participant-agent-3",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("meeting room sendMessage 会带 targetParticipantIds 并把回复写进当前房间消息流", async () => {
  const state = createDefaultMeetingRoomsState();
  state.accessMode = "platform_gateway";
  state.ownerPrincipalId = "principal-owner";
  state.activeRoomId = "room-1";
  state.selectedTargetParticipantIds = ["participant-agent-1"];
  state.activeRoom = {
    room: {
      roomId: "room-1",
      title: "发布阻塞讨论",
      goal: "找根因",
      status: "open",
      discussionMode: "moderated",
    },
    participants: [{
      participantId: "participant-agent-1",
      roomId: "room-1",
      participantKind: "managed_agent",
      principalId: "principal-agent-1",
      agentId: "agent-1",
      displayName: "后端·衡",
      roomRole: "participant",
      entryMode: "blank",
      joinedAt: "2026-04-18T10:00:00.000Z",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    }, {
      participantId: "participant-agent-2",
      roomId: "room-1",
      participantKind: "managed_agent",
      principalId: "principal-agent-2",
      agentId: "agent-2",
      displayName: "测试·澄",
      roomRole: "participant",
      entryMode: "active_work_context",
      joinedAt: "2026-04-18T10:00:00.000Z",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    }],
    messages: [],
    rounds: [],
    resolutions: [],
    artifactRefs: [],
  };
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url, init = {}) => {
      if (url === "/api/meeting-rooms/message/stream") {
        assert.equal(init.method, "POST");
        assert.deepEqual(JSON.parse(init.body), {
          roomId: "room-1",
          content: "先给出你们的根因判断。",
          operatorPrincipalId: "principal-owner",
          audience: "selected_participants",
          targetParticipantIds: ["participant-agent-1"],
        });
        return new Response([
          JSON.stringify({ event: "room.message.created", roomId: "room-1", messageId: "message-manager", roundId: "round-1" }),
          JSON.stringify({ event: "room.agent.reply", roomId: "room-1", roundId: "round-1", participantAgentId: "agent-1", messageId: "message-agent" }),
        ].join("\n"), {
          status: 200,
          headers: { "Content-Type": "application/x-ndjson" },
        });
      }

      assert.equal(url, "/api/meeting-rooms/detail");
      return new Response(JSON.stringify({
        room: {
          roomId: "room-1",
          organizationId: "org-1",
          title: "发布阻塞讨论",
          goal: "找根因",
          status: "open",
        },
        participants: [{
          participantId: "participant-agent-1",
          roomId: "room-1",
          participantKind: "managed_agent",
          principalId: "principal-agent-1",
          agentId: "agent-1",
          displayName: "后端·衡",
          roomRole: "participant",
          entryMode: "blank",
          joinedAt: "2026-04-18T10:00:00.000Z",
          createdAt: "2026-04-18T10:00:00.000Z",
          updatedAt: "2026-04-18T10:00:00.000Z",
        }, {
          participantId: "participant-agent-2",
          roomId: "room-1",
          participantKind: "managed_agent",
          principalId: "principal-agent-2",
          agentId: "agent-2",
          displayName: "测试·澄",
          roomRole: "participant",
          entryMode: "active_work_context",
          joinedAt: "2026-04-18T10:00:00.000Z",
          createdAt: "2026-04-18T10:00:00.000Z",
          updatedAt: "2026-04-18T10:00:00.000Z",
        }],
        messages: [{
          messageId: "message-manager",
          roomId: "room-1",
          roundId: "round-1",
          speakerType: "themis",
          audience: "all_participants",
          content: "先给出你们的根因判断。",
          messageKind: "message",
          createdAt: "2026-04-18T10:00:00.000Z",
          updatedAt: "2026-04-18T10:00:00.000Z",
        }, {
          messageId: "message-agent",
          roomId: "room-1",
          roundId: "round-1",
          speakerType: "managed_agent",
          speakerAgentId: "agent-1",
          audience: "all_participants",
          content: "我判断是 migration 超时。",
          messageKind: "message",
          createdAt: "2026-04-18T10:01:00.000Z",
          updatedAt: "2026-04-18T10:01:00.000Z",
        }],
        rounds: [],
        resolutions: [],
        artifactRefs: [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const app = createMeetingRoomAppStub(state);
    const controller = createMeetingRoomsController(app);
    await controller.sendMessage("先给出你们的根因判断。");

    assert.equal(app.runtime.meetingRooms.activeRoom.messages.length, 2);
    assert.equal(app.runtime.meetingRooms.activeRoom.messages[1].messageId, "message-agent");
    assert.equal(app.runtime.meetingRooms.activeRoom.messages[1].content, "我判断是 migration 超时。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("meeting room sendMessage 在详情刷新失败时也会直接显示流式回复正文", async () => {
  const state = createDefaultMeetingRoomsState();
  state.accessMode = "platform_gateway";
  state.ownerPrincipalId = "principal-owner";
  state.activeRoomId = "room-1";
  state.selectedTargetParticipantIds = ["participant-agent-1"];
  state.activeRoom = {
    room: {
      roomId: "room-1",
      title: "发布阻塞讨论",
      goal: "找根因",
      status: "open",
      discussionMode: "moderated",
    },
    participants: [{
      participantId: "participant-agent-1",
      roomId: "room-1",
      participantKind: "managed_agent",
      principalId: "principal-agent-1",
      agentId: "agent-1",
      displayName: "后端·衡",
      roomRole: "participant",
      entryMode: "blank",
      joinedAt: "2026-04-18T10:00:00.000Z",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    }],
    messages: [],
    rounds: [],
    resolutions: [],
    artifactRefs: [],
  };
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url) => {
      if (url === "/api/meeting-rooms/message/stream") {
        return new Response([
          JSON.stringify({ event: "room.message.created", roomId: "room-1", messageId: "message-manager", roundId: "round-1" }),
          JSON.stringify({
            event: "room.agent.reply",
            roomId: "room-1",
            roundId: "round-1",
            participantAgentId: "agent-1",
            messageId: "message-agent",
            content: "我判断是 migration 超时。",
            audience: "all_participants",
          }),
        ].join("\n"), {
          status: 200,
          headers: { "Content-Type": "application/x-ndjson" },
        });
      }

      return new Response(JSON.stringify({
        error: {
          message: "detail 暂时不可用",
        },
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    };

    const app = createMeetingRoomAppStub(state);
    const controller = createMeetingRoomsController(app);
    await controller.sendMessage("先给出你们的根因判断。");

    assert.equal(app.runtime.meetingRooms.activeRoom.messages.length, 2);
    assert.equal(app.runtime.meetingRooms.activeRoom.messages[1].messageId, "message-agent");
    assert.equal(app.runtime.meetingRooms.activeRoom.messages[1].content, "我判断是 migration 超时。");
    assert.equal(app.runtime.meetingRooms.activeRoom.messages[1].speakerType, "managed_agent");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("meeting room createResolution 会提交 sourceMessageIds 并刷新结论列表", async () => {
  const state = createDefaultMeetingRoomsState();
  state.accessMode = "platform_gateway";
  state.activeRoomId = "room-1";
  state.activeRoom = {
    room: {
      roomId: "room-1",
      title: "发布阻塞讨论",
      goal: "找根因",
      status: "open",
      discussionMode: "moderated",
    },
    participants: [{
      participantId: "participant-agent-1",
      roomId: "room-1",
      participantKind: "managed_agent",
      principalId: "principal-agent-1",
      agentId: "agent-1",
      displayName: "后端·衡",
      roomRole: "participant",
      entryMode: "active_work_context",
      joinedAt: "2026-04-18T10:00:00.000Z",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    }],
    messages: [{
      messageId: "message-manager",
      roomId: "room-1",
      speakerType: "themis",
      audience: "all_participants",
      content: "先给出根因判断。",
      messageKind: "message",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    }, {
      messageId: "message-agent",
      roomId: "room-1",
      speakerType: "managed_agent",
      speakerAgentId: "agent-1",
      audience: "all_participants",
      content: "我判断是 migration 锁冲突。",
      messageKind: "message",
      createdAt: "2026-04-18T10:01:00.000Z",
      updatedAt: "2026-04-18T10:01:00.000Z",
    }],
    rounds: [],
    resolutions: [],
    artifactRefs: [],
  };
  state.selectedResolutionSourceMessageIds = ["message-manager", "message-agent"];
  state.resolutionDraft = {
    title: "补 migration 重试",
    summary: "先补重试和告警，再重新发版。",
  };
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url, init = {}) => {
      assert.equal(url, "/api/meeting-rooms/resolutions/create");
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), {
        roomId: "room-1",
        sourceMessageIds: ["message-manager", "message-agent"],
        title: "补 migration 重试",
        summary: "先补重试和告警，再重新发版。",
      });

      return new Response(JSON.stringify({
        room: {
          roomId: "room-1",
          title: "发布阻塞讨论",
          goal: "找根因",
          status: "open",
          discussionMode: "moderated",
        },
        participants: state.activeRoom.participants,
        messages: state.activeRoom.messages,
        rounds: [],
        resolutions: [{
          resolutionId: "resolution-1",
          roomId: "room-1",
          sourceMessageIds: ["message-manager", "message-agent"],
          title: "补 migration 重试",
          summary: "先补重试和告警，再重新发版。",
          status: "draft",
          createdAt: "2026-04-18T10:02:00.000Z",
          updatedAt: "2026-04-18T10:02:00.000Z",
        }],
        artifactRefs: [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const app = createMeetingRoomAppStub(state);
    const controller = createMeetingRoomsController(app);
    await controller.createResolution();

    assert.equal(app.runtime.meetingRooms.activeRoom.resolutions.length, 1);
    assert.equal(app.runtime.meetingRooms.activeRoom.resolutions[0].resolutionId, "resolution-1");
    assert.deepEqual(app.runtime.meetingRooms.selectedResolutionSourceMessageIds, []);
    assert.deepEqual(app.runtime.meetingRooms.resolutionDraft, {
      title: "",
      summary: "",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("meeting room promoteResolution 和 closeRoom 会提交目标员工并刷新关闭态", async () => {
  const state = createDefaultMeetingRoomsState();
  state.accessMode = "platform_gateway";
  state.activeRoomId = "room-1";
  state.activeRoom = {
    room: {
      roomId: "room-1",
      title: "发布阻塞讨论",
      goal: "找根因",
      status: "open",
      discussionMode: "moderated",
    },
    participants: [{
      participantId: "participant-agent-1",
      roomId: "room-1",
      participantKind: "managed_agent",
      principalId: "principal-agent-1",
      agentId: "agent-1",
      displayName: "后端·衡",
      roomRole: "participant",
      entryMode: "blank",
      joinedAt: "2026-04-18T10:00:00.000Z",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    }, {
      participantId: "participant-agent-2",
      roomId: "room-1",
      participantKind: "managed_agent",
      principalId: "principal-agent-2",
      agentId: "agent-2",
      displayName: "测试·澄",
      roomRole: "participant",
      entryMode: "blank",
      joinedAt: "2026-04-18T10:00:00.000Z",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    }],
    messages: [],
    rounds: [],
    resolutions: [{
      resolutionId: "resolution-1",
      roomId: "room-1",
      sourceMessageIds: ["message-manager"],
      title: "补 migration 重试",
      summary: "先补重试和告警，再重新发版。",
      status: "draft",
      createdAt: "2026-04-18T10:02:00.000Z",
      updatedAt: "2026-04-18T10:02:00.000Z",
    }],
    artifactRefs: [],
  };
  state.resolutionPromotionTargetAgentIds = {
    "resolution-1": "agent-2",
  };
  state.closingSummaryText = "已形成正式执行项，本次会议到此收口。";
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        body: JSON.parse(init.body),
      });

      if (url === "/api/meeting-rooms/resolutions/promote") {
        return new Response(JSON.stringify({
          room: {
            roomId: "room-1",
            title: "发布阻塞讨论",
            goal: "找根因",
            status: "open",
            discussionMode: "moderated",
          },
          participants: state.activeRoom.participants,
          messages: [],
          rounds: [],
          resolutions: [{
            resolutionId: "resolution-1",
            roomId: "room-1",
            sourceMessageIds: ["message-manager"],
            title: "补 migration 重试",
            summary: "先补重试和告警，再重新发版。",
            status: "promoted",
            promotedWorkItemId: "work-item-1",
            createdAt: "2026-04-18T10:02:00.000Z",
            updatedAt: "2026-04-18T10:03:00.000Z",
          }],
          artifactRefs: [],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      assert.equal(url, "/api/meeting-rooms/close");
      return new Response(JSON.stringify({
        room: {
          roomId: "room-1",
          title: "发布阻塞讨论",
          goal: "找根因",
          status: "closed",
          discussionMode: "moderated",
          closingSummary: "已形成正式执行项，本次会议到此收口。",
        },
        participants: state.activeRoom.participants,
        messages: [],
        rounds: [],
        resolutions: [{
          resolutionId: "resolution-1",
          roomId: "room-1",
          sourceMessageIds: ["message-manager"],
          title: "补 migration 重试",
          summary: "先补重试和告警，再重新发版。",
          status: "promoted",
          promotedWorkItemId: "work-item-1",
          createdAt: "2026-04-18T10:02:00.000Z",
          updatedAt: "2026-04-18T10:03:00.000Z",
        }],
        artifactRefs: [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const app = createMeetingRoomAppStub(state);
    const controller = createMeetingRoomsController(app);
    await controller.promoteResolution("resolution-1");
    await controller.closeRoom();

    assert.deepEqual(calls[0], {
      url: "/api/meeting-rooms/resolutions/promote",
      body: {
        roomId: "room-1",
        resolutionId: "resolution-1",
        targetAgentId: "agent-2",
      },
    });
    assert.deepEqual(calls[1], {
      url: "/api/meeting-rooms/close",
      body: {
        roomId: "room-1",
        closingSummary: "已形成正式执行项，本次会议到此收口。",
      },
    });
    assert.equal(app.runtime.meetingRooms.activeRoom.room.status, "closed");
    assert.equal(app.runtime.meetingRooms.activeRoom.resolutions[0].promotedWorkItemId, "work-item-1");
    assert.equal(app.runtime.meetingRooms.closingSummaryText, "已形成正式执行项，本次会议到此收口。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("meeting room 会在 terminated 房间拒绝继续发言和正常收口", async () => {
  const state = createDefaultMeetingRoomsState();
  state.accessMode = "platform_gateway";
  state.ownerPrincipalId = "principal-owner";
  state.activeRoomId = "room-1";
  state.composerText = "请继续讨论。";
  state.closingSummaryText = "不应再正常收口。";
  state.selectedTargetParticipantIds = ["participant-agent-1"];
  state.activeRoom = {
    room: {
      roomId: "room-1",
      title: "发布阻塞讨论",
      goal: "找根因",
      status: "terminated",
      discussionMode: "moderated",
      terminationReason: "平台值班判断当前讨论进入异常循环。",
    },
    participants: [{
      participantId: "participant-agent-1",
      roomId: "room-1",
      participantKind: "managed_agent",
      principalId: "principal-agent-1",
      agentId: "agent-1",
      displayName: "后端·衡",
      roomRole: "participant",
      entryMode: "blank",
      joinedAt: "2026-04-18T10:00:00.000Z",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
    }],
    messages: [],
    rounds: [],
    resolutions: [],
    artifactRefs: [],
  };
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  try {
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error("terminated room should stay readonly");
    };

    const app = createMeetingRoomAppStub(state);
    const controller = createMeetingRoomsController(app);

    await controller.sendMessage();
    assert.equal(fetchCalled, false);
    assert.equal(app.runtime.meetingRooms.errorMessage, "当前会议室已被平台终止，只能回看，不能继续发起讨论。");

    await controller.closeRoom();
    assert.equal(fetchCalled, false);
    assert.equal(app.runtime.meetingRooms.errorMessage, "当前会议室已被平台终止，只能回看，不能再按正常收口关闭。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createMeetingRoomAppStub(meetingRoomsState) {
  return {
    runtime: {
      meetingRooms: meetingRoomsState,
    },
    utils: {
      async safeReadJson(response) {
        return await response.json();
      },
      escapeHtml(value) {
        return String(value);
      },
    },
    renderer: {
      renderAll() {},
    },
    dom: {
      meetingRoomsRefreshButton: null,
      meetingRoomsCreateOrganizationInput: null,
      meetingRoomsCreateButton: null,
      meetingRoomsCreateTitleInput: null,
      meetingRoomsCreateDiscussionModeSelect: null,
      meetingRoomsCreateGoalInput: null,
      meetingRoomsCreateParticipantsInput: null,
      meetingRoomsAddParticipantsInput: null,
      meetingRoomsAddParticipantsButton: null,
      meetingRoomsList: null,
      meetingRoomsActiveMessages: null,
      meetingRoomsResolutionTitleInput: null,
      meetingRoomsResolutionSummaryInput: null,
      meetingRoomsCreateResolutionButton: null,
      meetingRoomsResolutionSelectionNote: null,
      meetingRoomsResolutionsList: null,
      meetingRoomsCloseSummaryInput: null,
      meetingRoomsCloseButton: null,
      meetingRoomsTargetParticipantsList: null,
      meetingRoomsComposerInput: null,
      meetingRoomsSendButton: null,
    },
  };
}
