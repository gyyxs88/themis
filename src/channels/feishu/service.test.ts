import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CodexRuntimeCatalog } from "../../core/codex-app-server.js";
import { AppServerActionBridge } from "../../core/app-server-action-bridge.js";
import { AppServerTaskRuntime } from "../../core/app-server-task-runtime.js";
import { IdentityLinkService } from "../../core/identity-link-service.js";
import { SESSION_WORKSPACE_LOCKED_ERROR } from "../../core/session-settings-service.js";
import type { CodexTaskRuntime } from "../../core/codex-runtime.js";
import type {
  PrincipalTaskSettings,
  SessionTaskSettings,
  TaskPendingActionSubmitRequest,
  TaskEvent,
  TaskRequest,
  TaskResult,
  TaskRuntimeFacade,
  TaskRuntimeRunHooks,
} from "../../types/index.js";
import { SqliteCodexSessionRegistry } from "../../storage/index.js";
import { FeishuChannelService } from "./service.js";
import { FeishuSessionStore } from "./session-store.js";

test("/help 只展示第一层命令", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("help", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /\/settings 查看设置树/);
    assert.match(message, /\/sessions 查看最近会话/);
    assert.match(message, /\/workspace 查看或设置当前会话工作区/);
    assert.match(message, /\/quota 查看当前 Codex \/ ChatGPT 额度信息/);
    assert.doesNotMatch(message, /\/sandbox /);
    assert.doesNotMatch(message, /\/account list/);
    assert.doesNotMatch(message, /\/settings network/);
  } finally {
    harness.cleanup();
  }
});

test("/workspace 在无参数时展示当前会话工作区", async () => {
  const harness = createHarness();

  try {
    const sessionId = "session-workspace-view";
    const workspace = harness.createWorkspace("workspace-view");
    harness.setCurrentSession(sessionId);
    harness.writeSessionSettings(sessionId, {
      workspacePath: workspace,
    });

    await harness.handleCommand("workspace", []);

    const message = harness.takeSingleMessage();
    assert.match(message, new RegExp(`当前会话：${sessionId}`));
    assert.match(message, new RegExp(`当前会话工作区：${escapeRegExp(workspace)}`));
  } finally {
    harness.cleanup();
  }
});

test("/workspace <path> 会写入当前会话工作区，/ws 作为别名可用", async () => {
  const harness = createHarness();

  try {
    const sessionId = "session-workspace-write";
    const workspace = harness.createWorkspace("workspace-write");
    harness.setCurrentSession(sessionId);

    await harness.handleCommand("ws", [workspace]);

    const message = harness.takeSingleMessage();
    assert.match(message, /当前会话工作区已更新为：/);
    assert.equal(harness.readSessionSettings(sessionId)?.settings.workspacePath, workspace);
  } finally {
    harness.cleanup();
  }
});

test("/workspace <path> 只影响当前 session，不会污染 principal 与 task payload options", async () => {
  const harness = createHarness();

  try {
    const sessionId = "session-workspace-isolated";
    const workspace = harness.createWorkspace("workspace-isolated");
    harness.setCurrentSession(sessionId);

    await harness.handleCommand("settings", ["network", "off"]);
    harness.takeSingleMessage();
    const beforePrincipal = harness.getStoredPrincipalTaskSettings();

    await harness.handleCommand("workspace", [workspace]);

    const message = harness.takeSingleMessage();
    assert.match(message, /当前会话工作区已更新为：/);
    assert.deepEqual(harness.getStoredPrincipalTaskSettings(), beforePrincipal);

    const payload = harness.createTaskPayload(sessionId, "hello");
    assert.equal("workspacePath" in (payload.options ?? {}), false);
    assert.equal(payload.options?.networkAccessEnabled, false);
  } finally {
    harness.cleanup();
  }
});

test("/workspace <path> 在会话已执行任务后会拒绝修改", async () => {
  const harness = createHarness();

  try {
    const sessionId = "session-workspace-frozen";
    const workspaceA = harness.createWorkspace("workspace-frozen-a");
    const workspaceB = harness.createWorkspace("workspace-frozen-b");
    harness.setCurrentSession(sessionId);
    harness.writeSessionSettings(sessionId, {
      workspacePath: workspaceA,
    });
    harness.appendTurn(sessionId);

    await harness.handleCommand("workspace", [workspaceB]);

    const message = harness.takeSingleMessage();
    assert.match(message, new RegExp(escapeRegExp(SESSION_WORKSPACE_LOCKED_ERROR)));
    assert.equal(harness.readSessionSettings(sessionId)?.settings.workspacePath, workspaceA);
  } finally {
    harness.cleanup();
  }
});

test("/workspace 在没有激活会话时返回清晰提示", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("workspace", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /当前还没有激活会话。直接发消息时会自动创建，或使用 \/new 手动新建。/);
  } finally {
    harness.cleanup();
  }
});

test("/workspace <非法路径> 返回共享校验错误且不写入 settings", async () => {
  const harness = createHarness();

  try {
    const sessionId = "session-workspace-invalid-path";
    harness.setCurrentSession(sessionId);

    await harness.handleCommand("workspace", ["relative/project"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /只支持服务端本机绝对路径。/);
    assert.equal(harness.readSessionSettings(sessionId), null);
  } finally {
    harness.cleanup();
  }
});

test("/new 会继承当前激活会话的 workspacePath（只继承 workspacePath）", async () => {
  const harness = createHarness();

  try {
    const previousSessionId = "session-workspace-parent";
    const workspace = harness.createWorkspace("workspace-parent");
    harness.setCurrentSession(previousSessionId);
    harness.writeSessionSettings(previousSessionId, {
      workspacePath: workspace,
      profile: "custom-profile",
    });

    await harness.handleCommand("new", []);

    const message = harness.takeSingleMessage();
    const nextSessionId = parseSessionIdFromNewMessage(message);
    assert.notEqual(nextSessionId, previousSessionId);
    assert.equal(harness.getCurrentSessionId(), nextSessionId);
    assert.deepEqual(harness.readSessionSettings(nextSessionId)?.settings, {
      workspacePath: workspace,
    });
  } finally {
    harness.cleanup();
  }
});

test("/new 在工作区继承失败时会明确提示并保留新会话", async () => {
  const harness = createHarness();

  try {
    const previousSessionId = "session-workspace-parent-invalid";
    const missingWorkspace = join(harness.getWorkingDirectory(), "workspace-missing");
    harness.setCurrentSession(previousSessionId);
    harness.writeSessionSettings(previousSessionId, {
      workspacePath: missingWorkspace,
    });

    await harness.handleCommand("new", []);

    const message = harness.takeSingleMessage();
    const nextSessionId = parseSessionIdFromNewMessage(message);
    assert.match(message, /新会话已创建，但工作区继承失败/);
    assert.match(message, /工作区不存在/);
    assert.equal(harness.getCurrentSessionId(), nextSessionId);
    assert.equal(harness.readSessionSettings(nextSessionId), null);
  } finally {
    harness.cleanup();
  }
});

test("/current 会显示当前会话工作区", async () => {
  const harness = createHarness();

  try {
    const sessionId = "session-current-workspace";
    const workspace = harness.createWorkspace("workspace-current");
    harness.setCurrentSession(sessionId);
    harness.writeSessionSettings(sessionId, {
      workspacePath: workspace,
    });

    await harness.handleCommand("current", []);

    const message = harness.takeSingleMessage();
    assert.match(message, new RegExp(`当前会话：${sessionId}`));
    assert.match(message, new RegExp(`当前会话工作区：${escapeRegExp(workspace)}`));
  } finally {
    harness.cleanup();
  }
});

test("/current 在未设置工作区时显示回退文案", async () => {
  const harness = createHarness();

  try {
    const sessionId = "session-current-no-workspace";
    harness.setCurrentSession(sessionId);

    await harness.handleCommand("current", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /当前会话工作区：未设置（回退到 Themis 启动目录）/);
  } finally {
    harness.cleanup();
  }
});

test("/settings 只返回下一层配置项", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("settings", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /Themis 设置：/);
    assert.match(message, /\/settings sandbox/);
    assert.match(message, /\/settings search/);
    assert.match(message, /\/settings network/);
    assert.match(message, /\/settings approval/);
    assert.match(message, /\/settings account/);
    assert.match(message, /作用范围：Themis 中间层长期默认配置/);
    assert.doesNotMatch(message, /\/settings account use/);
  } finally {
    harness.cleanup();
  }
});

