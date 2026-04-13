import assert from "node:assert/strict";
import test from "node:test";
import { ManagedAgentPlatformGatewayClient } from "./managed-agent-platform-gateway-client.js";

interface FetchCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

test("ManagedAgentPlatformGatewayClient 会按项目工作区绑定契约读写平台 projects 接口", async () => {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
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

    if (url.endsWith("/api/platform/projects/workspace-binding/list")) {
      return new Response(JSON.stringify({
        bindings: [{
          projectId: "project-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Workspace",
          continuityMode: "sticky",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        }],
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (url.endsWith("/api/platform/projects/workspace-binding/detail")) {
      return new Response(JSON.stringify({
        binding: {
          projectId: "project-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Workspace",
          canonicalWorkspacePath: "/srv/alpha",
          continuityMode: "sticky",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:05:00.000Z",
        },
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (url.endsWith("/api/platform/projects/workspace-binding/upsert")) {
      return new Response(JSON.stringify({
        binding: {
          projectId: "project-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Workspace",
          canonicalWorkspacePath: "/srv/alpha",
          preferredNodeId: "node-alpha",
          lastActiveWorkspacePath: "/srv/alpha",
          continuityMode: "replicated",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:10:00.000Z",
        },
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const client = new ManagedAgentPlatformGatewayClient({
    baseUrl: "https://platform.example.com/",
    ownerPrincipalId: "principal-owner",
    webAccessToken: "token-123",
    fetchImpl,
  });

  const bindings = await client.listProjectWorkspaceBindings({
    organizationId: "org-alpha",
  });
  const binding = await client.getProjectWorkspaceBinding("project-alpha");
  const upserted = await client.upsertProjectWorkspaceBinding({
    projectId: "project-alpha",
    displayName: "Alpha Workspace",
    organizationId: "org-alpha",
    canonicalWorkspacePath: "/srv/alpha",
    preferredNodeId: "node-alpha",
    lastActiveWorkspacePath: "/srv/alpha",
    continuityMode: "replicated",
  });

  assert.equal(bindings.length, 1);
  assert.equal(bindings[0]?.projectId, "project-alpha");
  assert.equal(binding?.canonicalWorkspacePath, "/srv/alpha");
  assert.equal(upserted.preferredNodeId, "node-alpha");
  assert.equal(upserted.continuityMode, "replicated");

  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.headers.authorization, "Bearer token-123");
  assert.equal(calls[0]?.body.ownerPrincipalId, "principal-owner");
  assert.equal(calls[0]?.body.organizationId, "org-alpha");

  assert.equal(calls[1]?.body.projectId, "project-alpha");

  assert.deepEqual(calls[2]?.body, {
    ownerPrincipalId: "principal-owner",
    binding: {
      projectId: "project-alpha",
      displayName: "Alpha Workspace",
      organizationId: "org-alpha",
      canonicalWorkspacePath: "/srv/alpha",
      preferredNodeId: "node-alpha",
      lastActiveWorkspacePath: "/srv/alpha",
      continuityMode: "replicated",
    },
  });
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
