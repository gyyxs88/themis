import assert from "node:assert/strict";
import test from "node:test";
import { PlatformMeetingRoomGateway } from "./platform-meeting-room-gateway.js";

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

test("PlatformMeetingRoomGateway 会把 create/list/detail 请求发到上游平台", async () => {
  const calls: FetchCall[] = [];
  const client = new PlatformMeetingRoomGateway({
    baseUrl: "https://platform.example.com",
    ownerPrincipalId: "principal-owner",
    webAccessToken: "token-123",
    fetchImpl: async (input, init = {}) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      calls.push({
        url,
        method: init.method ?? "GET",
        headers: normalizeHeaders(init.headers),
        body: typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null,
      });

      return new Response(JSON.stringify({
        rooms: [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  await client.listRooms();

  assert.equal(calls[0]?.url, "https://platform.example.com/api/platform/meeting-rooms/list");
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.headers.authorization, "Bearer token-123");
  assert.equal(calls[0]?.body?.ownerPrincipalId, "principal-owner");
});

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]),
  );
}