test("/help 会展示 /skills 第一层入口", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("help", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /\/skills 查看和维护当前 principal 的 skills/);
  } finally {
    harness.cleanup();
  }
});

test("/skills foo 会回退到 /skills 自己的帮助", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["foo"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /Skills 管理：/);
    assert.match(message, /\/skills curated/);
    assert.match(message, /\/skills install local <ABSOLUTE_PATH>/);
    assert.match(message, /第一版不支持带空格路径/);
  } finally {
    harness.cleanup();
  }
});

test("/skills 在无安装项时返回空列表提示", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", []);

    const message = harness.takeSingleMessage();
    assert.match(message, /当前 principal：principal-local-owner/);
    assert.match(message, /暂无已安装 skill/);
    assert.match(message, /查看：\/skills curated/);
  } finally {
    harness.cleanup();
  }
});

test("/skills list 会展示同步摘要和异常账号", async () => {
  const harness = createHarness({
    listItems: [
      {
        skillName: "demo-skill",
        description: "demo",
        installStatus: "partially_synced",
        sourceType: "local-path",
        sourceRefJson: JSON.stringify({ absolutePath: "/srv/demo-skill" }),
        managedPath: "/srv/themis/skills/demo-skill",
        summary: { totalAccounts: 2, syncedCount: 1, conflictCount: 0, failedCount: 1 },
        materializations: [
          { targetId: "acc-1", state: "synced" },
          { targetId: "acc-2", state: "failed", lastError: "quota blocked" },
        ],
      },
    ],
  });

  try {
    await harness.handleCommand("skills", ["list"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /1\. demo-skill/);
    assert.match(message, /已同步 1\/2，冲突 0，失败 1/);
    assert.match(message, /账号槽位 acc-2 \[failed\]：quota blocked/);
  } finally {
    harness.cleanup();
  }
});

test("/skills curated 会展示 curated 列表和安装状态", async () => {
  const harness = createHarness({
    curatedItems: [
      { name: "python-setup", installed: true },
      { name: "debugger", installed: false },
    ],
  });

  try {
    await harness.handleCommand("skills", ["curated"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /当前 principal：principal-local-owner/);
    assert.match(message, /1\. python-setup \[已安装\]/);
    assert.match(message, /2\. debugger \[未安装\]/);
  } finally {
    harness.cleanup();
  }
});

test("/skills install local 会调用本机路径安装写操作", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["install", "local", "/srv/themis/skills/demo-skill"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /技能已安装：demo-skill/);
    assert.match(message, /安装状态：ready/);
    assert.match(message, /安装来源：本机路径 \/srv\/themis\/skills\/demo-skill/);
    assert.deepEqual(harness.getSkillWriteCalls(), [
      {
        method: "installFromLocalPath",
        principalId: "principal-local-owner",
        absolutePath: "/srv/themis/skills/demo-skill",
      },
    ]);
  } finally {
    harness.cleanup();
  }
});

test("/skills install url 会调用 GitHub URL 安装写操作", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", [
      "install",
      "url",
      "https://github.com/demo/repo/tree/main/skills/url-skill",
    ]);

    const message = harness.takeSingleMessage();
    assert.match(message, /技能已安装：url-skill/);
    assert.match(message, /安装来源：GitHub URL https:\/\/github\.com\/demo\/repo\/tree\/main\/skills\/url-skill/);
    assert.deepEqual(harness.getSkillWriteCalls(), [
      {
        method: "installFromGithub",
        principalId: "principal-local-owner",
        url: "https://github.com/demo/repo/tree/main/skills/url-skill",
      },
    ]);
  } finally {
    harness.cleanup();
  }
});

test("/skills install url <url> <ref> 会透传可选 ref", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", [
      "install",
      "url",
      "https://github.com/demo/repo/tree/main/skills/url-skill",
      "release-2026",
    ]);

    const message = harness.takeSingleMessage();
    assert.match(message, /技能已安装：url-skill/);
    assert.match(message, /GitHub ref：release-2026/);
    assert.deepEqual(harness.getSkillWriteCalls(), [
      {
        method: "installFromGithub",
        principalId: "principal-local-owner",
        url: "https://github.com/demo/repo/tree/main/skills/url-skill",
        ref: "release-2026",
      },
    ]);
  } finally {
    harness.cleanup();
  }
});

test("/skills install repo 会调用 GitHub repo/path 安装写操作", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["install", "repo", "demo/repo", "skills/repo-skill", "release-2026"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /技能已安装：repo-skill/);
    assert.match(message, /安装来源：GitHub 仓库 demo\/repo skills\/repo-skill/);
    assert.match(message, /GitHub ref：release-2026/);
    assert.deepEqual(harness.getSkillWriteCalls(), [
      {
        method: "installFromGithub",
        principalId: "principal-local-owner",
        repo: "demo/repo",
        path: "skills/repo-skill",
        ref: "release-2026",
      },
    ]);
  } finally {
    harness.cleanup();
  }
});

test("/skills install curated 会调用 curated 安装写操作", async () => {
  const harness = createHarness({
    curatedItems: [
      { name: "python-setup", installed: false },
    ],
  });

  try {
    await harness.handleCommand("skills", ["install", "curated", "python-setup"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /技能已安装：python-setup/);
    assert.match(message, /安装来源：curated skill python-setup/);
    assert.deepEqual(harness.getSkillWriteCalls(), [
      {
        method: "installFromCurated",
        principalId: "principal-local-owner",
        skillName: "python-setup",
      },
    ]);
  } finally {
    harness.cleanup();
  }
});

test("/skills remove <name> 会调用删除写操作", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["install", "local", "/srv/themis/skills/demo-skill"]);
    harness.takeSingleMessage();

    await harness.handleCommand("skills", ["remove", "demo-skill"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /技能已删除：demo-skill/);
    assert.match(message, /已删除受管目录：是/);
    assert.deepEqual(harness.getSkillWriteCalls().map((call) => call.method), [
      "installFromLocalPath",
      "removeSkill",
    ]);
  } finally {
    harness.cleanup();
  }
});

test("/skills sync <name> 会调用同步写操作", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["install", "local", "/srv/themis/skills/demo-skill"]);
    harness.takeSingleMessage();

    await harness.handleCommand("skills", ["sync", "demo-skill"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /已重同步 skill：demo-skill/);
    assert.match(message, /安装状态：ready/);
    assert.match(message, /已同步 2\/2，冲突 0，失败 0/);
    assert.deepEqual(harness.getSkillWriteCalls().map((call) => call.method), [
      "installFromLocalPath",
      "syncSkill",
    ]);
    assert.deepEqual(harness.getSkillWriteCalls()[1], {
      method: "syncSkill",
      principalId: "principal-local-owner",
      skillName: "demo-skill",
      force: false,
    });
  } finally {
    harness.cleanup();
  }
});

test("/skills sync <name> force 会以自然语言参数触发强制同步", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["install", "local", "/srv/themis/skills/demo-skill"]);
    harness.takeSingleMessage();

    await harness.handleCommand("skills", ["sync", "demo-skill", "force"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /已重同步 skill：demo-skill/);
    assert.match(message, /模式：强制同步/);
    assert.match(message, /安装状态：ready/);
    assert.match(message, /已同步 2\/2，冲突 0，失败 0/);
    assert.deepEqual(harness.getSkillWriteCalls()[1], {
      method: "syncSkill",
      principalId: "principal-local-owner",
      skillName: "demo-skill",
      force: true,
    });
  } finally {
    harness.cleanup();
  }
});

