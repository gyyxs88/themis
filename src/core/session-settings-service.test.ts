import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { persistSessionTaskSettings } from "./session-settings-service.js";

function createStoreContext() {
  const root = mkdtempSync(join(tmpdir(), "themis-session-settings-service-"));
  const store = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  return { root, store };
}

test("persistSessionTaskSettings 会保存并规范 workspacePath", () => {
  const { root, store } = createStoreContext();
  const workspace = join(root, "workspace");
  mkdirSync(workspace);

  try {
    const result = persistSessionTaskSettings(
      store,
      "session-1",
      {
        profile: "dev",
        workspacePath: join(workspace, "..", "workspace"),
      },
      "2026-03-26T01:00:00.000Z",
    );

    assert.equal(result.cleared, false);
    assert.equal(result.settings?.profile, "dev");
    assert.equal(result.settings?.workspacePath, workspace);
    assert.equal(result.createdAt, "2026-03-26T01:00:00.000Z");
    assert.equal(result.updatedAt, "2026-03-26T01:00:00.000Z");

    assert.deepEqual(store.getSessionTaskSettings("session-1")?.settings, {
      profile: "dev",
      workspacePath: workspace,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistSessionTaskSettings 会基于现有 settings 做 merge", () => {
  const { root, store } = createStoreContext();
  const workspace = join(root, "workspace");
  mkdirSync(workspace);

  try {
    store.saveSessionTaskSettings({
      sessionId: "session-merge",
      settings: {
        profile: "keep-me",
        accessMode: "auth",
      },
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
    });

    const result = persistSessionTaskSettings(
      store,
      "session-merge",
      {
        workspacePath: workspace,
      },
      "2026-03-26T01:00:00.000Z",
    );

    assert.equal(result.cleared, false);
    assert.deepEqual(result.settings, {
      profile: "keep-me",
      accessMode: "auth",
      workspacePath: workspace,
    });
    assert.equal(result.createdAt, "2026-03-26T00:00:00.000Z");
    assert.equal(result.updatedAt, "2026-03-26T01:00:00.000Z");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistSessionTaskSettings 在会话已有 turn 时禁止修改 workspacePath", () => {
  const { root, store } = createStoreContext();
  const workspaceA = join(root, "workspace-a");
  const workspaceB = join(root, "workspace-b");
  mkdirSync(workspaceA);
  mkdirSync(workspaceB);

  try {
    store.saveSessionTaskSettings({
      sessionId: "session-2",
      settings: {
        workspacePath: workspaceA,
        webSearchMode: "disabled",
      },
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
    });
    store.upsertTurnFromRequest({
      requestId: "request-1",
      sourceChannel: "web",
      user: {
        userId: "user-1",
      },
      goal: "hello",
      channelContext: {
        sessionId: "session-2",
      },
      createdAt: "2026-03-26T00:00:00.000Z",
    }, "task-1");

    assert.throws(() => {
      persistSessionTaskSettings(
        store,
        "session-2",
        {
          workspacePath: workspaceB,
        },
        "2026-03-26T01:00:00.000Z",
      );
    }, /当前会话已经执行过任务，不能再修改工作区；请先新建会话。/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistSessionTaskSettings 在冻结会话改成非法路径时仍优先抛冻结错误", () => {
  const { root, store } = createStoreContext();
  const workspace = join(root, "workspace");
  mkdirSync(workspace);

  try {
    store.saveSessionTaskSettings({
      sessionId: "session-2-invalid",
      settings: {
        workspacePath: workspace,
      },
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
    });
    store.upsertTurnFromRequest({
      requestId: "request-2",
      sourceChannel: "web",
      user: {
        userId: "user-2",
      },
      goal: "hello",
      channelContext: {
        sessionId: "session-2-invalid",
      },
      createdAt: "2026-03-26T00:00:00.000Z",
    }, "task-2");

    assert.throws(() => {
      persistSessionTaskSettings(
        store,
        "session-2-invalid",
        {
          workspacePath: "relative/project",
        },
        "2026-03-26T01:00:00.000Z",
      );
    }, /当前会话已经执行过任务，不能再修改工作区；请先新建会话。/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistSessionTaskSettings 支持用空白 workspacePath 删除已有字段", () => {
  const { root, store } = createStoreContext();
  const workspace = join(root, "workspace");
  mkdirSync(workspace);

  try {
    store.saveSessionTaskSettings({
      sessionId: "session-clear-workspace",
      settings: {
        profile: "dev",
        workspacePath: workspace,
      },
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
    });

    const result = persistSessionTaskSettings(
      store,
      "session-clear-workspace",
      {
        workspacePath: "   ",
      },
      "2026-03-26T01:00:00.000Z",
    );

    assert.equal(result.cleared, false);
    assert.deepEqual(result.settings, {
      profile: "dev",
    });
    assert.equal(store.getSessionTaskSettings("session-clear-workspace")?.settings.workspacePath, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistSessionTaskSettings 支持用空白字符串删除非 workspace 文本字段", () => {
  const { root, store } = createStoreContext();

  try {
    store.saveSessionTaskSettings({
      sessionId: "session-clear-profile",
      settings: {
        profile: "dev",
        webSearchMode: "disabled",
      },
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
    });

    const result = persistSessionTaskSettings(
      store,
      "session-clear-profile",
      {
        profile: "   ",
      },
      "2026-03-26T01:00:00.000Z",
    );

    assert.equal(result.cleared, false);
    assert.deepEqual(result.settings, {
      webSearchMode: "disabled",
    });
    assert.equal(store.getSessionTaskSettings("session-clear-profile")?.settings.profile, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistSessionTaskSettings 支持用 null 删除 networkAccessEnabled", () => {
  const { root, store } = createStoreContext();

  try {
    store.saveSessionTaskSettings({
      sessionId: "session-clear-network",
      settings: {
        networkAccessEnabled: true,
        webSearchMode: "disabled",
      },
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
    });

    const result = persistSessionTaskSettings(
      store,
      "session-clear-network",
      {
        networkAccessEnabled: null,
      },
      "2026-03-26T01:00:00.000Z",
    );

    assert.equal(result.cleared, false);
    assert.deepEqual(result.settings, {
      webSearchMode: "disabled",
    });
    assert.equal(
      store.getSessionTaskSettings("session-clear-network")?.settings.networkAccessEnabled,
      undefined,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistSessionTaskSettings 允许清空会话设置", () => {
  const { root, store } = createStoreContext();
  const workspace = join(root, "workspace");
  mkdirSync(workspace);

  try {
    store.saveSessionTaskSettings({
      sessionId: "session-3",
      settings: {
        workspacePath: workspace,
        accessMode: "auth",
      },
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
    });

    const result = persistSessionTaskSettings(
      store,
      "session-3",
      {},
      "2026-03-26T01:00:00.000Z",
    );

    assert.equal(result.cleared, true);
    assert.equal(result.settings, null);
    assert.equal(result.createdAt, "2026-03-26T00:00:00.000Z");
    assert.equal(result.updatedAt, "2026-03-26T01:00:00.000Z");
    assert.equal(store.getSessionTaskSettings("session-3"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
