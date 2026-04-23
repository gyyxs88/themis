import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultOperationsCommitmentsState,
  createOperationsCommitmentsController,
} from "./operations-commitments.js";

test("load 会读取承诺目标并回写状态", async () => {
  const state = createDefaultOperationsCommitmentsState();
  const app = createAppStub(state);
  const controller = createOperationsCommitmentsController(app);
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
        commitments: [{
          commitmentId: "commitment-ledger-1",
          principalId: "principal-1",
          title: "Q2 发布主线必须收口",
          status: "active",
          ownerPrincipalId: "principal-owner",
          startsAt: "2026-04-01T00:00:00.000Z",
          dueAt: "2026-06-30T23:59:00.000Z",
          progressPercent: 42,
          summary: "把运营中枢推进到可用控制面",
          milestones: [{
            title: "内测验收",
            status: "active",
            dueAt: "2026-05-15T23:59:00.000Z",
            evidenceRefs: [],
          }],
          evidenceRefs: [{ kind: "work_item", value: "work-item-evidence-1", label: "验收任务" }],
          relatedAssetIds: ["asset-ledger-1"],
          linkedDecisionIds: ["decision-ledger-1"],
          linkedRiskIds: ["risk-ledger-1"],
          relatedCadenceIds: ["cadence-ledger-1"],
          relatedWorkItemIds: ["work-item-1"],
          createdAt: "2026-04-23T18:00:00.000Z",
          updatedAt: "2026-04-23T18:05:00.000Z",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await controller.load();

    assert.equal(calls[0].url, "/api/operations/commitments/list");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body.channel, "web");
    assert.equal(calls[0].body.channelUserId, "browser-123");
    assert.equal(calls[0].body.status, "active");
    assert.equal(result.commitments.length, 1);
    assert.equal(app.runtime.operationsCommitments.status, "ready");
    assert.equal(app.runtime.operationsCommitments.commitments[0].commitmentId, "commitment-ledger-1");
    assert.equal(app.runtime.operationsCommitments.commitments[0].progressPercent, 42);
    assert.equal(app.runtime.operationsCommitments.commitments[0].milestones[0].title, "内测验收");
    assert.equal(app.renderer.renderAllCallCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("save 在新建后会刷新列表，并把筛选切到新承诺状态", async () => {
  const state = createDefaultOperationsCommitmentsState();
  state.filterStatus = "active";
  state.draft = {
    title: "Q2 发布主线进入风险跟踪",
    status: "at_risk",
    progressPercentText: "64",
    ownerPrincipalId: "principal-owner",
    startsAt: "2026-04-01T00:00:00.000Z",
    dueAt: "2026-07-15T23:59:00.000Z",
    relatedAssetIdsText: "asset-ledger-1\nasset-ledger-2",
    linkedDecisionIdsText: "decision-ledger-1",
    linkedRiskIdsText: "risk-ledger-1",
    relatedCadenceIdsText: "cadence-ledger-1",
    relatedWorkItemIdsText: "work-item-1\nwork-item-2",
    milestonesText: "active | 内测验收 | 2026-05-15T23:59:00.000Z | | 正在补回归",
    evidenceRefsText: "work_item | work-item-evidence-1 | 验收任务",
    summary: "当前最大风险是发布窗口被事故阻塞",
  };
  const app = createAppStub(state);
  const controller = createOperationsCommitmentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/operations/commitments/create") {
        return new Response(JSON.stringify({
          commitment: {
            commitmentId: "commitment-ledger-2",
            principalId: "principal-1",
            title: "Q2 发布主线进入风险跟踪",
            status: "at_risk",
            ownerPrincipalId: "principal-owner",
            startsAt: "2026-04-01T00:00:00.000Z",
            dueAt: "2026-07-15T23:59:00.000Z",
            progressPercent: 64,
            milestones: [{
              title: "内测验收",
              status: "active",
              dueAt: "2026-05-15T23:59:00.000Z",
              summary: "正在补回归",
              evidenceRefs: [],
            }],
            evidenceRefs: [{ kind: "work_item", value: "work-item-evidence-1", label: "验收任务" }],
            relatedAssetIds: ["asset-ledger-1", "asset-ledger-2"],
            linkedDecisionIds: ["decision-ledger-1"],
            linkedRiskIds: ["risk-ledger-1"],
            relatedCadenceIds: ["cadence-ledger-1"],
            relatedWorkItemIds: ["work-item-1", "work-item-2"],
            summary: "当前最大风险是发布窗口被事故阻塞",
            createdAt: "2026-04-23T18:15:00.000Z",
            updatedAt: "2026-04-23T18:15:00.000Z",
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        commitments: [{
          commitmentId: "commitment-ledger-2",
          principalId: "principal-1",
          title: "Q2 发布主线进入风险跟踪",
          status: "at_risk",
          ownerPrincipalId: "principal-owner",
          startsAt: "2026-04-01T00:00:00.000Z",
          dueAt: "2026-07-15T23:59:00.000Z",
          progressPercent: 64,
          milestones: [{
            title: "内测验收",
            status: "active",
            dueAt: "2026-05-15T23:59:00.000Z",
            summary: "正在补回归",
            evidenceRefs: [],
          }],
          evidenceRefs: [{ kind: "work_item", value: "work-item-evidence-1", label: "验收任务" }],
          relatedAssetIds: ["asset-ledger-1", "asset-ledger-2"],
          linkedDecisionIds: ["decision-ledger-1"],
          linkedRiskIds: ["risk-ledger-1"],
          relatedCadenceIds: ["cadence-ledger-1"],
          relatedWorkItemIds: ["work-item-1", "work-item-2"],
          summary: "当前最大风险是发布窗口被事故阻塞",
          createdAt: "2026-04-23T18:15:00.000Z",
          updatedAt: "2026-04-23T18:15:00.000Z",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await controller.save();

    assert.equal(calls[0].url, "/api/operations/commitments/create");
    assert.equal(calls[0].body.commitment.status, "at_risk");
    assert.equal(calls[0].body.commitment.progressPercent, 64);
    assert.deepEqual(calls[0].body.commitment.milestones, [{
      title: "内测验收",
      status: "active",
      dueAt: "2026-05-15T23:59:00.000Z",
      summary: "正在补回归",
      evidenceRefs: [],
    }]);
    assert.deepEqual(calls[0].body.commitment.evidenceRefs, [{
      kind: "work_item",
      value: "work-item-evidence-1",
      label: "验收任务",
    }]);
    assert.deepEqual(calls[0].body.commitment.relatedAssetIds, ["asset-ledger-1", "asset-ledger-2"]);
    assert.deepEqual(calls[0].body.commitment.relatedWorkItemIds, ["work-item-1", "work-item-2"]);
    assert.equal(calls[1].url, "/api/operations/commitments/list");
    assert.equal(calls[1].body.status, "at_risk");
    assert.equal(app.runtime.operationsCommitments.noticeMessage, "已新建承诺。");
    assert.equal(app.runtime.operationsCommitments.filterStatus, "at_risk");
    assert.equal(app.runtime.operationsCommitments.selectedCommitmentId, "commitment-ledger-2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("selectCommitment 会把选中的承诺写回编辑草稿", () => {
  const state = createDefaultOperationsCommitmentsState();
  state.commitments = [{
    commitmentId: "commitment-ledger-3",
    principalId: "principal-1",
    title: "安全审计补齐",
    status: "planned",
    ownerPrincipalId: "principal-security",
    startsAt: "2026-05-01T00:00:00.000Z",
    dueAt: "2026-05-31T23:59:00.000Z",
    progressPercent: 15,
    summary: "补齐公开发布前的审计项",
    milestones: [{
      title: "审计清单确认",
      status: "planned",
      dueAt: "2026-05-10T23:59:00.000Z",
      evidenceRefs: [],
    }],
    evidenceRefs: [{ kind: "doc", value: "docs/security-audit.md", label: "审计文档" }],
    relatedAssetIds: ["asset-ledger-3"],
    linkedDecisionIds: ["decision-ledger-3"],
    linkedRiskIds: ["risk-ledger-3"],
    relatedCadenceIds: ["cadence-ledger-3"],
    relatedWorkItemIds: ["work-item-3"],
    createdAt: "2026-04-23T18:20:00.000Z",
    updatedAt: "2026-04-23T18:20:00.000Z",
  }];
  const app = createAppStub(state);
  const controller = createOperationsCommitmentsController(app);

  controller.selectCommitment("commitment-ledger-3");

  assert.equal(app.runtime.operationsCommitments.selectedCommitmentId, "commitment-ledger-3");
  assert.equal(app.runtime.operationsCommitments.draft.title, "安全审计补齐");
  assert.equal(app.runtime.operationsCommitments.draft.status, "planned");
  assert.equal(app.runtime.operationsCommitments.draft.progressPercentText, "15");
  assert.match(app.runtime.operationsCommitments.draft.milestonesText, /审计清单确认/);
  assert.match(app.runtime.operationsCommitments.draft.evidenceRefsText, /docs\/security-audit\.md/);
  assert.match(app.runtime.operationsCommitments.draft.linkedRiskIdsText, /risk-ledger-3/);
});

function createAppStub(operationsCommitmentsState) {
  return {
    runtime: {
      operationsCommitments: operationsCommitmentsState,
      identity: {
        browserUserId: "browser-123",
      },
      auth: {
        account: {
          email: "owner@example.com",
        },
      },
    },
    operationsEdges: {
      async load() {},
    },
    operationsBossView: {
      async load() {},
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
      operationsCommitmentsRefreshButton: null,
      operationsCommitmentsNewButton: null,
      operationsCommitmentsFilterSelect: null,
      operationsCommitmentsStatusSelect: null,
      operationsCommitmentsTitleInput: null,
      operationsCommitmentsProgressInput: null,
      operationsCommitmentsOwnerInput: null,
      operationsCommitmentsStartsAtInput: null,
      operationsCommitmentsDueAtInput: null,
      operationsCommitmentsRelatedAssetsInput: null,
      operationsCommitmentsLinkedDecisionsInput: null,
      operationsCommitmentsLinkedRisksInput: null,
      operationsCommitmentsRelatedCadencesInput: null,
      operationsCommitmentsRelatedWorkItemsInput: null,
      operationsCommitmentsMilestonesInput: null,
      operationsCommitmentsEvidenceRefsInput: null,
      operationsCommitmentsSummaryInput: null,
      operationsCommitmentsSaveButton: null,
      operationsCommitmentsResetButton: null,
      operationsCommitmentsList: null,
    },
  };
}