test("/skills install 缺参数或未知 mode 时会返回清晰用法", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["install"]);
    const missingMode = harness.takeSingleMessage();
    assert.match(missingMode, /\/skills install <local\|url\|repo\|curated>/);
    assert.match(missingMode, /\/skills install url <GITHUB_URL> \[REF\]/);

    await harness.handleCommand("skills", ["install", "foo"]);
    const unknownMode = harness.takeSingleMessage();
    assert.match(unknownMode, /未识别的 install 模式：foo/);
    assert.match(unknownMode, /\/skills install repo <REPO> <PATH> \[REF\]/);

    await harness.handleCommand("skills", ["remove"]);
    const missingRemove = harness.takeSingleMessage();
    assert.match(missingRemove, /\/skills remove <SKILL_NAME>/);

    await harness.handleCommand("skills", ["sync"]);
    const missingSync = harness.takeSingleMessage();
    assert.match(missingSync, /\/skills sync <SKILL_NAME> \[force\]/);
    assert.match(missingSync, /force 是自然语言参数/);
  } finally {
    harness.cleanup();
  }
});

test("/skills install local 缺路径时返回 local 的明确用法", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["install", "local"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /用法：\/skills install local <ABSOLUTE_PATH>/);
    assert.doesNotMatch(message, /未识别的 install 模式：local/);
  } finally {
    harness.cleanup();
  }
});

test("/skills remove 缺少名称时返回 remove 的明确用法", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["remove"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /用法：\/skills remove <SKILL_NAME>/);
  } finally {
    harness.cleanup();
  }
});

test("/skills ls 不作为 list 别名，而是回退到 /skills 帮助", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("skills", ["ls"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /未识别的 skills 子命令：ls/);
    assert.match(message, /\/skills list 查看当前 principal 已安装的 skills/);
  } finally {
    harness.cleanup();
  }
});

test("/settings network 只展示当前值和选项，不会修改 principal 配置", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("settings", ["network"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /设置项：\/settings network/);
    assert.match(message, /当前值：on/);
    assert.match(message, /来源：Themis 系统默认值/);
    assert.match(message, /可选值：on \| off/);
    assert.equal(harness.getStoredPrincipalTaskSettings(), null);
  } finally {
    harness.cleanup();
  }
});

test("/settings network off 会写入 principal 默认，并影响后续不同会话的新任务", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("settings", ["network", "off"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /网络访问已更新为：off/);
    assert.deepEqual(harness.getStoredPrincipalTaskSettings(), {
      networkAccessEnabled: false,
    });

    const payloadA = harness.createTaskPayload("session-a", "hello");
    const payloadB = harness.createTaskPayload("session-b", "world");
    assert.equal(payloadA.options?.networkAccessEnabled, false);
    assert.equal(payloadB.options?.networkAccessEnabled, false);
  } finally {
    harness.cleanup();
  }
});

test("/settings account 子树支持查看和切换 principal 默认认证账号", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("settings", ["account"]);
    const accountRoot = harness.takeSingleMessage();
    assert.match(accountRoot, /账号设置：/);
    assert.match(accountRoot, /\/settings account current/);
    assert.match(accountRoot, /\/settings account list/);
    assert.match(accountRoot, /\/settings account use/);

    await harness.handleCommand("settings", ["account", "use"]);
    const useHelp = harness.takeSingleMessage();
    assert.match(useHelp, /设置项：\/settings account use/);
    assert.match(useHelp, /可选输入：<账号名\|邮箱\|序号\|default>/);
    assert.match(useHelp, /1\. alpha@example\.com/);
    assert.match(useHelp, /2\. beta@example\.com/);

    await harness.handleCommand("settings", ["account", "use", "2"]);
    const updated = harness.takeSingleMessage();
    assert.match(updated, /默认认证账号已更新为：beta@example\.com/);
    assert.deepEqual(harness.getStoredPrincipalTaskSettings(), {
      authAccountId: "acc-2",
    });
    assert.equal(harness.createTaskPayload("session-a", "hello").options?.authAccountId, "acc-2");

    await harness.handleCommand("settings", ["account", "use", "default"]);
    const cleared = harness.takeSingleMessage();
    assert.match(cleared, /默认认证账号已改为：跟随 Themis 系统默认账号 alpha@example\.com/);
    assert.equal(harness.getStoredPrincipalTaskSettings(), null);
  } finally {
    harness.cleanup();
  }
});

test("旧的 /network 兼容入口仍会写入 principal 默认配置", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("network", ["off"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /网络访问已更新为：off/);
    assert.deepEqual(harness.getStoredPrincipalTaskSettings(), {
      networkAccessEnabled: false,
    });
  } finally {
    harness.cleanup();
  }
});

test("/settings foo 会回退到 settings 第一层帮助", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("settings", ["foo"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /未识别的设置项：foo/);
    assert.match(message, /\/settings sandbox/);
    assert.match(message, /\/settings account/);
  } finally {
    harness.cleanup();
  }
});

test("斜杠命令会记录完成耗时日志", async () => {
  const harness = createHarness();

  try {
    await harness.handleCommand("help", []);
    harness.takeSingleMessage();

    const commandLogs = harness.getInfoLogs().filter((entry) => entry.includes("斜杠命令完成"));
    assert.equal(commandLogs.length, 1);
    assert.match(commandLogs[0] ?? "", /command=\/help/);
    assert.match(commandLogs[0] ?? "", /elapsedMs=\d+/);
    assert.match(commandLogs[0] ?? "", /chat=chat-1/);
    assert.match(commandLogs[0] ?? "", /message=message-1/);
  } finally {
    harness.cleanup();
  }
});

test("飞书文本发送会记录接口耗时日志", async () => {
  const harness = createHarness();

  try {
    harness.setClient({
      im: {
        v1: {
          message: {
            create: async () => ({
              data: {
                message_id: "msg-created-1",
              },
            }),
          },
        },
      },
    });

    await harness.createTextMessage("chat-1", "hello");

    const sendLogs = harness.getInfoLogs().filter((entry) => entry.includes("飞书消息发送完成"));
    assert.equal(sendLogs.length, 1);
    assert.match(sendLogs[0] ?? "", /action=create/);
    assert.match(sendLogs[0] ?? "", /msgType=text/);
    assert.match(sendLogs[0] ?? "", /chat=chat-1/);
    assert.match(sendLogs[0] ?? "", /message=msg-created-1/);
    assert.match(sendLogs[0] ?? "", /elapsedMs=\d+/);
    assert.match(sendLogs[0] ?? "", /bytes=\d+/);
  } finally {
    harness.cleanup();
  }
});

test("飞书普通任务在 app-server runtime 下仍保持占位、顺序缓冲与结果收口 parity", async () => {
  const harness = createHarness({
    runtimeEngine: "app-server",
  });

  try {
    await harness.handleIncomingText("请执行一次 app-server parity 测试");

    const messages = harness.takeMessages();
    assert.ok(messages.some((message) => /处理中/.test(message)));
    assert.ok(messages.some((message) => /app-server parity 测试/.test(message)));
    assert.deepEqual(harness.getTaskRuntimeCalls(), {
      sdk: 0,
      appServer: 1,
    });
  } finally {
    harness.cleanup();
  }
});

