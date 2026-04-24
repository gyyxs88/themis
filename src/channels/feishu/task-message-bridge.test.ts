import assert from "node:assert/strict";
import test from "node:test";
import {
  FeishuTaskMessageBridge,
  normalizeComparableReply,
} from "./task-message-bridge.js";

test("commentary completed 会立刻推送正文，并补新的处理中占位", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createCommentaryProgressMessage("req-1", "item-1", "第一条"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:第一条",
    "create:处理中...",
  ]);
});

test("多条 commentary completed 会各自立刻落成独立正文气泡", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createCommentaryProgressMessage("req-commentary-2", "item-1", "第一条"));
  await bridge.deliver(createCommentaryProgressMessage("req-commentary-2", "item-2", "第二条"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:第一条",
    "create:处理中...",
    "update:message-2:第二条",
    "create:处理中...",
  ]);
});

test("首条 tool trace 会接手处理中占位，并在同 bucket 上原地更新", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createToolTraceProgressMessage("req-tool-1", "tool-bucket-1", "工具轨迹\n1. 正在运行 npm run build"));
  await bridge.deliver(createToolTraceProgressMessage("req-tool-1", "tool-bucket-1", "工具轨迹\n1. 已运行 npm run build"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:工具轨迹\n1. 正在运行 npm run build",
    "create:处理中...",
    "update:message-1:工具轨迹\n1. 已运行 npm run build",
  ]);
});

test("tool trace 在 bucketId 变化时会新起一个工具轨迹气泡，不影响正文尾部占位", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createToolTraceProgressMessage("req-tool-2", "tool-bucket-1", "工具轨迹\n1. 等待审批 npm run build"));
  await bridge.deliver(createToolTraceProgressMessage("req-tool-2", "tool-bucket-2", "工具轨迹\n1. 正在运行 deploy"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:工具轨迹\n1. 等待审批 npm run build",
    "create:处理中...",
    "recall:message-2",
    "create:工具轨迹\n1. 正在运行 deploy",
    "create:处理中...",
  ]);
});

test("tool trace 接手占位后，后续 commentary 会继续使用新的尾部占位", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createToolTraceProgressMessage("req-tool-commentary", "tool-bucket-1", "工具轨迹\n1. 已调用 MCP themis.dispatch"));
  await bridge.deliver(createCommentaryProgressMessage("req-tool-commentary", "item-1", "老板，已经派出去一条只读工单。"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:工具轨迹\n1. 已调用 MCP themis.dispatch",
    "create:处理中...",
    "update:message-2:老板，已经派出去一条只读工单。",
    "create:处理中...",
  ]);
});

test("正文已经出现后，tool trace 不会再抢占尾部占位", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createCommentaryProgressMessage("req-commentary-tool", "item-1", "先汇总一下当前发现。"));
  await bridge.deliver(createToolTraceProgressMessage("req-commentary-tool", "tool-bucket-1", "工具轨迹\n1. 正在运行 rg -n todo"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:先汇总一下当前发现。",
    "create:处理中...",
    "recall:message-2",
    "create:工具轨迹\n1. 正在运行 rg -n todo",
    "create:处理中...",
  ]);
});

test("正文后插入 tool trace 时会移动尾部占位，最终正文落在工具轨迹下方", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createCommentaryProgressMessage("req-commentary-tool-final", "item-1", "中间正文"));
  await bridge.deliver(createToolTraceProgressMessage("req-commentary-tool-final", "tool-bucket-1", "工具轨迹\n1. 已调用 MCP themis.query"));
  await bridge.deliver(createResultMessage("req-commentary-tool-final", "最终正文"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:中间正文",
    "create:处理中...",
    "recall:message-2",
    "create:工具轨迹\n1. 已调用 MCP themis.query",
    "create:处理中...",
    "update:message-4:最终正文",
    "create:处理中...",
    "update:message-5:已完成",
  ]);
});

