import assert from "node:assert/strict";
import test from "node:test";
import { createStoreModelHelpers } from "./store-models.js";
import {
  buildWorkspaceNote,
  inheritWorkspaceSettings,
  isWorkspaceLocked,
} from "./session-workspace.js";

test("createDefaultThreadSettings 包含空 workspacePath", () => {
  const models = createStoreModelHelpers();
  assert.equal(models.createDefaultThreadSettings().workspacePath, "");
});

test("inheritWorkspaceSettings 只复制当前会话的 workspacePath", () => {
  const inherited = inheritWorkspaceSettings({
    settings: {
      workspacePath: "/srv/projects/demo",
      model: "gpt-5.4",
      reasoning: "high",
    },
  });

  assert.deepEqual(inherited, {
    workspacePath: "/srv/projects/demo",
  });
});

test("isWorkspaceLocked 会把已有历史会话视为锁定", () => {
  assert.equal(isWorkspaceLocked({ storedTurnCount: 1, turns: [] }), true);
  assert.equal(isWorkspaceLocked({ storedTurnCount: 0, turns: [{}] }), true);
  assert.equal(isWorkspaceLocked({ storedTurnCount: 0, turns: [] }), false);
});

test("buildWorkspaceNote 会在未设置时提示回退启动目录", () => {
  assert.match(
    buildWorkspaceNote({
      settings: { workspacePath: "" },
      storedTurnCount: 0,
      turns: [],
    }),
    /会回退到 Themis 启动目录/,
  );
});

test("buildWorkspaceNote 会在锁定会话上提示请先新建会话", () => {
  assert.match(
    buildWorkspaceNote({
      settings: { workspacePath: "/srv/projects/demo" },
      storedTurnCount: 2,
      turns: [],
    }),
    /请先新建会话/,
  );
});
