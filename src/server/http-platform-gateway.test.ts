import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";
import { resolveMainPlatformGatewayFacade } from "./main-platform-gateway.js";

test("主 Themis 的 /api/platform/* 在配置 THEMIS_PLATFORM_* 后会通过 gateway facade 访问平台上游", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-platform-gateway-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new AppServerTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const calls: Array<{
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }> = [];
  const facade = resolveMainPlatformGatewayFacade({
    env: {
      THEMIS_PLATFORM_BASE_URL: "https://platform.example.com/",
      THEMIS_PLATFORM_OWNER_PRINCIPAL_ID: "principal-owner",
      THEMIS_PLATFORM_WEB_ACCESS_TOKEN: "token-123",
    },
    fetchImpl: async (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const headers = normalizeHeaders(init?.headers);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};

      calls.push({
        url,
        headers,
        body,
      });

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
    },
  });

  assert.ok(facade);

  const server = createThemisHttpServer({
    runtime,
    platformControlPlaneFacade: facade,
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const headers = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const response = await fetch(`${baseUrl}/api/platform/agents/list`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ownerPrincipalId: "principal-owner",
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
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
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://platform.example.com/api/platform/agents/list");
    assert.equal(calls[0]?.headers.authorization, "Bearer token-123");
    assert.deepEqual(calls[0]?.body, {
      ownerPrincipalId: "principal-owner",
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
});

test("主 Themis 的 /api/platform/* 会透传平台上游错误状态码和错误码", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-platform-gateway-error-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new AppServerTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const calls: Array<{
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }> = [];
  const facade = resolveMainPlatformGatewayFacade({
    env: {
      THEMIS_PLATFORM_BASE_URL: "https://platform.example.com/",
      THEMIS_PLATFORM_OWNER_PRINCIPAL_ID: "principal-owner",
      THEMIS_PLATFORM_WEB_ACCESS_TOKEN: "token-123",
    },
    fetchImpl: async (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const headers = normalizeHeaders(init?.headers);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};

      calls.push({
        url,
        headers,
        body,
      });

      return new Response(JSON.stringify({
        error: {
          code: "NOT_FOUND",
          message: "Agent agent-missing not found.",
        },
      }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
        },
      });
    },
  });

  assert.ok(facade);

  const server = createThemisHttpServer({
    runtime,
    platformControlPlaneFacade: facade,
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const headers = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const response = await fetch(`${baseUrl}/api/platform/agents/card/update`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ownerPrincipalId: "principal-owner",
        agentId: "agent-missing",
        card: {
          currentFocus: "验证 404 透传。",
        },
      }),
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: {
        code: "NOT_FOUND",
        message: "Agent agent-missing not found.",
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://platform.example.com/api/platform/agents/card/update");
    assert.equal(calls[0]?.headers.authorization, "Bearer token-123");
    assert.deepEqual(calls[0]?.body, {
      ownerPrincipalId: "principal-owner",
      agentId: "agent-missing",
      card: {
        currentFocus: "验证 404 透传。",
      },
    });
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
