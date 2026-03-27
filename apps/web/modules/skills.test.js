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
    assert.equal(app.renderer.renderAllCallCount, 2);
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
