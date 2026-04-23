import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultOperationsCadencesState,
  createOperationsCadencesController,
} from "./operations-cadences.js";

test("load 会读取节奏记录并回写状态", async () => {
  const state = createDefaultOperationsCadencesState();
  const app = createAppStub(state);
  const controller = createOperationsCadencesController(app);
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
        cadences: [{
          cadenceId: "cadence-ledger-1",
          principalId: "principal-1",
          title: "prod-web 周检",
          frequency: "weekly",
          status: "active",
          nextRunAt: "2026-04-28T01:00:00.000Z",
          ownerPrincipalId: "principal-owner",
          playbookRef: "docs/runbooks/prod-web-weekly-check.md",
          summary: "检查 uptime、证书和备份状态",
          relatedAssetIds: ["asset-ledger-1"],
          createdAt: "2026-04-23T17:00:00.000Z",
          updatedAt: "2026-04-23T17:05:00.000Z",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await controller.load();

    assert.equal(calls[0].url, "/api/operations/cadences/list");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body.channel, "web");
    assert.equal(calls[0].body.channelUserId, "browser-123");
    assert.equal(calls[0].body.status, "active");
    assert.equal(result.cadences.length, 1);
    assert.equal(app.runtime.operationsCadences.status, "ready");
    assert.equal(app.runtime.operationsCadences.cadences[0].cadenceId, "cadence-ledger-1");
    assert.equal(app.renderer.renderAllCallCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("save 在新建后会刷新列表，并把筛选切到新节奏状态", async () => {
  const state = createDefaultOperationsCadencesState();
  state.filterStatus = "active";
  state.draft = {
    title: "账单月检",
    frequency: "monthly",
    status: "paused",
    nextRunAt: "2026-05-01T01:00:00.000Z",
    ownerPrincipalId: "principal-finance",
    playbookRef: "docs/runbooks/monthly-billing-review.md",
    relatedAssetIdsText: "asset-ledger-1\nasset-ledger-2",
    summary: "月初复盘云资源账单和续费提醒",
  };
  const app = createAppStub(state);
  const controller = createOperationsCadencesController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/operations/cadences/create") {
        return new Response(JSON.stringify({
          cadence: {
            cadenceId: "cadence-ledger-2",
            principalId: "principal-1",
            title: "账单月检",
            frequency: "monthly",
            status: "paused",
            nextRunAt: "2026-05-01T01:00:00.000Z",
            ownerPrincipalId: "principal-finance",
            playbookRef: "docs/runbooks/monthly-billing-review.md",
            relatedAssetIds: ["asset-ledger-1", "asset-ledger-2"],
            summary: "月初复盘云资源账单和续费提醒",
            createdAt: "2026-04-23T17:15:00.000Z",
            updatedAt: "2026-04-23T17:15:00.000Z",
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        cadences: [{
          cadenceId: "cadence-ledger-2",
          principalId: "principal-1",
          title: "账单月检",
          frequency: "monthly",
          status: "paused",
          nextRunAt: "2026-05-01T01:00:00.000Z",
          ownerPrincipalId: "principal-finance",
          playbookRef: "docs/runbooks/monthly-billing-review.md",
          relatedAssetIds: ["asset-ledger-1", "asset-ledger-2"],
          summary: "月初复盘云资源账单和续费提醒",
          createdAt: "2026-04-23T17:15:00.000Z",
          updatedAt: "2026-04-23T17:15:00.000Z",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await controller.save();

    assert.equal(calls[0].url, "/api/operations/cadences/create");
    assert.equal(calls[0].body.cadence.status, "paused");
    assert.equal(calls[0].body.cadence.frequency, "monthly");
    assert.deepEqual(calls[0].body.cadence.relatedAssetIds, ["asset-ledger-1", "asset-ledger-2"]);
    assert.equal(calls[1].url, "/api/operations/cadences/list");
    assert.equal(calls[1].body.status, "paused");
    assert.equal(app.runtime.operationsCadences.noticeMessage, "已新建节奏。");
    assert.equal(app.runtime.operationsCadences.filterStatus, "paused");
    assert.equal(app.runtime.operationsCadences.selectedCadenceId, "cadence-ledger-2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("selectCadence 会把选中的节奏写回编辑草稿", () => {
  const state = createDefaultOperationsCadencesState();
  state.cadences = [{
    cadenceId: "cadence-ledger-3",
    principalId: "principal-1",
    title: "备份抽查",
    frequency: "weekly",
    status: "active",
    nextRunAt: "2026-04-24T01:00:00.000Z",
    ownerPrincipalId: "principal-ops",
    playbookRef: "docs/runbooks/backup-check.md",
    summary: "检查恢复流程和最近一次备份可用性",
    relatedAssetIds: ["asset-ledger-3"],
    createdAt: "2026-04-23T17:20:00.000Z",
    updatedAt: "2026-04-23T17:20:00.000Z",
  }];
  const app = createAppStub(state);
  const controller = createOperationsCadencesController(app);

  controller.selectCadence("cadence-ledger-3");

  assert.equal(app.runtime.operationsCadences.selectedCadenceId, "cadence-ledger-3");
  assert.equal(app.runtime.operationsCadences.draft.title, "备份抽查");
  assert.equal(app.runtime.operationsCadences.draft.frequency, "weekly");
  assert.match(app.runtime.operationsCadences.draft.playbookRef, /backup-check/);
});

function createAppStub(operationsCadencesState) {
  return {
    runtime: {
      operationsCadences: operationsCadencesState,
      identity: {
        browserUserId: "browser-123",
      },
      auth: {
        account: {
          email: "owner@example.com",
        },
      },
    },
    utils: {
      autoResizeTextarea() {},
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
    dom: {
      operationsCadencesRefreshButton: null,
      operationsCadencesNewButton: null,
      operationsCadencesFilterSelect: null,
      operationsCadencesFrequencySelect: null,
      operationsCadencesStatusSelect: null,
      operationsCadencesTitleInput: null,
      operationsCadencesNextRunAtInput: null,
      operationsCadencesOwnerInput: null,
      operationsCadencesPlaybookRefInput: null,
      operationsCadencesRelatedAssetsInput: null,
      operationsCadencesSummaryInput: null,
      operationsCadencesSaveButton: null,
      operationsCadencesResetButton: null,
      operationsCadencesList: null,
    },
  };
}
