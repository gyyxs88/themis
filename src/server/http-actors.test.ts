import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  baseUrl: string;
  runtime: CodexTaskRuntime;
  runtimeStore: SqliteCodexSessionRegistry;
}

function buildIdentityPayload(channelUserId: string): {
  channel: string;
  channelUserId: string;
  displayName: string;
} {
  return {
    channel: "web",
    channelUserId,
    displayName: "Owner",
  };
}

async function withHttpServer(run: (context: TestServerContext) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-actors-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const server = createThemisHttpServer({ runtime });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  try {
    await run({
      baseUrl: `http://127.0.0.1:${address.port}`,
      runtime,
      runtimeStore,
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
}

async function postJson(
  baseUrl: string,
  pathname: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function readErrorResponse(response: Response): Promise<{
  error?: {
    code?: string;
    message?: string;
  };
}> {
  return response.json() as Promise<{
    error?: {
      code?: string;
      message?: string;
    };
  }>;
}

test("POST /api/actors/create 和 /api/actors/list 会按当前 principal 创建并列出数字员工", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

    const createResponse = await postJson(baseUrl, "/api/actors/create", {
      ...buildIdentityPayload("owner-actor-http"),
      actor: {
        displayName: "阿策",
        role: "frontend-worker",
      },
    }, authHeaders);

    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json() as {
      identity?: { principalId?: string };
      actor?: { actorId?: string; displayName?: string; role?: string };
    };
    assert.ok(createPayload.identity?.principalId);
    assert.ok(createPayload.actor?.actorId);
    assert.equal(createPayload.actor?.displayName, "阿策");
    assert.equal(createPayload.actor?.role, "frontend-worker");

    const listResponse = await postJson(
      baseUrl,
      "/api/actors/list",
      buildIdentityPayload("owner-actor-http"),
      authHeaders,
    );

    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json() as {
      identity?: { principalId?: string };
      actors?: Array<{ displayName?: string; role?: string }>;
    };
    assert.equal(listPayload.identity?.principalId, createPayload.identity?.principalId);
    assert.deepEqual(
      listPayload.actors?.map((actor) => ({
        displayName: actor.displayName,
        role: actor.role,
      })),
      [
        {
          displayName: "阿策",
          role: "frontend-worker",
        },
      ],
    );
  });
});

test("POST /api/actors/timeline 在 actorId 和 scopeId 冲突时返回客户端错误，而不是别的 actor timeline", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const identity = runtime.getIdentityLinkService().ensureIdentity(buildIdentityPayload("owner-actor-conflict"));
    const service = runtime.getPrincipalActorsService();
    const actorA = service.createActor({
      principalId: identity.principalId,
      displayName: "阿运",
      role: "ops-worker",
      now: "2026-03-31T13:00:00.000Z",
    });
    const actorB = service.createActor({
      principalId: identity.principalId,
      displayName: "阿前",
      role: "frontend-worker",
      now: "2026-03-31T13:00:30.000Z",
    });
    const dispatch = service.dispatchTaskToActor({
      principalId: identity.principalId,
      actorId: actorA.actorId,
      taskId: "task-ops-conflict",
      goal: "排查网关告警",
      now: "2026-03-31T13:01:00.000Z",
    });

    service.appendActorRuntimeMemory({
      principalId: identity.principalId,
      actorId: actorA.actorId,
      taskId: "task-ops-conflict",
      scopeId: dispatch.scope.scopeId,
      kind: "progress",
      title: "只属于阿运的记录",
      content: "这条 timeline 不该被别的 actorId 读到。",
      status: "active",
      createdAt: "2026-03-31T13:02:00.000Z",
    });

    const response = await postJson(baseUrl, "/api/actors/timeline", {
      ...buildIdentityPayload("owner-actor-conflict"),
      actorId: actorB.actorId,
      scopeId: dispatch.scope.scopeId,
    }, authHeaders);

    assert.equal(response.status, 400);
    const payload = await readErrorResponse(response);
    assert.equal(payload.error?.code, "INVALID_REQUEST");
    assert.equal(payload.error?.message, "Actor task scope does not exist.");
  });
});

