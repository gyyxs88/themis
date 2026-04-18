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

test("meeting room sendMessage 会消费 NDJSON 并把回复写进当前房间消息流", async () => {
  const state = createDefaultMeetingRoomsState();
  state.accessMode = "platform_gateway";
  state.ownerPrincipalId = "principal-owner";
  state.activeRoomId = "room-1";
  state.activeRoom = {
    room: {
      roomId: "room-1",
      title: "发布阻塞讨论",
      goal: "找根因",
      status: "open",
    },
    participants: [],
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
      meetingRoomsCreateGoalInput: null,
      meetingRoomsCreateParticipantsInput: null,
      meetingRoomsList: null,
      meetingRoomsComposerInput: null,
      meetingRoomsSendButton: null,
    },
  };
}
