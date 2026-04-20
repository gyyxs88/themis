import assert from "node:assert/strict";
import test from "node:test";
import {
  FeishuTaskMessageBridge,
  normalizeComparableReply,
} from "./task-message-bridge.js";

test("顺序延迟：第二条 progress 到来时才发送上一条，并补新的处理中占位", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-1", "item-1", "第一条"));

  assert.deepEqual(operations, ["create:处理中..."]);

  await bridge.deliver(createProgressMessage("req-1", "item-2", "第二条"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:第一条",
    "create:处理中...",
  ]);

  await bridge.deliver(createResultMessage("req-1", "第二条\n\n额度剩余：5h 87%｜1w 95%"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:第一条",
    "create:处理中...",
    "update:message-2:第二条\n\n额度剩余：5h 87%｜1w 95%",
  ]);
});

test("同一 item 的多次增量只覆盖缓存，不会把每次 delta 都落成独立消息", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-same-item-1", "item-same-1", "你好"));
  await bridge.deliver(createProgressMessage("req-same-item-1", "item-same-1", "你好，我"));
  await bridge.deliver(createProgressMessage("req-same-item-1", "item-same-1", "你好，我已经看过仓库"));

  assert.deepEqual(operations, ["create:处理中..."]);

  await bridge.deliver(createResultMessage("req-same-item-1", "你好，我已经看过仓库"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:你好，我已经看过仓库",
  ]);
});

test("最终消息与缓存 progress 仅额度不同：只更新最后一个占位，不重复发送上一条", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-2", "item-1", "同一条正文"));
  await bridge.deliver(createResultMessage("req-2", "同一条正文\n\n额度剩余：5h 87%｜1w 95%"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:同一条正文\n\n额度剩余：5h 87%｜1w 95%",
  ]);
});

test("最终消息与缓存 progress 不同：会先发送缓存，再发送最终消息", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-3", "item-1", "上一条"));
  await bridge.deliver(createResultMessage("req-3", "最终条"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:上一条",
    "create:最终条",
  ]);
});

test("静默超时会补发缓存 progress，并保留新的处理中占位", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`, 20);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-4", "item-1", "超时补发"));
  await wait(50);

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:超时补发",
    "create:处理中...",
  ]);

  await bridge.deliver(createResultMessage("req-4", "最终完成"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:超时补发",
    "create:处理中...",
    "update:message-2:最终完成",
  ]);
});

test("静默超时后若最终结果与已补发正文一致：尾部占位应收口为已完成，而不是重复正文", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`, 20);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-4-same-final", "item-1", "已经补发的正文"));
  await wait(50);

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:已经补发的正文",
    "create:处理中...",
  ]);

  await bridge.deliver(createResultMessage("req-4-same-final", "已经补发的正文"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:已经补发的正文",
    "create:处理中...",
    "update:message-2:已完成",
  ]);
});

test("状态类 progress 会单独发出状态摘要，不打断处理中占位", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver({
    kind: "event",
    requestId: "req-status-1",
    title: "task.progress",
    text: "## 系统继续处理中\n会话：session-1\n第一轮审批已提交，任务继续执行中。",
    metadata: {
      feishuSurfaceKind: "status",
      status: "running",
    },
  });

  assert.deepEqual(operations, [
    "create:处理中...",
    "create:## 系统继续处理中\n会话：session-1\n第一轮审批已提交，任务继续执行中。",
  ]);
});

test("persona onboarding 的无 actionId waiting 事件会静默，让最终问题直接替换占位", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver({
    kind: "event",
    requestId: "req-persona-onboarding-1",
    title: "task.action_required",
    text: "Persona bootstrap is waiting for the next answer.",
    metadata: {
      personaOnboarding: {
        status: "question",
        phase: "started",
      },
    },
  });
  await bridge.deliver(createResultMessage("req-persona-onboarding-1", "先认识一下。以后我怎么称呼你比较顺手？"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:先认识一下。以后我怎么称呼你比较顺手？",
  ]);
});

test("normalizeComparableReply 会忽略尾部额度信息", () => {
  assert.equal(
    normalizeComparableReply("正文\n\n额度剩余：5h 87%｜1w 95%"),
    "正文",
  );
  assert.equal(normalizeComparableReply("正文"), "正文");
});

function createBridge(
  operations: string[],
  nextMessageId: () => string,
  progressFlushTimeoutMs = 60_000,
): FeishuTaskMessageBridge {
  return new FeishuTaskMessageBridge({
    createText: async (text) => {
      operations.push(`create:${text}`);
      return {
        data: {
          message_id: nextMessageId(),
        },
      };
    },
    updateText: async (messageId, text) => {
      operations.push(`update:${messageId}:${text}`);
      return {
        data: {
          message_id: messageId,
        },
      };
    },
    sendText: async (text) => {
      operations.push(`send:${text}`);
    },
    splitText: (text) => {
      const normalized = text.trim();
      return normalized ? [normalized] : [];
    },
    progressFlushTimeoutMs,
  });
}

function createProgressMessage(requestId: string, itemId: string, text: string) {
  return {
    kind: "event" as const,
    requestId,
    title: "task.progress",
    text,
    metadata: {
      itemType: "agent_message",
      threadEventType: "item.completed",
      itemId,
    },
  };
}

function createResultMessage(requestId: string, text: string) {
  return {
    kind: "result" as const,
    requestId,
    title: "task.completed",
    text,
    metadata: {
      status: "completed",
      output: text,
    },
  };
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
