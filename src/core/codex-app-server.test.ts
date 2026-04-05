import assert from "node:assert/strict";
import test from "node:test";
import { CodexAppServerSession } from "./codex-app-server.js";

function createSessionStub(): { session: any; writes: string[] } {
  const writes: string[] = [];
  const session = Object.create(CodexAppServerSession.prototype) as any;

  session.pending = new Map();
  session.stderrChunks = [];
  session.notificationHandlers = new Set();
  session.serverRequestHandlers = new Set();
  session.nextId = 1;
  session.closed = false;
  session.child = {
    stdin: {
      write: (chunk: string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) => {
        writes.push(chunk);
        callback(null);
        return true;
      },
    },
  };

  return { session, writes };
}

test("onNotification 注册后能收到通知，解绑后不再收到", () => {
  const { session } = createSessionStub();
  const seen: string[] = [];

  const unsubscribe = session.onNotification((notification: { method: string }) => {
    seen.push(notification.method);
  });

  session.handleOutputLine(JSON.stringify({
    method: "thread/started",
    params: {
      threadId: "thread-1",
    },
  }));

  assert.deepEqual(seen, ["thread/started"]);

  unsubscribe();

  session.handleOutputLine(JSON.stringify({
    method: "thread/started",
    params: {
      threadId: "thread-2",
    },
  }));

  assert.deepEqual(seen, ["thread/started"]);
});

test("onServerRequest 注册后能收到 reverse request，解绑后不再收到", () => {
  const { session } = createSessionStub();
  const seen: Array<{ id: string | number; method: string }> = [];

  const unsubscribe = session.onServerRequest((request: { id: string | number; method: string }) => {
    seen.push({
      id: request.id,
      method: request.method,
    });
  });

  session.handleOutputLine(JSON.stringify({
    id: "server-1",
    method: "item/tool/requestUserInput",
    params: {
      prompt: "continue?",
    },
  }));

  assert.deepEqual(seen, [{
    id: "server-1",
    method: "item/tool/requestUserInput",
  }]);

  unsubscribe();

  session.handleOutputLine(JSON.stringify({
    id: "server-2",
    method: "item/tool/requestUserInput",
    params: {
      prompt: "again?",
    },
  }));

  assert.deepEqual(seen, [{
    id: "server-1",
    method: "item/tool/requestUserInput",
  }]);
});

test("respondToServerRequest 和 rejectServerRequest 会写出 JSON-RPC 回包", async () => {
  const { session, writes } = createSessionStub();

  await session.respondToServerRequest("server-1", { accepted: true });
  await session.rejectServerRequest(7, new Error("nope"));

  assert.deepEqual(writes, [
    `{"jsonrpc":"2.0","id":"server-1","result":{"accepted":true}}\n`,
    `{"jsonrpc":"2.0","id":7,"error":{"code":-32000,"message":"nope"}}\n`,
  ]);
});

test("request 会写出带 jsonrpc 的 JSON-RPC 请求", async () => {
  const { session, writes } = createSessionStub();

  const pending = session.request("thread/list", {
    limit: 1,
  });

  assert.deepEqual(writes, [
    `{"jsonrpc":"2.0","method":"thread/list","id":1,"params":{"limit":1}}\n`,
  ]);

  session.handleOutputLine(JSON.stringify({
    id: 1,
    result: {
      threads: [],
    },
  }));

  await assert.doesNotReject(async () => await pending);
});

test("numeric id 的普通 response 会 resolve pending 且不触发通知或反向请求处理器", () => {
  const { session } = createSessionStub();
  const seenNotifications: string[] = [];
  const seenServerRequests: string[] = [];
  let resolvedValue: unknown = null;

  session.onNotification((notification: { method: string }) => {
    seenNotifications.push(notification.method);
  });
  session.onServerRequest((request: { method: string }) => {
    seenServerRequests.push(request.method);
  });
  session.pending.set(1, {
    resolve: (value: unknown) => {
      resolvedValue = value;
    },
    reject: () => {},
  });

  session.handleOutputLine(JSON.stringify({
    id: 1,
    result: {
      ok: true,
    },
  }));

  assert.deepEqual(resolvedValue, {
    ok: true,
  });
  assert.deepEqual(seenNotifications, []);
  assert.deepEqual(seenServerRequests, []);
});

