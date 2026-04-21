import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { AppServerTaskRuntime } from "./app-server-task-runtime.js";
import { PrincipalActorsService } from "./principal-actors-service.js";

function createServiceContext() {
  const root = mkdtempSync(join(tmpdir(), "themis-principal-actors-service-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const service = new PrincipalActorsService({ registry });

  return { root, registry, service };
}

test("PrincipalActorsService 会创建 actor 并按 principal 列表返回", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-03-31T11:00:00.000Z",
      updatedAt: "2026-03-31T11:00:00.000Z",
    });

    const actor = service.createActor({
      principalId: "principal-owner",
      displayName: "阿策",
      role: "frontend-worker",
      now: "2026-03-31T11:01:00.000Z",
    });

    assert.equal(actor.displayName, "阿策");
    assert.equal(service.listActors("principal-owner")[0]?.actorId, actor.actorId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dispatchTaskToActor 会创建 runtime scope，并且只下发主记忆授权视图", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-03-31T11:00:00.000Z",
      updatedAt: "2026-03-31T11:00:00.000Z",
    });
    registry.savePrincipalMainMemory({
      memoryId: "main-memory-style",
      principalId: "principal-owner",
      kind: "collaboration-style",
      title: "回答风格",
      summary: "先结论后展开",
      bodyMarkdown: "默认先给结论，再展开。",
      sourceType: "themis",
      status: "active",
      createdAt: "2026-03-31T11:01:00.000Z",
      updatedAt: "2026-03-31T11:01:00.000Z",
    });
    registry.savePrincipalMainMemory({
      memoryId: "main-memory-flicker-1",
      principalId: "principal-owner",
      kind: "task-note",
      title: "前端闪烁排查记录 1",
      summary: "前端闪烁与首屏 skeleton 竞态有关",
      bodyMarkdown: "前端闪烁排查记录 1",
      sourceType: "themis",
      status: "active",
      createdAt: "2026-03-31T11:01:01.000Z",
      updatedAt: "2026-03-31T11:01:01.000Z",
    });
    registry.savePrincipalMainMemory({
      memoryId: "main-memory-flicker-2",
      principalId: "principal-owner",
      kind: "task-note",
      title: "前端闪烁排查记录 2",
      summary: "前端闪烁与 hydrate 时序有关",
      bodyMarkdown: "前端闪烁排查记录 2",
      sourceType: "themis",
      status: "active",
      createdAt: "2026-03-31T11:01:02.000Z",
      updatedAt: "2026-03-31T11:01:02.000Z",
    });
    registry.savePrincipalMainMemory({
      memoryId: "main-memory-flicker-3",
      principalId: "principal-owner",
      kind: "task-note",
      title: "前端闪烁排查记录 3",
      summary: "前端闪烁与样式回流有关",
      bodyMarkdown: "前端闪烁排查记录 3",
      sourceType: "themis",
      status: "active",
      createdAt: "2026-03-31T11:01:03.000Z",
      updatedAt: "2026-03-31T11:01:03.000Z",
    });
    registry.savePrincipalMainMemory({
      memoryId: "main-memory-flicker-4",
      principalId: "principal-owner",
      kind: "task-note",
      title: "前端闪烁排查记录 4",
      summary: "前端闪烁与缓存抖动有关",
      bodyMarkdown: "前端闪烁排查记录 4",
      sourceType: "themis",
      status: "active",
      createdAt: "2026-03-31T11:01:04.000Z",
      updatedAt: "2026-03-31T11:01:04.000Z",
    });
    registry.savePrincipalMainMemory({
      memoryId: "main-memory-flicker-5",
      principalId: "principal-owner",
      kind: "task-note",
      title: "前端闪烁排查记录 5",
      summary: "前端闪烁与过渡动画有关",
      bodyMarkdown: "前端闪烁排查记录 5",
      sourceType: "themis",
      status: "active",
      createdAt: "2026-03-31T11:01:05.000Z",
      updatedAt: "2026-03-31T11:01:05.000Z",
    });
    registry.savePrincipalMainMemory({
      memoryId: "main-memory-flicker-6",
      principalId: "principal-owner",
      kind: "task-note",
      title: "前端闪烁排查记录 6",
      summary: "前端闪烁与图片尺寸抖动有关",
      bodyMarkdown: "前端闪烁排查记录 6",
      sourceType: "themis",
      status: "active",
      createdAt: "2026-03-31T11:01:06.000Z",
      updatedAt: "2026-03-31T11:01:06.000Z",
    });
    registry.savePrincipalActor({
      actorId: "actor-frontend-1",
      ownerPrincipalId: "principal-owner",
      displayName: "阿策",
      role: "frontend-worker",
      status: "active",
      createdAt: "2026-03-31T11:02:00.000Z",
      updatedAt: "2026-03-31T11:02:00.000Z",
    });
    registry.savePrincipalActor({
      actorId: "actor-research-1",
      ownerPrincipalId: "principal-owner",
      displayName: "阿研",
      role: "research-worker",
      status: "active",
      createdAt: "2026-03-31T11:02:30.000Z",
      updatedAt: "2026-03-31T11:02:30.000Z",
    });
    registry.saveActorTaskScope({
      scopeId: "scope-other",
      principalId: "principal-owner",
      actorId: "actor-research-1",
      taskId: "task-other",
      goal: "别的员工草稿",
      status: "open",
      createdAt: "2026-03-31T11:03:00.000Z",
      updatedAt: "2026-03-31T11:03:00.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "runtime-other-1",
      principalId: "principal-owner",
      actorId: "actor-research-1",
      taskId: "task-other",
      scopeId: "scope-other",
      kind: "observation",
      title: "别的员工草稿",
      content: "这条不该被派工包看到。",
      status: "active",
      createdAt: "2026-03-31T11:04:00.000Z",
    });

    const packet = service.dispatchTaskToActor({
      principalId: "principal-owner",
      actorId: "actor-frontend-1",
      taskId: "task-frontend-1",
      conversationId: "conversation-1",
      goal: "修复前端闪烁",
      workspacePath: "/workspace/themis",
      now: "2026-03-31T11:05:00.000Z",
    });

    assert.equal(packet.actor.displayName, "阿策");
    assert.equal(packet.scope.taskId, "task-frontend-1");
    assert.equal(
      registry.getActorTaskScope("principal-owner", packet.scope.scopeId)?.scopeId,
      packet.scope.scopeId,
    );
    assert.deepEqual(packet.authorizedMemory.map((item) => item.title), [
      "前端闪烁排查记录 6",
      "前端闪烁排查记录 5",
      "前端闪烁排查记录 4",
      "前端闪烁排查记录 3",
      "前端闪烁排查记录 2",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("appendActorRuntimeMemory 会拒绝 scope.taskId 不一致的写入", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-03-31T11:00:00.000Z",
      updatedAt: "2026-03-31T11:00:00.000Z",
    });
    registry.savePrincipalActor({
      actorId: "actor-ops-1",
      ownerPrincipalId: "principal-owner",
      displayName: "阿运",
      role: "ops-worker",
      status: "active",
      createdAt: "2026-03-31T11:01:00.000Z",
      updatedAt: "2026-03-31T11:01:00.000Z",
    });
    registry.saveActorTaskScope({
      scopeId: "scope-ops-1",
      principalId: "principal-owner",
      actorId: "actor-ops-1",
      taskId: "task-ops-1",
      goal: "检查生产链路",
      status: "open",
      createdAt: "2026-03-31T11:02:00.000Z",
      updatedAt: "2026-03-31T11:02:00.000Z",
    });

    assert.throws(
      () =>
        service.appendActorRuntimeMemory({
          principalId: "principal-owner",
          actorId: "actor-ops-1",
          taskId: "task-ops-2",
          scopeId: "scope-ops-1",
          kind: "progress",
          title: "污染写入",
          content: "不该写入另一个 task。",
          status: "active",
          createdAt: "2026-03-31T11:03:00.000Z",
        }),
      /task|scope/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("takeOverActorTask 会返回 timeline 与 handoff 摘要", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-03-31T11:00:00.000Z",
      updatedAt: "2026-03-31T11:00:00.000Z",
    });
    registry.savePrincipalActor({
      actorId: "actor-ops-1",
      ownerPrincipalId: "principal-owner",
      displayName: "阿运",
      role: "ops-worker",
      status: "active",
      createdAt: "2026-03-31T11:01:00.000Z",
      updatedAt: "2026-03-31T11:01:00.000Z",
    });
    registry.saveActorTaskScope({
      scopeId: "scope-ops-1",
      principalId: "principal-owner",
      actorId: "actor-ops-1",
      taskId: "task-ops-1",
      goal: "检查生产链路",
      status: "open",
      createdAt: "2026-03-31T11:02:00.000Z",
      updatedAt: "2026-03-31T11:02:00.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "runtime-ops-1",
      principalId: "principal-owner",
      actorId: "actor-ops-1",
      taskId: "task-ops-1",
      scopeId: "scope-ops-1",
      kind: "progress",
      title: "已查看日志",
      content: "已确认 502 发生在 gateway 层。",
      status: "active",
      createdAt: "2026-03-31T11:03:00.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "runtime-ops-2",
      principalId: "principal-owner",
      actorId: "actor-ops-1",
      taskId: "task-ops-1",
      scopeId: "scope-ops-1",
      kind: "result",
      title: "初步结论",
      content: "问题集中在 gateway 配置漂移。",
      status: "active",
      createdAt: "2026-03-31T11:03:30.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "runtime-ops-3",
      principalId: "principal-owner",
      actorId: "actor-ops-1",
      taskId: "task-ops-1",
      scopeId: "scope-ops-1",
      kind: "blocker",
      title: "缺少线上变量",
      content: "需要 owner 补充生产环境网关配置。",
      status: "active",
      createdAt: "2026-03-31T11:04:00.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "runtime-ops-polluted",
      principalId: "principal-owner",
      actorId: "actor-ops-1",
      taskId: "task-ops-2",
      scopeId: "scope-ops-1",
      kind: "result",
      title: "跨 task 污染",
      content: "这条不该被 scope-ops-1 takeover 看到。",
      status: "active",
      createdAt: "2026-03-31T11:05:00.000Z",
    });

    const takeover = service.takeOverActorTask({
      principalId: "principal-owner",
      actorId: "actor-ops-1",
      scopeId: "scope-ops-1",
    });

    assert.equal(takeover.actor.displayName, "阿运");
    assert.equal(takeover.timeline.length, 3);
    assert.equal(takeover.handoff.goal, "检查生产链路");
    assert.equal(takeover.handoff.latestResult, "问题集中在 gateway 配置漂移。");
    assert.equal(takeover.handoff.latestBlocker, "需要 owner 补充生产环境网关配置。");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("getActorTaskTimeline 在传 taskId 和 limit 时会先按 taskId 过滤再限量", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-03-31T11:00:00.000Z",
      updatedAt: "2026-03-31T11:00:00.000Z",
    });
    registry.savePrincipalActor({
      actorId: "actor-dev-1",
      ownerPrincipalId: "principal-owner",
      displayName: "阿策",
      role: "frontend-worker",
      status: "active",
      createdAt: "2026-03-31T11:01:00.000Z",
      updatedAt: "2026-03-31T11:01:00.000Z",
    });
    registry.saveActorTaskScope({
      scopeId: "scope-a",
      principalId: "principal-owner",
      actorId: "actor-dev-1",
      taskId: "task-a",
      goal: "别的任务",
      status: "open",
      createdAt: "2026-03-31T11:02:00.000Z",
      updatedAt: "2026-03-31T11:02:00.000Z",
    });
    registry.saveActorTaskScope({
      scopeId: "scope-b",
      principalId: "principal-owner",
      actorId: "actor-dev-1",
      taskId: "task-b",
      goal: "目标任务",
      status: "open",
      createdAt: "2026-03-31T11:02:30.000Z",
      updatedAt: "2026-03-31T11:02:30.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "runtime-a-1",
      principalId: "principal-owner",
      actorId: "actor-dev-1",
      taskId: "task-a",
      scopeId: "scope-a",
      kind: "progress",
      title: "别的任务 1",
      content: "会先占掉旧实现的 limit 配额。",
      status: "active",
      createdAt: "2026-03-31T11:03:00.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "runtime-a-2",
      principalId: "principal-owner",
      actorId: "actor-dev-1",
      taskId: "task-a",
      scopeId: "scope-a",
      kind: "progress",
      title: "别的任务 2",
      content: "会先占掉旧实现的 limit 配额。",
      status: "active",
      createdAt: "2026-03-31T11:03:30.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "runtime-b-1",
      principalId: "principal-owner",
      actorId: "actor-dev-1",
      taskId: "task-b",
      scopeId: "scope-b",
      kind: "progress",
      title: "目标任务 1",
      content: "这是 task-b 的第一条。",
      status: "active",
      createdAt: "2026-03-31T11:04:00.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "runtime-b-2",
      principalId: "principal-owner",
      actorId: "actor-dev-1",
      taskId: "task-b",
      scopeId: "scope-b",
      kind: "result",
      title: "目标任务 2",
      content: "这是 task-b 的第二条。",
      status: "active",
      createdAt: "2026-03-31T11:04:30.000Z",
    });

    const timeline = service.getActorTaskTimeline({
      principalId: "principal-owner",
      actorId: "actor-dev-1",
      taskId: "task-b",
      limit: 2,
    });

    assert.deepEqual(timeline.map((entry) => entry.runtimeMemoryId), [
      "runtime-b-1",
      "runtime-b-2",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("getActorTaskTimeline 在只传 scopeId 时会过滤掉与 scope 不匹配的脏历史", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-03-31T11:00:00.000Z",
      updatedAt: "2026-03-31T11:00:00.000Z",
    });
    registry.savePrincipalActor({
      actorId: "actor-ops-1",
      ownerPrincipalId: "principal-owner",
      displayName: "阿运",
      role: "ops-worker",
      status: "active",
      createdAt: "2026-03-31T11:01:00.000Z",
      updatedAt: "2026-03-31T11:01:00.000Z",
    });
    registry.saveActorTaskScope({
      scopeId: "scope-ops-1",
      principalId: "principal-owner",
      actorId: "actor-ops-1",
      taskId: "task-ops-1",
      goal: "检查生产链路",
      status: "open",
      createdAt: "2026-03-31T11:02:00.000Z",
      updatedAt: "2026-03-31T11:02:00.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "runtime-ops-1",
      principalId: "principal-owner",
      actorId: "actor-ops-1",
      taskId: "task-ops-1",
      scopeId: "scope-ops-1",
      kind: "progress",
      title: "正常记录",
      content: "这条属于 task-ops-1。",
      status: "active",
      createdAt: "2026-03-31T11:03:00.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "runtime-ops-polluted",
      principalId: "principal-owner",
      actorId: "actor-ops-1",
      taskId: "task-ops-2",
      scopeId: "scope-ops-1",
      kind: "result",
      title: "脏历史",
      content: "这条不该被 scope-ops-1 的 timeline 读到。",
      status: "active",
      createdAt: "2026-03-31T11:04:00.000Z",
    });

    const timeline = service.getActorTaskTimeline({
      principalId: "principal-owner",
      scopeId: "scope-ops-1",
    });

    assert.deepEqual(timeline.map((entry) => entry.runtimeMemoryId), ["runtime-ops-1"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("suggestMainMemoryCandidate 与 reviewMainMemoryCandidate 会把候选和正式主记忆分离", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-memory-owner",
      displayName: "Owner",
      createdAt: "2026-04-02T13:00:00.000Z",
      updatedAt: "2026-04-02T13:00:00.000Z",
    });

    const candidate = service.suggestMainMemoryCandidate({
      principalId: "principal-memory-owner",
      kind: "preference",
      title: "回答节奏",
      summary: "先结论后展开。",
      rationale: "最近多轮协作都希望先收结论。",
      suggestedContent: "默认先给结论，再补过程和依据。",
      sourceType: "themis",
      sourceLabel: "session session-memory-owner-1 / task task-memory-owner-1",
      sourceTaskId: "task-memory-owner-1",
      sourceConversationId: "session-memory-owner-1",
      now: "2026-04-02T13:01:00.000Z",
    });

    assert.equal(candidate.status, "suggested");
    assert.equal(candidate.sourceTaskId, "task-memory-owner-1");
    assert.equal(service.searchMainMemory("principal-memory-owner", "结论", 5).length, 0);

    const approved = service.reviewMainMemoryCandidate({
      principalId: "principal-memory-owner",
      candidateId: candidate.candidateId,
      decision: "approve",
      now: "2026-04-02T13:02:00.000Z",
    });

    assert.equal(approved.candidate.status, "approved");
    assert.ok(approved.memory);
    assert.equal(approved.memory?.title, "回答节奏");
    assert.equal(service.searchMainMemory("principal-memory-owner", "结论", 5)[0]?.title, "回答节奏");

    const rejectedCandidate = service.suggestMainMemoryCandidate({
      principalId: "principal-memory-owner",
      kind: "behavior",
      title: "复盘方式",
      summary: "先列风险，再给建议。",
      rationale: "用户最近更常先问风险边界。",
      suggestedContent: "复盘时先列风险和回滚面。",
      sourceType: "manual",
      sourceLabel: "owner manual review",
      now: "2026-04-02T13:03:00.000Z",
    });

    const rejected = service.reviewMainMemoryCandidate({
      principalId: "principal-memory-owner",
      candidateId: rejectedCandidate.candidateId,
      decision: "reject",
      now: "2026-04-02T13:04:00.000Z",
    });
    assert.equal(rejected.candidate.status, "rejected");
    assert.equal(rejected.memory ?? null, null);

    const archived = service.reviewMainMemoryCandidate({
      principalId: "principal-memory-owner",
      candidateId: rejectedCandidate.candidateId,
      decision: "archive",
      now: "2026-04-02T13:05:00.000Z",
    });
    assert.equal(archived.candidate.archivedAt, "2026-04-02T13:05:00.000Z");
    assert.deepEqual(
      service.listMainMemoryCandidates({
        principalId: "principal-memory-owner",
        limit: 10,
      }).map((item) => item.candidateId),
      [candidate.candidateId],
    );
    assert.deepEqual(
      service.listMainMemoryCandidates({
        principalId: "principal-memory-owner",
        includeArchived: true,
        status: "rejected",
        limit: 10,
      }).map((item) => item.candidateId),
      [rejectedCandidate.candidateId],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("getActorTaskTimeline 在传 scopeId 和冲突 taskId 时仍以 scope 元数据为准", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-03-31T11:00:00.000Z",
      updatedAt: "2026-03-31T11:00:00.000Z",
    });
    registry.savePrincipalActor({
      actorId: "actor-ops-1",
      ownerPrincipalId: "principal-owner",
      displayName: "阿运",
      role: "ops-worker",
      status: "active",
      createdAt: "2026-03-31T11:01:00.000Z",
      updatedAt: "2026-03-31T11:01:00.000Z",
    });
    registry.saveActorTaskScope({
      scopeId: "scope-ops-1",
      principalId: "principal-owner",
      actorId: "actor-ops-1",
      taskId: "task-ops-1",
      goal: "检查生产链路",
      status: "open",
      createdAt: "2026-03-31T11:02:00.000Z",
      updatedAt: "2026-03-31T11:02:00.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "runtime-ops-1",
      principalId: "principal-owner",
      actorId: "actor-ops-1",
      taskId: "task-ops-1",
      scopeId: "scope-ops-1",
      kind: "progress",
      title: "正常记录",
      content: "这条属于 task-ops-1。",
      status: "active",
      createdAt: "2026-03-31T11:03:00.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "runtime-ops-polluted",
      principalId: "principal-owner",
      actorId: "actor-ops-1",
      taskId: "task-ops-2",
      scopeId: "scope-ops-1",
      kind: "result",
      title: "脏历史",
      content: "这条不该被 scope-ops-1 的 timeline 读到。",
      status: "active",
      createdAt: "2026-03-31T11:04:00.000Z",
    });

    const timeline = service.getActorTaskTimeline({
      principalId: "principal-owner",
      scopeId: "scope-ops-1",
      taskId: "task-ops-2",
    });

    assert.deepEqual(timeline.map((entry) => entry.runtimeMemoryId), ["runtime-ops-1"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AppServerTaskRuntime 会暴露 PrincipalActorsService", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-principal-actors-runtime-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

  try {
    const runtime = new AppServerTaskRuntime({
      runtimeStore,
      workingDirectory: root,
    });

    assert.ok(runtime.getPrincipalActorsService() instanceof PrincipalActorsService);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
