import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import type { PlatformMeetingRoomGateway } from "../core/platform-meeting-room-gateway.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

test("POST /api/meeting-rooms/message/stream 会把 manager 消息流式编排成员工回复", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-meeting-rooms-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const appendedReplies: Array<{ content?: string }> = [];
  const fakeGateway = {
    getStatus() {
      return {
        accessMode: "platform_gateway",
        platformBaseUrl: "https://platform.example.com",
        ownerPrincipalId: "principal-owner",
      };
    },
    async createManagerMessage() {
      return {
        room: {
          roomId: "room-1",
          ownerPrincipalId: "principal-owner",
          organizationId: "org-1",
          title: "发布阻塞讨论",
          goal: "找根因",
          status: "open",
          discussionMode: "moderated",
          createdByOperatorPrincipalId: "principal-owner",
          createdAt: "2026-04-18T10:00:00.000Z",
          updatedAt: "2026-04-18T10:00:00.000Z",
        },
        message: {
          messageId: "message-manager",
          roomId: "room-1",
          speakerType: "themis",
          audience: "all_participants",
          content: "先给出根因判断。",
          messageKind: "message",
          createdAt: "2026-04-18T10:01:00.000Z",
          updatedAt: "2026-04-18T10:01:00.000Z",
        },
        round: {
          roundId: "round-1",
          roomId: "room-1",
          triggerMessageId: "message-manager",
          status: "running",
          targetParticipantIds: ["participant-agent"],
          respondedParticipantIds: [],
          startedAt: "2026-04-18T10:01:00.000Z",
          createdAt: "2026-04-18T10:01:00.000Z",
          updatedAt: "2026-04-18T10:01:00.000Z",
        },
        targetParticipants: [{
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
      };
    },
    async getRoomDetail() {
      return {
        room: {
          roomId: "room-1",
          ownerPrincipalId: "principal-owner",
          organizationId: "org-1",
          title: "发布阻塞讨论",
          goal: "找根因",
          status: "open",
          discussionMode: "moderated",
          createdByOperatorPrincipalId: "principal-owner",
          createdAt: "2026-04-18T10:00:00.000Z",
          updatedAt: "2026-04-18T10:01:00.000Z",
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
          triggerMessageId: "message-manager",
          status: "running",
          targetParticipantIds: ["participant-agent"],
          respondedParticipantIds: [],
          startedAt: "2026-04-18T10:01:00.000Z",
          createdAt: "2026-04-18T10:01:00.000Z",
          updatedAt: "2026-04-18T10:01:00.000Z",
        }],
        messages: [{
          messageId: "message-manager",
          roomId: "room-1",
          speakerType: "themis",
          audience: "all_participants",
          content: "先给出根因判断。",
          messageKind: "message",
          createdAt: "2026-04-18T10:01:00.000Z",
          updatedAt: "2026-04-18T10:01:00.000Z",
        }],
        resolutions: [],
        artifactRefs: [],
      };
    },
    async appendAgentReply(input: { content: string }) {
      appendedReplies.push(input);
      return {
        room: { roomId: "room-1", title: "发布阻塞讨论", goal: "找根因", status: "open" },
        round: {
          roundId: "round-1",
          roomId: "room-1",
          triggerMessageId: "message-manager",
          status: "completed",
          targetParticipantIds: ["participant-agent"],
          respondedParticipantIds: ["participant-agent"],
          startedAt: "2026-04-18T10:01:00.000Z",
          completedAt: "2026-04-18T10:01:03.000Z",
          createdAt: "2026-04-18T10:01:00.000Z",
          updatedAt: "2026-04-18T10:01:03.000Z",
        },
        message: {
          messageId: "message-agent",
          roomId: "room-1",
          roundId: "round-1",
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
      throw new Error("本用例不应走失败分支");
    },
  } as unknown as PlatformMeetingRoomGateway;
  const fakeRuntime = {
    async runTaskAsPrincipal() {
      return {
        taskId: "task-1",
        requestId: "request-1",
        status: "completed",
        summary: "我判断是 migration 阶段超时。",
        output: "我判断是 migration 阶段超时。",
      };
    },
  };

  const server = createThemisHttpServer({
    runtime,
    platformMeetingRoomGateway: fakeGateway,
    appServerRuntimeForMeetingRooms: fakeRuntime as never,
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const response = await fetch(`${baseUrl}/api/meeting-rooms/message/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        roomId: "room-1",
        content: "先给出你们的根因判断。",
        operatorPrincipalId: "principal-owner",
      }),
    });
    const text = await response.text();
    const events = text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

    assert.equal(response.status, 200);
    assert.deepEqual(events.map((event) => event.event), [
      "room.message.created",
      "room.round.started",
      "room.agent.reply",
      "room.round.completed",
    ]);
    assert.equal(events[2]?.content, "我判断是 migration 阶段超时。");
    assert.equal(events[2]?.audience, "all_participants");
    assert.equal(appendedReplies.length, 1);
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
});

async function listenServer(server: Server): Promise<Server> {
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