test("startThread 和 startTurn 在缺少返回标识时会抛明确错误", async () => {
  const { session } = createSessionStub();
  session.request = async () => ({});

  await assert.rejects(
    session.startThread({
      cwd: process.cwd(),
    }),
    /thread\/start did not return a threadId/,
  );

  await assert.rejects(
    session.startTurn("thread-1", "hello"),
    /turn\/start did not return a turnId/,
  );

  await assert.rejects(
    session.startReview("thread-1", "please review"),
    /review\/start did not return a reviewThreadId/,
  );

  session.request = async (method: string) => method === "review/start"
    ? {
      reviewThreadId: "thread-review-1",
    }
    : {};

  await assert.rejects(
    session.startReview("thread-1", "please review"),
    /review\/start did not return a turn\.id/,
  );

  session.request = async (method: string) => method === "turn/steer"
    ? {}
    : {};

  await assert.rejects(
    session.steerTurn("thread-1", "turn-1", "focus tests"),
    /turn\/steer did not return a turnId/,
  );
});

test("resumeThread 在缺少 threadId 时会抛明确错误", async () => {
  const { session } = createSessionStub();
  session.request = async () => ({});

  await assert.rejects(
    session.resumeThread("thread-1", {
      cwd: process.cwd(),
    }),
    /thread\/resume did not return a threadId/,
  );
});

test("initialize 会声明 experimentalApi capability，允许后续线程启用扩展历史持久化", async () => {
  const { session } = createSessionStub();
  const calls: Array<{ method: string; params: unknown }> = [];

  session.request = async (method: string, params: unknown) => {
    calls.push({ method, params });
    return {};
  };

  await session.initialize();

  assert.deepEqual(calls, [
    {
      method: "initialize",
      params: {
        clientInfo: {
          name: "themis-webui",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
        },
      },
    },
  ]);
});

test("startThread 和 resumeThread 会补齐持久化扩展历史所需参数", async () => {
  const { session } = createSessionStub();
  const calls: Array<{ method: string; params: unknown }> = [];

  session.request = async (method: string, params: unknown) => {
    calls.push({
      method,
      params,
    });
    return {
      threadId: "thread-1",
    };
  };

  await session.startThread({
    cwd: "/workspace/demo",
  });
  await session.resumeThread("thread-1", {
    cwd: "/workspace/demo",
  });

  assert.deepEqual(calls, [
    {
      method: "thread/start",
      params: {
        cwd: "/workspace/demo",
        experimentalRawEvents: false,
        persistExtendedHistory: true,
      },
    },
    {
      method: "thread/resume",
      params: {
        threadId: "thread-1",
        cwd: "/workspace/demo",
        persistExtendedHistory: true,
      },
    },
  ]);
});

test("startThread 和 resumeThread 会兼容当前 app-server 返回的 thread.id 结构", async () => {
  const { session } = createSessionStub();

  session.request = async () => ({
    thread: {
      id: "thread-structured-1",
    },
  });

  await assert.deepEqual(
    await session.startThread({
      cwd: "/workspace/demo",
    }),
    {
      threadId: "thread-structured-1",
    },
  );

  await assert.deepEqual(
    await session.resumeThread("thread-source-1", {
      cwd: "/workspace/demo",
    }),
    {
      threadId: "thread-structured-1",
    },
  );
});