test("尾部占位撤回失败时会降级收口，并仍把最终正文放到工具轨迹下方", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`, {
    recallMessage: async () => {
      throw new Error("recall failed");
    },
  });

  await bridge.prepareResponseSlot();
  await bridge.deliver(createCommentaryProgressMessage("req-commentary-tool-fallback", "item-1", "中间正文"));
  await bridge.deliver(createToolTraceProgressMessage("req-commentary-tool-fallback", "tool-bucket-1", "工具轨迹\n1. 已调用 MCP themis.query"));
  await bridge.deliver(createResultMessage("req-commentary-tool-fallback", "最终正文"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:中间正文",
    "create:处理中...",
    "recall:message-2",
    "update:message-2:继续处理中",
    "create:工具轨迹\n1. 已调用 MCP themis.query",
    "create:处理中...",
    "update:message-4:最终正文",
    "create:处理中...",
    "update:message-5:已完成",
  ]);
});

test("agent delta 快照不会直接落成飞书正文", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createDeltaProgressMessage("req-delta-1", "item-delta-1", "你好，我正在继续写"));

  assert.deepEqual(operations, ["create:处理中..."]);
});

test("最终消息与上一条 commentary 仅额度不同：只收口为已完成", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createCommentaryProgressMessage("req-2", "item-1", "同一条正文"));
  await bridge.deliver(createResultMessage("req-2", "同一条正文\n\n额度剩余：5h 87%｜1w 95%"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:同一条正文",
    "create:处理中...",
    "update:message-2:已完成",
  ]);
});

test("最终消息与上一条 commentary 不一致时：会先发最终正文，再收口为已完成", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createCommentaryProgressMessage("req-2-different", "item-1", "中间正文"));
  await bridge.deliver(createResultMessage("req-2-different", "最终正文"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:中间正文",
    "create:处理中...",
    "update:message-2:最终正文",
    "create:处理中...",
    "update:message-3:已完成",
  ]);
});

test("没有 commentary 时最终消息会直接替换当前占位", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createResultMessage("req-3", "最终条"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:最终条",
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

test("终态收口后会忽略晚到的 progress，避免重新起正文和处理中占位", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createCommentaryProgressMessage("req-late-progress-after-cancel", "item-1", "先查这台的站点承载和技术栈。"));
  await bridge.deliver(createTerminalResultMessage(
    "req-late-progress-after-cancel",
    "task.cancelled",
    "cancelled",
    "任务因超时被取消，超时时间约为 300 秒。",
  ));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:先查这台的站点承载和技术栈。",
    "create:处理中...",
    "update:message-2:任务因超时被取消，超时时间约为 300 秒。\n\n任务已取消",
  ]);

  await bridge.deliver(createCommentaryProgressMessage(
    "req-late-progress-after-cancel",
    "item-2",
    "老板，这台也查清了。",
  ));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:先查这台的站点承载和技术栈。",
    "create:处理中...",
    "update:message-2:任务因超时被取消，超时时间约为 300 秒。\n\n任务已取消",
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
  options: {
    recallMessage?: ((messageId: string) => Promise<void>) | null;
  } = {},
): FeishuTaskMessageBridge {
  const recallMessage = options.recallMessage === null
    ? null
    : async (messageId: string) => {
        operations.push(`recall:${messageId}`);
        await options.recallMessage?.(messageId);
      };

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
    ...(recallMessage ? { recallMessage } : {}),
    sendText: async (text) => {
      operations.push(`send:${text}`);
    },
    splitText: (text) => {
      const normalized = text.trim();
      return normalized ? [normalized] : [];
    },
  });
}

function createCommentaryProgressMessage(requestId: string, itemId: string, text: string) {
  return createProgressMessage(requestId, itemId, text, {
    threadEventType: "item.completed",
    itemPhase: "commentary",
  });
}

function createDeltaProgressMessage(requestId: string, itemId: string, text: string) {
  return createProgressMessage(requestId, itemId, text, {
    threadEventType: "item.delta",
  });
}

function createToolTraceProgressMessage(requestId: string, bucketId: string, text: string) {
  return {
    kind: "event" as const,
    requestId,
    title: "task.progress",
    text,
    metadata: {
      traceKind: "tool",
      traceBucketId: bucketId,
    },
  };
}

function createProgressMessage(
  requestId: string,
  itemId: string,
  text: string,
  options: {
    threadEventType: string;
    itemPhase?: string;
  },
) {
  return {
    kind: "event" as const,
    requestId,
    title: "task.progress",
    text,
    metadata: {
      itemType: "agent_message",
      threadEventType: options.threadEventType,
      itemId,
      ...(options.itemPhase ? { itemPhase: options.itemPhase } : {}),
    },
  };
}

function createResultMessage(requestId: string, text: string) {
  return createTerminalResultMessage(requestId, "task.completed", "completed", text);
}

function createTerminalResultMessage(
  requestId: string,
  title: string,
  status: "completed" | "failed" | "cancelled",
  text: string,
) {
  return {
    kind: "result" as const,
    requestId,
    title,
    text,
    metadata: {
      status,
      output: text,
    },
  };
}
