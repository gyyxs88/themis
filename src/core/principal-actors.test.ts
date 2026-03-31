import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ACTOR_RUNTIME_MEMORY_KINDS,
  ACTOR_TASK_SCOPE_STATUSES,
  PRINCIPAL_ACTOR_STATUSES,
  PRINCIPAL_MAIN_MEMORY_STATUSES,
} from "../types/index.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

function createRegistryContext() {
  const root = mkdtempSync(join(tmpdir(), "themis-principal-actors-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

  return { root, registry };
}

test("actors 领域枚举遵循计划词汇", () => {
  assert.deepEqual(PRINCIPAL_ACTOR_STATUSES, ["active", "paused", "archived"]);
  assert.deepEqual(PRINCIPAL_MAIN_MEMORY_STATUSES, ["active", "deprecated", "archived"]);
  assert.deepEqual(ACTOR_TASK_SCOPE_STATUSES, [
    "open",
    "completed",
    "failed",
    "cancelled",
    "taken_over",
  ]);
  assert.deepEqual(ACTOR_RUNTIME_MEMORY_KINDS, [
    "progress",
    "observation",
    "blocker",
    "result",
    "handoff",
  ]);
});

test("SqliteCodexSessionRegistry 会按 principal 保存 actor 和 runtime timeline", () => {
  const { root, registry } = createRegistryContext();

  try {
    registry.savePrincipal({
      principalId: "principal-1",
      displayName: "Owner",
      createdAt: "2026-03-31T10:00:00.000Z",
      updatedAt: "2026-03-31T10:00:00.000Z",
    });
    registry.savePrincipal({
      principalId: "principal-2",
      displayName: "Owner 2",
      createdAt: "2026-03-31T10:00:30.000Z",
      updatedAt: "2026-03-31T10:00:30.000Z",
    });

    registry.savePrincipalActor({
      actorId: "actor-frontend-1",
      ownerPrincipalId: "principal-1",
      displayName: "阿策",
      role: "frontend-worker",
      status: "active",
      createdAt: "2026-03-31T10:01:00.000Z",
      updatedAt: "2026-03-31T10:01:00.000Z",
    });
    registry.savePrincipalActor({
      actorId: "actor-frontend-2",
      ownerPrincipalId: "principal-2",
      displayName: "阿别",
      role: "backend-worker",
      status: "active",
      createdAt: "2026-03-31T10:01:30.000Z",
      updatedAt: "2026-03-31T10:01:30.000Z",
    });
    registry.saveActorTaskScope({
      scopeId: "scope-1",
      principalId: "principal-1",
      actorId: "actor-frontend-1",
      taskId: "task-1",
      conversationId: "conversation-1",
      goal: "修复闪烁",
      workspacePath: "/workspace/themis",
      status: "open",
      createdAt: "2026-03-31T10:02:00.000Z",
      updatedAt: "2026-03-31T10:02:00.000Z",
    });
    assert.throws(
      () =>
        registry.saveActorTaskScope({
          scopeId: "scope-cross-1",
          principalId: "principal-1",
          actorId: "actor-frontend-2",
          taskId: "task-cross-1",
          goal: "跨 principal 绑定",
          status: "open",
          createdAt: "2026-03-31T10:02:30.000Z",
          updatedAt: "2026-03-31T10:02:30.000Z",
        }),
      /principal|actor|foreign|constraint/i,
    );
    assert.throws(
      () =>
        registry.appendActorRuntimeMemory({
          runtimeMemoryId: "memory-cross-1",
          principalId: "principal-1",
          actorId: "actor-frontend-2",
          taskId: "task-1",
          conversationId: "conversation-1",
          scopeId: "scope-1",
          kind: "progress",
          title: "跨 principal runtime",
          content: "不该被允许。",
          status: "active",
          createdAt: "2026-03-31T10:03:30.000Z",
        }),
      /principal|actor|scope|foreign|constraint/i,
    );
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "memory-1",
      principalId: "principal-1",
      actorId: "actor-frontend-1",
      taskId: "task-1",
      conversationId: "conversation-1",
      scopeId: "scope-1",
      kind: "progress",
      title: "已读取仓库",
      content: "已定位到 apps/web 的渲染链路。",
      status: "active",
      createdAt: "2026-03-31T10:03:00.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "memory-2",
      principalId: "principal-1",
      actorId: "actor-frontend-1",
      taskId: "task-1",
      conversationId: "conversation-1",
      scopeId: "scope-1",
      kind: "blocker",
      title: "缺少账号权限",
      content: "需要 owner 账号确认线上环境变量。",
      status: "active",
      createdAt: "2026-03-31T10:04:00.000Z",
    });

    assert.deepEqual(
      registry.listPrincipalActors("principal-1").map((actor) => [actor.actorId, actor.displayName, actor.role]),
      [["actor-frontend-1", "阿策", "frontend-worker"]],
    );
    assert.deepEqual(
      registry.listActorTaskTimeline({
        principalId: "principal-1",
        scopeId: "scope-1",
      }).map((entry) => [entry.kind, entry.title]),
      [
        ["progress", "已读取仓库"],
        ["blocker", "缺少账号权限"],
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("appendActorRuntimeMemory 会拒绝重复 runtimeMemoryId", () => {
  const { root, registry } = createRegistryContext();

  try {
    registry.savePrincipal({
      principalId: "principal-dup",
      displayName: "Owner",
      createdAt: "2026-03-31T10:00:00.000Z",
      updatedAt: "2026-03-31T10:00:00.000Z",
    });
    registry.savePrincipalActor({
      actorId: "actor-dup-1",
      ownerPrincipalId: "principal-dup",
      displayName: "阿策",
      role: "frontend-worker",
      status: "active",
      createdAt: "2026-03-31T10:01:00.000Z",
      updatedAt: "2026-03-31T10:01:00.000Z",
    });
    registry.saveActorTaskScope({
      scopeId: "scope-dup-1",
      principalId: "principal-dup",
      actorId: "actor-dup-1",
      taskId: "task-dup-1",
      goal: "重复 ID 测试",
      status: "open",
      createdAt: "2026-03-31T10:02:00.000Z",
      updatedAt: "2026-03-31T10:02:00.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "memory-dup-1",
      principalId: "principal-dup",
      actorId: "actor-dup-1",
      taskId: "task-dup-1",
      scopeId: "scope-dup-1",
      kind: "result",
      title: "首次写入",
      content: "第一条 runtime memory。",
      status: "active",
      createdAt: "2026-03-31T10:03:00.000Z",
    });

    assert.throws(
      () =>
        registry.appendActorRuntimeMemory({
          runtimeMemoryId: "memory-dup-1",
          principalId: "principal-dup",
          actorId: "actor-dup-1",
          taskId: "task-dup-1",
          scopeId: "scope-dup-1",
          kind: "handoff",
          title: "重复写入",
          content: "这条不该覆盖前一条。",
          status: "active",
          createdAt: "2026-03-31T10:04:00.000Z",
        }),
      /constraint|unique|primary key|duplicate/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SqliteCodexSessionRegistry 会分别检索主记忆和 actor runtime memory", () => {
  const { root, registry } = createRegistryContext();

  try {
    registry.savePrincipal({
      principalId: "principal-2",
      displayName: "Owner",
      createdAt: "2026-03-31T10:00:00.000Z",
      updatedAt: "2026-03-31T10:00:00.000Z",
    });
    registry.savePrincipalMainMemory({
      memoryId: "main-memory-1",
      principalId: "principal-2",
      kind: "collaboration-style",
      title: "回答风格",
      summary: "先结论后展开",
      bodyMarkdown: "默认先给结论，再展开分析。",
      sourceType: "themis",
      status: "active",
      createdAt: "2026-03-31T10:01:00.000Z",
      updatedAt: "2026-03-31T10:01:00.000Z",
    });
    registry.savePrincipalActor({
      actorId: "actor-research-1",
      ownerPrincipalId: "principal-2",
      displayName: "阿研",
      role: "research-worker",
      status: "active",
      createdAt: "2026-03-31T10:02:00.000Z",
      updatedAt: "2026-03-31T10:02:00.000Z",
    });
    registry.saveActorTaskScope({
      scopeId: "scope-research-1",
      principalId: "principal-2",
      actorId: "actor-research-1",
      taskId: "task-research-1",
      goal: "整理登录问题",
      status: "open",
      createdAt: "2026-03-31T10:03:00.000Z",
      updatedAt: "2026-03-31T10:03:00.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "runtime-memory-1",
      principalId: "principal-2",
      actorId: "actor-research-1",
      taskId: "task-research-1",
      scopeId: "scope-research-1",
      kind: "observation",
      title: "登录失败线索",
      content: "错误集中在旧 keyring 密码不匹配。",
      status: "active",
      createdAt: "2026-03-31T10:04:00.000Z",
    });

    assert.equal(
      registry.searchPrincipalMainMemory("principal-2", "结论", 5)[0]?.title,
      "回答风格",
    );
    assert.equal(
      registry.searchActorRuntimeMemory({
        principalId: "principal-2",
        actorId: "actor-research-1",
        query: "keyring",
        limit: 5,
      })[0]?.title,
      "登录失败线索",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("searchActorRuntimeMemory 会按 actorId / scopeId / query / limit 组合过滤", () => {
  const { root, registry } = createRegistryContext();

  try {
    registry.savePrincipal({
      principalId: "principal-3",
      displayName: "Owner",
      createdAt: "2026-03-31T10:00:00.000Z",
      updatedAt: "2026-03-31T10:00:00.000Z",
    });
    registry.savePrincipalActor({
      actorId: "actor-frontend-3",
      ownerPrincipalId: "principal-3",
      displayName: "阿策",
      role: "frontend-worker",
      status: "active",
      createdAt: "2026-03-31T10:01:00.000Z",
      updatedAt: "2026-03-31T10:01:00.000Z",
    });
    registry.savePrincipalActor({
      actorId: "actor-research-3",
      ownerPrincipalId: "principal-3",
      displayName: "阿研",
      role: "research-worker",
      status: "paused",
      createdAt: "2026-03-31T10:01:30.000Z",
      updatedAt: "2026-03-31T10:01:30.000Z",
    });
    registry.saveActorTaskScope({
      scopeId: "scope-web-3",
      principalId: "principal-3",
      actorId: "actor-frontend-3",
      taskId: "task-web-3",
      goal: "修复闪烁",
      status: "open",
      createdAt: "2026-03-31T10:02:00.000Z",
      updatedAt: "2026-03-31T10:02:00.000Z",
    });
    registry.saveActorTaskScope({
      scopeId: "scope-research-3",
      principalId: "principal-3",
      actorId: "actor-research-3",
      taskId: "task-research-3",
      goal: "整理登录问题",
      status: "open",
      createdAt: "2026-03-31T10:02:30.000Z",
      updatedAt: "2026-03-31T10:02:30.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "memory-web-3a",
      principalId: "principal-3",
      actorId: "actor-frontend-3",
      taskId: "task-web-3",
      scopeId: "scope-web-3",
      kind: "progress",
      title: "已读取仓库",
      content: "定位到渲染链路。",
      status: "active",
      createdAt: "2026-03-31T10:03:00.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "memory-web-3b",
      principalId: "principal-3",
      actorId: "actor-frontend-3",
      taskId: "task-web-3",
      scopeId: "scope-web-3",
      kind: "observation",
      title: "keyring 线索",
      content: "错误可能与旧 keyring 有关。",
      status: "active",
      createdAt: "2026-03-31T10:04:00.000Z",
    });
    registry.appendActorRuntimeMemory({
      runtimeMemoryId: "memory-research-3a",
      principalId: "principal-3",
      actorId: "actor-research-3",
      taskId: "task-research-3",
      scopeId: "scope-research-3",
      kind: "result",
      title: "登录失败结论",
      content: "结论：旧 keyring 密码不匹配。",
      status: "active",
      createdAt: "2026-03-31T10:05:00.000Z",
    });

    assert.deepEqual(
      registry.searchActorRuntimeMemory({
        principalId: "principal-3",
        actorId: "actor-frontend-3",
        limit: 10,
      }).map((entry) => entry.title),
      ["keyring 线索", "已读取仓库"],
    );
    assert.deepEqual(
      registry.searchActorRuntimeMemory({
        principalId: "principal-3",
        scopeId: "scope-web-3",
        query: "仓库",
        limit: 10,
      }).map((entry) => entry.title),
      ["已读取仓库"],
    );
    assert.deepEqual(
      registry.searchActorRuntimeMemory({
        principalId: "principal-3",
        actorId: "actor-frontend-3",
        scopeId: "scope-web-3",
        query: "keyring",
        limit: 1,
      }).map((entry) => entry.title),
      ["keyring 线索"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