test("forkThread 和 readThread 会规范化 thread 响应", async () => {
  const { session } = createSessionStub();
  session.request = async (method: string) => {
    if (method === "thread/fork") {
      return {
        thread: {
          id: "thread-forked-1",
        },
      };
    }

    if (method === "thread/read") {
      return {
        thread: {
          id: "thread-read-1",
          preview: "preview text",
          status: "idle",
          cwd: "/workspace/demo",
          createdAt: 1743249600,
          updatedAt: 1743251400,
          turns: [
            {
              id: "turn-1",
              status: "completed",
              preview: "done",
              createdAt: 1743249660,
              updatedAt: 1743249720,
            },
          ],
        },
      };
    }

    throw new Error(`unexpected method: ${method}`);
  };

  const forked = await session.forkThread("thread-source-1");
  const snapshot = await session.readThread("thread-read-1", {
    includeTurns: true,
  });

  assert.deepEqual(forked, {
    threadId: "thread-forked-1",
  });
  assert.deepEqual(snapshot, {
    threadId: "thread-read-1",
    preview: "preview text",
    status: "idle",
    cwd: "/workspace/demo",
    createdAt: "2025-03-29T12:00:00.000Z",
    updatedAt: "2025-03-29T12:30:00.000Z",
    turnCount: 1,
    turns: [
      {
        turnId: "turn-1",
        status: "completed",
        summary: "done",
        createdAt: "2025-03-29T12:01:00.000Z",
        updatedAt: "2025-03-29T12:02:00.000Z",
      },
    ],
  });
});

test("startTurn 会按当前 app-server 协议发送 input，并兼容 turn.id 响应", async () => {
  const { session } = createSessionStub();
  const calls: Array<{ method: string; params: unknown }> = [];

  session.request = async (method: string, params: unknown) => {
    calls.push({ method, params });

    if (method === "turn/start") {
      return {
        turn: {
          id: "turn-start-1",
        },
      };
    }

    throw new Error(`unexpected method: ${method}`);
  };

  const started = await session.startTurn("thread-1", "hello");

  assert.deepEqual(started, {
    turnId: "turn-start-1",
  });
  assert.deepEqual(calls, [
    {
      method: "turn/start",
      params: {
        threadId: "thread-1",
        input: [
          {
            type: "text",
            text: "hello",
            text_elements: [],
          },
        ],
      },
    },
  ]);
});

test("startTurn 会把本地图片输入规范化成 localImage", async () => {
  const { session } = createSessionStub();
  const calls: Array<{ method: string; params: unknown }> = [];

  session.request = async (method: string, params: unknown) => {
    calls.push({ method, params });

    if (method === "turn/start") {
      return {
        turnId: "turn-local-image-1",
      };
    }

    throw new Error(`unexpected method: ${method}`);
  };

  const started = await session.startTurn("thread-1", [
    {
      type: "text",
      text: "看看这张图",
      text_elements: [],
    },
    {
      type: "localImage",
      path: "/workspace/temp/input-assets/shot.png",
    },
  ]);

  assert.deepEqual(started, {
    turnId: "turn-local-image-1",
  });
  assert.deepEqual(calls, [
    {
      method: "turn/start",
      params: {
        threadId: "thread-1",
        input: [
          {
            type: "text",
            text: "看看这张图",
            text_elements: [],
          },
          {
            type: "localImage",
            path: "/workspace/temp/input-assets/shot.png",
          },
        ],
      },
    },
  ]);
});

test("startReview 和 steerTurn 会按 app-server 协议发送最小参数", async () => {
  const { session } = createSessionStub();
  const calls: Array<{ method: string; params: unknown }> = [];

  session.request = async (method: string, params: unknown) => {
    calls.push({ method, params });

    if (method === "review/start") {
      return {
        reviewThreadId: "thread-review-1",
        turn: {
          id: "turn-review-1",
        },
      };
    }

    if (method === "turn/steer") {
      return {
        turnId: "turn-running-1",
      };
    }

    throw new Error(`unexpected method: ${method}`);
  };

  const review = await session.startReview("thread-1", "please review current diff");
  const steer = await session.steerTurn("thread-1", "turn-running-1", "focus on tests only");

  assert.deepEqual(review, {
    reviewThreadId: "thread-review-1",
    turnId: "turn-review-1",
  });
  assert.deepEqual(steer, {
    turnId: "turn-running-1",
  });
  assert.deepEqual(calls, [
    {
      method: "review/start",
      params: {
        threadId: "thread-1",
        target: {
          type: "custom",
          instructions: "please review current diff",
        },
      },
    },
    {
      method: "turn/steer",
      params: {
        threadId: "thread-1",
        expectedTurnId: "turn-running-1",
        input: [
          {
            type: "text",
            text: "focus on tests only",
            text_elements: [],
          },
        ],
      },
    },
  ]);
});
