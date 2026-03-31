import assert from "node:assert/strict";
import test from "node:test";
import {
  renderFeishuCurrentSessionSurface,
  renderFeishuTaskStatusSurface,
  renderFeishuWaitingActionSurface,
} from "./mobile-surface.js";

test("renderFeishuWaitingActionSurface 会输出等待动作、thread 摘要和命令提示", () => {
  const text = renderFeishuWaitingActionSurface({
    sessionId: "session-feishu-1",
    latestStatus: "waiting",
    actionId: "approval-1",
    actionType: "approval",
    prompt: "Allow command?",
    thread: {
      engine: "app-server",
      threadId: "thread-feishu-1",
      preview: "review current diff",
      status: "running",
      turnCount: 3,
    },
  });

  assert.match(text, /等待你处理/);
  assert.match(text, /approval-1/);
  assert.match(text, /thread-feishu-1/);
  assert.match(text, /review current diff/);
  assert.match(text, /\/approve approval-1/);
  assert.match(text, /\/deny approval-1/);
});

test("renderFeishuWaitingActionSurface 在 user-input 场景提示直接回复并保留 /reply 兜底", () => {
  const text = renderFeishuWaitingActionSurface({
    sessionId: "session-feishu-1",
    latestStatus: "waiting",
    actionId: "reply-1",
    actionType: "user-input",
    prompt: "Please add details",
    thread: {
      engine: "app-server",
      threadId: "thread-feishu-1",
      preview: "need more detail",
      status: "waiting",
      turnCount: 2,
    },
  });

  assert.match(text, /直接回复这条消息即可继续/);
  assert.match(text, /\/reply reply-1 <内容>/);
});

test("renderFeishuCurrentSessionSurface 会输出工作区、最新任务状态和 thread 概览", () => {
  const text = renderFeishuCurrentSessionSurface({
    sessionId: "session-feishu-1",
    workspacePath: "/workspace/themis",
    principalId: "principal-1",
    accountLabel: "alpha@example.com",
    latestStatus: "running",
    thread: {
      engine: "app-server",
      threadId: "thread-feishu-1",
      preview: "ship mobile surface",
      status: "running",
      turnCount: 5,
    },
  });

  assert.match(text, /当前会话/);
  assert.match(text, /任务状态：running/);
  assert.match(text, /\/workspace\/themis/);
  assert.match(text, /principal-1/);
  assert.match(text, /alpha@example.com/);
  assert.match(text, /thread-feishu-1/);
  assert.match(text, /ship mobile surface/);
});

test("renderFeishuTaskStatusSurface 会把已提交审批后的 running 表达成移动端状态文案", () => {
  const text = renderFeishuTaskStatusSurface({
    phase: "action-submitted-running",
    sessionId: "session-feishu-1",
    summary: "第一轮审批已提交，任务继续执行中。",
  });

  assert.match(text, /系统继续处理中/);
  assert.match(text, /session-feishu-1/);
  assert.match(text, /第一轮审批已提交/);
});