test("飞书 /approve 会提交等待中的 approval action", async () => {
  const harness = createHarness();

  try {
    harness.injectPendingAction({
      actionId: "approval-1",
      actionType: "approval",
      prompt: "Allow command?",
      choices: ["approve", "deny"],
    });

    await harness.handleCommand("approve", ["approval-1"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /已提交审批/);
    assert.equal(harness.findPendingAction("approval-1"), null);
    assert.deepEqual(harness.getResolvedActionSubmissions(), [{
      taskId: "task-pending-action",
      requestId: "req-pending-action",
      actionId: "approval-1",
      decision: "approve",
    }]);
  } finally {
    harness.cleanup();
  }
});

test("飞书 /approve 只会命中当前会话的同名 waiting action，不会串到别的 session", async () => {
  const harness = createHarness();

  try {
    const currentSessionId = "session-feishu-current";
    harness.setCurrentSession(currentSessionId);
    harness.injectPendingAction({
      taskId: "task-other-session",
      requestId: "req-other-session",
      actionId: "approval-shared",
      actionType: "approval",
      prompt: "Allow other command?",
      sessionId: "session-feishu-other",
    });
    harness.injectPendingAction({
      taskId: "task-current-session",
      requestId: "req-current-session",
      actionId: "approval-shared",
      actionType: "approval",
      prompt: "Allow current command?",
      sessionId: currentSessionId,
    });

    await harness.handleCommand("approve", ["approval-shared"]);

    assert.deepEqual(harness.getResolvedActionSubmissions(), [{
      taskId: "task-current-session",
      requestId: "req-current-session",
      actionId: "approval-shared",
      decision: "approve",
    }]);
  } finally {
    harness.cleanup();
  }
});

test("飞书 /reply <actionId> <内容> 会提交等待中的 user-input action", async () => {
  const harness = createHarness();

  try {
    harness.injectPendingAction({
      actionId: "reply-1",
      actionType: "user-input",
      prompt: "Please add details",
    });

    await harness.handleCommand("reply", ["reply-1", "继续", "执行"]);

    const message = harness.takeSingleMessage();
    assert.match(message, /已提交补充输入/);
    assert.equal(harness.findPendingAction("reply-1"), null);
    assert.deepEqual(harness.getResolvedActionSubmissions(), [{
      taskId: "task-pending-action",
      requestId: "req-pending-action",
      actionId: "reply-1",
      inputText: "继续 执行",
    }]);
  } finally {
    harness.cleanup();
  }
});

test("飞书普通任务在未显式指定 runtimeEngine 时默认走 app-server runtime", async () => {
  const harness = createHarness();

  try {
    await harness.handleIncomingText("请执行一次默认引擎切换测试");

    assert.deepEqual(harness.getTaskRuntimeCalls(), {
      sdk: 0,
      appServer: 1,
    });
  } finally {
    harness.cleanup();
  }
});

test("飞书在未传 runtimeRegistry 时也默认走内建 app-server runtime", async () => {
  let appServerCalls = 0;
  const originalRunTask = AppServerTaskRuntime.prototype.runTask;

  AppServerTaskRuntime.prototype.runTask = async function patchedRunTask(request) {
    appServerCalls += 1;
    return {
      taskId: request.taskId ?? "task-feishu-built-in-app-server-1",
      requestId: request.requestId,
      status: "completed",
      summary: request.goal,
      output: request.goal,
      structuredOutput: {
        session: {
          engine: "app-server",
        },
      },
      completedAt: new Date().toISOString(),
    };
  };

  const harness = createHarness({
    omitRuntimeRegistry: true,
  });

  try {
    await harness.handleIncomingText("请走内建 app-server runtime");
    const messages = harness.takeMessages();

    assert.ok(messages.some((message) => message.includes("请走内建 app-server runtime")));
    assert.equal(appServerCalls, 1);
    assert.equal(harness.getTaskRuntimeCalls().sdk, 0);
  } finally {
    AppServerTaskRuntime.prototype.runTask = originalRunTask;
    harness.cleanup();
  }
});

test("飞书在显式非法 runtimeEngine 时不会静默回退到 default runtime", async () => {
  const harness = createHarness();

  try {
    harness.writeRawPrincipalTaskSettings({
      runtimeEngine: "bogus-engine",
    });

    await harness.handleIncomingText("请检查飞书非法 runtime");

    const messages = harness.takeMessages().join("\n");
    assert.match(messages, /Invalid runtimeEngine: bogus-engine/);
    assert.deepEqual(harness.getTaskRuntimeCalls(), {
      sdk: 0,
      appServer: 0,
    });
  } finally {
    harness.cleanup();
  }
});

test("飞书在显式请求未启用 runtime 时不会静默回退到 default runtime", async () => {
  const harness = createHarness({
    runtimeEngine: "sdk",
    enabledRuntimeEngines: ["sdk"],
  });

  try {
    harness.writeRawPrincipalTaskSettings({
      runtimeEngine: "app-server",
    });

    await harness.handleIncomingText("请检查飞书未启用 runtime");

    const messages = harness.takeMessages().join("\n");
    assert.match(messages, /Requested runtimeEngine is not enabled: app-server/);
    assert.deepEqual(harness.getTaskRuntimeCalls(), {
      sdk: 0,
      appServer: 0,
    });
  } finally {
    harness.cleanup();
  }
});

test("飞书收到 task.action_required 时会提示命令式回复", async () => {
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerEventsBuilder: (request) => [{
      eventId: "event-feishu-action-required-1",
      taskId: request.taskId ?? "task-feishu-action-required",
      requestId: request.requestId,
      type: "task.action_required",
      status: "waiting",
      message: "Allow command?\n使用 /approve approval-1 或 /deny approval-1",
      payload: {
        actionId: "approval-1",
        actionType: "approval",
        prompt: "Allow command?",
        choices: ["approve", "deny"],
      },
      timestamp: new Date().toISOString(),
    }],
  });

  try {
    await harness.handleIncomingText("请执行一次等待审批测试");

    const messages = harness.takeMessages();
    assert.ok(messages.some((message) => /Allow command\?/.test(message)));
    assert.ok(messages.some((message) => /\/approve approval-1/.test(message)));
  } finally {
    harness.cleanup();
  }
});

test("飞书命令式审批恢复会沿同一任务链收口 action 提示、审批提交与最终结果", async () => {
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      actionBridge,
      taskRuntimeCalls,
    }) => ({
      async runTask(request, hooks = {}) {
        taskRuntimeCalls.appServer += 1;
        const taskId = request.taskId ?? "task-feishu-journey-1";
        const requestId = request.requestId;
        const actionId = "approval-feishu-journey-1";

        actionBridge.register({
          taskId,
          requestId,
          actionId,
          actionType: "approval",
          prompt: "Allow feishu recovery journey?",
          choices: ["approve", "deny"],
          scope: {
            sourceChannel: "feishu",
            userId: request.user.userId,
            ...(request.channelContext.channelSessionKey
              ? {
                sessionId: request.channelContext.channelSessionKey,
              }
              : {}),
          },
        });

        await hooks.onEvent?.({
          eventId: "event-feishu-journey-action-required",
          taskId,
          requestId,
          type: "task.action_required",
          status: "waiting",
          message: `Allow feishu recovery journey?\n使用 /approve ${actionId} 或 /deny ${actionId}`,
          payload: {
            actionId,
            actionType: "approval",
            prompt: "Allow feishu recovery journey?",
            choices: ["approve", "deny"],
          },
          timestamp: new Date().toISOString(),
        });

        const submissionPromise = actionBridge.waitForSubmission(taskId, requestId, actionId);
        assert.ok(submissionPromise);
        const submission = await submissionPromise;
        assert.ok(submission);
        assert.equal(submission.decision, "approve");

        const result: TaskResult = {
          taskId,
          requestId,
          status: "completed",
          summary: `最终结果：${request.goal}`,
          output: `最终结果：${request.goal}`,
          structuredOutput: {
            session: {
              engine: "app-server",
            },
          },
          completedAt: new Date().toISOString(),
        };

        return hooks.finalizeResult ? await hooks.finalizeResult(request, result) : result;
      },
      getRuntimeStore() {
        return runtimeStore;
      },
      getIdentityLinkService() {
        return identityService;
      },
      getPrincipalSkillsService() {
        return principalSkillsService;
      },
    }),
  } as FeishuHarnessConfig);

  try {
    const taskPromise = harness.handleIncomingText("请执行一次飞书恢复闭环测试");

    await waitFor(() => {
      const messages = harness.peekMessages();
      return messages.some((message) => message.includes("/approve approval-feishu-journey-1"));
    });

    await harness.handleCommand("approve", ["approval-feishu-journey-1"]);
    await taskPromise;

    const messages = harness.takeMessages().join("\n");
    assert.match(messages, /Allow feishu recovery journey\?/);
    assert.match(messages, /已提交审批/);
    assert.match(messages, /最终结果：请执行一次飞书恢复闭环测试/);
    const submissions = harness.getResolvedActionSubmissions();
    assert.equal(submissions.length, 1);
    assert.match(submissions[0]?.taskId ?? "", /^task-/);
    assert.equal(submissions[0]?.actionId, "approval-feishu-journey-1");
    assert.equal(submissions[0]?.decision, "approve");
    assert.ok(submissions[0]?.requestId);
  } finally {
    harness.cleanup();
  }
});

