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
    "create:处理中...",
    "update:message-3:已完成",
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

test("最终消息与缓存 progress 仅额度不同：会展示终稿并明确收口为已完成", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-2", "item-1", "同一条正文"));
  await bridge.deliver(createResultMessage("req-2", "同一条正文\n\n额度剩余：5h 87%｜1w 95%"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:同一条正文\n\n额度剩余：5h 87%｜1w 95%",
    "create:处理中...",
    "update:message-2:已完成",
  ]);
});

test("最终消息在首条正文可见前到达时：当前占位会直接收口成最终消息", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-3", "item-1", "上一条"));
  await bridge.deliver(createResultMessage("req-3", "最终条"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:最终条",
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
    "update:message-1:最终完成",
    "update:message-2:已完成",
  ]);
});

test("20 秒到点时会优先截到最近句末，而不是把半句直接露出来", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`, 20);
  const progressText = "第一句已经完整。第二句还在继续展开但是现在还没有写完";

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-boundary-soft-flush", "item-1", progressText));
  await wait(25);

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:第一句已经完整。",
    "create:处理中...",
  ]);
});

test("20 秒没有句末或空行时不会半句露出，40 秒才会兜底强刷", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`, 20);
  const progressText = "这是一段还没有句号也没有空行但是确实已经生成了很多内容只是仍然没有自然收口所以二十秒时不该把半句直接发出来";

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-boundary-hard-flush", "item-1", progressText));
  await wait(25);

  assert.deepEqual(operations, [
    "create:处理中...",
  ]);

  await wait(25);

  assert.deepEqual(operations, [
    "create:处理中...",
    `update:message-1:${progressText}`,
    "create:处理中...",
  ]);
});

test("没有新增安全边界时不会重复 update 已显示的同一段正文", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`, 20);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-noop-same-visible", "item-1", "第一句已经完整。\n\n第二段还没写完"));
  await wait(25);

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:第一句已经完整。",
    "create:处理中...",
  ]);

  await bridge.deliver(createProgressMessage("req-noop-same-visible", "item-1", "第一句已经完整。\n\n第二段还没写完但是仍然没有句号"));
  await wait(25);

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:第一句已经完整。",
    "create:处理中...",
  ]);
});

test("同一条正文持续输出时，会按时间节拍更新同一条已显示消息", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`, 20);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-same-item-streaming", "item-1", "第一版"));
  await wait(50);

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:第一版",
    "create:处理中...",
  ]);

  await bridge.deliver(createProgressMessage("req-same-item-streaming", "item-1", "第二版"));
  await wait(50);

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:第一版",
    "create:处理中...",
    "update:message-1:第二版",
  ]);

  await bridge.deliver(createResultMessage("req-same-item-streaming", "第二版"));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:第一版",
    "create:处理中...",
    "update:message-1:第二版",
    "update:message-2:已完成",
  ]);
});

test("足够完整的首条正文会立即露出，并保留新的处理中占位", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);
  const longProgress = [
    "收到，老板，这段我先接住，不急着往后跳。",
    "",
    "先锁三个关键信号：",
    "",
    "- 要点一：这是翻译站，不是聚合站。",
    "- 要点二：真正的流量入口来自 Novel Updates，而不是泛流量广告。",
    "- 要点三：这条判断已经足够支撑后面继续往商业模型收。",
    "- 要点四：你们当时的策略不是拍脑袋，而是基于入口和转化路径做的选择。",
  ].join("\n");

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-eager-progress", "item-1", longProgress));

  assert.deepEqual(operations, [
    "create:处理中...",
    `update:message-1:${longProgress}`,
    "create:处理中...",
  ]);

  await bridge.deliver(createResultMessage("req-eager-progress", longProgress));

  assert.deepEqual(operations, [
    "create:处理中...",
    `update:message-1:${longProgress}`,
    "create:处理中...",
    "update:message-2:已完成",
  ]);
});

