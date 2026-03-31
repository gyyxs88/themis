import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { CodexTaskRuntime } from "./codex-runtime.js";
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
      goal: "前端闪烁",
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

test("CodexTaskRuntime 会暴露 PrincipalActorsService", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-principal-actors-runtime-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

  try {
    const runtime = new CodexTaskRuntime({
      runtimeStore,
      workingDirectory: root,
      skipGitRepoCheck: true,
    });

    assert.ok(runtime.getPrincipalActorsService() instanceof PrincipalActorsService);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
