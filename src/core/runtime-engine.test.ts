import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidTaskRuntimeSelectionError,
  parseRuntimeEngine,
  resolvePublicTaskRuntime,
  resolveRequestedTaskRuntime,
  resolveTaskRuntime,
  resolveRuntimeEngine,
} from "./runtime-engine.js";

test("parseRuntimeEngine 仅接受 app-server", () => {
  assert.equal(parseRuntimeEngine("app-server"), "app-server");
  assert.equal(parseRuntimeEngine("sdk"), null);
  assert.equal(parseRuntimeEngine(""), null);
  assert.equal(parseRuntimeEngine("bad-value"), null);
  assert.equal(parseRuntimeEngine(undefined), null);
  assert.equal(parseRuntimeEngine(null), null);
});

test("resolveRuntimeEngine 默认和回退都收敛到 app-server", () => {
  assert.equal(resolveRuntimeEngine(undefined), "app-server");
  assert.equal(resolveRuntimeEngine(undefined, "app-server"), "app-server");
  assert.equal(resolveRuntimeEngine("bad-value", "app-server"), "app-server");
});

test("resolveTaskRuntime 会命中已注册 runtime", () => {
  const defaultRuntime = createRuntime("default");
  const requestedRuntime = createRuntime("requested");

  assert.equal(
    resolveTaskRuntime(
      {
        defaultRuntime,
        runtimes: {
          "app-server": requestedRuntime,
        },
      },
      "app-server",
    ),
    requestedRuntime,
  );
});

test("resolveTaskRuntime 会在未注册时回退 defaultRuntime", () => {
  const defaultRuntime = createRuntime("default");

  assert.equal(
    resolveTaskRuntime(
      {
        defaultRuntime,
      },
      "app-server",
    ),
    defaultRuntime,
  );
});

test("resolveRequestedTaskRuntime 在未显式请求时返回 defaultRuntime", () => {
  const defaultRuntime = createRuntime("default");

  assert.equal(
    resolveRequestedTaskRuntime(
      {
        defaultRuntime,
      },
      undefined,
    ),
    defaultRuntime,
  );
});

test("resolveRequestedTaskRuntime 在显式请求 null 时抛 InvalidTaskRuntimeSelectionError", () => {
  const defaultRuntime = createRuntime("default");

  assert.throws(
    () => resolveRequestedTaskRuntime(
      {
        defaultRuntime,
      },
      null,
    ),
    (error) => {
      assert.ok(error instanceof InvalidTaskRuntimeSelectionError);
      assert.match(error.message, /Invalid runtimeEngine: null/);
      return true;
    },
  );
});

test("resolveRequestedTaskRuntime 在显式请求未启用 runtime 时抛 InvalidTaskRuntimeSelectionError", () => {
  const defaultRuntime = createRuntime("default");

  assert.throws(
    () => resolveRequestedTaskRuntime(
      {
        defaultRuntime,
      },
      "app-server",
    ),
    (error) => {
      assert.ok(error instanceof InvalidTaskRuntimeSelectionError);
      assert.match(error.message, /Requested runtimeEngine is not enabled: app-server/);
      return true;
    },
  );
});

test("resolveRequestedTaskRuntime 在显式请求非法 runtime 时抛 InvalidTaskRuntimeSelectionError", () => {
  const defaultRuntime = createRuntime("default");

  assert.throws(
    () => resolveRequestedTaskRuntime(
      {
        defaultRuntime,
      },
      "bad-runtime",
    ),
    (error) => {
      assert.ok(error instanceof InvalidTaskRuntimeSelectionError);
      assert.match(error.message, /Invalid runtimeEngine: bad-runtime/);
      return true;
    },
  );
});

test("resolvePublicTaskRuntime 在未显式请求时返回 defaultRuntime", () => {
  const defaultRuntime = createRuntime("default");

  assert.equal(
    resolvePublicTaskRuntime(
      {
        defaultRuntime,
        runtimes: {
          "app-server": createRuntime("app-server"),
        },
      },
      undefined,
    ),
    defaultRuntime,
  );
});

test("resolvePublicTaskRuntime 在显式请求 app-server 时返回已注册 runtime", () => {
  const defaultRuntime = createRuntime("default");
  const appServerRuntime = createRuntime("app-server");

  assert.equal(
    resolvePublicTaskRuntime(
      {
        defaultRuntime,
        runtimes: {
          "app-server": appServerRuntime,
        },
      },
      "app-server",
    ),
    appServerRuntime,
  );
});

test("resolvePublicTaskRuntime 在显式请求 sdk 时抛 InvalidTaskRuntimeSelectionError", () => {
  const defaultRuntime = createRuntime("default");

  assert.throws(
    () => resolvePublicTaskRuntime(
      {
        defaultRuntime,
        runtimes: {
          "app-server": createRuntime("app-server"),
        },
      },
      "sdk",
    ),
    (error) => {
      assert.ok(error instanceof InvalidTaskRuntimeSelectionError);
      assert.match(error.message, /Invalid runtimeEngine: sdk/);
      return true;
    },
  );
});

test("resolvePublicTaskRuntime 在显式请求未注册的 app-server 时抛 InvalidTaskRuntimeSelectionError", () => {
  const defaultRuntime = createRuntime("default");

  assert.throws(
    () => resolvePublicTaskRuntime(
      {
        defaultRuntime,
      },
      "app-server",
    ),
    (error) => {
      assert.ok(error instanceof InvalidTaskRuntimeSelectionError);
      assert.match(error.message, /Requested runtimeEngine is not enabled: app-server/);
      return true;
    },
  );
});

function createRuntime(label: string) {
  return {
    runTask: async () => ({
      taskId: label,
      requestId: label,
      status: "completed" as const,
      summary: label,
      completedAt: new Date().toISOString(),
    }),
    getRuntimeStore: () => label,
    getIdentityLinkService: () => label,
    getPrincipalSkillsService: () => label,
  };
}
