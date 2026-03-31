import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

function createRegistryContext() {
  const root = mkdtempSync(join(tmpdir(), "themis-principal-actors-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

  return { root, registry };
}

test("SqliteCodexSessionRegistry 会按 principal 保存 actor 和 runtime timeline", () => {
  const { root, registry } = createRegistryContext();

  try {
    registry.savePrincipal({
      principalId: "principal-1",
      displayName: "Owner",
      createdAt: "2026-03-31T10:00:00.000Z",
      updatedAt: "2026-03-31T10:00:00.000Z",
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