test("飞书连续 waiting action 恢复会在第二轮命令提交后才最终收口", async () => {
  const emittedEventSummaries: string[] = [];
  const harness = createHarness({
    runtimeEngine: "app-server",
    appServerRuntimeFactory: ({
      runtimeStore,
      identityService,
      principalSkillsService,
      actionBridge,
      taskRuntimeCalls,
    }) => ({
      async runTask(request, hooks = {}) {
        taskRuntimeCalls.appServer += 1;
        const taskId = request.taskId ?? "task-feishu-journey-2";
        const requestId = request.requestId;
        const firstActionId = "approval-feishu-journey-2a";
        const secondActionId = "approval-feishu-journey-2b";

        actionBridge.register({
          taskId,
          requestId,
          actionId: firstActionId,
          actionType: "approval",
          prompt: "Allow first feishu recovery step?",
          choices: ["approve", "deny"],
          scope: {
            sourceChannel: "feishu",
            userId: request.user.userId,
            ...(request.channelContext.channelSessionKey
              ? {
                sessionId: request.channelContext.channelSessionKey,
              }
              : {}),
          },
        });

        await hooks.onEvent?.({
          eventId: "event-feishu-journey-2-action-required-a",
          taskId,
          requestId,
          type: "task.action_required",
          status: "waiting",
          message: `Allow first feishu recovery step?\n使用 /approve ${firstActionId} 或 /deny ${firstActionId}`,
          payload: {
            actionId: firstActionId,
            actionType: "approval",
            prompt: "Allow first feishu recovery step?",
            choices: ["approve", "deny"],
          },
          timestamp: new Date().toISOString(),
        });
        emittedEventSummaries.push(`task.action_required:${firstActionId}`);

        const firstSubmissionPromise = actionBridge.waitForSubmission(taskId, requestId, firstActionId);
        assert.ok(firstSubmissionPromise);
        const firstSubmission = await firstSubmissionPromise;
        assert.ok(firstSubmission);
        assert.equal(firstSubmission.decision, "approve");

        emittedEventSummaries.push("task.progress:running");
        await hooks.onEvent?.({
          eventId: "event-feishu-journey-2-running",
          taskId,
          requestId,
          type: "task.progress",
          status: "running",
          message: "第一轮审批已提交，任务继续执行中。",
          payload: {
            itemType: "agent_message",
            threadEventType: "item.completed",
            itemId: "item-feishu-journey-2-running",
          },
          timestamp: new Date().toISOString(),
        });

        actionBridge.register({
          taskId,
          requestId,
          actionId: secondActionId,
          actionType: "approval",
          prompt: "Allow second feishu recovery step?",
          choices: ["approve", "deny"],
          scope: {
            sourceChannel: "feishu",
            userId: request.user.userId,
            ...(request.channelContext.channelSessionKey
              ? {
                sessionId: request.channelContext.channelSessionKey,
              }
              : {}),
          },
        });

        await hooks.onEvent?.({
          eventId: "event-feishu-journey-2-action-required-b",
          taskId,
          requestId,
          type: "task.action_required",
          status: "waiting",
          message: `Allow second feishu recovery step?\n使用 /approve ${secondActionId} 或 /deny ${secondActionId}`,
          payload: {
            actionId: secondActionId,
            actionType: "approval",
            prompt: "Allow second feishu recovery step?",
            choices: ["approve", "deny"],
          },
          timestamp: new Date().toISOString(),
        });
        emittedEventSummaries.push(`task.action_required:${secondActionId}`);

        const secondSubmissionPromise = actionBridge.waitForSubmission(taskId, requestId, secondActionId);
        assert.ok(secondSubmissionPromise);
        const secondSubmission = await secondSubmissionPromise;
        assert.ok(secondSubmission);
        assert.equal(secondSubmission.decision, "approve");

        const result: TaskResult = {
          taskId,
          requestId,
          status: "completed",
          summary: `最终结果：${request.goal}`,
          output: `最终结果：${request.goal}`,
          structuredOutput: {
            session: {
              engine: "app-server",
            },
          },
          completedAt: new Date().toISOString(),
        };

        return hooks.finalizeResult ? await hooks.finalizeResult(request, result) : result;
      },
      getRuntimeStore() {
        return runtimeStore;
      },
      getIdentityLinkService() {
        return identityService;
      },
      getPrincipalSkillsService() {
        return principalSkillsService;
      },
    }),
  } as FeishuHarnessConfig);

  try {
    let taskSettled = false;
    const taskPromise = harness.handleIncomingText("请执行一次飞书连续恢复闭环测试").then(() => {
      taskSettled = true;
    });

    await waitFor(() => {
      const messages = harness.peekMessages();
      return messages.some((message) => message.includes("/approve approval-feishu-journey-2a"));
    });

    const sessionId = harness.getCurrentSessionId();
    assert.ok(sessionId);

    await harness.handleCommand("approve", ["approval-feishu-journey-2a"]);

    await waitFor(() => {
      const messages = harness.peekMessages();
      return messages.some((message) => message.includes("/approve approval-feishu-journey-2b"));
    });

    const messagesAfterFirstApproval = harness.peekMessages().join("\n");
    assert.equal(taskSettled, false);
    assert.match(messagesAfterFirstApproval, /Allow first feishu recovery step\?/);
    assert.match(messagesAfterFirstApproval, /Allow second feishu recovery step\?/);
    assert.match(messagesAfterFirstApproval, /\/approve approval-feishu-journey-2b/);
    assert.doesNotMatch(messagesAfterFirstApproval, /最终结果：请执行一次飞书连续恢复闭环测试/);
    assert.deepEqual(emittedEventSummaries, [
      "task.action_required:approval-feishu-journey-2a",
      "task.progress:running",
      "task.action_required:approval-feishu-journey-2b",
    ]);

    await harness.handleCommand("approve", ["approval-feishu-journey-2b"]);
    await taskPromise;

    const messages = harness.takeMessages().join("\n");
    assert.equal(harness.getCurrentSessionId(), sessionId);
    assert.match(messages, /\/approve approval-feishu-journey-2a/);
    assert.match(messages, /\/approve approval-feishu-journey-2b/);
    assert.match(messages, /最终结果：请执行一次飞书连续恢复闭环测试/);
    assert.deepEqual(
      harness.getResolvedActionSubmissions().map((entry) => entry.actionId),
      [
        "approval-feishu-journey-2a",
        "approval-feishu-journey-2b",
      ],
    );
  } finally {
    harness.cleanup();
  }
});

type FeishuHarnessSkillItem = {
  skillName: string;
  description: string;
  installStatus: string;
  sourceType: string;
  sourceRefJson: string;
  managedPath: string;
  summary: { totalAccounts: number; syncedCount: number; conflictCount: number; failedCount: number };
  materializations: Array<{ targetId: string; state: string; lastError?: string }>;
  lastError?: string;
};

type FeishuHarnessCuratedItem = { name: string; installed: boolean };

type FeishuHarnessConfig = {
  runtimeCatalog?: CodexRuntimeCatalog;
  runtimeEngine?: "sdk" | "app-server";
  enabledRuntimeEngines?: Array<"sdk" | "app-server">;
  omitRuntimeRegistry?: boolean;
  appServerEventsBuilder?: (request: TaskRequest) => TaskEvent[];
  appServerRuntimeFactory?: (input: {
    runtimeStore: SqliteCodexSessionRegistry;
    identityService: IdentityLinkService;
    principalSkillsService: {
      listPrincipalSkills: () => FeishuHarnessSkillItem[];
      listCuratedSkills: () => Promise<FeishuHarnessCuratedItem[]>;
      installFromLocalPath: (input: {
        principalId: string;
        absolutePath: string;
        replace?: boolean;
      }) => Promise<unknown>;
      installFromGithub: (input: {
        principalId: string;
        repo?: string;
        path?: string;
        url?: string;
        ref?: string;
        replace?: boolean;
      }) => Promise<unknown>;
      installFromCurated: (input: {
        principalId: string;
        skillName: string;
        replace?: boolean;
      }) => Promise<unknown>;
      removeSkill: (principalId: string, skillName: string) => unknown;
      syncSkill: (principalId: string, skillName: string, options?: { force?: boolean }) => Promise<unknown>;
    };
    taskRuntimeCalls: { sdk: number; appServer: number };
    actionBridge: AppServerActionBridge;
  }) => TaskRuntimeFacade;
  listItems?: Array<FeishuHarnessSkillItem>;
  curatedItems?: Array<FeishuHarnessCuratedItem>;
};

