import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultMemoryCandidatesState, createMemoryCandidatesController } from "./memory-candidates.js";

test("load 会读取长期记忆候选列表并回写状态", async () => {
  const state = createDefaultMemoryCandidatesState();
  const app = createAppStub(state);
  const controller = createMemoryCandidatesController(app);
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
        candidates: [
          {
            candidateId: "candidate-1",
            principalId: "principal-1",
            kind: "preference",
            title: "偏好候选",
            summary: "更喜欢先给结论",
            rationale: "最近多轮会话都出现同样偏好",
            suggestedContent: "默认先给结论，再展开说明。",
            sourceType: "themis",
            sourceLabel: "session / task",
            status: "suggested",
            createdAt: "2026-04-06T02:00:00.000Z",
            updatedAt: "2026-04-06T02:05:00.000Z",
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await controller.load();

    assert.equal(calls[0].url, "/api/actors/memory-candidates/list");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body.channel, "web");
    assert.equal(calls[0].body.channelUserId, "browser-123");
    assert.equal(calls[0].body.status, "suggested");
    assert.equal(result.candidates.length, 1);
    assert.equal(app.runtime.memoryCandidates.status, "ready");
    assert.equal(app.runtime.memoryCandidates.candidates[0].candidateId, "candidate-1");
    assert.equal(app.renderer.renderAllCallCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("review 在批准后会刷新列表并写入成功提示", async () => {
  const state = createDefaultMemoryCandidatesState();
  state.status = "ready";
  state.candidates = [
    {
      candidateId: "candidate-1",
      principalId: "principal-1",
      kind: "preference",
      title: "偏好候选",
      summary: "更喜欢先给结论",
      rationale: "最近多轮会话都出现同样偏好",
      suggestedContent: "默认先给结论，再展开说明。",
      sourceType: "themis",
      sourceLabel: "session / task",
      status: "suggested",
      createdAt: "2026-04-06T02:00:00.000Z",
      updatedAt: "2026-04-06T02:05:00.000Z",
    },
  ];
  const app = createAppStub(state);
  const controller = createMemoryCandidatesController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/actors/memory-candidates/review") {
        return new Response(JSON.stringify({
          candidate: {
            candidateId: "candidate-1",
            status: "approved",
            approvedMemoryId: "memory-1",
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        candidates: [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await controller.review("candidate-1", "approve");

    assert.equal(calls[0].url, "/api/actors/memory-candidates/review");
    assert.equal(calls[0].body.candidateId, "candidate-1");
    assert.equal(calls[0].body.decision, "approve");
    assert.equal(calls[1].url, "/api/actors/memory-candidates/list");
    assert.equal(app.runtime.memoryCandidates.noticeMessage, "已批准候选，并写入正式主记忆。");
    assert.equal(app.runtime.memoryCandidates.reviewingCandidateId, "");
    assert.deepEqual(app.runtime.memoryCandidates.candidates, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extractLatest 会从当前线程最近完成任务提炼候选并刷新列表", async () => {
  const state = createDefaultMemoryCandidatesState();
  state.status = "ready";
  const app = createAppStub(state, {
    activeThread: {
      turns: [
        {
          requestId: "req-old-running",
          state: "running",
          result: {
            status: "running",
            summary: "还在执行",
          },
        },
        {
          requestId: "req-latest-completed",
          state: "completed",
          result: {
            status: "completed",
            summary: "已完成",
          },
        },
      ],
    },
  });
  const controller = createMemoryCandidatesController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/actors/memory-candidates/extract") {
        return new Response(JSON.stringify({
          candidates: [
            { candidateId: "candidate-1" },
            { candidateId: "candidate-2" },
          ],
          updates: [
            { action: "suggested" },
            { action: "suggested" },
          ],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        candidates: [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await controller.extractLatest();

    assert.equal(calls[0].url, "/api/actors/memory-candidates/extract");
    assert.equal(calls[0].body.requestId, "req-latest-completed");
    assert.equal(calls[1].url, "/api/actors/memory-candidates/list");
    assert.equal(app.runtime.memoryCandidates.noticeMessage, "已从最近完成任务提炼出 2 条长期记忆候选。");
    assert.equal(app.runtime.memoryCandidates.extracting, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createAppStub(memoryCandidatesState, options = {}) {
  return {
    runtime: {
      memoryCandidates: memoryCandidatesState,
      identity: {
        browserUserId: "browser-123",
      },
      auth: {
        account: {
          email: "",
        },
      },
    },
    utils: {
      async safeReadJson(response) {
        return await response.json();
      },
    },
    renderer: {
      renderAllCallCount: 0,
      renderAll() {
        this.renderAllCallCount += 1;
      },
    },
    store: {
      getActiveThread() {
        return options.activeThread ?? null;
      },
    },
    dom: {
      memoryCandidatesRefreshButton: null,
      memoryCandidatesExtractButton: null,
      memoryCandidatesFilterSelect: null,
      memoryCandidatesIncludeArchivedInput: null,
      memoryCandidatesList: null,
      workspaceToolsPanel: null,
      workspaceToolsToggle: null,
    },
  };
}