test("POST /api/actors/timeline 和 /api/actors/takeover 在 scope 不存在时返回一致的客户端错误", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const identity = runtime.getIdentityLinkService().ensureIdentity(buildIdentityPayload("owner-actor-missing-scope"));
    const actor = runtime.getPrincipalActorsService().createActor({
      principalId: identity.principalId,
      displayName: "阿测",
      role: "qa-worker",
      now: "2026-03-31T14:00:00.000Z",
    });

    const timelineResponse = await postJson(baseUrl, "/api/actors/timeline", {
      ...buildIdentityPayload("owner-actor-missing-scope"),
      actorId: actor.actorId,
      scopeId: "scope-missing",
    }, authHeaders);
    const timelinePayload = await readErrorResponse(timelineResponse);

    const takeoverResponse = await postJson(baseUrl, "/api/actors/takeover", {
      ...buildIdentityPayload("owner-actor-missing-scope"),
      actorId: actor.actorId,
      scopeId: "scope-missing",
    }, authHeaders);
    const takeoverPayload = await readErrorResponse(takeoverResponse);

    assert.equal(timelineResponse.status, 400);
    assert.equal(takeoverResponse.status, 400);
    assert.equal(timelinePayload.error?.code, "INVALID_REQUEST");
    assert.equal(takeoverPayload.error?.code, "INVALID_REQUEST");
    assert.equal(timelinePayload.error?.message, "Actor task scope does not exist.");
    assert.equal(takeoverPayload.error?.message, "Actor task scope does not exist.");
  });
});

test("POST /api/actors/timeline 和 /api/actors/takeover 会返回 runtime timeline 与 handoff 摘要", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const identity = runtime.getIdentityLinkService().ensureIdentity(buildIdentityPayload("owner-actor-timeline"));
    const service = runtime.getPrincipalActorsService();
    const actor = service.createActor({
      principalId: identity.principalId,
      displayName: "阿运",
      role: "ops-worker",
      now: "2026-03-31T12:00:00.000Z",
    });
    const dispatch = service.dispatchTaskToActor({
      principalId: identity.principalId,
      actorId: actor.actorId,
      taskId: "task-ops-1",
      goal: "检查生产链路",
      now: "2026-03-31T12:01:00.000Z",
    });

    service.appendActorRuntimeMemory({
      principalId: identity.principalId,
      actorId: actor.actorId,
      taskId: "task-ops-1",
      scopeId: dispatch.scope.scopeId,
      kind: "progress",
      title: "已查看日志",
      content: "已定位到 gateway 502。",
      status: "active",
      createdAt: "2026-03-31T12:02:00.000Z",
    });
    service.appendActorRuntimeMemory({
      principalId: identity.principalId,
      actorId: actor.actorId,
      taskId: "task-ops-1",
      scopeId: dispatch.scope.scopeId,
      kind: "blocker",
      title: "缺少线上变量",
      content: "需要 owner 补充生产环境配置。",
      status: "active",
      createdAt: "2026-03-31T12:03:00.000Z",
    });

    const timelineResponse = await postJson(baseUrl, "/api/actors/timeline", {
      ...buildIdentityPayload("owner-actor-timeline"),
      actorId: actor.actorId,
      scopeId: dispatch.scope.scopeId,
    }, authHeaders);

    assert.equal(timelineResponse.status, 200);
    const timelinePayload = await timelineResponse.json() as {
      identity?: { principalId?: string };
      timeline?: Array<{ kind?: string; title?: string }>;
    };
    assert.equal(timelinePayload.identity?.principalId, identity.principalId);
    assert.deepEqual(
      timelinePayload.timeline?.map((entry) => [entry.kind, entry.title]),
      [
        ["progress", "已查看日志"],
        ["blocker", "缺少线上变量"],
      ],
    );

    const takeoverResponse = await postJson(baseUrl, "/api/actors/takeover", {
      ...buildIdentityPayload("owner-actor-timeline"),
      actorId: actor.actorId,
      scopeId: dispatch.scope.scopeId,
    }, authHeaders);

    assert.equal(takeoverResponse.status, 200);
    const takeoverPayload = await takeoverResponse.json() as {
      actor?: { actorId?: string; displayName?: string };
      scope?: { scopeId?: string; goal?: string };
      timeline?: Array<{ kind?: string; title?: string }>;
      handoff?: {
        goal?: string;
        latestBlocker?: string | null;
        latestResult?: string | null;
      };
    };
    assert.equal(takeoverPayload.actor?.actorId, actor.actorId);
    assert.equal(takeoverPayload.actor?.displayName, "阿运");
    assert.equal(takeoverPayload.scope?.scopeId, dispatch.scope.scopeId);
    assert.equal(takeoverPayload.scope?.goal, "检查生产链路");
    assert.equal(takeoverPayload.timeline?.length, 2);
    assert.equal(takeoverPayload.handoff?.goal, "检查生产链路");
    assert.equal(takeoverPayload.handoff?.latestBlocker, "需要 owner 补充生产环境配置。");
    assert.equal(takeoverPayload.handoff?.latestResult, null);
  });
});

function listenServer(server: Server): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
