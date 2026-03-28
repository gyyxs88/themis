import assert from "node:assert/strict";
import test from "node:test";
import { safeReadJson } from "./utils.js";

test("safeReadJson 遇到 401 时会跳到 /login，但仍继续解析 JSON", async () => {
  const originalWindow = globalThis.window;
  const assignCalls = [];

  try {
    globalThis.window = {
      location: {
        pathname: "/chat",
        assign(url) {
          assignCalls.push(url);
        },
      },
    };

    const response = new Response(JSON.stringify({ ok: true }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });

    const result = await safeReadJson(response);

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(assignCalls, ["/login"]);
  } finally {
    globalThis.window = originalWindow;
  }
});