test("同一条正文的短开头不会被过早露出，等补全到结构化内容后才会显示", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);
  const shortLead = "收到，老板。这一段我先按事实收住，不下判断。\n\n关键";
  const fullProgress = [
    "收到，老板。这一段我先按事实收住，不下判断。",
    "",
    "关键节点是：",
    "",
    "- 第一个翻译站是 `novelbike.com`",
    "- 初期策略不是先挂广告，而是先做内容、把流量做起来",
    "- 广告收入最终和预期严重偏离",
    "- 原来的“免费阅读 + 展示广告”商业假设已经开始被现实打穿",
    "- 所以后面的会议其实已经不是普通复盘，而是生死决策前夜",
  ].join("\n");

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-partial-same-item", "item-1", shortLead));

  assert.deepEqual(operations, [
    "create:处理中...",
  ]);

  await bridge.deliver(createProgressMessage("req-partial-same-item", "item-1", fullProgress));

  assert.deepEqual(operations, [
    "create:处理中...",
    `update:message-1:${fullProgress}`,
    "create:处理中...",
  ]);

  await bridge.deliver(createResultMessage("req-partial-same-item", fullProgress));

  assert.deepEqual(operations, [
    "create:处理中...",
    `update:message-1:${fullProgress}`,
    "create:处理中...",
    "update:message-2:已完成",
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

test("终态收口后会忽略晚到的 progress，避免重新起正文和处理中占位", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`);
  const lateProgressText = [
    "老板，这台也查清了。",
    "",
    "结论：",
    "",
    "- `94.72.125.89` 是一台 WordPress 多站宿主机。",
    "- `noveljungle.com`、`novelville.com`、`xoxonovels.com` 都在这台机子上。",
    "- 现在公网四台里，这台的角色已经能锁定。",
  ].join("\n");

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-late-progress-after-cancel", "item-1", "先查这台的站点承载和技术栈。"));
  await bridge.deliver(createTerminalResultMessage(
    "req-late-progress-after-cancel",
    "task.cancelled",
    "cancelled",
    "任务因超时被取消，超时时间约为 300 秒。",
  ));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:任务因超时被取消，超时时间约为 300 秒。\n\n任务已取消",
  ]);

  await bridge.deliver(createProgressMessage(
    "req-late-progress-after-cancel",
    "item-2",
    lateProgressText,
  ));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:任务因超时被取消，超时时间约为 300 秒。\n\n任务已取消",
  ]);
});

test("正文消息接近编辑上限时会暂停增量更新，并把最后一次编辑留给最终成稿", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = createBridge(operations, () => `message-${nextMessageId++}`, 10, 3);

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-progress-edit-budget", "item-1", "第一句已经完整。"));
  await wait(25);

  await bridge.deliver(createProgressMessage(
    "req-progress-edit-budget",
    "item-1",
    "第一句已经完整。\n\n第二句也已经完整。",
  ));
  await wait(25);

  await bridge.deliver(createProgressMessage(
    "req-progress-edit-budget",
    "item-1",
    "第一句已经完整。\n\n第二句也已经完整。\n\n第三句会等最终完成时再一起露出。",
  ));
  await wait(25);

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:第一句已经完整。",
    "create:处理中...",
    "update:message-1:第一句已经完整。\n\n第二句也已经完整。",
  ]);

  await bridge.deliver(createResultMessage(
    "req-progress-edit-budget",
    "第一句已经完整。\n\n第二句也已经完整。\n\n第三句会等最终完成时再一起露出。",
  ));

  assert.deepEqual(operations, [
    "create:处理中...",
    "update:message-1:第一句已经完整。",
    "create:处理中...",
    "update:message-1:第一句已经完整。\n\n第二句也已经完整。",
    "update:message-1:第一句已经完整。\n\n第二句也已经完整。\n\n第三句会等最终完成时再一起露出。",
    "update:message-2:已完成",
  ]);
});

test("重叠 flush 会合并到最新可见正文，不会额外多刷一轮正文", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = new FeishuTaskMessageBridge({
    createText: async (text) => {
      operations.push(`create:${text}`);
      return {
        data: {
          message_id: `message-${nextMessageId++}`,
        },
      };
    },
    updateText: async (messageId, text) => {
      await wait(20);
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
    progressFlushTimeoutMs: 1,
    progressMaxTextUpdates: 3,
  });

  await bridge.prepareResponseSlot();
  await bridge.deliver(createProgressMessage("req-overlap-budget", "item-1", "第一句已经完整。"));
  await wait(30);

  const overlappedDeliveries = Promise.all([
    bridge.deliver(createProgressMessage(
      "req-overlap-budget",
      "item-1",
      "第一句已经完整。\n\n第二句已经完整。",
    )),
    (async () => {
      await wait(2);
      await bridge.deliver(createProgressMessage(
        "req-overlap-budget",
        "item-1",
        "第一句已经完整。\n\n第二句已经完整。\n\n第三句已经完整。",
      ));
    })(),
  ]);

  await overlappedDeliveries;
  await wait(40);

  assert.deepEqual(operations.slice(0, 3), [
    "create:处理中...",
    "update:message-1:第一句已经完整。",
    "create:处理中...",
  ]);
  assert.equal(
    operations.filter((entry) => entry.startsWith("update:message-1:")).length,
    2,
  );

  await bridge.deliver(createResultMessage(
    "req-overlap-budget",
    "第一句已经完整。\n\n第二句已经完整。\n\n第三句已经完整。",
  ));

  const bodyUpdates = operations.filter((entry) => entry.startsWith("update:message-1:"));
  assert.equal(bodyUpdates.length >= 2 && bodyUpdates.length <= 3, true);
  assert.equal(
    bodyUpdates.at(-1),
    "update:message-1:第一句已经完整。\n\n第二句已经完整。\n\n第三句已经完整。",
  );
  assert.equal(operations.at(-1), "update:message-2:已完成");
});

test("正文终稿更新撞上飞书编辑上限时，尾部占位仍会收口为已完成", async () => {
  const operations: string[] = [];
  let nextMessageId = 1;
  const bridge = new FeishuTaskMessageBridge({
    createText: async (text) => {
      operations.push(`create:${text}`);
      return {
        data: {
          message_id: `message-${nextMessageId++}`,
        },
      };
    },
    updateText: async (messageId, text) => {
      if (messageId === "message-1" && text.includes("最终终稿")) {
        operations.push(`fail-update:${messageId}:${text}`);
        const error = new Error("Request failed with status code 400") as Error & {
          response?: { data?: { code?: number; msg?: string } };
        };
        error.response = {
          data: {
            code: 230072,
            msg: "The message has reached the number of times it can be edited.",
          },
        };
        throw error;
      }

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
    progressFlushTimeoutMs: 20,
    progressMaxTextUpdates: 20,
  });

  await bridge.prepareResponseSlot();
  const visibleProgress = [
    "老板，我先把结构化正文露出来。",
    "",
    "- 第一条已经确认",
    "- 第二条已经确认",
    "- 第三条已经确认",
    "- 第四条已经确认",
    "",
    "这是一段足够长的正文，用来确保首条 progress 会先显示出来。",
  ].join("\n");
  const firstVisibleProgress = [
    "老板，我先把结构化正文露出来。",
    "",
    "- 第一条已经确认",
    "- 第二条已经确认",
    "- 第三条已经确认",
    "- 第四条已经确认",
  ].join("\n");
  await bridge.deliver(createProgressMessage("req-edit-limit-final-close", "item-1", visibleProgress));
  await wait(30);

  assert.deepEqual(operations, [
    "create:处理中...",
    `update:message-1:${firstVisibleProgress}`,
    "create:处理中...",
  ]);

  await bridge.deliver(createResultMessage("req-edit-limit-final-close", `${visibleProgress}\n\n最终终稿`));

  assert.deepEqual(operations, [
    "create:处理中...",
    `update:message-1:${firstVisibleProgress}`,
    "create:处理中...",
    `fail-update:message-1:${visibleProgress}\n\n最终终稿`,
    "update:message-2:已完成",
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
  progressMaxTextUpdates = 20,
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
    progressMaxTextUpdates,
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

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
