import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Thread, ThreadOptions, Codex } from "@openai/codex-sdk";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskRequest } from "../types/index.js";
import { CodexThreadSessionStore, SessionBusyError } from "./codex-session-store.js";

function createRequest(sessionId: string | undefined, taskId: string): TaskRequest {
  return {
    requestId: `${taskId}-request`,
    taskId,
    sourceChannel: "web",
    user: {
      userId: "user-1",
      displayName: "User",
    },
    goal: "test session store",
    channelContext: sessionId ? { sessionId } : {},
    createdAt: "2026-03-28T12:00:00.000Z",
  };
}

function createThread(label: string): Thread {
  return { label } as unknown as Thread;
}

function createCodexDouble() {
  const calls = {
    start: [] as ThreadOptions[],
    resume: [] as Array<{ threadId: string; options: ThreadOptions }>,
  };

  const codex: Partial<Codex> = {
    startThread(options: ThreadOptions) {
      calls.start.push(options);
      return createThread("started");
    },
    resumeThread(threadId: string, options: ThreadOptions) {
      calls.resume.push({ threadId, options });
      return createThread("resumed");
    },
  };

  return {
    calls,
    codex: codex as Codex,
  };
}

function createStoreContext(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const { codex, calls } = createCodexDouble();
  const store = new CodexThreadSessionStore({
    codex,
    sessionRegistry: registry,
  });

  return { root, registry, calls, store };
}

test("acquire 在没有 sessionId 时返回 ephemeral 且不落库", async () => {
  const { root, registry, calls, store } = createStoreContext("themis-session-store-ephemeral-");

  try {
    const lease = await store.acquire(createRequest(undefined, "task-ephemeral"), {
      model: "gpt-5.4",
    });

    assert.equal(lease.sessionMode, "ephemeral");
    assert.equal(calls.start.length, 1);
    assert.equal(registry.getSession(""), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("acquire 首次进入命名 session 时返回 created 并写 activeTaskId", async () => {
  const { root, registry, calls, store } = createStoreContext("themis-session-store-created-");

  try {
    const lease = await store.acquire(createRequest("session-created", "task-created"), {
      model: "gpt-5.4",
    });

    assert.equal(lease.sessionMode, "created");
    assert.equal(calls.start.length, 1);
    assert.equal(registry.getSession("session-created")?.activeTaskId, "task-created");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("acquire 在已有 threadId 时返回 resumed 并复用 thread", async () => {
  const { root, registry, calls, store } = createStoreContext("themis-session-store-resumed-");

  registry.saveSession({
    sessionId: "session-resumed",
    threadId: "thread-existing",
    createdAt: "2026-03-28T12:00:00.000Z",
    updatedAt: "2026-03-28T12:00:00.000Z",
  });

  try {
    const lease = await store.acquire(createRequest("session-resumed", "task-resumed"), {
      model: "gpt-5.4",
    });

    assert.equal(lease.sessionMode, "resumed");
    assert.equal(calls.resume.length, 1);
    assert.equal(calls.resume[0]?.threadId, "thread-existing");
    assert.equal(registry.getSession("session-resumed")?.activeTaskId, "task-resumed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("acquire 在已有其它活跃任务时抛 SessionBusyError", async () => {
  const { root, registry, store } = createStoreContext("themis-session-store-busy-");

  registry.saveSession({
    sessionId: "session-busy",
    threadId: "thread-existing",
    createdAt: "2026-03-28T12:00:00.000Z",
    updatedAt: "2026-03-28T12:00:00.000Z",
    activeTaskId: "other-task",
  });

  try {
    await assert.rejects(
      () => store.acquire(createRequest("session-busy", "task-busy"), { model: "gpt-5.4" }),
      SessionBusyError,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release 会在没有最终 threadId 时删除空 session；有最终 threadId 时保留绑定", async () => {
  const { root, registry, store } = createStoreContext("themis-session-store-release-");

  try {
    const emptyLease = await store.acquire(createRequest("session-empty", "task-empty"), {
      model: "gpt-5.4",
    });
    await emptyLease.release();
    assert.equal(registry.getSession("session-empty"), null);

    const keptLease = await store.acquire(createRequest("session-keep", "task-keep"), {
      model: "gpt-5.4",
    });
    await keptLease.release("thread-final");

    const saved = registry.getSession("session-keep");
    assert.equal(saved?.threadId, "thread-final");
    assert.equal(saved?.activeTaskId, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