type FeishuHarnessSkillCall =
  | { method: "installFromLocalPath"; principalId: string; absolutePath: string; replace?: boolean }
  | {
    method: "installFromGithub";
    principalId: string;
    repo?: string;
    path?: string;
    url?: string;
    ref?: string;
    replace?: boolean;
  }
  | { method: "installFromCurated"; principalId: string; skillName: string; replace?: boolean }
  | { method: "removeSkill"; principalId: string; skillName: string }
  | { method: "syncSkill"; principalId: string; skillName: string; force?: boolean };

function createTaskRuntimeDouble(input: {
  engine: "sdk" | "app-server";
  runtimeStore: SqliteCodexSessionRegistry;
  identityService: IdentityLinkService;
  principalSkillsService: {
    listPrincipalSkills: () => FeishuHarnessSkillItem[];
    listCuratedSkills: () => Promise<FeishuHarnessCuratedItem[]>;
    installFromLocalPath: (input: {
      principalId: string;
      absolutePath: string;
      replace?: boolean;
    }) => Promise<unknown>;
    installFromGithub: (input: {
      principalId: string;
      repo?: string;
      path?: string;
      url?: string;
      ref?: string;
      replace?: boolean;
    }) => Promise<unknown>;
    installFromCurated: (input: {
      principalId: string;
      skillName: string;
      replace?: boolean;
    }) => Promise<unknown>;
    removeSkill: (principalId: string, skillName: string) => unknown;
    syncSkill: (principalId: string, skillName: string, options?: { force?: boolean }) => Promise<unknown>;
  };
  taskRuntimeCalls: { sdk: number; appServer: number };
  eventBuilder?: (request: TaskRequest) => TaskEvent[];
}): TaskRuntimeFacade {
  return {
    async runTask(request: TaskRequest, hooks: TaskRuntimeRunHooks = {}): Promise<TaskResult> {
      if (input.engine === "sdk") {
        input.taskRuntimeCalls.sdk += 1;
      } else {
        input.taskRuntimeCalls.appServer += 1;
      }

      const events = input.eventBuilder?.(request) ?? [{
        eventId: `event-feishu-${input.engine}-1`,
        taskId: request.taskId ?? `task-feishu-${input.engine}`,
        requestId: request.requestId,
        type: "task.progress",
        status: "running",
        message: request.goal,
        payload: {
          itemType: "agent_message",
          threadEventType: "item.completed",
          itemId: `item-feishu-${input.engine}-1`,
        },
        timestamp: new Date().toISOString(),
      }];

      for (const event of events) {
        await hooks.onEvent?.(event);
      }

      const baseResult: TaskResult = {
        taskId: request.taskId ?? `task-feishu-${input.engine}`,
        requestId: request.requestId,
        status: "completed",
        summary: request.goal,
        output: request.goal,
        ...(input.engine === "app-server"
          ? {
            structuredOutput: {
              session: {
                engine: "app-server",
              },
            },
          }
          : {}),
        completedAt: new Date().toISOString(),
      };
      return hooks.finalizeResult ? await hooks.finalizeResult(request, baseResult) : baseResult;
    },
    getRuntimeStore: () => input.runtimeStore,
    getIdentityLinkService: () => input.identityService,
    getPrincipalSkillsService: () => input.principalSkillsService,
  };
}

