import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultSkillsState, createSkillsController } from "./skills.js";

test("normalizeSkillsList 会把后端返回映射成前端状态", () => {
  const state = createDefaultSkillsState();
  const controller = createSkillsController(createAppStub(state));

  const result = controller.normalizeSkillsList({
    skills: [
      {
        skillName: "demo-skill",
        description: "demo",
        sourceType: "local-path",
        installStatus: "ready",
        lastError: "sync failed",
        summary: {
          totalAccounts: 2,
          syncedCount: 1,
        },
        materializations: [
          {
            targetId: "acct-1",
            state: "synced",
            lastSyncedAt: "2026-03-27T10:00:00.000Z",
          },
        ],
      },
    ],
  });

  assert.equal(result.skills[0].skillName, "demo-skill");
  assert.equal(result.skills[0].installStatus, "ready");
  assert.equal(result.skills[0].lastError, "sync failed");
  assert.equal(result.skills[0].summary.totalAccounts, 2);
  assert.equal(result.skills[0].materializations[0].targetId, "acct-1");
});

test("load 会读取列表并回写到运行时状态", async () => {
  const state = createDefaultSkillsState();
  const app = createAppStub(state);
  const controller = createSkillsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      return new Response(JSON.stringify({
        skills: [
          {
            skillName: "demo-skill",
            description: "demo",
            sourceType: "local-path",
            installStatus: "ready",
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await controller.load();

    assert.equal(result.skills.length, 1);
    assert.equal(app.runtime.skills.status, "ready");
    assert.equal(app.runtime.skills.skills[0].skillName, "demo-skill");
    assert.equal(calls[0].url, "/api/skills/list");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body.channel, "web");
    assert.equal(calls[0].body.channelUserId, "browser-123");
    assert.equal(calls[0].body.displayName, "Themis Web er-123");
    assert.equal(app.renderer.renderAllCallCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("load 在新请求已完成后会忽略旧请求响应", async () => {
  const state = createDefaultSkillsState();
  const app = createAppStub(state);
  const controller = createSkillsController(app);
  const originalFetch = globalThis.fetch;
  const pending = [];

  try {
    globalThis.fetch = (url) => {
      const deferred = createDeferred();
      pending.push({
        url,
        ...deferred,
      });
      return deferred.promise;
    };

    const firstLoadPromise = controller.load();

    assert.equal(app.runtime.skills.loading, true);

    const secondLoadPromise = controller.load();

    pending[1].resolve(jsonResponse({
      skills: [
        {
          skillName: "fresh-skill",
          description: "fresh",
          sourceType: "local-path",
          installStatus: "ready",
        },
      ],
    }));

    await secondLoadPromise;

    pending[0].resolve(jsonResponse({
      skills: [
        {
          skillName: "stale-skill",
          description: "stale",
          sourceType: "local-path",
          installStatus: "ready",
        },
      ],
    }));

    await firstLoadPromise;

    assert.equal(app.runtime.skills.loading, false);
    assert.equal(app.runtime.skills.skills[0].skillName, "fresh-skill");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refresh 在新 refresh 已开始后会忽略旧 curated 成功响应", async () => {
  const state = createDefaultSkillsState();
  const app = createAppStub(state);
  const controller = createSkillsController(app);
  const originalFetch = globalThis.fetch;
  const pending = [];

  try {
    globalThis.fetch = (url) => {
      const deferred = createDeferred();
      pending.push({
        url,
        ...deferred,
      });
      return deferred.promise;
    };

    const refresh1Promise = controller.refresh();

    assert.equal(app.runtime.skills.loading, true);
    assert.equal(pending[0].url, "/api/skills/list");

    pending[0].resolve(jsonResponse({
      skills: [
        {
          skillName: "stale-skill",
          description: "stale",
          sourceType: "local-path",
          installStatus: "ready",
        },
      ],
    }));
    await waitForPendingRequest(pending, 1, "/api/skills/catalog/curated");

    assert.equal(pending[1].url, "/api/skills/catalog/curated");

    const refresh2Promise = controller.refresh();

    assert.equal(app.runtime.skills.loading, true);
    await waitForPendingRequest(pending, 2, "/api/skills/list");
    assert.equal(pending[2].url, "/api/skills/list");

    pending[1].resolve(jsonResponse({
      curated: [
        {
          name: "stale-curated",
          installed: true,
        },
      ],
    }));
    await flushMicrotasks();

    assert.equal(app.runtime.skills.loading, true);
    assert.deepEqual(app.runtime.skills.curated, []);
    assert.equal(app.runtime.skills.errorMessage, "");

    pending[2].resolve(jsonResponse({
      skills: [
        {
          skillName: "fresh-skill",
          description: "fresh",
          sourceType: "local-path",
          installStatus: "ready",
        },
      ],
    }));
    await waitForPendingRequest(pending, 3, "/api/skills/catalog/curated");

    assert.equal(pending[3].url, "/api/skills/catalog/curated");

    pending[3].resolve(jsonResponse({
      curated: [
        {
          name: "fresh-curated",
          installed: true,
        },
      ],
    }));

    await Promise.all([refresh1Promise, refresh2Promise]);

    assert.equal(app.runtime.skills.loading, false);
    assert.equal(app.runtime.skills.skills[0].skillName, "fresh-skill");
    assert.equal(app.runtime.skills.curated[0].name, "fresh-curated");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refresh 在新 refresh 已开始后会忽略旧 curated 失败，不改 loading 或错误态", async () => {
  const state = createDefaultSkillsState();
  state.curated = [
    {
      name: "persisted-curated",
      installed: false,
    },
  ];
  const app = createAppStub(state);
  const controller = createSkillsController(app);
  const originalFetch = globalThis.fetch;
  const pending = [];

  try {
    globalThis.fetch = (url) => {
      const deferred = createDeferred();
      pending.push({
        url,
        ...deferred,
      });
      return deferred.promise;
    };

    const refresh1Promise = controller.refresh().then(
      () => ({ status: "fulfilled" }),
      (error) => ({ status: "rejected", error }),
    );

    await waitForPendingRequest(pending, 0, "/api/skills/list");
    pending[0].resolve(jsonResponse({
      skills: [
        {
          skillName: "stale-skill",
          description: "stale",
          sourceType: "local-path",
          installStatus: "ready",
        },
      ],
    }));
    await waitForPendingRequest(pending, 1, "/api/skills/catalog/curated");

    const refresh2Promise = controller.refresh();

    assert.equal(app.runtime.skills.loading, true);
    await waitForPendingRequest(pending, 2, "/api/skills/list");
    assert.equal(pending[1].url, "/api/skills/catalog/curated");
    assert.equal(pending[2].url, "/api/skills/list");

    pending[1].resolve(jsonResponse({
      error: {
        message: "旧 curated 失败",
      },
    }, 500));
    await flushMicrotasks();

    assert.equal(app.runtime.skills.loading, true);
    assert.equal(app.runtime.skills.errorMessage, "");
    assert.deepEqual(app.runtime.skills.curated, [
      {
        name: "persisted-curated",
        installed: false,
      },
    ]);

    pending[2].resolve(jsonResponse({
      skills: [
        {
          skillName: "fresh-skill",
          description: "fresh",
          sourceType: "local-path",
          installStatus: "ready",
        },
      ],
    }));
    await waitForPendingRequest(pending, 3, "/api/skills/catalog/curated");

    pending[3].resolve(jsonResponse({
      curated: [
        {
          name: "fresh-curated",
          installed: true,
        },
      ],
    }));

    await Promise.all([refresh1Promise, refresh2Promise]);

    assert.equal(app.runtime.skills.loading, false);
    assert.equal(app.runtime.skills.errorMessage, "");
    assert.equal(app.runtime.skills.curated[0].name, "fresh-curated");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("installFromLocalPath 成功后会刷新 skills 和 curated 状态", async () => {
  const state = createDefaultSkillsState();
  const app = createAppStub(state);
  const controller = createSkillsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(init.body) : null,
      });

      if (url === "/api/skills/install") {
        return jsonResponse({
          result: {
            skill: {
              skillName: "demo-skill",
            },
          },
        });
      }

      if (url === "/api/skills/list") {
        return jsonResponse({
          skills: [
            {
              skillName: "demo-skill",
              description: "demo",
              sourceType: "local-path",
              installStatus: "ready",
            },
          ],
        });
      }

      if (url === "/api/skills/catalog/curated") {
        return jsonResponse({
          curated: [
            {
              name: "demo-skill",
              installed: true,
            },
          ],
        });
      }

      throw new Error(`unexpected fetch ${url}`);
    };

    const result = await controller.installFromLocalPath("/srv/skills/demo", true);

    assert.equal(result.skill.skillName, "demo-skill");
    assert.equal(app.runtime.skills.installing, false);
    assert.equal(app.runtime.skills.skills[0].skillName, "demo-skill");
    assert.equal(app.runtime.skills.curated[0].installed, true);
    assert.equal(calls[0].url, "/api/skills/install");
    assert.equal(calls[0].body.source.absolutePath, "/srv/skills/demo");
    assert.equal(calls[0].body.replace, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mutation 后的 quiet refresh 被新 refresh 覆盖时，旧 curated 失败不会写 notice 或清 loading", async () => {
  const state = createDefaultSkillsState();
  const app = createAppStub(state);
  const controller = createSkillsController(app);
  const originalFetch = globalThis.fetch;
  const pending = [];

  try {
    globalThis.fetch = (url) => {
      if (url === "/api/skills/install") {
        return Promise.resolve(jsonResponse({
          result: {
            skill: {
              skillName: "demo-skill",
            },
          },
        }));
      }

      const deferred = createDeferred();
      pending.push({
        url,
        ...deferred,
      });
      return deferred.promise;
    };

    const installPromise = controller.installFromLocalPath("/srv/skills/demo");
    await waitForPendingRequest(pending, 0, "/api/skills/list");

    assert.equal(pending[0].url, "/api/skills/list");

    pending[0].resolve(jsonResponse({
      skills: [
        {
          skillName: "stale-skill",
          description: "stale",
          sourceType: "local-path",
          installStatus: "ready",
        },
      ],
    }));
    await waitForPendingRequest(pending, 1, "/api/skills/catalog/curated");

    assert.equal(pending[1].url, "/api/skills/catalog/curated");

    const refreshPromise = controller.refresh();

    assert.equal(app.runtime.skills.loading, true);
    await waitForPendingRequest(pending, 2, "/api/skills/list");
    assert.equal(pending[2].url, "/api/skills/list");

    pending[1].resolve(jsonResponse({
      error: {
        message: "quiet curated failed",
      },
    }, 500));
    await flushMicrotasks();

    assert.equal(app.runtime.skills.loading, true);
    assert.equal(app.runtime.skills.noticeMessage, "");
    assert.equal(app.runtime.skills.errorMessage, "");

    pending[2].resolve(jsonResponse({
      skills: [
        {
          skillName: "fresh-skill",
          description: "fresh",
          sourceType: "local-path",
          installStatus: "ready",
        },
      ],
    }));
    await waitForPendingRequest(pending, 3, "/api/skills/catalog/curated");

    pending[3].resolve(jsonResponse({
      curated: [
        {
          name: "fresh-curated",
          installed: true,
        },
      ],
    }));

    const [installResult] = await Promise.all([installPromise, refreshPromise]);

    assert.equal(installResult.skill.skillName, "demo-skill");
    assert.equal(app.runtime.skills.loading, false);
    assert.equal(app.runtime.skills.noticeMessage, "");
    assert.equal(app.runtime.skills.errorMessage, "");
    assert.equal(app.runtime.skills.curated[0].name, "fresh-curated");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("installFromGitHubUrl 和 installFromGitHubRepoPath 会发送对应 source payload", async () => {
  const state = createDefaultSkillsState();
  const app = createAppStub(state);
  const controller = createSkillsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(init.body) : null,
      });

      if (url === "/api/skills/install") {
        return jsonResponse({
          result: {
            skill: {
              skillName: "demo-skill",
            },
          },
        });
      }

      if (url === "/api/skills/list") {
        return jsonResponse({ skills: [] });
      }

      if (url === "/api/skills/catalog/curated") {
        return jsonResponse({ curated: [] });
      }

      throw new Error(`unexpected fetch ${url}`);
    };

    await controller.installFromGitHubUrl("https://github.com/openai/example-skill", "main");
    await controller.installFromGitHubRepoPath("openai/example-skills", "skills/demo", "v1");

    assert.equal(calls[0].url, "/api/skills/install");
    assert.deepEqual(calls[0].body.source, {
      type: "github-url",
      url: "https://github.com/openai/example-skill",
      ref: "main",
    });
    assert.equal(calls[3].url, "/api/skills/install");
    assert.deepEqual(calls[3].body.source, {
      type: "github-repo-path",
      repo: "openai/example-skills",
      path: "skills/demo",
      ref: "v1",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mutation 成功但 refresh 失败时不应把 mutation 当失败，且 busy 会恢复", async () => {
  const state = createDefaultSkillsState();
  const app = createAppStub(state);
  const controller = createSkillsController(app);
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url, init = {}) => {
      if (url === "/api/skills/install") {
        return jsonResponse({
          result: {
            skill: {
              skillName: "demo-skill",
            },
          },
        });
      }

      if (url === "/api/skills/list") {
        return jsonResponse({
          error: {
            message: "列表刷新失败",
          },
        }, 500);
      }

      throw new Error(`unexpected fetch ${url} ${init.method ?? "GET"}`);
    };

    const result = await controller.installFromLocalPath("/srv/skills/demo");

    assert.equal(result.skill.skillName, "demo-skill");
    assert.equal(app.runtime.skills.installing, false);
    assert.equal(app.runtime.skills.loading, false);
    assert.equal(app.runtime.skills.errorMessage, "");
    assert.equal(app.runtime.skills.noticeMessage, "操作已成功，但刷新最新列表失败，请手动刷新。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("removeSkill 和 syncSkill 会把 skillName 发给后端", async () => {
  const state = createDefaultSkillsState();
  const app = createAppStub(state);
  const controller = createSkillsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        body: init.body ? JSON.parse(init.body) : null,
      });

      if (url === "/api/skills/remove" || url === "/api/skills/sync") {
        return jsonResponse({
          result: {
            skill: {
              skillName: "demo-skill",
            },
          },
        });
      }

      if (url === "/api/skills/list") {
        return jsonResponse({ skills: [] });
      }

      if (url === "/api/skills/catalog/curated") {
        return jsonResponse({ curated: [] });
      }

      throw new Error(`unexpected fetch ${url}`);
    };

    await controller.removeSkill("demo-skill");
    await controller.syncSkill("demo-skill", true);

    assert.equal(calls[0].url, "/api/skills/remove");
    assert.equal(calls[0].body.skillName, "demo-skill");
    assert.equal(calls[1].url, "/api/skills/list");
    assert.equal(calls[3].url, "/api/skills/sync");
    assert.equal(calls[3].body.skillName, "demo-skill");
    assert.equal(calls[3].body.force, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loadCuratedCatalog 会读取 curated 列表并保留 installed 标记", async () => {
  const state = createDefaultSkillsState();
  const app = createAppStub(state);
  const controller = createSkillsController(app);
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => jsonResponse({
      curated: [
        {
          name: "debugger",
          installed: false,
        },
        {
          name: "python-setup",
          installed: true,
        },
      ],
    });

    const result = await controller.loadCuratedCatalog();

    assert.deepEqual(result.curated, [
      {
        name: "debugger",
        installed: false,
      },
      {
        name: "python-setup",
        installed: true,
      },
    ]);
    assert.equal(app.runtime.skills.curated[1].installed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createAppStub(skillsState) {
  return {
    runtime: {
      skills: skillsState,
      identity: {
        browserUserId: "browser-123",
      },
      auth: {
        account: null,
      },
    },
    utils: {
      safeReadJson: async (response) => response.json(),
    },
    renderer: {
      renderAllCallCount: 0,
      renderAll() {
        this.renderAllCallCount += 1;
      },
    },
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

async function flushMicrotasks() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await Promise.resolve();
  }
}

async function waitForPendingRequest(pending, index, url) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (pending[index]?.url === url) {
      return;
    }

    await flushMicrotasks();
  }

  assert.fail(`expected pending[${index}] to be ${url}, got ${pending[index]?.url ?? "missing"}`);
}
