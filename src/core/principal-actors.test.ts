import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
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

function seedPrincipalActorMemoryState(
  registry: SqliteCodexSessionRegistry,
  options: {
    principalId: string;
    actorId: string;
    memoryId: string;
    scopeId: string;
    runtimeMemoryId: string;
    taskId: string;
    conversationId?: string;
  },
) {
  registry.savePrincipalMainMemory({
    memoryId: options.memoryId,
    principalId: options.principalId,
    kind: "preference",
    title: `主记忆-${options.principalId}`,
    summary: "先结论后展开",
    bodyMarkdown: "默认先给结论，再展开分析。",
    sourceType: "themis",
    status: "active",
    createdAt: "2026-03-31T11:01:00.000Z",
    updatedAt: "2026-03-31T11:01:00.000Z",
  });

  registry.savePrincipalActor({
    actorId: options.actorId,
    ownerPrincipalId: options.principalId,
    displayName: `演员-${options.actorId}`,
    role: "research-worker",
    status: "active",
    createdAt: "2026-03-31T11:02:00.000Z",
    updatedAt: "2026-03-31T11:02:00.000Z",
  });

  registry.saveActorTaskScope({
    scopeId: options.scopeId,
    principalId: options.principalId,
    actorId: options.actorId,
    taskId: options.taskId,
    goal: `任务-${options.taskId}`,
    workspacePath: "/workspace/themis",
    status: "open",
    createdAt: "2026-03-31T11:03:00.000Z",
    updatedAt: "2026-03-31T11:03:00.000Z",
    ...(options.conversationId ? { conversationId: options.conversationId } : {}),
  });

  registry.appendActorRuntimeMemory({
    runtimeMemoryId: options.runtimeMemoryId,
    principalId: options.principalId,
    actorId: options.actorId,
    taskId: options.taskId,
    scopeId: options.scopeId,
    kind: "progress",
    title: `runtime-${options.runtimeMemoryId}`,
    content: "已经完成上下文扫描。",
    status: "active",
    createdAt: "2026-03-31T11:04:00.000Z",
    ...(options.conversationId ? { conversationId: options.conversationId } : {}),
  });
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

test("savePrincipalMainMemory 会拒绝跨 principal 重挂 memoryId", () => {
  const { root, registry } = createRegistryContext();

  try {
    registry.savePrincipal({
      principalId: "principal-main-1",
      displayName: "Owner 1",
      createdAt: "2026-03-31T10:00:00.000Z",
      updatedAt: "2026-03-31T10:00:00.000Z",
    });
    registry.savePrincipal({
      principalId: "principal-main-2",
      displayName: "Owner 2",
      createdAt: "2026-03-31T10:00:30.000Z",
      updatedAt: "2026-03-31T10:00:30.000Z",
    });

    registry.savePrincipalMainMemory({
      memoryId: "main-memory-shared",
      principalId: "principal-main-1",
      kind: "preference",
      title: "回答节奏",
      summary: "先结论后展开",
      bodyMarkdown: "先给结论，再展开分析。",
      sourceType: "themis",
      status: "active",
      createdAt: "2026-03-31T10:01:00.000Z",
      updatedAt: "2026-03-31T10:01:00.000Z",
    });

    assert.throws(
      () =>
        registry.savePrincipalMainMemory({
          memoryId: "main-memory-shared",
          principalId: "principal-main-2",
          kind: "preference",
          title: "回答节奏",
          summary: "先结论后展开",
          bodyMarkdown: "这条不该抢走别人的 memory。",
          sourceType: "themis",
          status: "active",
          createdAt: "2026-03-31T10:02:00.000Z",
          updatedAt: "2026-03-31T10:02:00.000Z",
        }),
      /principal main memory belongs to another principal/i,
    );

    assert.equal(registry.searchPrincipalMainMemory("principal-main-1", "回答", 5)[0]?.title, "回答节奏");
    assert.equal(registry.searchPrincipalMainMemory("principal-main-2", "回答", 5).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("savePrincipalActor / savePrincipalMainMemory / saveActorTaskScope 在 changes=0 时会抛错", () => {
  const { root, registry } = createRegistryContext();

  try {
    const noopDb = {
      prepare(sql: string) {
        if (
          sql.includes("FROM themis_principal_actors") &&
          sql.includes("WHERE owner_principal_id = ?") &&
          sql.includes("AND actor_id = ?")
        ) {
          return {
            get: () => ({ owner_principal_id: "principal-noop", actor_id: "actor-noop-1" }),
          };
        }

        if (sql.includes("FROM themis_principal_actors") && sql.includes("WHERE actor_id = ?")) {
          return {
            get: () => ({ owner_principal_id: "principal-noop" }),
          };
        }

        if (sql.includes("FROM themis_principal_main_memory") && sql.includes("WHERE memory_id = ?")) {
          return {
            get: () => ({ principal_id: "principal-noop" }),
          };
        }

        if (sql.includes("FROM themis_actor_task_scopes") && sql.includes("WHERE scope_id = ?")) {
          return {
            get: () => ({ principal_id: "principal-noop" }),
          };
        }

        if (sql.includes("INSERT INTO themis_principal_actors")) {
          return {
            run: () => ({ changes: 0 }),
          };
        }

        if (sql.includes("INSERT INTO themis_principal_main_memory")) {
          return {
            run: () => ({ changes: 0 }),
          };
        }

        if (sql.includes("INSERT INTO themis_actor_task_scopes")) {
          return {
            run: () => ({ changes: 0 }),
          };
        }

        throw new Error(`Unexpected SQL in noop test: ${sql}`);
      },
    };

    (registry as unknown as { db: typeof noopDb }).db = noopDb;

    assert.throws(
      () =>
        registry.savePrincipalActor({
          actorId: "actor-noop-1",
          ownerPrincipalId: "principal-noop",
          displayName: "阿策",
          role: "frontend-worker",
          status: "active",
          createdAt: "2026-03-31T10:01:00.000Z",
          updatedAt: "2026-03-31T10:01:00.000Z",
        }),
      /did not apply|changes|no-op/i,
    );

    assert.throws(
      () =>
        registry.savePrincipalMainMemory({
          memoryId: "memory-noop-1",
          principalId: "principal-noop",
          kind: "preference",
          title: "回答节奏",
          summary: "先结论后展开",
          bodyMarkdown: "先给结论，再展开分析。",
          sourceType: "themis",
          status: "active",
          createdAt: "2026-03-31T10:02:00.000Z",
          updatedAt: "2026-03-31T10:02:00.000Z",
        }),
      /did not apply|changes|no-op/i,
    );

    assert.throws(
      () =>
        registry.saveActorTaskScope({
          scopeId: "scope-noop-1",
          principalId: "principal-noop",
          actorId: "actor-noop-1",
          taskId: "task-noop-1",
          goal: "校验 no-op",
          status: "open",
          createdAt: "2026-03-31T10:03:00.000Z",
          updatedAt: "2026-03-31T10:03:00.000Z",
        }),
      /did not apply|changes|no-op/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SqliteCodexSessionRegistry 会保存长期记忆候选，并支持状态/归档/搜索过滤", () => {
  const { root, registry } = createRegistryContext();

  try {
    registry.savePrincipal({
      principalId: "principal-candidate-1",
      displayName: "Owner",
      createdAt: "2026-04-02T12:00:00.000Z",
      updatedAt: "2026-04-02T12:00:00.000Z",
    });

    registry.savePrincipalMainMemoryCandidate({
      candidateId: "candidate-suggested-1",
      principalId: "principal-candidate-1",
      kind: "preference",
      title: "回答节奏",
      summary: "偏好先给结论再展开。",
      rationale: "最近多轮对话都要求先结论后展开。",
      suggestedContent: "默认先给结论，再补过程和依据。",
      sourceType: "themis",
      sourceLabel: "session session-candidate-1 / task task-candidate-1",
      sourceTaskId: "task-candidate-1",
      sourceConversationId: "session-candidate-1",
      status: "suggested",
      createdAt: "2026-04-02T12:01:00.000Z",
      updatedAt: "2026-04-02T12:01:00.000Z",
    });
    registry.savePrincipalMainMemoryCandidate({
      candidateId: "candidate-rejected-1",
      principalId: "principal-candidate-1",
      kind: "behavior",
      title: "复盘方式",
      summary: "倾向先列风险再给建议。",
      rationale: "用户更关注风险排查。",
      suggestedContent: "复盘时优先列风险和回滚面。",
      sourceType: "manual",
      sourceLabel: "owner manual review",
      status: "rejected",
      reviewedAt: "2026-04-02T12:02:30.000Z",
      createdAt: "2026-04-02T12:02:00.000Z",
      updatedAt: "2026-04-02T12:02:30.000Z",
    });
    registry.savePrincipalMainMemory({
      memoryId: "main-memory-approved-1",
      principalId: "principal-candidate-1",
      kind: "task-note",
      title: "上线排障偏好",
      summary: "故障排查时先看 doctor。",
      bodyMarkdown: "遇到线上问题先跑 doctor，再决定是否深入。",
      sourceType: "themis",
      status: "active",
      createdAt: "2026-04-02T12:03:30.000Z",
      updatedAt: "2026-04-02T12:04:00.000Z",
    });
    registry.savePrincipalMainMemoryCandidate({
      candidateId: "candidate-approved-1",
      principalId: "principal-candidate-1",
      kind: "task-note",
      title: "上线排障偏好",
      summary: "故障排查时先看 doctor。",
      rationale: "近期多次诊断都从 doctor 起步。",
      suggestedContent: "遇到线上问题先跑 doctor，再决定是否深入。",
      sourceType: "themis",
      sourceLabel: "session session-candidate-2 / task task-candidate-2",
      status: "approved",
      approvedMemoryId: "main-memory-approved-1",
      reviewedAt: "2026-04-02T12:04:00.000Z",
      archivedAt: "2026-04-02T12:05:00.000Z",
      createdAt: "2026-04-02T12:03:00.000Z",
      updatedAt: "2026-04-02T12:05:00.000Z",
    });

    const defaultList = registry.listPrincipalMainMemoryCandidates({
      principalId: "principal-candidate-1",
      limit: 10,
    });
    assert.deepEqual(defaultList.map((item) => item.candidateId), [
      "candidate-rejected-1",
      "candidate-suggested-1",
    ]);

    const suggestedOnly = registry.listPrincipalMainMemoryCandidates({
      principalId: "principal-candidate-1",
      status: "suggested",
      query: "先给结论",
      limit: 10,
    });
    assert.deepEqual(suggestedOnly.map((item) => item.candidateId), ["candidate-suggested-1"]);

    const archivedApproved = registry.listPrincipalMainMemoryCandidates({
      principalId: "principal-candidate-1",
      status: "approved",
      includeArchived: true,
      query: "doctor",
      limit: 10,
    });
    assert.deepEqual(archivedApproved.map((item) => item.candidateId), ["candidate-approved-1"]);
    assert.equal(archivedApproved[0]?.approvedMemoryId, "main-memory-approved-1");
    assert.equal(archivedApproved[0]?.archivedAt, "2026-04-02T12:05:00.000Z");

    const loaded = registry.getPrincipalMainMemoryCandidate("principal-candidate-1", "candidate-suggested-1");
    assert.equal(loaded?.sourceTaskId, "task-candidate-1");
    assert.equal(loaded?.sourceConversationId, "session-candidate-1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("savePrincipalMainMemoryCandidate 会拒绝跨 principal 重挂 candidateId", () => {
  const { root, registry } = createRegistryContext();

  try {
    registry.savePrincipal({
      principalId: "principal-candidate-owner-1",
      displayName: "Owner 1",
      createdAt: "2026-04-02T12:00:00.000Z",
      updatedAt: "2026-04-02T12:00:00.000Z",
    });
    registry.savePrincipal({
      principalId: "principal-candidate-owner-2",
      displayName: "Owner 2",
      createdAt: "2026-04-02T12:00:30.000Z",
      updatedAt: "2026-04-02T12:00:30.000Z",
    });

    registry.savePrincipalMainMemoryCandidate({
      candidateId: "candidate-shared-1",
      principalId: "principal-candidate-owner-1",
      kind: "preference",
      title: "回答节奏",
      summary: "先结论后展开",
      rationale: "Owner 1 偏好如此。",
      suggestedContent: "默认先给结论，再展开分析。",
      sourceType: "themis",
      sourceLabel: "session candidate-shared-owner-1",
      status: "suggested",
      createdAt: "2026-04-02T12:01:00.000Z",
      updatedAt: "2026-04-02T12:01:00.000Z",
    });

    assert.throws(
      () =>
        registry.savePrincipalMainMemoryCandidate({
          candidateId: "candidate-shared-1",
          principalId: "principal-candidate-owner-2",
          kind: "preference",
          title: "回答节奏",
          summary: "先结论后展开",
          rationale: "这条不该抢走别人的候选。",
          suggestedContent: "默认先给结论，再展开分析。",
          sourceType: "manual",
          sourceLabel: "owner manual review",
          status: "suggested",
          createdAt: "2026-04-02T12:02:00.000Z",
          updatedAt: "2026-04-02T12:02:00.000Z",
        }),
      /principal main memory candidate belongs to another principal/i,
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

test("旧 actor memory schema 打开后会升级到复合约束", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-principal-actors-legacy-"));
  const databaseFile = join(root, "infra/local/themis.db");
  mkdirSync(join(root, "infra/local"), { recursive: true });
  const legacyDatabase = new Database(databaseFile);

  try {
    legacyDatabase.exec(`
      CREATE TABLE themis_principals (
        principal_id TEXT PRIMARY KEY,
        display_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE themis_principal_actors (
        actor_id TEXT PRIMARY KEY,
        owner_principal_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE TABLE themis_actor_task_scopes (
        scope_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        conversation_id TEXT,
        goal TEXT NOT NULL,
        workspace_path TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE,
        FOREIGN KEY (actor_id) REFERENCES themis_principal_actors(actor_id) ON DELETE CASCADE
      );

      CREATE TABLE themis_actor_runtime_memory (
        runtime_memory_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        conversation_id TEXT,
        scope_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE,
        FOREIGN KEY (actor_id) REFERENCES themis_principal_actors(actor_id) ON DELETE CASCADE,
        FOREIGN KEY (scope_id) REFERENCES themis_actor_task_scopes(scope_id) ON DELETE CASCADE
      );

      PRAGMA user_version = 12;
    `);

    legacyDatabase.prepare(
      `
        INSERT INTO themis_principals (
          principal_id,
          display_name,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?)
      `,
    ).run(
      "principal-legacy",
      "Legacy Owner",
      "2026-03-31T09:59:00.000Z",
      "2026-03-31T09:59:00.000Z",
    );
    legacyDatabase.prepare(
      `
        INSERT INTO themis_principal_actors (
          actor_id,
          owner_principal_id,
          display_name,
          role,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "actor-legacy-1",
      "principal-legacy",
      "阿旧",
      "frontend-worker",
      "active",
      "2026-03-31T10:00:00.000Z",
      "2026-03-31T10:00:00.000Z",
    );
    legacyDatabase.prepare(
      `
        INSERT INTO themis_actor_task_scopes (
          scope_id,
          principal_id,
          actor_id,
          task_id,
          conversation_id,
          goal,
          workspace_path,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "scope-legacy-1",
      "principal-legacy",
      "actor-legacy-1",
      "task-legacy-1",
      "conversation-legacy-1",
      "迁移前测试",
      "/workspace/legacy",
      "open",
      "2026-03-31T10:01:00.000Z",
      "2026-03-31T10:01:00.000Z",
    );
    legacyDatabase.prepare(
      `
        INSERT INTO themis_actor_runtime_memory (
          runtime_memory_id,
          principal_id,
          actor_id,
          task_id,
          conversation_id,
          scope_id,
          kind,
          title,
          content,
          status,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "memory-legacy-1",
      "principal-legacy",
      "actor-legacy-1",
      "task-legacy-1",
      "conversation-legacy-1",
      "scope-legacy-1",
      "progress",
      "迁移前进度",
      "旧库里的一条 runtime memory。",
      "active",
      "2026-03-31T10:02:00.000Z",
    );
    legacyDatabase.close();

    const registry = new SqliteCodexSessionRegistry({
      databaseFile,
    });

    const inspector = new Database(databaseFile, { readonly: true });

    try {
      const actorSql = inspector
        .prepare(
          `
            SELECT sql
            FROM sqlite_master
            WHERE type = 'table'
              AND name = ?
          `,
        )
        .get("themis_principal_actors") as { sql?: string } | undefined;
      const scopeSql = inspector
        .prepare(
          `
            SELECT sql
            FROM sqlite_master
            WHERE type = 'table'
              AND name = ?
          `,
        )
        .get("themis_actor_task_scopes") as { sql?: string } | undefined;
      const runtimeSql = inspector
        .prepare(
          `
            SELECT sql
            FROM sqlite_master
            WHERE type = 'table'
              AND name = ?
          `,
        )
        .get("themis_actor_runtime_memory") as { sql?: string } | undefined;

      assert.match(actorSql?.sql ?? "", /UNIQUE\s*\(\s*owner_principal_id\s*,\s*actor_id\s*\)/i);
      assert.match(scopeSql?.sql ?? "", /FOREIGN KEY\s*\(\s*principal_id\s*,\s*actor_id\s*\)/i);
      assert.match(scopeSql?.sql ?? "", /UNIQUE\s*\(\s*principal_id\s*,\s*scope_id\s*\)/i);
      assert.match(runtimeSql?.sql ?? "", /FOREIGN KEY\s*\(\s*principal_id\s*,\s*actor_id\s*\)/i);
      assert.match(runtimeSql?.sql ?? "", /FOREIGN KEY\s*\(\s*principal_id\s*,\s*scope_id\s*\)/i);

      assert.deepEqual(
        registry.listPrincipalActors("principal-legacy").map((actor) => actor.actorId),
        ["actor-legacy-1"],
      );
      assert.deepEqual(
        registry.listActorTaskTimeline({
          principalId: "principal-legacy",
          scopeId: "scope-legacy-1",
        }).map((entry) => entry.title),
        ["迁移前进度"],
      );
    } finally {
      inspector.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("脏 legacy actor memory 数据会在升级时被 foreign_key_check 拦下", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-principal-actors-dirty-"));
  const databaseFile = join(root, "infra/local/themis.db");
  mkdirSync(join(root, "infra/local"), { recursive: true });
  const legacyDatabase = new Database(databaseFile);

  try {
    legacyDatabase.exec(`
      CREATE TABLE themis_principals (
        principal_id TEXT PRIMARY KEY,
        display_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE themis_principal_actors (
        actor_id TEXT PRIMARY KEY,
        owner_principal_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE TABLE themis_actor_task_scopes (
        scope_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        conversation_id TEXT,
        goal TEXT NOT NULL,
        workspace_path TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE,
        FOREIGN KEY (actor_id) REFERENCES themis_principal_actors(actor_id) ON DELETE CASCADE
      );

      CREATE TABLE themis_actor_runtime_memory (
        runtime_memory_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        conversation_id TEXT,
        scope_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE,
        FOREIGN KEY (actor_id) REFERENCES themis_principal_actors(actor_id) ON DELETE CASCADE,
        FOREIGN KEY (scope_id) REFERENCES themis_actor_task_scopes(scope_id) ON DELETE CASCADE
      );

      PRAGMA user_version = 12;
    `);

    legacyDatabase.prepare(
      `
        INSERT INTO themis_principals (
          principal_id,
          display_name,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?)
      `,
    ).run(
      "principal-dirty-1",
      "Dirty Owner 1",
      "2026-03-31T09:59:00.000Z",
      "2026-03-31T09:59:00.000Z",
    );
    legacyDatabase.prepare(
      `
        INSERT INTO themis_principals (
          principal_id,
          display_name,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?)
      `,
    ).run(
      "principal-dirty-2",
      "Dirty Owner 2",
      "2026-03-31T09:59:30.000Z",
      "2026-03-31T09:59:30.000Z",
    );
    legacyDatabase.prepare(
      `
        INSERT INTO themis_principal_actors (
          actor_id,
          owner_principal_id,
          display_name,
          role,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "actor-dirty-1",
      "principal-dirty-2",
      "阿脏",
      "research-worker",
      "active",
      "2026-03-31T10:00:00.000Z",
      "2026-03-31T10:00:00.000Z",
    );
    legacyDatabase.prepare(
      `
        INSERT INTO themis_actor_task_scopes (
          scope_id,
          principal_id,
          actor_id,
          task_id,
          conversation_id,
          goal,
          workspace_path,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "scope-dirty-1",
      "principal-dirty-1",
      "actor-dirty-1",
      "task-dirty-1",
      "conversation-dirty-1",
      "脏数据测试",
      "/workspace/dirty",
      "open",
      "2026-03-31T10:01:00.000Z",
      "2026-03-31T10:01:00.000Z",
    );
    legacyDatabase.prepare(
      `
        INSERT INTO themis_actor_runtime_memory (
          runtime_memory_id,
          principal_id,
          actor_id,
          task_id,
          conversation_id,
          scope_id,
          kind,
          title,
          content,
          status,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "memory-dirty-1",
      "principal-dirty-1",
      "actor-dirty-1",
      "task-dirty-1",
      "conversation-dirty-1",
      "scope-dirty-1",
      "progress",
      "脏 runtime memory",
      "这条记录在旧库里是合法的，但迁移后不该被带过去。",
      "active",
      "2026-03-31T10:02:00.000Z",
    );
    legacyDatabase.close();

    assert.throws(
      () =>
        new SqliteCodexSessionRegistry({
          databaseFile,
        }),
      /foreign key check|migration failed/i,
    );

    const inspector = new Database(databaseFile, { readonly: true });

    try {
      assert.equal(inspector.pragma("user_version", { simple: true }), 12);
      const actorSql = inspector
        .prepare(
          `
            SELECT sql
            FROM sqlite_master
            WHERE type = 'table'
              AND name = ?
          `,
        )
        .get("themis_principal_actors") as { sql?: string } | undefined;
      const scopeSql = inspector
        .prepare(
          `
            SELECT sql
            FROM sqlite_master
            WHERE type = 'table'
              AND name = ?
          `,
        )
        .get("themis_actor_task_scopes") as { sql?: string } | undefined;
      const runtimeSql = inspector
        .prepare(
          `
            SELECT sql
            FROM sqlite_master
            WHERE type = 'table'
              AND name = ?
          `,
        )
        .get("themis_actor_runtime_memory") as { sql?: string } | undefined;
      assert.match(actorSql?.sql ?? "", /actor_id\s+TEXT\s+PRIMARY KEY/i);
      assert.match(scopeSql?.sql ?? "", /FOREIGN KEY\s*\(\s*actor_id\s*\)\s*REFERENCES\s*themis_principal_actors\s*\(\s*actor_id\s*\)/i);
      assert.doesNotMatch(scopeSql?.sql ?? "", /UNIQUE\s*\(\s*principal_id\s*,\s*scope_id\s*\)/i);
      assert.match(runtimeSql?.sql ?? "", /FOREIGN KEY\s*\(\s*actor_id\s*\)\s*REFERENCES\s*themis_principal_actors\s*\(\s*actor_id\s*\)/i);
      assert.doesNotMatch(runtimeSql?.sql ?? "", /FOREIGN KEY\s*\(\s*principal_id\s*,\s*actor_id\s*\)/i);
    } finally {
      inspector.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mergePrincipals 会迁移 actor/main-memory/candidate/scope/runtime-memory 到 target principal", () => {
  const { root, registry } = createRegistryContext();

  try {
    registry.savePrincipal({
      principalId: "principal-source",
      displayName: "Source",
      createdAt: "2026-03-31T11:00:00.000Z",
      updatedAt: "2026-03-31T11:00:00.000Z",
    });
    registry.savePrincipal({
      principalId: "principal-target",
      displayName: "Target",
      createdAt: "2026-03-31T11:00:30.000Z",
      updatedAt: "2026-03-31T11:00:30.000Z",
    });

    seedPrincipalActorMemoryState(registry, {
      principalId: "principal-source",
      actorId: "actor-source-1",
      memoryId: "main-memory-source-1",
      scopeId: "scope-source-1",
      runtimeMemoryId: "runtime-memory-source-1",
      taskId: "task-source-1",
      conversationId: "conversation-source-1",
    });
    registry.savePrincipalMainMemoryCandidate({
      candidateId: "candidate-source-1",
      principalId: "principal-source",
      kind: "preference",
      title: "回答节奏",
      summary: "先结论后展开",
      rationale: "source principal 偏好如此。",
      suggestedContent: "默认先给结论，再展开分析。",
      sourceType: "themis",
      sourceLabel: "session conversation-source-1 / task task-source-1",
      sourceTaskId: "task-source-1",
      sourceConversationId: "conversation-source-1",
      status: "approved",
      approvedMemoryId: "main-memory-source-1",
      reviewedAt: "2026-03-31T11:04:30.000Z",
      createdAt: "2026-03-31T11:04:00.000Z",
      updatedAt: "2026-03-31T11:04:30.000Z",
    });

    registry.mergePrincipals(
      "principal-source",
      "principal-target",
      "2026-03-31T11:05:00.000Z",
    );

    assert.deepEqual(
      registry.listPrincipalActors("principal-target").map((actor) => [actor.actorId, actor.ownerPrincipalId]),
      [["actor-source-1", "principal-target"]],
    );
    assert.equal(
      registry.searchPrincipalMainMemory("principal-target", "主记忆-principal-source", 5)[0]?.principalId,
      "principal-target",
    );
    assert.equal(
      registry.getActorTaskScope("principal-target", "scope-source-1")?.principalId,
      "principal-target",
    );
    assert.equal(
      registry.listActorTaskTimeline({
        principalId: "principal-target",
        scopeId: "scope-source-1",
      })[0]?.principalId,
      "principal-target",
    );
    assert.equal(
      registry.getPrincipalMainMemoryCandidate("principal-target", "candidate-source-1")?.principalId,
      "principal-target",
    );

    assert.equal(registry.listPrincipalActors("principal-source").length, 0);
    assert.equal(registry.searchPrincipalMainMemory("principal-source", "主记忆", 5).length, 0);
    assert.equal(registry.getPrincipalMainMemoryCandidate("principal-source", "candidate-source-1"), null);
    assert.equal(registry.getActorTaskScope("principal-source", "scope-source-1"), null);
    assert.equal(registry.listActorTaskTimeline({ principalId: "principal-source" }).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resetPrincipalState 会清空 actor/main-memory/candidate/scope/runtime-memory", () => {
  const { root, registry } = createRegistryContext();

  try {
    registry.savePrincipal({
      principalId: "principal-reset",
      displayName: "Reset",
      createdAt: "2026-03-31T11:10:00.000Z",
      updatedAt: "2026-03-31T11:10:00.000Z",
    });

    seedPrincipalActorMemoryState(registry, {
      principalId: "principal-reset",
      actorId: "actor-reset-1",
      memoryId: "main-memory-reset-1",
      scopeId: "scope-reset-1",
      runtimeMemoryId: "runtime-memory-reset-1",
      taskId: "task-reset-1",
      conversationId: "conversation-reset-1",
    });
    registry.savePrincipalMainMemoryCandidate({
      candidateId: "candidate-reset-1",
      principalId: "principal-reset",
      kind: "task-note",
      title: "排障习惯",
      summary: "先跑 doctor。",
      rationale: "近期多轮排障都从 doctor 起步。",
      suggestedContent: "遇到线上问题先跑 doctor。",
      sourceType: "themis",
      sourceLabel: "session conversation-reset-1 / task task-reset-1",
      sourceTaskId: "task-reset-1",
      sourceConversationId: "conversation-reset-1",
      status: "suggested",
      createdAt: "2026-03-31T11:10:30.000Z",
      updatedAt: "2026-03-31T11:10:30.000Z",
    });

    registry.resetPrincipalState("principal-reset", "2026-03-31T11:11:00.000Z");

    assert.equal(registry.listPrincipalActors("principal-reset").length, 0);
    assert.equal(registry.searchPrincipalMainMemory("principal-reset", "主记忆", 5).length, 0);
    assert.equal(registry.getPrincipalMainMemoryCandidate("principal-reset", "candidate-reset-1"), null);
    assert.equal(registry.getActorTaskScope("principal-reset", "scope-reset-1"), null);
    assert.equal(registry.listActorTaskTimeline({ principalId: "principal-reset" }).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
