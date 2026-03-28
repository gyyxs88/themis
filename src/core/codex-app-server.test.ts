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
    `{"id":"server-1","result":{"accepted":true}}\n`,
    `{"id":7,"error":{"code":-32000,"message":"nope"}}\n`,
  ]);
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
