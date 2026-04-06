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

test("POST /api/actors/memory-candidates/suggest、/list、/review 会管理长期记忆候选", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const identity = runtime.getIdentityLinkService().ensureIdentity(buildIdentityPayload("owner-memory-http"));

    const suggestResponse = await postJson(baseUrl, "/api/actors/memory-candidates/suggest", {
      ...buildIdentityPayload("owner-memory-http"),
      candidate: {
        kind: "preference",
        title: "回答节奏",
        summary: "先结论后展开。",
        rationale: "最近多轮协作都要求先给结论。",
        suggestedContent: "默认先给结论，再补过程和依据。",
        sourceType: "themis",
        sourceLabel: "session session-http-memory-1 / task task-http-memory-1",
        sourceTaskId: "task-http-memory-1",
        sourceConversationId: "session-http-memory-1",
      },
    }, authHeaders);

    assert.equal(suggestResponse.status, 200);
    const suggestPayload = await suggestResponse.json() as {
      identity?: { principalId?: string };
      candidate?: { candidateId?: string; status?: string; sourceTaskId?: string };
    };
    assert.equal(suggestPayload.identity?.principalId, identity.principalId);
    assert.ok(suggestPayload.candidate?.candidateId);
    assert.equal(suggestPayload.candidate?.status, "suggested");
    assert.equal(suggestPayload.candidate?.sourceTaskId, "task-http-memory-1");

    const listResponse = await postJson(baseUrl, "/api/actors/memory-candidates/list", {
      ...buildIdentityPayload("owner-memory-http"),
      limit: 10,
    }, authHeaders);

    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json() as {
      candidates?: Array<{ candidateId?: string; status?: string }>;
    };
    assert.deepEqual(
      listPayload.candidates?.map((candidate) => candidate.candidateId),
      [suggestPayload.candidate?.candidateId],
    );

    const approveResponse = await postJson(baseUrl, "/api/actors/memory-candidates/review", {
      ...buildIdentityPayload("owner-memory-http"),
      candidateId: suggestPayload.candidate?.candidateId,
      decision: "approve",
    }, authHeaders);

    assert.equal(approveResponse.status, 200);
    const approvePayload = await approveResponse.json() as {
      candidate?: { status?: string; approvedMemoryId?: string };
      memory?: { title?: string };
    };
    assert.equal(approvePayload.candidate?.status, "approved");
    assert.ok(approvePayload.candidate?.approvedMemoryId);
    assert.equal(approvePayload.memory?.title, "回答节奏");

    const rejectSuggestResponse = await postJson(baseUrl, "/api/actors/memory-candidates/suggest", {
      ...buildIdentityPayload("owner-memory-http"),
      candidate: {
        kind: "behavior",
        title: "复盘方式",
        summary: "先列风险，再给建议。",
        rationale: "近期对话更关注风险面。",
        suggestedContent: "复盘时先列风险和回滚面。",
        sourceType: "manual",
        sourceLabel: "owner manual review",
      },
    }, authHeaders);
    const rejectSuggestPayload = await rejectSuggestResponse.json() as {
      candidate?: { candidateId?: string };
    };

    const rejectResponse = await postJson(baseUrl, "/api/actors/memory-candidates/review", {
      ...buildIdentityPayload("owner-memory-http"),
      candidateId: rejectSuggestPayload.candidate?.candidateId,
      decision: "reject",
    }, authHeaders);

    assert.equal(rejectResponse.status, 200);
    const rejectPayload = await rejectResponse.json() as {
      candidate?: { status?: string; candidateId?: string };
      memory?: unknown;
    };
    assert.equal(rejectPayload.candidate?.status, "rejected");
    assert.equal(rejectPayload.memory ?? null, null);

    const archiveResponse = await postJson(baseUrl, "/api/actors/memory-candidates/review", {
      ...buildIdentityPayload("owner-memory-http"),
      candidateId: rejectSuggestPayload.candidate?.candidateId,
      decision: "archive",
    }, authHeaders);

    assert.equal(archiveResponse.status, 200);
    const archivePayload = await archiveResponse.json() as {
      candidate?: { archivedAt?: string };
    };
    assert.ok(typeof archivePayload.candidate?.archivedAt === "string");

    const archivedListResponse = await postJson(baseUrl, "/api/actors/memory-candidates/list", {
      ...buildIdentityPayload("owner-memory-http"),
      includeArchived: true,
      status: "rejected",
      limit: 10,
    }, authHeaders);
    const archivedListPayload = await archivedListResponse.json() as {
      candidates?: Array<{ candidateId?: string; archivedAt?: string }>;
    };

    assert.deepEqual(
      archivedListPayload.candidates?.map((candidate) => candidate.candidateId),
      [rejectSuggestPayload.candidate?.candidateId],
    );
    assert.ok(typeof archivedListPayload.candidates?.[0]?.archivedAt === "string");
  });
});

test("POST /api/actors/memory-candidates/extract 会从已完成任务提炼新候选，并自动去重", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const identity = runtime.getIdentityLinkService().ensureIdentity(buildIdentityPayload("owner-memory-extract"));
    const request = {
      requestId: "req-memory-extract-1",
      taskId: "task-memory-extract-1",
      sourceChannel: "web" as const,
      user: {
        userId: "owner-memory-extract",
        displayName: "Owner",
      },
      goal: "以后默认中文回复。以后先给结论再展开。",
      channelContext: {
        sessionId: "session-memory-extract-1",
        channelSessionKey: "session-memory-extract-1",
      },
      createdAt: "2026-04-06T09:00:00.000Z",
    };
    runtimeStore.upsertTurnFromRequest(request, request.taskId);
    runtimeStore.completeTaskTurn({
      request,
      result: {
        taskId: request.taskId,
        requestId: request.requestId,
        status: "completed",
        summary: "已完成整理。",
        completedAt: "2026-04-06T09:05:00.000Z",
      },
      sessionMode: "created",
      threadId: "thread-memory-extract-1",
    });

    const extractResponse = await postJson(baseUrl, "/api/actors/memory-candidates/extract", {
      ...buildIdentityPayload("owner-memory-extract"),
      requestId: request.requestId,
    }, authHeaders);

    assert.equal(extractResponse.status, 200);
    const extractPayload = await extractResponse.json() as {
      identity?: { principalId?: string };
      requestId?: string;
      candidates?: Array<{ title?: string; status?: string }>;
      updates?: Array<{ action?: string }>;
    };
    assert.equal(extractPayload.identity?.principalId, identity.principalId);
    assert.equal(extractPayload.requestId, request.requestId);
    assert.deepEqual(
      extractPayload.candidates?.map((candidate) => candidate.title),
      ["默认中文沟通", "回答先给结论"],
    );
    assert.ok(extractPayload.candidates?.every((candidate) => candidate.status === "suggested"));
    assert.ok(extractPayload.updates?.every((update) => update.action === "suggested"));

    const dedupedResponse = await postJson(baseUrl, "/api/actors/memory-candidates/extract", {
      ...buildIdentityPayload("owner-memory-extract"),
      requestId: request.requestId,
    }, authHeaders);
    const dedupedPayload = await dedupedResponse.json() as {
      candidates?: Array<unknown>;
      updates?: Array<unknown>;
    };

    assert.equal(dedupedResponse.status, 200);
    assert.deepEqual(dedupedPayload.candidates, []);
    assert.deepEqual(dedupedPayload.updates, []);
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