function createHarness(
  runtimeCatalogOrSkillsOverrides?: CodexRuntimeCatalog | FeishuHarnessConfig | {
    listItems?: Array<FeishuHarnessSkillItem>;
    curatedItems?: Array<FeishuHarnessCuratedItem>;
  },
  skillsOverrides?: {
    listItems?: Array<FeishuHarnessSkillItem>;
    curatedItems?: Array<FeishuHarnessCuratedItem>;
  },
) {
  const harnessConfig =
    runtimeCatalogOrSkillsOverrides
    && typeof runtimeCatalogOrSkillsOverrides === "object"
    && !("models" in runtimeCatalogOrSkillsOverrides)
    && (
      "runtimeEngine" in runtimeCatalogOrSkillsOverrides
      || "runtimeCatalog" in runtimeCatalogOrSkillsOverrides
      || "omitRuntimeRegistry" in runtimeCatalogOrSkillsOverrides
      || "appServerEventsBuilder" in runtimeCatalogOrSkillsOverrides
      || "appServerRuntimeFactory" in runtimeCatalogOrSkillsOverrides
    )
      ? runtimeCatalogOrSkillsOverrides as FeishuHarnessConfig
      : null;
  const runtimeCatalog = harnessConfig?.runtimeCatalog
    ?? (
      runtimeCatalogOrSkillsOverrides && "models" in runtimeCatalogOrSkillsOverrides
        ? runtimeCatalogOrSkillsOverrides
        : createRuntimeCatalog()
    );
  const normalizedSkillsOverrides = harnessConfig
    ? {
      listItems: harnessConfig.listItems,
      curatedItems: harnessConfig.curatedItems,
    }
    : (
      runtimeCatalogOrSkillsOverrides && "models" in runtimeCatalogOrSkillsOverrides
        ? skillsOverrides
        : runtimeCatalogOrSkillsOverrides
    );
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-feishu-service-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });
  const identityService = new IdentityLinkService(runtimeStore);
  const sessionStore = new FeishuSessionStore({
    filePath: join(workingDirectory, "infra/local/feishu-sessions.json"),
  });
  const accounts = [
    {
      accountId: "acc-1",
      label: "Alpha",
      accountEmail: "alpha@example.com",
      codexHome: "/tmp/codex-alpha",
    },
    {
      accountId: "acc-2",
      label: "Beta",
      accountEmail: "beta@example.com",
      codexHome: "/tmp/codex-beta",
    },
  ];
  const skillsState = {
    listItems: normalizedSkillsOverrides?.listItems ?? [],
    curatedItems: normalizedSkillsOverrides?.curatedItems ?? [],
    writeCalls: [] as FeishuHarnessSkillCall[],
  };
  function currentPrincipalId(): string {
    return ensurePrincipalId();
  }

  function buildManagedPath(skillName: string): string {
    return join(workingDirectory, "infra/local/principals", currentPrincipalId(), "skills", skillName);
  }

  function buildSkillSummary(totalAccounts = accounts.length) {
    return {
      totalAccounts,
      syncedCount: totalAccounts,
      conflictCount: 0,
      failedCount: 0,
    };
  }

  function buildSkillMaterializations(totalAccounts = accounts.length) {
    return accounts.slice(0, totalAccounts).map((account) => ({
      targetId: account.accountId,
      state: "synced",
    }));
  }

  function buildSkillItem(input: {
    skillName: string;
    description?: string;
    sourceType: string;
    sourceRefJson: string;
    installStatus?: string;
  }): FeishuHarnessSkillItem {
    return {
      skillName: input.skillName,
      description: input.description ?? `${input.skillName} description`,
      installStatus: input.installStatus ?? "ready",
      sourceType: input.sourceType,
      sourceRefJson: input.sourceRefJson,
      managedPath: buildManagedPath(input.skillName),
      summary: buildSkillSummary(),
      materializations: buildSkillMaterializations(),
    };
  }

  function upsertSkillItem(item: FeishuHarnessSkillItem): void {
    const index = skillsState.listItems.findIndex((existing) => existing.skillName === item.skillName);
    if (index >= 0) {
      skillsState.listItems[index] = item;
      return;
    }
    skillsState.listItems.push(item);
  }

  function syncCuratedInstalledFlag(skillName: string, installed: boolean): void {
    const existing = skillsState.curatedItems.find((item) => item.name === skillName);
    if (existing) {
      existing.installed = installed;
      return;
    }
    skillsState.curatedItems.push({ name: skillName, installed });
  }

  function removeSkillItem(skillName: string): FeishuHarnessSkillItem {
    const index = skillsState.listItems.findIndex((item) => item.skillName === skillName);
    if (index === -1) {
      throw new Error(`技能 ${skillName} 不存在。`);
    }
    const [removed] = skillsState.listItems.splice(index, 1);
    if (!removed) {
      throw new Error(`技能 ${skillName} 删除失败。`);
    }
    syncCuratedInstalledFlag(skillName, false);
    return removed;
  }

  const principalSkillsService = {
    listPrincipalSkills: () => skillsState.listItems,
    listCuratedSkills: async () => skillsState.curatedItems,
    installFromLocalPath: async (input: { principalId: string; absolutePath: string; replace?: boolean }) => {
      skillsState.writeCalls.push({ method: "installFromLocalPath", ...input });
      const skillName = input.absolutePath.split("/").filter(Boolean).pop() ?? "local-skill";
      const item = buildSkillItem({
        skillName,
        description: `installed from local path ${input.absolutePath}`,
        sourceType: "local-path",
        sourceRefJson: JSON.stringify({ absolutePath: input.absolutePath }),
      });
      upsertSkillItem(item);
      syncCuratedInstalledFlag(skillName, true);
      return { skill: item, materializations: item.materializations, summary: item.summary };
    },
    installFromGithub: async (input: {
      principalId: string;
      repo?: string;
      path?: string;
      url?: string;
      ref?: string;
      replace?: boolean;
    }) => {
      skillsState.writeCalls.push({ method: "installFromGithub", ...input });
      const skillName = (input.path ?? input.url ?? "github-skill").split("/").filter(Boolean).pop() ?? "github-skill";
      const sourceRefJson = input.url
        ? JSON.stringify({ url: input.url, ...(input.ref ? { ref: input.ref } : {}) })
        : JSON.stringify({ repo: input.repo, path: input.path, ...(input.ref ? { ref: input.ref } : {}) });
      const sourceType = input.url ? "github-url" : "github-repo-path";
      const item = buildSkillItem({
        skillName,
        description: `installed from ${sourceType}`,
        sourceType,
        sourceRefJson,
      });
      upsertSkillItem(item);
      syncCuratedInstalledFlag(skillName, true);
      return { skill: item, materializations: item.materializations, summary: item.summary };
    },
    installFromCurated: async (input: { principalId: string; skillName: string; replace?: boolean }) => {
      skillsState.writeCalls.push({ method: "installFromCurated", ...input });
      const item = buildSkillItem({
        skillName: input.skillName,
        description: `installed curated skill ${input.skillName}`,
        sourceType: "curated",
        sourceRefJson: JSON.stringify({ repo: "openai/skills", path: `skills/.curated/${input.skillName}` }),
      });
      upsertSkillItem(item);
      syncCuratedInstalledFlag(input.skillName, true);
      return { skill: item, materializations: item.materializations, summary: item.summary };
    },
    removeSkill: (principalId: string, skillName: string) => {
      skillsState.writeCalls.push({ method: "removeSkill", principalId, skillName });
      const removed = removeSkillItem(skillName);
      return {
        skillName: removed.skillName,
        removedManagedPath: true,
        removedMaterializations: removed.materializations.length,
      };
    },
    syncSkill: async (principalId: string, skillName: string, options?: { force?: boolean }) => {
      skillsState.writeCalls.push({
        method: "syncSkill",
        principalId,
        skillName,
        ...(typeof options?.force === "boolean" ? { force: options.force } : {}),
      });
      const item = skillsState.listItems.find((entry) => entry.skillName === skillName);
      if (!item) {
        throw new Error(`技能 ${skillName} 不存在。`);
      }
      item.summary = buildSkillSummary();
      item.materializations = buildSkillMaterializations();
      item.installStatus = "ready";
      return { skill: item, materializations: item.materializations, summary: item.summary };
    },
  };
  const taskRuntimeCalls = {
    sdk: 0,
    appServer: 0,
  };
  const actionBridge = new AppServerActionBridge();
  let rawPrincipalTaskSettingsOverride: Record<string, unknown> | null = null;
  const baseRuntime = createTaskRuntimeDouble({
    engine: "sdk",
    runtimeStore,
    identityService,
    principalSkillsService,
    taskRuntimeCalls,
  });
  const runtime = {
    ...baseRuntime,
    getWorkingDirectory: () => workingDirectory,
    readRuntimeConfig: async (): Promise<CodexRuntimeCatalog> => runtimeCatalog,
    getPrincipalTaskSettings: (principalId?: string): PrincipalTaskSettings | null => {
      if (!principalId) {
        return null;
      }

      if (rawPrincipalTaskSettingsOverride) {
        return rawPrincipalTaskSettingsOverride as PrincipalTaskSettings;
      }

      return runtimeStore.getPrincipalTaskSettings(principalId)?.settings ?? null;
    },
    savePrincipalTaskSettings: (principalId: string, settings: PrincipalTaskSettings): PrincipalTaskSettings => {
      const now = new Date().toISOString();
      const existing = runtimeStore.getPrincipalTaskSettings(principalId);
      runtimeStore.savePrincipalTaskSettings({
        principalId,
        settings,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      return settings;
    },
  } as unknown as CodexTaskRuntime;
  const appServerRuntime = harnessConfig?.appServerRuntimeFactory
    ? harnessConfig.appServerRuntimeFactory({
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
      actionBridge,
    })
    : createTaskRuntimeDouble({
      engine: "app-server",
      runtimeStore,
      identityService,
      principalSkillsService,
      taskRuntimeCalls,
      ...(harnessConfig?.appServerEventsBuilder ? { eventBuilder: harnessConfig.appServerEventsBuilder } : {}),
    });
  const loggerState = createLogger();
  const resolvedActionSubmissions: TaskPendingActionSubmitRequest[] = [];
  const originalResolveAction = actionBridge.resolve.bind(actionBridge);
  actionBridge.resolve = (payload) => {
    const resolved = originalResolveAction(payload);

    if (resolved) {
      resolvedActionSubmissions.push(payload);
    }

    return resolved;
  };
  const service = new FeishuChannelService({
    runtime,
    ...(harnessConfig?.omitRuntimeRegistry
      ? {}
      : {
        runtimeRegistry: buildRuntimeRegistry({
          defaultRuntimeEngine: harnessConfig?.runtimeEngine === "sdk" ? "sdk" : "app-server",
          sdkRuntime: runtime,
          appServerRuntime,
          ...(harnessConfig?.enabledRuntimeEngines
            ? {
              enabledRuntimeEngines: harnessConfig.enabledRuntimeEngines,
            }
            : {}),
        }),
      }),
    authRuntime: {
      listAccounts: () => accounts,
      getActiveAccount: () => accounts[0] ?? null,
      readSnapshot: async (accountId?: string) => {
        const resolved = accountId
          ? accounts.find((account) => account.accountId === accountId) ?? null
          : accounts[0] ?? null;

        if (!resolved) {
          return {
            accountId: "",
            accountLabel: "",
            authenticated: false,
            authMethod: null,
            requiresOpenaiAuth: true,
            pendingLogin: null,
            lastError: null,
            providerProfile: null,
            account: null,
            rateLimits: null,
          };
        }

        return {
          accountId: resolved.accountId,
          accountLabel: resolved.label,
          authenticated: true,
          authMethod: "chatgpt",
          requiresOpenaiAuth: true,
          pendingLogin: null,
          lastError: null,
          providerProfile: null,
          account: {
            email: resolved.accountEmail,
            planType: "plus",
          },
          rateLimits: null,
        };
      },
    } as never,
    taskTimeoutMs: 5_000,
    sessionStore,
    logger: loggerState.logger,
  });
  const messages: string[] = [];
  let nextMessageId = 1;
  const context = {
    chatId: "chat-1",
    messageId: "message-1",
    userId: "user-1",
    text: "",
  };

  (service as unknown as { safeSendText: (chatId: string, text: string) => Promise<void> }).safeSendText = async (
    _chatId,
    text,
  ) => {
    messages.push(text);
  };
  (service as unknown as { actionBridge: AppServerActionBridge }).actionBridge = actionBridge;
  (service as unknown as { client: unknown }).client = {
    im: {
      v1: {
        message: {
          create: async ({ data }: { data: { content: string } }) => {
            messages.push(extractFeishuRenderedText(data.content));
            return {
              data: {
                message_id: `msg-created-${nextMessageId++}`,
              },
            };
          },
          update: async ({ path, data }: { path: { message_id: string }; data: { content: string } }) => {
            messages.push(extractFeishuRenderedText(data.content));
            return {
              data: {
                message_id: path.message_id,
              },
            };
          },
        },
      },
    },
  };

  function ensurePrincipalId(): string {
    return identityService.ensureIdentity({
      channel: "feishu",
      channelUserId: context.userId,
    }).principalId;
  }

  function conversationKey() {
    return {
      chatId: context.chatId,
      userId: context.userId,
    };
  }

  return {
    async handleCommand(name: string, args: string[]) {
      await (service as unknown as {
        handleCommand(command: { name: string; args: string[]; raw: string }, incomingContext: typeof context): Promise<void>;
      }).handleCommand({ name, args, raw: `/${name} ${args.join(" ")}`.trim() }, context);
    },
    async handleIncomingText(text: string) {
      await (service as unknown as {
        handleTaskMessage(incomingContext: typeof context): Promise<void>;
      }).handleTaskMessage({ ...context, text });
    },
    takeMessages() {
      const current = [...messages];
      messages.length = 0;
      return current;
    },
    peekMessages() {
      return [...messages];
    },
    takeSingleMessage() {
      assert.equal(messages.length, 1);
      return messages.pop() ?? "";
    },
    getTaskRuntimeCalls() {
      return { ...taskRuntimeCalls };
    },
    injectPendingAction(input: {
      taskId?: string;
      requestId?: string;
      actionId: string;
      actionType: "approval" | "user-input";
      prompt: string;
      choices?: string[];
      sourceChannel?: "feishu";
      sessionId?: string;
      userId?: string;
    }) {
      const taskId = input.taskId ?? "task-pending-action";
      const requestId = input.requestId ?? "req-pending-action";
      const scopedSessionId = input.sessionId ?? sessionStore.ensureActiveSessionId(conversationKey());

      return actionBridge.register({
        taskId,
        requestId,
        actionId: input.actionId,
        actionType: input.actionType,
        prompt: input.prompt,
        ...(input.choices ? { choices: input.choices } : {}),
        scope: {
          sourceChannel: input.sourceChannel ?? "feishu",
          sessionId: scopedSessionId,
          userId: input.userId ?? context.userId,
        },
      });
    },
    findPendingAction(actionId: string) {
      return actionBridge.find(actionId);
    },
    getResolvedActionSubmissions() {
      return [...resolvedActionSubmissions];
    },
    getSkillWriteCalls() {
      return [...skillsState.writeCalls];
    },
    getInfoLogs() {
      return [...loggerState.infoLogs];
    },
    getStoredPrincipalTaskSettings() {
      return runtimeStore.getPrincipalTaskSettings(ensurePrincipalId())?.settings ?? null;
    },
    writeRawPrincipalTaskSettings(settings: Record<string, unknown>) {
      ensurePrincipalId();
      rawPrincipalTaskSettingsOverride = { ...settings };
    },
    async createTextMessage(chatId: string, text: string) {
      return await (service as unknown as {
        createTextMessage(targetChatId: string, value: string): Promise<unknown>;
      }).createTextMessage(chatId, text);
    },
    setClient(client: unknown) {
      (service as unknown as { client: unknown }).client = client;
    },
    createTaskPayload(sessionId: string, text: string) {
      return (service as unknown as {
        createTaskPayload(incomingContext: typeof context, currentSessionId: string): { options?: Record<string, unknown> };
      }).createTaskPayload({ ...context, text }, sessionId);
    },
    getWorkingDirectory() {
      return workingDirectory;
    },
    setCurrentSession(sessionId: string) {
      sessionStore.setActiveSessionId(conversationKey(), sessionId);
    },
    getCurrentSessionId() {
      return sessionStore.getActiveSessionId(conversationKey());
    },
    readSessionSettings(sessionId: string) {
      return runtimeStore.getSessionTaskSettings(sessionId);
    },
    writeSessionSettings(sessionId: string, settings: SessionTaskSettings) {
      const now = new Date().toISOString();
      const existing = runtimeStore.getSessionTaskSettings(sessionId);
      runtimeStore.saveSessionTaskSettings({
        sessionId,
        settings,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    },
    appendTurn(sessionId: string, goal = "hello") {
      const now = new Date().toISOString();
      const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      runtimeStore.upsertTurnFromRequest({
        requestId: `request-${seed}`,
        sourceChannel: "feishu",
        user: {
          userId: context.userId,
        },
        goal,
        channelContext: {
          sessionId,
        },
        createdAt: now,
      }, `task-${seed}`);
    },
    createWorkspace(name: string) {
      const workspace = join(workingDirectory, name);
      mkdirSync(workspace, { recursive: true });
      return workspace;
    },
    cleanup() {
      rmSync(workingDirectory, { recursive: true, force: true });
    },
  };
}

function buildRuntimeRegistry(input: {
  enabledRuntimeEngines?: Array<"sdk" | "app-server">;
  defaultRuntimeEngine: "sdk" | "app-server";
  sdkRuntime: TaskRuntimeFacade;
  appServerRuntime: TaskRuntimeFacade;
}) {
  const enabledRuntimeEngines = input.enabledRuntimeEngines ?? ["sdk", "app-server"];
  const runtimes: Partial<Record<"sdk" | "app-server", TaskRuntimeFacade>> = {};

  if (enabledRuntimeEngines.includes("sdk")) {
    runtimes.sdk = input.sdkRuntime;
  }

  if (enabledRuntimeEngines.includes("app-server")) {
    runtimes["app-server"] = input.appServerRuntime;
  }

  return {
    defaultRuntime: input.defaultRuntimeEngine === "sdk" ? input.sdkRuntime : input.appServerRuntime,
    runtimes,
  };
}

function extractFeishuRenderedText(content: string): string {
  const parsed = JSON.parse(content) as {
    text?: string;
    zh_cn?: {
      content?: Array<Array<{ text?: string }>>;
    };
  };

  if (typeof parsed.text === "string") {
    return parsed.text;
  }

  const firstText = parsed.zh_cn?.content?.flat().find((item) => typeof item.text === "string")?.text;
  return typeof firstText === "string" ? firstText : "";
}

async function waitFor(check: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

function createRuntimeCatalog(): CodexRuntimeCatalog {
  return {
    models: [createRuntimeModel("gpt-5.4", "medium", true)],
    defaults: {
      profile: null,
      model: "gpt-5.4",
      reasoning: "medium",
      approvalPolicy: null,
      sandboxMode: null,
      webSearchMode: null,
      networkAccessEnabled: null,
    },
    provider: {
      type: "codex-default",
      name: "Codex CLI",
      baseUrl: null,
      model: "gpt-5.4",
      lockedModel: false,
    },
    accessModes: [
      {
        id: "auth",
        label: "auth",
        description: "auth",
      },
    ],
    thirdPartyProviders: [],
    personas: [],
  };
}

function createRuntimeModel(model: string, defaultReasoningEffort: string, isDefault: boolean) {
  return {
    id: model,
    model,
    displayName: model,
    description: model,
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "low" },
      { reasoningEffort: "medium", description: "medium" },
      { reasoningEffort: "high", description: "high" },
      { reasoningEffort: "xhigh", description: "xhigh" },
    ],
    defaultReasoningEffort,
    contextWindow: 200_000,
    capabilities: {
      textInput: true,
      imageInput: false,
      supportsCodexTasks: true,
      supportsReasoningSummaries: false,
      supportsVerbosity: false,
      supportsParallelToolCalls: false,
      supportsSearchTool: true,
      supportsImageDetailOriginal: false,
    },
    supportsPersonality: true,
    supportsCodexTasks: true,
    isDefault,
  };
}

function createLogger() {
  const infoLogs: string[] = [];
  const warnLogs: string[] = [];
  const errorLogs: string[] = [];

  return {
    logger: {
      info(message: string) {
        infoLogs.push(message);
      },
      warn(message: string) {
        warnLogs.push(message);
      },
      error(message: string) {
        errorLogs.push(message);
      },
    },
    infoLogs,
    warnLogs,
    errorLogs,
  };
}

function parseSessionIdFromNewMessage(message: string): string {
  const matched = message.match(/已创建新会话：([^\n]+)/);
  assert.ok(matched?.[1], `无法从消息中解析会话 ID：${message}`);
  return matched[1].trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
