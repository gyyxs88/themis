import assert from "node:assert/strict";
import test from "node:test";
import { resolveMainPlatformGatewayFacade } from "./main-platform-gateway.js";

test("未配置 THEMIS_PLATFORM_* 时不启用主 Themis 平台 gateway facade", () => {
  const facade = resolveMainPlatformGatewayFacade({
    env: {},
  });

  assert.equal(facade, undefined);
});

test("配置 THEMIS_PLATFORM_* 后主 Themis 会把 /api/platform/* 能力切到平台 gateway facade", async () => {
  const calls: Array<{
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const headers = normalizeHeaders(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};

    calls.push({ url, headers, body });

    return new Response(JSON.stringify({
      organizations: [{
        organizationId: "org-alpha",
        ownerPrincipalId: "principal-owner",
        displayName: "Alpha Org",
        slug: "alpha-org",
        createdAt: "2026-04-14T12:00:00.000Z",
        updatedAt: "2026-04-14T12:00:00.000Z",
      }],
      agents: [{
        agentId: "agent-alpha",
        principalId: "principal-agent-alpha",
        organizationId: "org-alpha",
        displayName: "Alpha Agent",
        departmentRole: "交付经理",
        status: "active",
        createdByPrincipalId: "principal-owner",
        createdAt: "2026-04-14T12:00:00.000Z",
        updatedAt: "2026-04-14T12:00:00.000Z",
      }],
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  };

  const facade = resolveMainPlatformGatewayFacade({
    env: {
      THEMIS_PLATFORM_BASE_URL: "https://platform.example.com/",
      THEMIS_PLATFORM_OWNER_PRINCIPAL_ID: "principal-owner",
      THEMIS_PLATFORM_WEB_ACCESS_TOKEN: "token-123",
    },
    fetchImpl,
  });

  assert.ok(facade);

  const list = await facade.listManagedAgents("principal-owner");
  assert.equal(list.organizations.length, 1);
  assert.equal(list.agents.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://platform.example.com/api/platform/agents/list");
  assert.equal(calls[0]?.headers.authorization, "Bearer token-123");
  assert.deepEqual(calls[0]?.body, {
    ownerPrincipalId: "principal-owner",
  });
});

test("主 Themis 平台 gateway facade 会拒绝和配置 ownerPrincipalId 不一致的请求", async () => {
  const facade = resolveMainPlatformGatewayFacade({
    env: {
      THEMIS_PLATFORM_BASE_URL: "https://platform.example.com",
      THEMIS_PLATFORM_OWNER_PRINCIPAL_ID: "principal-owner",
      THEMIS_PLATFORM_WEB_ACCESS_TOKEN: "token-123",
    },
    fetchImpl: async () => {
      throw new Error("should not fetch when ownerPrincipalId mismatches");
    },
  });

  assert.ok(facade);
  await assert.rejects(
    async () => {
      await facade.listManagedAgents("principal-other");
    },
    /Configured platform gateway ownerPrincipalId does not match request ownerPrincipalId/,
  );
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
