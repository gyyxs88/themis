import assert from "node:assert/strict";
import test from "node:test";
import { createRenderer } from "./ui.js";

test("renderComposer 会在 review 可用时使用 review 文案", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "review",
      review: {
        enabled: true,
        reason: "",
      },
      steer: {
        enabled: false,
        reason: "当前没有执行中的任务可调整",
      },
    },
  });

  assert.equal(typeof harness.renderer.renderComposer, "function");
  harness.renderer.renderComposer();

  assert.equal(
    harness.dom.goalInput.placeholder,
    "补充你希望重点审查的内容，例如：优先看回归风险和缺失测试",
  );
  assert.equal(harness.dom.submitButton.textContent, "提交 Review");
});

test("renderComposer 会在 steer 可用时使用 steer 文案", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "steer",
      review: {
        enabled: false,
        reason: "当前还没有可审查的已收口结果",
      },
      steer: {
        enabled: true,
        reason: "",
      },
    },
  });

  harness.renderer.renderComposer();

  assert.equal(
    harness.dom.goalInput.placeholder,
    "补充你希望当前执行如何调整，例如：先收紧范围，只处理 Web 回归",
  );
  assert.equal(harness.dom.submitButton.textContent, "发送 Steer");
});

test("renderComposer 会在持久模式不可用时回退到 chat 语义", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "review",
      review: {
        enabled: false,
        reason: "当前还没有可审查的已收口结果",
      },
      steer: {
        enabled: false,
        reason: "当前没有执行中的任务可调整",
      },
    },
  });

  harness.renderer.renderComposer();

  assert.equal(
    harness.dom.goalInput.placeholder,
    "直接输入你的目标、约束和注意事项，例如：继续把这个界面做成员工可用版本，并优先优化输入体验",
  );
  assert.equal(harness.dom.submitButton.textContent, "发送给 Themis");
  assert.ok(harness.dom.composerActionBar.innerHTML.includes('data-composer-mode-button="review"'));
  assert.ok(harness.dom.composerActionBar.innerHTML.includes('data-composer-mode-button="steer"'));
  assert.ok(!harness.dom.composerActionBar.innerHTML.includes('aria-pressed="true"'));
  assert.ok(!harness.dom.composerActionBar.innerHTML.includes('active"'));
});

test("renderComposer 会继续渲染草稿附件摘要", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    threadOverrides: {
      draftInputAssets: [
        {
          assetId: "asset-doc-1",
          kind: "document",
          name: "report.pdf",
          mimeType: "application/pdf",
          localPath: "/workspace/temp/input-assets/report.pdf",
          ingestionStatus: "ready",
          textExtraction: {
            status: "completed",
            textPreview: "第一页摘要",
          },
          metadata: {
            pageCount: 3,
          },
        },
      ],
    },
  });

  harness.renderer.renderComposer();

  assert.ok(harness.dom.composerInputAssetsList.innerHTML.includes("report.pdf"));
  assert.ok(harness.dom.composerInputAssetsList.innerHTML.includes("PDF"));
  assert.ok(harness.dom.composerInputAssetsList.innerHTML.includes("3 页"));
  assert.ok(harness.dom.composerInputAssetsList.innerHTML.includes("第一页摘要"));
});

test("renderConversation 会为 turn.inputEnvelope.assets 渲染输入附件摘要", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    threadOverrides: {
      turns: [
        {
          id: "turn-input-assets",
          goal: "请总结这些输入",
          inputText: "",
          state: "completed",
          options: {},
          inputEnvelope: {
            envelopeId: "env-1",
            sourceChannel: "web",
            sourceSessionId: "thread-composer",
            createdAt: "2026-04-02T10:00:00.000Z",
            parts: [
              {
                partId: "part-1",
                type: "text",
                role: "user",
                order: 1,
                text: "请总结这些输入",
              },
              {
                partId: "part-2",
                type: "document",
                role: "user",
                order: 2,
                assetId: "asset-doc-1",
              },
            ],
            assets: [
              {
                assetId: "asset-doc-1",
                kind: "document",
                name: "report.pdf",
                mimeType: "application/pdf",
                localPath: "/workspace/temp/input-assets/report.pdf",
                sourceChannel: "web",
                ingestionStatus: "ready",
                textExtraction: {
                  status: "completed",
                  textPreview: "第一页摘要",
                },
                metadata: {
                  pageCount: 3,
                },
              },
            ],
          },
          assistantMessages: [],
          steps: [],
          result: null,
        },
      ],
    },
  });

  assert.equal(typeof harness.renderer.renderConversation, "function");
  harness.renderer.renderConversation(false);

  assert.ok(harness.dom.conversation.innerHTML.includes("本次输入附件"));
  assert.ok(harness.dom.conversation.innerHTML.includes("report.pdf"));
  assert.ok(harness.dom.conversation.innerHTML.includes("PDF"));
  assert.ok(harness.dom.conversation.innerHTML.includes("3 页"));
  assert.ok(harness.dom.conversation.innerHTML.includes("第一页摘要"));
});

test("renderThreadControlPanel 会渲染主视图 conversationId、折叠详情，并且不回填接入输入框", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: {
        enabled: false,
        reason: "",
      },
      steer: {
        enabled: false,
        reason: "",
      },
    },
    threadControlState: {
      status: { kind: "waiting", label: "等待处理中的 action" },
      source: { kind: "attached", label: "已接入" },
      conversationId: "conversation-123",
      joinHint: "把飞书 /current 或其他渠道拿到的 conversationId 粘贴到这里，就能切到同一条统一会话。",
      details: [
        { label: "conversationId", value: "conversation-123" },
        { label: "serverThreadId", value: "server-thread-456" },
        { label: "来源", value: "已接入" },
      ],
    },
    runtime: {
      threadControlJoinOpen: true,
    },
  });

  assert.equal(typeof harness.renderer.renderThreadControlPanel, "function");
  harness.dom.conversationLinkInput.value = "user-pasted-id";
  harness.renderer.renderThreadControlPanel();

  assert.equal(harness.dom.threadControlStatus.textContent, "等待处理中的 action");
  assert.equal(harness.dom.threadControlConversationId.textContent, "conversation-123");
  assert.ok(harness.dom.threadControlSource.innerHTML.includes("已接入"));
  assert.equal(harness.dom.threadControlDetails.open, false);
  assert.equal(harness.dom.threadControlDetails.innerHTML, "static-shell");
  assert.ok(harness.dom.threadControlDetailsBody.innerHTML.includes("conversation-123"));
  assert.equal(harness.dom.threadControlPanel.hidden, false);
  assert.equal(harness.dom.threadControlJoinPanel.hidden, false);
  assert.equal(harness.dom.threadControlJoinToggle.getAttribute("aria-expanded"), "true");
  assert.equal(harness.dom.conversationLinkInput.value, "user-pasted-id");
});

test("renderThreadControlPanel 在空态隐藏后再显示时不会删除静态骨架，且内容可以重新更新", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    threadControlState: {
      status: { kind: "idle", label: "当前空闲" },
      source: { kind: "standard", label: "普通会话" },
      conversationId: "conversation-a",
      joinHint: "hint-a",
      details: [{ label: "conversationId", value: "conversation-a" }],
    },
  });

  harness.renderer.renderThreadControlPanel();
  harness.store.getActiveThread = () => null;
  harness.renderer.renderThreadControlPanel();

  assert.equal(harness.dom.threadControlPanel.hidden, true);
  assert.equal(harness.dom.threadControlPanel.innerHTML, "static-shell");

  harness.store.getActiveThread = () => harness.thread;
  harness.store.resolveThreadControlState = () => ({
    status: { kind: "running", label: "正在执行" },
    source: { kind: "attached", label: "已接入" },
    conversationId: "conversation-b",
    joinHint: "hint-b",
    details: [{ label: "conversationId", value: "conversation-b" }],
  });
  harness.renderer.renderThreadControlPanel();

  assert.equal(harness.dom.threadControlStatus.textContent, "正在执行");
  assert.equal(harness.dom.threadControlConversationId.textContent, "conversation-b");
  assert.ok(harness.dom.threadControlDetailsBody.innerHTML.includes("conversation-b"));
});

test("renderThreadControlPanel 重渲染时保留 details 展开态，并只更新 body 内容", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    threadControlState: {
      status: { kind: "idle", label: "当前空闲" },
      source: { kind: "standard", label: "普通会话" },
      conversationId: "conversation-a",
      joinHint: "hint-a",
      details: [{ label: "conversationId", value: "conversation-a" }],
    },
  });

  harness.dom.threadControlDetails.open = true;
  const originalDetailsNode = harness.dom.threadControlDetails;
  harness.renderer.renderThreadControlPanel();
  harness.store.resolveThreadControlState = () => ({
    status: { kind: "syncing", label: "正在同步" },
    source: { kind: "fork", label: "fork" },
    conversationId: "conversation-b",
    joinHint: "hint-b",
    details: [{ label: "conversationId", value: "conversation-b" }],
  });
  harness.renderer.renderThreadControlPanel();

  assert.equal(harness.dom.threadControlDetails, originalDetailsNode);
  assert.equal(harness.dom.threadControlDetails.open, true);
  assert.ok(harness.dom.threadControlDetailsBody.innerHTML.includes("conversation-b"));
});

test.skip("renderAgentsState 会在组织级等待队列渲染直接治理入口", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      agents: {
        status: "ready",
        errorMessage: "",
        noticeMessage: "",
        loading: false,
        detailLoading: false,
        workItemDetailLoading: false,
        creating: false,
        dispatching: false,
        ackingMailboxEntryId: "",
        respondingWorkItemId: "",
        organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
        agents: [
          {
            agentId: "agent-ops",
            principalId: "principal-ops",
            displayName: "运维·曜",
            departmentRole: "运维",
            mission: "负责发布和值班。",
            status: "active",
            updatedAt: "2026-04-06T15:05:00.000Z",
          },
        ],
        organizationWaitingSummary: {
          totalCount: 1,
          waitingHumanCount: 1,
          waitingAgentCount: 0,
          escalationCount: 1,
        },
        organizationWaitingItems: [
          {
            workItem: {
              workItemId: "work-item-1",
              targetAgentId: "agent-ops",
              status: "waiting_human",
              goal: "确认是否允许继续发布",
              priority: "urgent",
              updatedAt: "2026-04-06T15:05:00.000Z",
              waitingActionRequest: {
                actionType: "approval",
                prompt: "是否允许继续执行发布命令？",
                choices: ["approve", "deny"],
              },
            },
            targetAgent: {
              agentId: "agent-ops",
              displayName: "运维·曜",
              departmentRole: "运维",
            },
            sourceAgent: null,
            sourcePrincipal: {
              principalId: "principal-owner",
              displayName: "Owner",
            },
            latestWaitingMessage: null,
          },
        ],
        organizationWaitingResponseDrafts: {
          "work-item-1": {
            decision: "approve",
            inputText: "可以继续，但请先确认监控。",
          },
        },
        selectedAgentId: "agent-ops",
        selectedAgent: null,
        selectedAgentPrincipal: null,
        selectedOrganization: null,
        workItems: [],
        mailboxItems: [],
        selectedWorkItemId: "",
        selectedWorkItemDetail: null,
        humanResponseDraft: {
          workItemId: "",
          decision: "",
          inputText: "",
        },
        createDraft: {
          departmentRole: "",
          displayName: "",
          mission: "",
        },
        dispatchDraft: {
          targetAgentId: "agent-ops",
          sourceType: "human",
          sourceAgentId: "",
          dispatchReason: "",
          goal: "",
          contextPacketText: "",
          priority: "normal",
        },
      },
    },
  });

  assert.equal(typeof harness.renderer.renderAgentsState, "function");
  harness.renderer.renderAgentsState();

  assert.ok(harness.dom.agentsWaitingSummary.textContent.includes("当前共有 1 条待治理项"));
  assert.ok(harness.dom.agentsWaitingList.innerHTML.includes("直接治理"));
  assert.ok(harness.dom.agentsWaitingList.innerHTML.includes('data-agent-waiting-respond="work-item-1"'));
  assert.ok(harness.dom.agentsWaitingList.innerHTML.includes('data-agent-waiting-decision="work-item-1"'));
  assert.ok(harness.dom.agentsWaitingList.innerHTML.includes("可以继续，但请先确认监控。"));
});

test.skip("renderAgentsState 会渲染组织级治理摘要与 manager 热点卡", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      agents: {
        status: "ready",
        errorMessage: "",
        noticeMessage: "",
        loading: false,
        detailLoading: false,
        workItemDetailLoading: false,
        creating: false,
        dispatching: false,
        organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
        agents: [
          {
            agentId: "agent-manager",
            principalId: "principal-manager",
            organizationId: "org-1",
            displayName: "经理·曜",
            departmentRole: "经理",
            mission: "负责拆解任务与汇总结果。",
            status: "active",
          },
        ],
        organizationGovernanceOverview: {
          urgentParentCount: 1,
          attentionParentCount: 2,
          waitingHumanCount: 1,
          waitingAgentCount: 1,
          staleParentCount: 1,
          failedChildCount: 2,
          managersNeedingAttentionCount: 1,
          managerHotspots: [
            {
              managerAgent: {
                agentId: "agent-manager",
                displayName: "经理·曜",
                status: "active",
              },
              openParentCount: 2,
              urgentParentCount: 1,
              attentionParentCount: 1,
              waitingCount: 2,
              staleParentCount: 1,
              failedChildCount: 2,
              latestActivityAt: "2026-04-08T09:05:00.000Z",
            },
          ],
        },
        governanceFilters: {
          organizationId: "org-1",
          managerAgentId: "",
          attentionLevel: "all",
          waitingFor: "any",
          staleOnly: false,
          failedOnly: false,
        },
        organizationWaitingSummary: null,
        organizationWaitingItems: [],
        organizationCollaborationSummary: null,
        organizationCollaborationItems: [],
        organizationWaitingResponseDrafts: {},
        selectedAgentId: "",
        selectedAgent: null,
        selectedAgentPrincipal: null,
        selectedOrganization: { organizationId: "org-1", displayName: "老板团队" },
        workItems: [],
        mailboxItems: [],
        selectedWorkItemId: "",
        selectedWorkItemDetail: null,
        humanResponseDraft: {
          workItemId: "",
          decision: "",
          inputText: "",
        },
        createDraft: {
          departmentRole: "",
          displayName: "",
          mission: "",
        },
        dispatchDraft: {
          targetAgentId: "",
          sourceType: "human",
          sourceAgentId: "",
          dispatchReason: "",
          goal: "",
          contextPacketText: "",
          priority: "normal",
        },
      },
    },
  });

  harness.renderer.renderAgentsState();

  assert.ok(harness.dom.agentsGovernanceOverviewSummary.textContent.includes("当前有 1 条紧急父任务"));
  assert.ok(harness.dom.agentsGovernanceSummaryGrid.innerHTML.includes('data-agent-governance-preset="urgent"'));
  assert.ok(harness.dom.agentsGovernanceSummaryGrid.innerHTML.includes("需关注 manager"));
  assert.ok(harness.dom.agentsGovernanceHotspotsSummary.textContent.includes("1 个需要关注的 manager"));
  assert.ok(harness.dom.agentsGovernanceHotspotsList.innerHTML.includes("经理·曜"));
  assert.ok(harness.dom.agentsGovernanceHotspotsList.innerHTML.includes('data-agent-governance-hotspot-filter="agent-manager"'));
  assert.ok(harness.dom.agentsGovernanceHotspotsList.innerHTML.includes('data-agent-governance-hotspot-focus="agent-manager"'));
});

test.skip("renderAgentsState 会把 Platform Agents 兼容提示渲染到状态栏", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      agents: {
        status: "ready",
        errorMessage: "",
        noticeMessage: "",
        loading: false,
        detailLoading: false,
        workItemDetailLoading: false,
        creating: false,
        dispatching: false,
        updatingSpawnPolicy: false,
        savingExecutionBoundary: false,
        approvingSpawnSuggestionId: "",
        approvingIdleRecoverySuggestionId: "",
        ignoringSpawnSuggestionId: "",
        rejectingSpawnSuggestionId: "",
        restoringSpawnSuggestionId: "",
        ackingMailboxEntryId: "",
        cancelingWorkItemId: "",
        escalatingWorkItemId: "",
        respondingWorkItemId: "",
        lifecycleUpdatingAgentId: "",
        lifecycleUpdatingAction: "",
        compatibilityStatus: {
          panelOwnership: "platform",
          accessMode: "platform_gateway",
          statusLevel: "warning",
          message: "当前 Platform Agents 面板只是主 Themis 里的平台兼容入口；实际读写已走平台控制面，后续会迁到独立 Platform 前端。",
          platformBaseUrl: "http://platform.example.com",
          ownerPrincipalId: "principal-platform-owner",
        },
        organizations: [],
        agents: [],
        organizationGovernanceOverview: null,
        organizationWaitingSummary: null,
        organizationWaitingItems: [],
        organizationCollaborationSummary: null,
        organizationCollaborationItems: [],
        spawnPolicies: [],
        spawnSuggestions: [],
        suppressedSpawnSuggestions: [],
        spawnAuditLogs: [],
        idleRecoverySuggestions: [],
        idleRecoveryAuditLogs: [],
        governanceFilters: {
          organizationId: "",
          managerAgentId: "",
          attentionLevel: "all",
          waitingFor: "any",
          staleOnly: false,
          failedOnly: false,
          limit: 20,
        },
        organizationWaitingResponseDrafts: {},
        selectedAgentId: "",
        selectedAgent: null,
        selectedAgentPrincipal: null,
        selectedOrganization: null,
        selectedWorkspacePolicy: null,
        selectedRuntimeProfile: null,
        availableAuthAccounts: [],
        availableThirdPartyProviders: [],
        handoffs: [],
        handoffTimeline: [],
        workItems: [],
        mailboxItems: [],
        selectedWorkItemId: "",
        selectedWorkItemDetail: null,
        humanResponseDraft: {
          workItemId: "",
          decision: "",
          inputText: "",
        },
        spawnPolicyDraft: {
          organizationId: "",
          maxActiveAgents: 12,
          maxActiveAgentsPerRole: 3,
        },
        executionBoundaryDraft: {
          workspacePath: "",
          additionalDirectoriesText: "",
          allowNetworkAccess: true,
          accessMode: "auth",
          authAccountId: "",
          thirdPartyProviderId: "",
          model: "",
          reasoning: "",
          memoryMode: "",
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          webSearchMode: "live",
          networkAccessEnabled: true,
        },
        createDraft: {
          departmentRole: "",
          displayName: "",
          mission: "",
        },
        dispatchDraft: {
          targetAgentId: "",
          sourceType: "human",
          sourceAgentId: "",
          dispatchReason: "",
          goal: "",
          contextPacketText: "",
          priority: "normal",
        },
      },
    },
  });

  harness.renderer.renderAgentsState();

  assert.equal(
    harness.dom.agentsStatusNote.textContent,
    "当前 Platform Agents 面板只是主 Themis 里的平台兼容入口；实际读写已走平台控制面，后续会迁到独立 Platform 前端。",
  );
  assert.equal(harness.dom.agentsStatusNote.dataset.state, "warning");
  assert.equal(
    harness.dom.agentsOpenPlatformLink.href,
    "http://platform.example.com/?ownerPrincipalId=principal-platform-owner",
  );
  assert.equal(harness.dom.agentsOpenPlatformLink.getAttribute("aria-disabled"), "false");
  assert.match(
    harness.dom.agentsOpenPlatformNote.textContent,
    /http:\/\/platform\.example\.com\/\?ownerPrincipalId=principal-platform-owner/,
  );
});

test.skip("renderAgentsState 会在 gateway_required 时把 Platform Agents 限制成状态入口", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      agents: {
        status: "ready",
        errorMessage: "",
        noticeMessage: "",
        loading: false,
        detailLoading: false,
        workItemDetailLoading: false,
        creating: false,
        dispatching: false,
        updatingSpawnPolicy: false,
        savingExecutionBoundary: false,
        approvingSpawnSuggestionId: "",
        approvingIdleRecoverySuggestionId: "",
        ignoringSpawnSuggestionId: "",
        rejectingSpawnSuggestionId: "",
        restoringSpawnSuggestionId: "",
        ackingMailboxEntryId: "",
        cancelingWorkItemId: "",
        escalatingWorkItemId: "",
        respondingWorkItemId: "",
        lifecycleUpdatingAgentId: "",
        lifecycleUpdatingAction: "",
        compatibilityStatus: {
          panelOwnership: "platform",
          accessMode: "gateway_required",
          statusLevel: "error",
          message: "当前 Platform Agents 兼容入口已经收口为纯 gateway；请先配置 THEMIS_PLATFORM_*，或直接使用独立 themis-platform 页面。",
          platformBaseUrl: "",
          ownerPrincipalId: "principal-platform-owner",
        },
        organizations: [],
        agents: [],
        organizationGovernanceOverview: null,
        organizationWaitingSummary: null,
        organizationWaitingItems: [],
        organizationCollaborationSummary: null,
        organizationCollaborationItems: [],
        spawnPolicies: [],
        spawnSuggestions: [],
        suppressedSpawnSuggestions: [],
        spawnAuditLogs: [],
        idleRecoverySuggestions: [],
        idleRecoveryAuditLogs: [],
        governanceFilters: {
          organizationId: "",
          managerAgentId: "",
          attentionLevel: "all",
          waitingFor: "any",
          staleOnly: false,
          failedOnly: false,
          limit: 20,
        },
        organizationWaitingResponseDrafts: {},
        selectedAgentId: "",
        selectedAgent: null,
        selectedAgentPrincipal: null,
        selectedOrganization: null,
        selectedWorkspacePolicy: null,
        selectedRuntimeProfile: null,
        availableAuthAccounts: [],
        availableThirdPartyProviders: [],
        handoffs: [],
        handoffTimeline: [],
        workItems: [],
        mailboxItems: [],
        selectedWorkItemId: "",
        selectedWorkItemDetail: null,
        humanResponseDraft: {
          workItemId: "",
          decision: "",
          inputText: "",
        },
        spawnPolicyDraft: {
          organizationId: "",
          maxActiveAgents: 12,
          maxActiveAgentsPerRole: 3,
        },
        executionBoundaryDraft: {
          workspacePath: "",
          additionalDirectoriesText: "",
          allowNetworkAccess: true,
          accessMode: "auth",
          authAccountId: "",
          thirdPartyProviderId: "",
          model: "",
          reasoning: "",
          memoryMode: "",
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          webSearchMode: "live",
          networkAccessEnabled: true,
        },
        createDraft: {
          departmentRole: "",
          displayName: "",
          mission: "",
        },
        dispatchDraft: {
          targetAgentId: "",
          sourceType: "human",
          sourceAgentId: "",
          dispatchReason: "",
          goal: "",
          contextPacketText: "",
          priority: "normal",
        },
      },
    },
  });

  harness.renderer.renderAgentsState();

  assert.equal(harness.dom.agentsStatusNote.dataset.state, "error");
  assert.equal(harness.dom.agentsOpenPlatformLink.getAttribute("aria-disabled"), "true");
  assert.equal(
    harness.dom.agentsOpenPlatformNote.textContent,
    "主 Themis 已不再托管这个平台治理面；请先配置平台 gateway，或直接切到独立 themis-platform 页面。",
  );
});

test.skip("renderAgentsState 会渲染组织级跨父任务汇总台卡片，并暴露父任务跳转动作", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      agents: {
        status: "ready",
        errorMessage: "",
        noticeMessage: "",
        loading: false,
        detailLoading: false,
        workItemDetailLoading: false,
        creating: false,
        dispatching: false,
        ackingMailboxEntryId: "",
        respondingWorkItemId: "",
        organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
        agents: [
          {
            agentId: "agent-manager",
            principalId: "principal-manager",
            displayName: "经理·曜",
            departmentRole: "经理",
            mission: "负责拆解任务与汇总结果。",
            status: "active",
          },
        ],
        organizationWaitingSummary: {
          totalCount: 0,
          waitingHumanCount: 0,
          waitingAgentCount: 0,
          escalationCount: 0,
        },
        organizationWaitingItems: [],
        organizationCollaborationSummary: {
          totalCount: 1,
          urgentCount: 1,
          attentionCount: 0,
          normalCount: 0,
        },
        organizationCollaborationItems: [
          {
            parentWorkItem: {
              workItemId: "work-item-parent-1",
              targetAgentId: "agent-manager",
              status: "running",
              goal: "把组织级跨父任务汇总挂到 Agents 面板",
            },
            managerAgent: {
              agentId: "agent-manager",
              displayName: "经理·曜",
            },
            childSummary: {
              totalCount: 3,
              openCount: 2,
              waitingCount: 1,
              completedCount: 1,
              failedCount: 0,
              cancelledCount: 0,
            },
            latestHandoff: null,
            latestWaitingMessage: {
              messageId: "msg-1",
              messageType: "escalation",
            },
            latestWaitingWorkItemId: "work-item-child-1",
            latestWaitingTargetAgentId: "agent-manager",
            latestWaitingActionType: "approval",
            latestGovernanceResponse: null,
            lastActivityAt: "2026-04-07T12:10:00.000Z",
            lastActivityKind: "waiting",
            lastActivitySummary: "当前 UI 交互还需要顶层治理拍板。",
            attentionLevel: "urgent",
            attentionReasons: ["1 条任务等待顶层治理", "最近出现升级阻塞"],
            waitingHumanChildCount: 1,
            waitingAgentChildCount: 0,
            failedChildCount: 0,
            staleChildCount: 0,
            managerStatus: "active",
          },
        ],
        organizationWaitingResponseDrafts: {},
        selectedAgentId: "agent-manager",
        selectedAgent: {
          agentId: "agent-manager",
          principalId: "principal-manager",
          displayName: "经理·曜",
          departmentRole: "经理",
          mission: "负责拆解任务与汇总结果。",
          status: "active",
        },
        selectedAgentPrincipal: {
          principalId: "principal-manager",
        },
        selectedOrganization: {
          organizationId: "org-1",
          displayName: "老板团队",
        },
        workItems: [],
        mailboxItems: [],
        selectedWorkItemId: "work-item-parent-1",
        selectedWorkItemDetail: null,
        humanResponseDraft: {
          workItemId: "",
          decision: "",
          inputText: "",
        },
        createDraft: {
          departmentRole: "",
          displayName: "",
          mission: "",
        },
        dispatchDraft: {
          targetAgentId: "agent-manager",
          sourceType: "human",
          sourceAgentId: "",
          dispatchReason: "",
          goal: "",
          contextPacketText: "",
          priority: "normal",
        },
      },
    },
  });

  harness.renderer.renderAgentsState();

  assert.ok(harness.dom.agentsCollaborationSummary.textContent.includes("当前共有 1 条跨父任务协作链路"));
  assert.ok(harness.dom.agentsCollaborationList.innerHTML.includes("紧急介入"));
  assert.ok(harness.dom.agentsCollaborationList.innerHTML.includes("经理·曜"));
  assert.ok(harness.dom.agentsCollaborationList.innerHTML.includes("关注原因"));
  assert.ok(harness.dom.agentsCollaborationList.innerHTML.includes('data-agent-collaboration-open="work-item-parent-1"'));
  assert.ok(harness.dom.agentsCollaborationList.innerHTML.includes('data-agent-collaboration-focus="agent-manager"'));
  assert.ok(harness.dom.agentsCollaborationList.innerHTML.includes('data-agent-collaboration-waiting-open="work-item-child-1"'));
  assert.ok(harness.dom.agentsCollaborationList.innerHTML.includes('data-agent-collaboration-lifecycle="pause"'));
});

test.skip("renderAgentsState 会渲染自动创建建议卡片与批准按钮", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      agents: {
        status: "ready",
        errorMessage: "",
        noticeMessage: "",
        loading: false,
        detailLoading: false,
        workItemDetailLoading: false,
        creating: false,
        dispatching: false,
        approvingSpawnSuggestionId: "",
        ignoringSpawnSuggestionId: "",
        rejectingSpawnSuggestionId: "",
        restoringSpawnSuggestionId: "",
        ackingMailboxEntryId: "",
        respondingWorkItemId: "",
        organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
        agents: [],
        organizationWaitingSummary: null,
        organizationWaitingItems: [],
        spawnPolicies: [
          {
            organizationId: "org-1",
            maxActiveAgents: 12,
            maxActiveAgentsPerRole: 3,
          },
        ],
        spawnSuggestions: [
          {
            suggestionId: "spawn-suggestion-1",
            departmentRole: "运维",
            displayName: "运维·砺",
            rationale: "运维·曜 当前有 4 个未完成 work item，建议增设一个 运维 长期 agent 分担持续负载。",
            supportingAgentDisplayName: "运维·曜",
            openWorkItemCount: 4,
            waitingWorkItemCount: 2,
            highPriorityWorkItemCount: 2,
            guardrail: {
              organizationActiveAgentCount: 2,
              organizationActiveAgentLimit: 12,
              roleActiveAgentCount: 2,
              roleActiveAgentLimit: 3,
              blocked: false,
            },
            auditFacts: {
              creationReason: "运维·曜 当前有 4 个未完成 work item，建议增设一个 运维 长期 agent 分担持续负载。",
              expectedScope: "负责分担运维持续性工作。",
              insufficiencyReason: "运维·曜 当前积压较高。",
              namingBasis: "沿用“运维·风格名”自动命名规则。",
            },
          },
        ],
        suppressedSpawnSuggestions: [
          {
            suggestionId: "spawn-suggestion-suppressed-1",
            departmentRole: "运维",
            displayName: "运维·岚",
            supportingAgentDisplayName: "运维·曜",
            rationale: "运维积压较高，建议增员。",
            suppressionState: "ignored",
            updatedAt: "2026-04-07T09:10:00.000Z",
            auditFacts: {
              creationReason: "运维积压较高，建议增员。",
            },
          },
        ],
        spawnPolicyDraft: {
          organizationId: "org-1",
          maxActiveAgents: 12,
          maxActiveAgentsPerRole: 3,
        },
        spawnAuditLogs: [
          {
            auditLogId: "agent-audit-1",
            eventType: "spawn_suggestion_approved",
            displayName: "运维·砺",
            departmentRole: "运维",
            summary: "已批准自动创建 运维·砺，作为新的 运维 长期 agent。",
            supportingAgentDisplayName: "运维·曜",
            guardrail: {
              organizationActiveAgentCount: 1,
              organizationActiveAgentLimit: 12,
              roleActiveAgentCount: 1,
              roleActiveAgentLimit: 3,
            },
            auditFacts: {
              expectedScope: "负责分担运维持续性工作。",
            },
            createdAt: "2026-04-07T09:00:00.000Z",
          },
        ],
        selectedAgentId: "",
        selectedAgent: null,
        selectedAgentPrincipal: null,
        selectedOrganization: null,
        workItems: [],
        mailboxItems: [],
        selectedWorkItemId: "",
        selectedWorkItemDetail: null,
        humanResponseDraft: { workItemId: "", decision: "", inputText: "" },
        createDraft: { departmentRole: "", displayName: "", mission: "" },
        dispatchDraft: {
          targetAgentId: "",
          sourceType: "human",
          sourceAgentId: "",
          dispatchReason: "",
          goal: "",
          contextPacketText: "",
          priority: "normal",
        },
      },
    },
  });

  harness.renderer.renderAgentsState();

  assert.ok(harness.dom.agentsSpawnSuggestionsSummary.textContent.includes("1 条"));
  assert.ok(harness.dom.agentsSpawnPolicySummary.textContent.includes("活跃 agent 上限 12"));
  assert.equal(harness.dom.agentsSpawnPolicyMaxActiveInput.value, "12");
  assert.equal(harness.dom.agentsSpawnPolicyMaxRoleInput.value, "3");
  assert.ok(harness.dom.agentsSpawnSuggestionsList.innerHTML.includes("运维·砺"));
  assert.ok(harness.dom.agentsSpawnSuggestionsList.innerHTML.includes('data-agent-spawn-approve="spawn-suggestion-1"'));
  assert.ok(harness.dom.agentsSpawnSuggestionsList.innerHTML.includes('data-agent-spawn-ignore="spawn-suggestion-1"'));
  assert.ok(harness.dom.agentsSpawnSuggestionsList.innerHTML.includes('data-agent-spawn-reject="spawn-suggestion-1"'));
  assert.ok(harness.dom.agentsSpawnSuggestionsList.innerHTML.includes("按建议创建"));
  assert.ok(harness.dom.agentsSpawnSuggestionsList.innerHTML.includes("组织活跃 agent 2/12"));
  assert.ok(harness.dom.agentsSuppressedSpawnSuggestionsSummary.textContent.includes("1 条"));
  assert.ok(harness.dom.agentsSuppressedSpawnSuggestionsList.innerHTML.includes("运维·岚"));
  assert.ok(harness.dom.agentsSuppressedSpawnSuggestionsList.innerHTML.includes('data-agent-spawn-restore="spawn-suggestion-suppressed-1"'));
  assert.ok(harness.dom.agentsSpawnAuditSummary.textContent.includes("1 条"));
  assert.ok(harness.dom.agentsSpawnAuditList.innerHTML.includes("已批准"));
  assert.ok(harness.dom.agentsSpawnAuditList.innerHTML.includes("运维·曜"));
});

test.skip("renderAgentsState 会渲染 idle 回收建议与审计记录", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      agents: {
        status: "ready",
        errorMessage: "",
        noticeMessage: "",
        loading: false,
        detailLoading: false,
        workItemDetailLoading: false,
        creating: false,
        dispatching: false,
        approvingIdleRecoverySuggestionId: "",
        organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
        agents: [],
        organizationWaitingSummary: null,
        organizationWaitingItems: [],
        spawnPolicies: [],
        spawnSuggestions: [],
        suppressedSpawnSuggestions: [],
        spawnAuditLogs: [],
        idleRecoverySuggestions: [
          {
            suggestionId: "idle-suggestion-1",
            agentId: "agent-ops",
            displayName: "运维·砺",
            departmentRole: "运维",
            currentStatus: "active",
            recommendedAction: "pause",
            idleHours: 99,
            lastActivitySummary: "最近一次 handoff 已完成交接。",
            openWorkItemCount: 0,
            pendingMailboxCount: 0,
            recentClosedWorkItemCount: 1,
            recentHandoffCount: 1,
            rationale: "该 auto agent 已连续空闲 99 小时，且当前没有未完成任务或待处理 mailbox。",
          },
        ],
        idleRecoveryAuditLogs: [
          {
            auditLogId: "agent-audit-idle-1",
            eventType: "idle_recovery_pause_approved",
            displayName: "运维·砺",
            departmentRole: "运维",
            summary: "已按建议暂停空闲 agent 运维·砺。",
            createdAt: "2026-04-07T12:00:00.000Z",
          },
        ],
        spawnPolicyDraft: {
          organizationId: "org-1",
          maxActiveAgents: 12,
          maxActiveAgentsPerRole: 3,
        },
        selectedAgentId: "",
        selectedAgent: null,
        selectedAgentPrincipal: null,
        selectedOrganization: null,
        workItems: [],
        mailboxItems: [],
        selectedWorkItemId: "",
        selectedWorkItemDetail: null,
        humanResponseDraft: { workItemId: "", decision: "", inputText: "" },
        createDraft: { departmentRole: "", displayName: "", mission: "" },
        dispatchDraft: {
          targetAgentId: "",
          sourceType: "human",
          sourceAgentId: "",
          dispatchReason: "",
          goal: "",
          contextPacketText: "",
          priority: "normal",
        },
      },
    },
  });

  harness.renderer.renderAgentsState();

  assert.ok(harness.dom.agentsIdleRecoverySuggestionsSummary.textContent.includes("1 条"));
  assert.ok(harness.dom.agentsIdleRecoverySuggestionsList.innerHTML.includes("运维·砺"));
  assert.ok(harness.dom.agentsIdleRecoverySuggestionsList.innerHTML.includes("建议暂停"));
  assert.ok(harness.dom.agentsIdleRecoverySuggestionsList.innerHTML.includes('data-agent-idle-approve="idle-suggestion-1"'));
  assert.ok(harness.dom.agentsIdleRecoveryAuditSummary.textContent.includes("1 条"));
  assert.ok(harness.dom.agentsIdleRecoveryAuditList.innerHTML.includes("已暂停"));
});

test.skip("renderAgentsState 会把 bootstrapping agent 的建档状态和提示文案渲染出来", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      agents: {
        status: "ready",
        errorMessage: "",
        noticeMessage: "",
        loading: false,
        detailLoading: false,
        workItemDetailLoading: false,
        creating: false,
        dispatching: false,
        organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
        organizationWaitingSummary: {
          totalCount: 0,
          waitingHumanCount: 0,
          waitingAgentCount: 0,
          escalationCount: 0,
        },
        organizationWaitingItems: [],
        spawnPolicies: [],
        spawnPolicyDraft: {
          organizationId: "org-1",
          maxActiveAgents: 12,
          maxActiveAgentsPerRole: 3,
        },
        spawnSuggestions: [],
        suppressedSpawnSuggestions: [],
        spawnAuditLogs: [],
        agents: [
          {
            agentId: "agent-ops-2",
            principalId: "principal-ops-2",
            organizationId: "org-1",
            displayName: "运维·砺",
            departmentRole: "运维",
            mission: "负责运维值班与巡检分流。",
            status: "bootstrapping",
            creationMode: "auto",
            bootstrapProfile: {
              state: "pending",
              bootstrapWorkItemId: "work-item-bootstrap-1",
            },
          },
        ],
        selectedAgentId: "agent-ops-2",
        selectedAgent: {
          agentId: "agent-ops-2",
          principalId: "principal-ops-2",
          organizationId: "org-1",
          displayName: "运维·砺",
          departmentRole: "运维",
          mission: "负责运维值班与巡检分流。",
          status: "bootstrapping",
          creationMode: "auto",
          bootstrapProfile: {
            state: "pending",
            bootstrapWorkItemId: "work-item-bootstrap-1",
          },
        },
        selectedAgentPrincipal: { principalId: "principal-ops-2" },
        selectedOrganization: { organizationId: "org-1", displayName: "老板团队" },
        workItems: [],
        mailboxItems: [],
        selectedWorkItemId: "",
        selectedWorkItemDetail: null,
        humanResponseDraft: { workItemId: "", decision: "", inputText: "" },
        createDraft: { departmentRole: "", displayName: "", mission: "" },
        dispatchDraft: {
          targetAgentId: "agent-ops-2",
          sourceType: "human",
          sourceAgentId: "",
          dispatchReason: "",
          goal: "",
          contextPacketText: "",
          priority: "normal",
        },
      },
    },
  });

  harness.renderer.renderAgentsState();

  assert.equal(harness.dom.agentsSelectedAgentHeading.textContent, "运维·砺");
  assert.ok(harness.dom.agentsSelectedAgentCopy.textContent.includes("首次职责建档"));
  assert.ok(harness.dom.agentsSelectedAgentMeta.innerHTML.includes("建档"));
  assert.ok(harness.dom.agentsSelectedAgentMeta.innerHTML.includes("建档进行中"));
});

test.skip("renderAgentsState 会在 waiting_agent 卡片渲染升级入口", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      agents: {
        status: "ready",
        errorMessage: "",
        noticeMessage: "",
        loading: false,
        detailLoading: false,
        workItemDetailLoading: false,
        creating: false,
        dispatching: false,
        ackingMailboxEntryId: "",
        escalatingWorkItemId: "",
        respondingWorkItemId: "",
        organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
        agents: [
          {
            agentId: "agent-frontend",
            principalId: "principal-frontend",
            displayName: "前端·岚",
            departmentRole: "前端",
            mission: "负责 Web 工作台。",
            status: "active",
            updatedAt: "2026-04-07T09:05:00.000Z",
          },
          {
            agentId: "agent-backend",
            principalId: "principal-backend",
            displayName: "后端·衡",
            departmentRole: "后端",
            mission: "负责接口与存储。",
            status: "active",
            updatedAt: "2026-04-07T09:05:00.000Z",
          },
        ],
        organizationWaitingSummary: {
          totalCount: 1,
          waitingHumanCount: 0,
          waitingAgentCount: 1,
          escalationCount: 0,
        },
        organizationWaitingItems: [
          {
            workItem: {
              workItemId: "work-item-2",
              targetAgentId: "agent-backend",
              status: "waiting_agent",
              goal: "确认是否可以继续部署",
              priority: "urgent",
              updatedAt: "2026-04-07T09:05:00.000Z",
              waitingActionRequest: {
                waitingFor: "agent",
                actionType: "approval",
                prompt: "是否允许执行 deploy production？",
                choices: ["approve", "deny"],
              },
            },
            targetAgent: {
              agentId: "agent-backend",
              displayName: "后端·衡",
              departmentRole: "后端",
            },
            sourceAgent: {
              agentId: "agent-frontend",
              displayName: "前端·岚",
              departmentRole: "前端",
            },
            sourcePrincipal: {
              principalId: "principal-owner",
              displayName: "Owner",
            },
            latestWaitingMessage: {
              messageId: "msg-waiting-2",
              messageType: "approval_request",
            },
          },
        ],
        organizationWaitingResponseDrafts: {},
        selectedAgentId: "agent-backend",
        selectedAgent: null,
        selectedAgentPrincipal: null,
        selectedOrganization: null,
        workItems: [],
        mailboxItems: [],
        selectedWorkItemId: "",
        selectedWorkItemDetail: null,
        humanResponseDraft: {
          workItemId: "",
          decision: "",
          inputText: "",
        },
        createDraft: {
          departmentRole: "",
          displayName: "",
          mission: "",
        },
        dispatchDraft: {
          targetAgentId: "agent-backend",
          sourceType: "human",
          sourceAgentId: "",
          dispatchReason: "",
          goal: "",
          contextPacketText: "",
          priority: "normal",
        },
      },
    },
  });

  harness.renderer.renderAgentsState();

  assert.ok(harness.dom.agentsWaitingSummary.textContent.includes("等 agent 1 条"));
  assert.ok(harness.dom.agentsWaitingList.innerHTML.includes("升级处理"));
  assert.ok(harness.dom.agentsWaitingList.innerHTML.includes('data-agent-waiting-escalate="work-item-2"'));
  assert.ok(harness.dom.agentsWaitingList.innerHTML.includes("升级到顶层治理"));
});

test.skip("renderAgentsState 会在可安全取消的 work item 详情里渲染取消动作", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      agents: {
        status: "ready",
        errorMessage: "",
        noticeMessage: "",
        loading: false,
        detailLoading: false,
        workItemDetailLoading: false,
        creating: false,
        dispatching: false,
        ackingMailboxEntryId: "",
        cancelingWorkItemId: "",
        escalatingWorkItemId: "",
        respondingWorkItemId: "",
        lifecycleUpdatingAgentId: "",
        lifecycleUpdatingAction: "",
        organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
        agents: [
          {
            agentId: "agent-backend",
            principalId: "principal-backend",
            displayName: "后端·衡",
            departmentRole: "后端",
            mission: "负责接口与存储。",
            status: "active",
            updatedAt: "2026-04-07T10:20:00.000Z",
          },
        ],
        organizationWaitingSummary: {
          totalCount: 0,
          waitingHumanCount: 0,
          waitingAgentCount: 0,
          escalationCount: 0,
        },
        organizationWaitingItems: [],
        organizationWaitingResponseDrafts: {},
        selectedAgentId: "agent-backend",
        selectedAgent: {
          agentId: "agent-backend",
          principalId: "principal-backend",
          displayName: "后端·衡",
          departmentRole: "后端",
          mission: "负责接口与存储。",
          status: "active",
        },
        selectedAgentPrincipal: {
          principalId: "principal-backend",
        },
        selectedOrganization: {
          organizationId: "org-1",
          displayName: "老板团队",
        },
        workItems: [
          {
            workItemId: "work-item-3",
            targetAgentId: "agent-backend",
            status: "queued",
            sourceType: "human",
            goal: "这条任务现在应该被取消",
          },
        ],
        mailboxItems: [],
        selectedWorkItemId: "work-item-3",
        selectedWorkItemDetail: {
          workItem: {
            workItemId: "work-item-3",
            targetAgentId: "agent-backend",
            status: "queued",
            goal: "这条任务现在应该被取消",
          },
          targetAgent: {
            agentId: "agent-backend",
            displayName: "后端·衡",
          },
          sourcePrincipal: {
            principalId: "principal-owner",
          },
          messages: [],
        },
        humanResponseDraft: {
          workItemId: "",
          decision: "",
          inputText: "",
        },
        createDraft: {
          departmentRole: "",
          displayName: "",
          mission: "",
        },
        dispatchDraft: {
          targetAgentId: "agent-backend",
          sourceType: "human",
          sourceAgentId: "",
          dispatchReason: "",
          goal: "",
          contextPacketText: "",
          priority: "normal",
        },
      },
    },
  });

  harness.renderer.renderAgentsState();

  assert.ok(harness.dom.agentsWorkItemDetail.innerHTML.includes("治理动作"));
  assert.ok(harness.dom.agentsWorkItemDetail.innerHTML.includes('data-agent-work-item-cancel="work-item-3"'));
  assert.ok(harness.dom.agentsWorkItemDetail.innerHTML.includes("取消该 work item"));
});

test.skip("renderAgentsState 会在 work item 详情里渲染父任务与下游协作汇总", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      agents: {
        status: "ready",
        errorMessage: "",
        noticeMessage: "",
        loading: false,
        detailLoading: false,
        workItemDetailLoading: false,
        creating: false,
        dispatching: false,
        ackingMailboxEntryId: "",
        cancelingWorkItemId: "",
        escalatingWorkItemId: "",
        respondingWorkItemId: "",
        lifecycleUpdatingAgentId: "",
        lifecycleUpdatingAction: "",
        organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
        agents: [
          {
            agentId: "agent-manager",
            principalId: "principal-manager",
            displayName: "经理·曜",
            departmentRole: "经理",
            mission: "负责拆解任务与汇总结果。",
            status: "active",
          },
        ],
        organizationWaitingSummary: {
          totalCount: 0,
          waitingHumanCount: 0,
          waitingAgentCount: 0,
          escalationCount: 0,
        },
        organizationWaitingItems: [],
        organizationWaitingResponseDrafts: {},
        selectedAgentId: "agent-manager",
        selectedAgent: {
          agentId: "agent-manager",
          principalId: "principal-manager",
          displayName: "经理·曜",
          departmentRole: "经理",
          mission: "负责拆解任务与汇总结果。",
          status: "active",
        },
        selectedAgentPrincipal: {
          principalId: "principal-manager",
        },
        selectedOrganization: {
          organizationId: "org-1",
          displayName: "老板团队",
        },
        handoffs: [],
        handoffTimeline: [],
        workItems: [
          {
            workItemId: "work-item-child-1",
            parentWorkItemId: "work-item-parent-1",
            targetAgentId: "agent-manager",
            status: "completed",
            goal: "汇总当前协作进展",
          },
        ],
        mailboxItems: [],
        selectedWorkItemId: "work-item-child-1",
        selectedWorkItemDetail: {
          workItem: {
            workItemId: "work-item-child-1",
            parentWorkItemId: "work-item-parent-1",
            targetAgentId: "agent-manager",
            status: "completed",
            goal: "汇总当前协作进展",
          },
          targetAgent: {
            agentId: "agent-manager",
            displayName: "经理·曜",
          },
          sourcePrincipal: {
            principalId: "principal-owner",
          },
          parentWorkItem: {
            workItemId: "work-item-root-1",
            targetAgentId: "agent-lead",
            status: "running",
            goal: "完成 P4 第二刀",
          },
          parentTargetAgent: {
            agentId: "agent-lead",
            displayName: "负责人·青",
          },
          childSummary: {
            totalCount: 2,
            openCount: 1,
            waitingCount: 1,
            completedCount: 1,
            failedCount: 0,
            cancelledCount: 0,
          },
          childWorkItems: [
            {
              workItem: {
                workItemId: "work-item-sub-1",
                targetAgentId: "agent-backend",
                status: "completed",
                goal: "补 work item summary 接口",
                priority: "high",
              },
              targetAgent: {
                agentId: "agent-backend",
                displayName: "后端·衡",
              },
              latestHandoff: {
                handoffId: "handoff-1",
                summary: "接口已完成并回交给经理。",
              },
            },
            {
              workItem: {
                workItemId: "work-item-sub-2",
                targetAgentId: "agent-frontend",
                status: "waiting_agent",
                goal: "补 detail 面板",
                priority: "normal",
              },
              targetAgent: {
                agentId: "agent-frontend",
                displayName: "前端·岚",
              },
              latestHandoff: null,
            },
          ],
          messages: [],
        },
        humanResponseDraft: {
          workItemId: "",
          decision: "",
          inputText: "",
        },
        createDraft: {
          departmentRole: "",
          displayName: "",
          mission: "",
        },
        dispatchDraft: {
          targetAgentId: "agent-manager",
          sourceType: "human",
          sourceAgentId: "",
          dispatchReason: "",
          goal: "",
          contextPacketText: "",
          priority: "normal",
        },
      },
    },
  });

  harness.renderer.renderAgentsState();

  assert.ok(harness.dom.agentsWorkItemDetail.innerHTML.includes("父任务"));
  assert.ok(harness.dom.agentsWorkItemDetail.innerHTML.includes("负责人·青"));
  assert.ok(harness.dom.agentsWorkItemDetail.innerHTML.includes("下游协作汇总"));
  assert.ok(harness.dom.agentsWorkItemDetail.innerHTML.includes("后端·衡"));
  assert.ok(harness.dom.agentsWorkItemDetail.innerHTML.includes("接口已完成并回交给经理。"));
  assert.ok(harness.dom.agentsWorkItemDetail.innerHTML.includes("等待中"));
});

test.skip("renderAgentsState 会在当前 agent 面板渲染 lifecycle 治理动作", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      agents: {
        status: "ready",
        errorMessage: "",
        noticeMessage: "",
        loading: false,
        detailLoading: false,
        workItemDetailLoading: false,
        creating: false,
        dispatching: false,
        ackingMailboxEntryId: "",
        escalatingWorkItemId: "",
        respondingWorkItemId: "",
        lifecycleUpdatingAgentId: "",
        lifecycleUpdatingAction: "",
        organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
        agents: [
          {
            agentId: "agent-ops",
            principalId: "principal-ops",
            displayName: "运维·曜",
            departmentRole: "运维",
            mission: "负责部署与值班。",
            status: "active",
            updatedAt: "2026-04-07T10:00:00.000Z",
          },
        ],
        organizationWaitingSummary: {
          totalCount: 0,
          waitingHumanCount: 0,
          waitingAgentCount: 0,
          escalationCount: 0,
        },
        organizationWaitingItems: [],
        organizationWaitingResponseDrafts: {},
        selectedAgentId: "agent-ops",
        selectedAgent: {
          agentId: "agent-ops",
          principalId: "principal-ops",
          displayName: "运维·曜",
          departmentRole: "运维",
          mission: "负责部署与值班。",
          status: "active",
        },
        selectedAgentPrincipal: {
          principalId: "principal-ops",
        },
        selectedOrganization: {
          organizationId: "org-1",
          displayName: "老板团队",
        },
        workItems: [],
        mailboxItems: [],
        selectedWorkItemId: "",
        selectedWorkItemDetail: null,
        humanResponseDraft: {
          workItemId: "",
          decision: "",
          inputText: "",
        },
        createDraft: {
          departmentRole: "",
          displayName: "",
          mission: "",
        },
        dispatchDraft: {
          targetAgentId: "agent-ops",
          sourceType: "human",
          sourceAgentId: "",
          dispatchReason: "",
          goal: "",
          contextPacketText: "",
          priority: "normal",
        },
      },
    },
  });

  harness.renderer.renderAgentsState();

  assert.ok(harness.dom.agentsSelectedAgentMeta.innerHTML.includes("治理动作"));
  assert.ok(harness.dom.agentsSelectedAgentMeta.innerHTML.includes('data-agent-lifecycle-action="pause"'));
  assert.ok(harness.dom.agentsSelectedAgentMeta.innerHTML.includes('data-agent-lifecycle-action="archive"'));
});

test.skip("renderAgentsState 会渲染 handoff 卡片与交接时间线", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      agents: {
        status: "ready",
        errorMessage: "",
        noticeMessage: "",
        loading: false,
        detailLoading: false,
        workItemDetailLoading: false,
        creating: false,
        dispatching: false,
        ackingMailboxEntryId: "",
        escalatingWorkItemId: "",
        respondingWorkItemId: "",
        lifecycleUpdatingAgentId: "",
        lifecycleUpdatingAction: "",
        organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
        agents: [
          {
            agentId: "agent-backend",
            principalId: "principal-backend",
            displayName: "后端·衡",
            departmentRole: "后端",
            mission: "负责接口与存储。",
            status: "active",
          },
        ],
        organizationWaitingSummary: {
          totalCount: 0,
          waitingHumanCount: 0,
          waitingAgentCount: 0,
          escalationCount: 0,
        },
        organizationWaitingItems: [],
        organizationWaitingResponseDrafts: {},
        selectedAgentId: "agent-backend",
        selectedAgent: {
          agentId: "agent-backend",
          principalId: "principal-backend",
          displayName: "后端·衡",
          departmentRole: "后端",
          mission: "负责接口与存储。",
          status: "active",
        },
        selectedAgentPrincipal: {
          principalId: "principal-backend",
        },
        selectedOrganization: {
          organizationId: "org-1",
          displayName: "老板团队",
        },
        handoffs: [
          {
            handoffId: "handoff-1",
            fromAgentId: "agent-backend",
            toAgentId: "agent-frontend",
            toAgentDisplayName: "前端·岚",
            counterpartyDisplayName: "前端·岚",
            workItemId: "work-item-2",
            summary: "detail 接口已交接给前端验证。",
            blockers: ["等页面联调"],
            recommendedNextActions: ["补时间线面板"],
            attachedArtifacts: ["src/server/http-agents.ts"],
            createdAt: "2026-04-07T10:10:00.000Z",
          },
        ],
        handoffTimeline: [
          {
            kind: "handoff",
            title: "交接给前端·岚",
            summary: "detail 接口已交接给前端验证。",
            counterpartyDisplayName: "前端·岚",
            workItemId: "work-item-2",
            at: "2026-04-07T10:10:00.000Z",
            handoffId: "handoff-1",
          },
        ],
        workItems: [],
        mailboxItems: [],
        selectedWorkItemId: "",
        selectedWorkItemDetail: null,
        humanResponseDraft: {
          workItemId: "",
          decision: "",
          inputText: "",
        },
        createDraft: {
          departmentRole: "",
          displayName: "",
          mission: "",
        },
        dispatchDraft: {
          targetAgentId: "agent-backend",
          sourceType: "human",
          sourceAgentId: "",
          dispatchReason: "",
          goal: "",
          contextPacketText: "",
          priority: "normal",
        },
      },
    },
  });

  harness.renderer.renderAgentsState();

  assert.ok(harness.dom.agentsHandoffsSummary.textContent.includes("1 条 handoff"));
  assert.ok(harness.dom.agentsHandoffsList.innerHTML.includes("发起交接"));
  assert.ok(harness.dom.agentsHandoffsList.innerHTML.includes("前端·岚"));
  assert.ok(harness.dom.agentsHandoffsList.innerHTML.includes("detail 接口已交接给前端验证。"));
  assert.ok(harness.dom.agentsHandoffsList.innerHTML.includes("等页面联调"));
  assert.ok(harness.dom.agentsTimelineSummary.textContent.includes("1 条记录"));
  assert.ok(harness.dom.agentsTimelineList.innerHTML.includes("交接给前端·岚"));
  assert.ok(harness.dom.agentsTimelineList.innerHTML.includes("detail 接口已交接给前端验证。"));
  assert.ok(harness.dom.agentsTimelineList.innerHTML.includes("交接"));
});

test("renderAgentsState 会把 Platform Agents 渲染成纯跳转入口", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      agents: {
        status: "ready",
        errorMessage: "",
        noticeMessage: "",
        loading: false,
        compatibilityStatus: {
          panelOwnership: "platform",
          accessMode: "platform_gateway",
          statusLevel: "warning",
          message: "当前 Platform Agents 页面只是主 Themis 里的独立 Platform 跳转入口。",
          platformBaseUrl: "http://platform.example.com",
          ownerPrincipalId: "principal-platform-owner",
        },
      },
    },
  });

  harness.renderer.renderAgentsState();

  assert.equal(harness.dom.agentsStatusNote.textContent, "当前 Platform Agents 页面只是主 Themis 里的独立 Platform 跳转入口。");
  assert.equal(harness.dom.agentsStatusNote.dataset.state, "warning");
  assert.equal(harness.dom.agentsOpenPlatformLink.href, "http://platform.example.com/?ownerPrincipalId=principal-platform-owner");
  assert.equal(harness.dom.agentsOpenPlatformLink.getAttribute("aria-disabled"), "false");
  assert.match(
    harness.dom.agentsOpenPlatformNote.textContent,
    /当前主 Themis 只保留独立 Platform 页面的跳转入口：http:\/\/platform\.example\.com\/\?ownerPrincipalId=principal-platform-owner/,
  );
  assert.equal(harness.dom.agentsRefreshButton.textContent, "刷新入口状态");
  assert.equal(harness.dom.agentsGovernanceSummaryGrid.innerHTML, "");
  assert.equal(harness.dom.agentsWaitingList.innerHTML, "");
});

test("renderAgentsState 会在 gateway_required 时把 Platform Agents 限制成状态入口", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      agents: {
        status: "ready",
        errorMessage: "",
        noticeMessage: "",
        loading: false,
        compatibilityStatus: {
          panelOwnership: "platform",
          accessMode: "gateway_required",
          statusLevel: "error",
          message: "当前 Platform Agents 兼容入口已经收口为纯 gateway；请先配置 THEMIS_PLATFORM_*，或直接使用独立 themis-platform 页面。",
          platformBaseUrl: "",
          ownerPrincipalId: "principal-platform-owner",
        },
      },
    },
  });

  harness.renderer.renderAgentsState();

  assert.equal(harness.dom.agentsStatusNote.dataset.state, "error");
  assert.equal(harness.dom.agentsOpenPlatformLink.href, "#");
  assert.equal(harness.dom.agentsOpenPlatformLink.getAttribute("aria-disabled"), "true");
  assert.equal(
    harness.dom.agentsOpenPlatformNote.textContent,
    "主 Themis 已不再托管这个平台治理面；请先配置平台 gateway，或直接切到独立 themis-platform 页面。",
  );
  assert.equal(harness.dom.agentsCollaborationList.innerHTML, "");
  assert.equal(harness.dom.agentsSelectedAgentMeta.innerHTML, "");
});

test("renderAgentsState 会在 loading 时更新入口状态和刷新按钮", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      agents: {
        status: "loading",
        errorMessage: "",
        noticeMessage: "",
        loading: true,
        compatibilityStatus: null,
      },
    },
  });

  harness.renderer.renderAgentsState();

  assert.equal(harness.dom.agentsStatusNote.textContent, "正在读取 Platform 兼容入口状态。");
  assert.equal(harness.dom.agentsStatusNote.dataset.state, "loading");
  assert.equal(harness.dom.agentsRefreshButton.disabled, true);
  assert.equal(harness.dom.agentsRefreshButton.textContent, "刷新中...");
  assert.equal(harness.dom.agentsOpenPlatformLink.href, "#");
  assert.equal(harness.dom.agentsOpenPlatformNote.textContent, "已配置平台上游后，这里会给出独立 Platform 页面的直达入口。");
});

test("renderWorkspaceTools 会渲染运营中枢首版视图", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    threadOverrides: {
      title: "发布主线收口",
      serverThreadId: "thread-server-1",
      settings: {
        workspacePath: "/srv/themis",
      },
      turns: [{
        id: "turn-1",
      }],
    },
    runtime: {
      workspaceToolsOpen: true,
      workspaceToolsSection: "operations-center",
      memoryCandidates: {
        status: "ready",
        candidates: [{
          candidateId: "candidate-1",
        }, {
          candidateId: "candidate-2",
        }],
        loading: false,
        filterStatus: "suggested",
        includeArchived: false,
        noticeMessage: "",
        errorMessage: "",
      },
      meetingRooms: {
        accessMode: "platform_gateway",
        platformBaseUrl: "https://platform.example.com",
        ownerPrincipalId: "principal-owner",
        loadingStatus: false,
        loadingRooms: false,
        errorMessage: "",
        noticeMessage: "",
        rooms: [{
          roomId: "room-1",
        }],
      },
      operationsBossView: {
        status: "ready",
        loading: false,
        errorMessage: "",
        noticeMessage: "老板视图已刷新。",
        bossView: {
          principalId: "principal-owner",
          generatedAt: "2026-04-23T18:30:00.000Z",
          headline: {
            tone: "red",
            title: "今天先处理红灯",
            summary: "有 1 个高危未收口风险、1 条阻塞关系，需要先确认 owner。",
          },
          metrics: [{
            key: "open_risks",
            label: "未收口风险",
            value: 1,
            tone: "red",
            detail: "1 个 high / critical。",
          }],
          focusItems: [{
            objectType: "risk",
            objectId: "risk-ledger-1",
            title: "prod-web CPU 突增",
            label: "critical / open",
            tone: "red",
            summary: "关联资产：Themis 官网",
            actionLabel: "确认 owner / 缓解动作",
          }],
          relationItems: [{
            edgeId: "operation-edge-1",
            relationType: "blocks",
            tone: "red",
            label: "风险阻塞发布",
            fromLabel: "prod-web CPU 突增",
            toLabel: "发布窗口",
            summary: "发布前先处理风险。",
          }],
          recentDecisions: [{
            decisionId: "decision-ledger-1",
            title: "当前阶段先叫运营中枢",
            status: "active",
            decidedAt: "2026-04-23T14:10:00.000Z",
            summary: "先收口控制面。",
          }],
        },
      },
      operationsAssets: {
        status: "ready",
        loading: false,
        submitting: false,
        filterStatus: "active",
        selectedAssetId: "",
        noticeMessage: "",
        errorMessage: "",
        draft: {
          kind: "site",
          name: "",
          status: "active",
          ownerPrincipalId: "",
          summary: "",
          tagsText: "",
          refsText: "",
        },
        assets: [{
          assetId: "asset-ledger-1",
          principalId: "principal-owner",
          kind: "site",
          name: "Themis 官网",
          status: "active",
          tags: ["官网"],
          refs: [{
            kind: "domain",
            value: "themis.example.com",
          }],
        }],
      },
      operationsCadences: {
        status: "ready",
        loading: false,
        submitting: false,
        filterStatus: "active",
        selectedCadenceId: "",
        noticeMessage: "",
        errorMessage: "",
        draft: {
          title: "",
          frequency: "weekly",
          status: "active",
          nextRunAt: "",
          ownerPrincipalId: "",
          playbookRef: "",
          relatedAssetIdsText: "",
          summary: "",
        },
        cadences: [{
          cadenceId: "cadence-ledger-1",
          principalId: "principal-owner",
          title: "prod-web 周检",
          frequency: "weekly",
          status: "active",
          nextRunAt: "2026-04-28T01:00:00.000Z",
          ownerPrincipalId: "principal-owner",
          playbookRef: "docs/runbooks/prod-web-weekly-check.md",
          relatedAssetIds: ["asset-ledger-1"],
        }],
      },
      operationsCommitments: {
        status: "ready",
        loading: false,
        submitting: false,
        filterStatus: "active",
        selectedCommitmentId: "",
        noticeMessage: "",
        errorMessage: "",
        draft: {
          title: "",
          status: "active",
          progressPercentText: "0",
          ownerPrincipalId: "",
          startsAt: "",
          dueAt: "",
          relatedAssetIdsText: "",
          linkedDecisionIdsText: "",
          linkedRiskIdsText: "",
          relatedCadenceIdsText: "",
          relatedWorkItemIdsText: "",
          milestonesText: "",
          evidenceRefsText: "",
          summary: "",
        },
        commitments: [{
          commitmentId: "commitment-ledger-1",
          principalId: "principal-owner",
          title: "Q2 发布主线必须收口",
          status: "active",
          ownerPrincipalId: "principal-owner",
          startsAt: "2026-04-01T00:00:00.000Z",
          dueAt: "2026-06-30T23:59:00.000Z",
          progressPercent: 42,
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
        }],
      },
      operationsDecisions: {
        status: "ready",
        loading: false,
        submitting: false,
        filterStatus: "active",
        selectedDecisionId: "",
        noticeMessage: "",
        errorMessage: "",
        draft: {
          title: "",
          status: "active",
          decidedByPrincipalId: "",
          decidedAt: "",
          relatedAssetIdsText: "",
          relatedWorkItemIdsText: "",
          summary: "",
        },
        decisions: [{
          decisionId: "decision-ledger-1",
          principalId: "principal-owner",
          title: "当前阶段先叫运营中枢",
          status: "active",
          decidedAt: "2026-04-23T14:10:00.000Z",
          relatedAssetIds: ["asset-ledger-1"],
          relatedWorkItemIds: ["work-item-1"],
        }],
      },
      operationsEdges: {
        status: "ready",
        loading: false,
        submitting: false,
        filterStatus: "active",
        selectedEdgeId: "",
        noticeMessage: "",
        errorMessage: "",
        draft: {
          fromObjectType: "decision",
          fromObjectId: "",
          toObjectType: "risk",
          toObjectId: "",
          relationType: "relates_to",
          status: "active",
          label: "",
          summary: "",
        },
        edges: [{
          edgeId: "operation-edge-1",
          principalId: "principal-owner",
          fromObjectType: "decision",
          fromObjectId: "decision-ledger-1",
          toObjectType: "risk",
          toObjectId: "risk-ledger-1",
          relationType: "mitigates",
          status: "active",
          label: "先降级风险",
        }],
      },
      operationsRisks: {
        status: "ready",
        loading: false,
        submitting: false,
        filterStatus: "open",
        selectedRiskId: "",
        noticeMessage: "",
        errorMessage: "",
        draft: {
          type: "risk",
          title: "",
          severity: "medium",
          status: "open",
          ownerPrincipalId: "",
          detectedAt: "",
          relatedAssetIdsText: "",
          linkedDecisionIdsText: "",
          relatedWorkItemIdsText: "",
          summary: "",
        },
        risks: [{
          riskId: "risk-ledger-1",
          principalId: "principal-owner",
          type: "incident",
          title: "prod-web CPU 突增",
          severity: "critical",
          status: "open",
          detectedAt: "2026-04-23T16:00:00.000Z",
          relatedAssetIds: ["asset-ledger-1"],
          linkedDecisionIds: ["decision-ledger-1"],
          relatedWorkItemIds: ["work-item-1"],
        }],
      },
    },
  });

  harness.renderer.renderOperationsCenterState();

  assert.match(harness.dom.operationsCenterFoundationGrid.innerHTML, /执行闭环/);
  assert.match(harness.dom.operationsCenterNextGrid.innerHTML, /Asset/);
  assert.match(harness.dom.operationsCenterLiveGrid.innerHTML, /发布主线收口/);
  assert.match(harness.dom.operationsCenterLiveGrid.innerHTML, /平台 gateway/);
  assert.match(harness.dom.operationsCenterLiveGrid.innerHTML, /老板视图/);
  assert.match(harness.dom.operationsCenterLiveGrid.innerHTML, /今天先处理红灯/);
  assert.match(harness.dom.operationsCenterLiveGrid.innerHTML, /资产台账/);
  assert.match(harness.dom.operationsCenterLiveGrid.innerHTML, /节奏记录/);
  assert.match(harness.dom.operationsCenterLiveGrid.innerHTML, /承诺目标/);
  assert.match(harness.dom.operationsCenterLiveGrid.innerHTML, /决策记录/);
  assert.match(harness.dom.operationsCenterLiveGrid.innerHTML, /关系边/);
  assert.match(harness.dom.operationsCenterLiveGrid.innerHTML, /对象图查询/);
  assert.match(harness.dom.operationsCenterLiveGrid.innerHTML, /风险 \/ 事故/);
  assert.equal(
    harness.dom.operationsCenterPlatformLink.href,
    "https://platform.example.com/?ownerPrincipalId=principal-owner",
  );
  assert.match(harness.dom.operationsCenterStatusNote.textContent, /老板视图、最小资产台账、节奏记录、承诺目标、决策记录、风险卡、关系边和对象图查询/);
});

test("renderOperationsBossViewState 会渲染老板视图经营晨报", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      operationsBossView: {
        status: "ready",
        loading: false,
        errorMessage: "",
        noticeMessage: "老板视图已刷新。",
        bossView: {
          principalId: "principal-owner",
          generatedAt: "2026-04-23T18:30:00.000Z",
          headline: {
            tone: "red",
            title: "今天先处理红灯",
            summary: "有 1 个高危未收口风险。",
          },
          metrics: [{
            key: "open_risks",
            label: "未收口风险",
            value: 1,
            tone: "red",
            detail: "1 个 high / critical。",
          }],
          focusItems: [{
            objectType: "risk",
            objectId: "risk-ledger-1",
            title: "prod-web CPU 突增",
            label: "critical / open",
            tone: "red",
            summary: "关联资产：prod-web",
            actionLabel: "确认 owner / 缓解动作",
          }],
          relationItems: [{
            edgeId: "operation-edge-1",
            relationType: "blocks",
            tone: "red",
            label: "风险阻塞发布",
            fromLabel: "prod-web CPU 突增",
            toLabel: "发布窗口",
            summary: "发布前先处理风险。",
          }],
          recentDecisions: [{
            decisionId: "decision-ledger-1",
            title: "先冻结发布窗口",
            status: "active",
            decidedAt: "2026-04-23T14:10:00.000Z",
            summary: "风险未收口前不继续发布。",
          }],
        },
      },
    },
  });

  harness.renderer.renderOperationsBossViewState();

  assert.match(harness.dom.operationsBossViewHeadline.innerHTML, /今天先处理红灯/);
  assert.match(harness.dom.operationsBossViewMetrics.innerHTML, /未收口风险/);
  assert.match(harness.dom.operationsBossViewFocusList.innerHTML, /prod-web CPU 突增/);
  assert.match(harness.dom.operationsBossViewRelationsList.innerHTML, /风险阻塞发布/);
  assert.match(harness.dom.operationsBossViewDecisionsList.innerHTML, /先冻结发布窗口/);
  assert.equal(harness.dom.operationsBossViewRefreshButton.textContent, "刷新老板视图");
  assert.match(harness.dom.operationsBossViewStatusNote.textContent, /老板视图已刷新/);
});

test("renderOperationsAssetsState 会渲染资产台账列表和编辑草稿", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      operationsAssets: {
        status: "ready",
        loading: false,
        submitting: false,
        filterStatus: "watch",
        selectedAssetId: "asset-ledger-1",
        noticeMessage: "已更新资产台账。",
        errorMessage: "",
        draft: {
          kind: "database",
          name: "订单库",
          status: "watch",
          ownerPrincipalId: "principal-db",
          summary: "核心订单主库",
          tagsText: "生产, 核心",
          refsText: "host:10.0.0.12",
        },
        assets: [{
          assetId: "asset-ledger-1",
          principalId: "principal-owner",
          kind: "database",
          name: "订单库",
          status: "watch",
          ownerPrincipalId: "principal-db",
          summary: "核心订单主库",
          tags: ["生产", "核心"],
          refs: [{
            kind: "host",
            value: "10.0.0.12",
          }],
        }],
      },
      operationsEdges: {
        status: "ready",
        loading: false,
        submitting: false,
        filterStatus: "active",
        selectedEdgeId: "",
        noticeMessage: "",
        errorMessage: "",
        draft: {
          fromObjectType: "decision",
          fromObjectId: "",
          toObjectType: "risk",
          toObjectId: "",
          relationType: "relates_to",
          status: "active",
          label: "",
          summary: "",
        },
        edges: [{
          edgeId: "operation-edge-auto-asset",
          principalId: "principal-owner",
          fromObjectType: "cadence",
          fromObjectId: "cadence-ledger-1",
          toObjectType: "asset",
          toObjectId: "asset-ledger-1",
          relationType: "tracks",
          status: "active",
          label: "节奏跟踪资产",
        }, {
          edgeId: "operation-edge-impact-asset",
          principalId: "principal-owner",
          fromObjectType: "cadence",
          fromObjectId: "cadence-ledger-1",
          toObjectType: "commitment",
          toObjectId: "commitment-ledger-1",
          relationType: "tracks",
          status: "active",
          label: "节奏跟踪承诺",
        }],
      },
    },
  });

  harness.renderer.renderOperationsAssetsState();

  assert.equal(harness.dom.operationsAssetsFilterSelect.value, "watch");
  assert.equal(harness.dom.operationsAssetsFormTitle.textContent, "编辑资产：订单库");
  assert.equal(harness.dom.operationsAssetsKindSelect.value, "database");
  assert.equal(harness.dom.operationsAssetsNameInput.value, "订单库");
  assert.equal(harness.dom.operationsAssetsStatusSelect.value, "watch");
  assert.equal(harness.dom.operationsAssetsSaveButton.textContent, "更新资产");
  assert.match(harness.dom.operationsAssetsList.innerHTML, /订单库/);
  assert.match(harness.dom.operationsAssetsList.innerHTML, /对象反链/);
  assert.match(harness.dom.operationsAssetsList.innerHTML, /节奏跟踪资产/);
  assert.match(harness.dom.operationsAssetsList.innerHTML, /影响范围/);
  assert.match(harness.dom.operationsAssetsList.innerHTML, /一跳 1 个 \/ 二跳 1 个/);
  assert.match(harness.dom.operationsAssetsList.innerHTML, /commitment:commitment-ledger-1/);
  assert.match(harness.dom.operationsAssetsStatusNote.textContent, /已更新资产台账/);
});

test("renderOperationsDecisionsState 会渲染决策记录列表和编辑草稿", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      operationsDecisions: {
        status: "ready",
        loading: false,
        submitting: false,
        filterStatus: "superseded",
        selectedDecisionId: "decision-ledger-1",
        noticeMessage: "已更新决策记录。",
        errorMessage: "",
        draft: {
          title: "先做运营中枢，数字公司操作系统作为最终形态",
          status: "superseded",
          decidedByPrincipalId: "principal-owner",
          decidedAt: "2026-04-23T14:20:00.000Z",
          relatedAssetIdsText: "asset-ledger-1\nasset-ledger-2",
          relatedWorkItemIdsText: "work-item-1",
          summary: "当前先收口产品定位和真实对象边界",
        },
        decisions: [{
          decisionId: "decision-ledger-1",
          principalId: "principal-owner",
          title: "先做运营中枢，数字公司操作系统作为最终形态",
          status: "superseded",
          decidedByPrincipalId: "principal-owner",
          decidedAt: "2026-04-23T14:20:00.000Z",
          relatedAssetIds: ["asset-ledger-1", "asset-ledger-2"],
          relatedWorkItemIds: ["work-item-1"],
          summary: "当前先收口产品定位和真实对象边界",
        }],
      },
    },
  });

  harness.renderer.renderOperationsDecisionsState();

  assert.equal(harness.dom.operationsDecisionsFilterSelect.value, "superseded");
  assert.equal(
    harness.dom.operationsDecisionsFormTitle.textContent,
    "编辑决策：先做运营中枢，数字公司操作系统作为最终形态",
  );
  assert.equal(
    harness.dom.operationsDecisionsTitleInput.value,
    "先做运营中枢，数字公司操作系统作为最终形态",
  );
  assert.equal(harness.dom.operationsDecisionsStatusSelect.value, "superseded");
  assert.equal(harness.dom.operationsDecisionsSaveButton.textContent, "更新决策");
  assert.match(harness.dom.operationsDecisionsList.innerHTML, /Decision/);
  assert.match(harness.dom.operationsDecisionsList.innerHTML, /asset-ledger-1/);
  assert.match(harness.dom.operationsDecisionsStatusNote.textContent, /已更新决策记录/);
});

test("renderOperationsCadencesState 会渲染节奏记录列表和编辑草稿", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      operationsCadences: {
        status: "ready",
        loading: false,
        submitting: false,
        filterStatus: "paused",
        selectedCadenceId: "cadence-ledger-1",
        noticeMessage: "已更新节奏。",
        errorMessage: "",
        draft: {
          title: "账单月检",
          frequency: "monthly",
          status: "paused",
          nextRunAt: "2026-05-01T01:00:00.000Z",
          ownerPrincipalId: "principal-finance",
          playbookRef: "docs/runbooks/monthly-billing-review.md",
          relatedAssetIdsText: "asset-ledger-1\nasset-ledger-2",
          summary: "月初复盘云资源账单和续费提醒",
        },
        cadences: [{
          cadenceId: "cadence-ledger-1",
          principalId: "principal-owner",
          title: "账单月检",
          frequency: "monthly",
          status: "paused",
          nextRunAt: "2026-05-01T01:00:00.000Z",
          ownerPrincipalId: "principal-finance",
          playbookRef: "docs/runbooks/monthly-billing-review.md",
          relatedAssetIds: ["asset-ledger-1", "asset-ledger-2"],
          summary: "月初复盘云资源账单和续费提醒",
        }],
      },
    },
  });

  harness.renderer.renderOperationsCadencesState();

  assert.equal(harness.dom.operationsCadencesFilterSelect.value, "paused");
  assert.equal(harness.dom.operationsCadencesFormTitle.textContent, "编辑节奏：账单月检");
  assert.equal(harness.dom.operationsCadencesFrequencySelect.value, "monthly");
  assert.equal(harness.dom.operationsCadencesStatusSelect.value, "paused");
  assert.equal(harness.dom.operationsCadencesSaveButton.textContent, "更新节奏");
  assert.match(harness.dom.operationsCadencesList.innerHTML, /Playbook: docs\/runbooks\/monthly-billing-review.md/);
  assert.match(harness.dom.operationsCadencesStatusNote.textContent, /已更新节奏/);
});

test("renderOperationsCommitmentsState 会渲染承诺目标列表和编辑草稿", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      operationsCommitments: {
        status: "ready",
        loading: false,
        submitting: false,
        filterStatus: "at_risk",
        selectedCommitmentId: "commitment-ledger-1",
        noticeMessage: "已更新承诺。",
        errorMessage: "",
        draft: {
          title: "Q2 发布主线进入风险跟踪",
          status: "at_risk",
          progressPercentText: "68",
          ownerPrincipalId: "principal-owner",
          startsAt: "2026-04-01T00:00:00.000Z",
          dueAt: "2026-07-15T23:59:00.000Z",
          relatedAssetIdsText: "asset-ledger-1\nasset-ledger-2",
          linkedDecisionIdsText: "decision-ledger-1",
          linkedRiskIdsText: "risk-ledger-1",
          relatedCadenceIdsText: "cadence-ledger-1",
          relatedWorkItemIdsText: "work-item-1",
          milestonesText: "done | 内测验收 | 2026-05-15T23:59:00.000Z | 2026-05-14T10:00:00.000Z | 已完成",
          evidenceRefsText: "work_item | work-item-evidence-1 | 验收任务",
          summary: "当前最大风险是发布窗口被事故阻塞",
        },
        commitments: [{
          commitmentId: "commitment-ledger-1",
          principalId: "principal-owner",
          title: "Q2 发布主线进入风险跟踪",
          status: "at_risk",
          ownerPrincipalId: "principal-owner",
          startsAt: "2026-04-01T00:00:00.000Z",
          dueAt: "2026-07-15T23:59:00.000Z",
          progressPercent: 68,
          milestones: [{
            title: "内测验收",
            status: "done",
            dueAt: "2026-05-15T23:59:00.000Z",
            completedAt: "2026-05-14T10:00:00.000Z",
            summary: "已完成",
            evidenceRefs: [],
          }],
          evidenceRefs: [{ kind: "work_item", value: "work-item-evidence-1", label: "验收任务" }],
          relatedAssetIds: ["asset-ledger-1", "asset-ledger-2"],
          linkedDecisionIds: ["decision-ledger-1"],
          linkedRiskIds: ["risk-ledger-1"],
          relatedCadenceIds: ["cadence-ledger-1"],
          relatedWorkItemIds: ["work-item-1"],
          summary: "当前最大风险是发布窗口被事故阻塞",
        }],
      },
      operationsEdges: {
        status: "ready",
        loading: false,
        submitting: false,
        filterStatus: "active",
        selectedEdgeId: "",
        noticeMessage: "",
        errorMessage: "",
        draft: {
          fromObjectType: "decision",
          fromObjectId: "",
          toObjectType: "risk",
          toObjectId: "",
          relationType: "relates_to",
          status: "active",
          label: "",
          summary: "",
        },
        edges: [{
          edgeId: "operation-edge-auto-commitment",
          principalId: "principal-owner",
          fromObjectType: "risk",
          fromObjectId: "risk-ledger-1",
          toObjectType: "commitment",
          toObjectId: "commitment-ledger-1",
          relationType: "blocks",
          status: "active",
          label: "风险阻塞承诺",
        }, {
          edgeId: "operation-edge-impact-commitment",
          principalId: "principal-owner",
          fromObjectType: "risk",
          fromObjectId: "risk-ledger-1",
          toObjectType: "asset",
          toObjectId: "asset-ledger-9",
          relationType: "relates_to",
          status: "active",
          label: "风险关联资产",
        }],
      },
    },
  });

  harness.renderer.renderOperationsCommitmentsState();

  assert.equal(harness.dom.operationsCommitmentsFilterSelect.value, "at_risk");
  assert.equal(harness.dom.operationsCommitmentsFormTitle.textContent, "编辑承诺：Q2 发布主线进入风险跟踪");
  assert.equal(harness.dom.operationsCommitmentsTitleInput.value, "Q2 发布主线进入风险跟踪");
  assert.equal(harness.dom.operationsCommitmentsStatusSelect.value, "at_risk");
  assert.equal(harness.dom.operationsCommitmentsProgressInput.value, "68");
  assert.match(harness.dom.operationsCommitmentsMilestonesInput.value, /内测验收/);
  assert.match(harness.dom.operationsCommitmentsEvidenceRefsInput.value, /work-item-evidence-1/);
  assert.equal(harness.dom.operationsCommitmentsSaveButton.textContent, "更新承诺");
  assert.match(harness.dom.operationsCommitmentsList.innerHTML, /Commitment/);
  assert.match(harness.dom.operationsCommitmentsList.innerHTML, /进度：68%/);
  assert.match(harness.dom.operationsCommitmentsList.innerHTML, /里程碑/);
  assert.match(harness.dom.operationsCommitmentsList.innerHTML, /证据/);
  assert.match(harness.dom.operationsCommitmentsList.innerHTML, /Risk: risk-ledger-1/);
  assert.match(harness.dom.operationsCommitmentsList.innerHTML, /对象反链/);
  assert.match(harness.dom.operationsCommitmentsList.innerHTML, /风险阻塞承诺/);
  assert.match(harness.dom.operationsCommitmentsList.innerHTML, /影响范围/);
  assert.match(harness.dom.operationsCommitmentsList.innerHTML, /asset:asset-ledger-9/);
  assert.match(harness.dom.operationsCommitmentsStatusNote.textContent, /已更新承诺/);
});

test("renderOperationsEdgesState 会渲染关系边列表和编辑草稿", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      operationsEdges: {
        status: "ready",
        loading: false,
        submitting: false,
        filterStatus: "active",
        selectedEdgeId: "operation-edge-1",
        noticeMessage: "已更新关系边。",
        errorMessage: "",
        draft: {
          fromObjectType: "decision",
          fromObjectId: "decision-ledger-1",
          toObjectType: "risk",
          toObjectId: "risk-ledger-1",
          relationType: "mitigates",
          status: "active",
          label: "先降级风险",
          summary: "该决策用于降低支付风险",
        },
        edges: [{
          edgeId: "operation-edge-1",
          principalId: "principal-owner",
          fromObjectType: "decision",
          fromObjectId: "decision-ledger-1",
          toObjectType: "risk",
          toObjectId: "risk-ledger-1",
          relationType: "mitigates",
          status: "active",
          label: "先降级风险",
          summary: "该决策用于降低支付风险",
        }],
      },
    },
  });

  harness.renderer.renderOperationsEdgesState();

  assert.equal(harness.dom.operationsEdgesFilterSelect.value, "active");
  assert.equal(harness.dom.operationsEdgesFormTitle.textContent, "编辑关系：先降级风险");
  assert.equal(harness.dom.operationsEdgesFromTypeSelect.value, "decision");
  assert.equal(harness.dom.operationsEdgesToTypeSelect.value, "risk");
  assert.equal(harness.dom.operationsEdgesRelationSelect.value, "mitigates");
  assert.equal(harness.dom.operationsEdgesSaveButton.textContent, "更新关系");
  assert.match(harness.dom.operationsEdgesList.innerHTML, /先降级风险/);
  assert.match(harness.dom.operationsEdgesList.innerHTML, /mitigates/);
  assert.match(harness.dom.operationsEdgesStatusNote.textContent, /已更新关系边/);
});

test("renderOperationsGraphState 会渲染对象图查询结果和草稿", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      operationsGraph: {
        status: "ready",
        loading: false,
        errorMessage: "",
        noticeMessage: "对象图已刷新。",
        rootObjectType: "commitment",
        rootObjectId: "commitment-ledger-1",
        targetObjectType: "asset",
        targetObjectId: "asset-ledger-1",
        maxDepth: "2",
        graph: {
          principalId: "principal-owner",
          generatedAt: "2026-04-23T20:30:00.000Z",
          maxDepth: 2,
          root: { objectType: "commitment", objectId: "commitment-ledger-1" },
          target: { objectType: "asset", objectId: "asset-ledger-1", reachable: true },
          nodes: [{
            objectType: "commitment",
            objectId: "commitment-ledger-1",
            depth: 0,
          }, {
            objectType: "risk",
            objectId: "risk-ledger-1",
            depth: 1,
            viaEdgeId: "operation-edge-1",
            viaObjectType: "commitment",
            viaObjectId: "commitment-ledger-1",
          }, {
            objectType: "asset",
            objectId: "asset-ledger-1",
            depth: 2,
            viaEdgeId: "operation-edge-2",
            viaObjectType: "risk",
            viaObjectId: "risk-ledger-1",
          }],
          edges: [{
            edgeId: "operation-edge-1",
            fromObjectType: "risk",
            fromObjectId: "risk-ledger-1",
            toObjectType: "commitment",
            toObjectId: "commitment-ledger-1",
            relationType: "blocks",
            status: "active",
            label: "风险阻塞承诺",
          }, {
            edgeId: "operation-edge-2",
            fromObjectType: "risk",
            fromObjectId: "risk-ledger-1",
            toObjectType: "asset",
            toObjectId: "asset-ledger-1",
            relationType: "relates_to",
            status: "active",
            label: "风险关联资产",
          }],
          shortestPath: [{
            edgeId: "operation-edge-1",
            fromObjectType: "risk",
            fromObjectId: "risk-ledger-1",
            toObjectType: "commitment",
            toObjectId: "commitment-ledger-1",
            relationType: "blocks",
            status: "active",
            label: "风险阻塞承诺",
          }, {
            edgeId: "operation-edge-2",
            fromObjectType: "risk",
            fromObjectId: "risk-ledger-1",
            toObjectType: "asset",
            toObjectId: "asset-ledger-1",
            relationType: "relates_to",
            status: "active",
            label: "风险关联资产",
          }],
        },
      },
    },
  });

  harness.renderer.renderOperationsGraphState();

  assert.equal(harness.dom.operationsGraphRootTypeSelect.value, "commitment");
  assert.equal(harness.dom.operationsGraphRootIdInput.value, "commitment-ledger-1");
  assert.equal(harness.dom.operationsGraphTargetTypeSelect.value, "asset");
  assert.equal(harness.dom.operationsGraphTargetIdInput.value, "asset-ledger-1");
  assert.equal(harness.dom.operationsGraphDepthSelect.value, "2");
  assert.equal(harness.dom.operationsGraphRefreshButton.textContent, "查询对象图");
  assert.match(harness.dom.operationsGraphSummary.innerHTML, /节点 3 个 \/ 边 2 条/);
  assert.match(harness.dom.operationsGraphNodes.innerHTML, /depth 2/);
  assert.match(harness.dom.operationsGraphNodes.innerHTML, /asset:asset-ledger-1/);
  assert.match(harness.dom.operationsGraphEdges.innerHTML, /blocks/);
  assert.match(harness.dom.operationsGraphEdges.innerHTML, /风险关联资产/);
  assert.match(harness.dom.operationsGraphPath.innerHTML, /风险阻塞承诺/);
  assert.match(harness.dom.operationsGraphStatusNote.textContent, /对象图已刷新/);
});

test("renderOperationsRisksState 会渲染风险记录列表和编辑草稿", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      operationsRisks: {
        status: "ready",
        loading: false,
        submitting: false,
        filterStatus: "watch",
        selectedRiskId: "risk-ledger-1",
        noticeMessage: "已更新风险记录。",
        errorMessage: "",
        draft: {
          type: "incident",
          title: "支付回调失败",
          severity: "critical",
          status: "watch",
          ownerPrincipalId: "principal-pay",
          detectedAt: "2026-04-23T16:20:00.000Z",
          relatedAssetIdsText: "asset-ledger-2",
          linkedDecisionIdsText: "decision-ledger-3",
          relatedWorkItemIdsText: "work-item-3",
          summary: "导致订单未自动确认",
        },
        risks: [{
          riskId: "risk-ledger-1",
          principalId: "principal-owner",
          type: "incident",
          title: "支付回调失败",
          severity: "critical",
          status: "watch",
          ownerPrincipalId: "principal-pay",
          detectedAt: "2026-04-23T16:20:00.000Z",
          relatedAssetIds: ["asset-ledger-2"],
          linkedDecisionIds: ["decision-ledger-3"],
          relatedWorkItemIds: ["work-item-3"],
          summary: "导致订单未自动确认",
        }],
      },
    },
  });

  harness.renderer.renderOperationsRisksState();

  assert.equal(harness.dom.operationsRisksFilterSelect.value, "watch");
  assert.equal(harness.dom.operationsRisksFormTitle.textContent, "编辑风险：支付回调失败");
  assert.equal(harness.dom.operationsRisksTypeSelect.value, "incident");
  assert.equal(harness.dom.operationsRisksSeveritySelect.value, "critical");
  assert.equal(harness.dom.operationsRisksStatusSelect.value, "watch");
  assert.equal(harness.dom.operationsRisksSaveButton.textContent, "更新风险");
  assert.match(harness.dom.operationsRisksList.innerHTML, /Decision: decision-ledger-3/);
  assert.match(harness.dom.operationsRisksStatusNote.textContent, /已更新风险记录/);
});

test("renderMeetingRoomsState 会渲染内部会议室列表和当前房间消息流", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      workspaceToolsSection: "meeting-rooms",
      meetingRooms: {
        accessMode: "platform_gateway",
        platformBaseUrl: "https://platform.example.com",
        ownerPrincipalId: "principal-owner",
        loadingStatus: false,
        loadingRooms: false,
        creating: false,
        streaming: false,
        errorMessage: "",
        noticeMessage: "",
        rooms: [{
          roomId: "room-1",
          title: "发布阻塞讨论",
          goal: "找根因",
          status: "open",
          discussionMode: "moderated",
        }],
        activeRoomId: "room-1",
        activeRoom: {
          room: {
            roomId: "room-1",
            title: "发布阻塞讨论",
            goal: "找根因",
            status: "open",
            discussionMode: "moderated",
          },
          participants: [{
            participantId: "participant-agent-1",
            roomId: "room-1",
            participantKind: "managed_agent",
            agentId: "agent-1",
            displayName: "后端·衡",
            entryMode: "active_work_context",
          }],
          messages: [{
            messageId: "message-1",
            roomId: "room-1",
            speakerType: "themis",
            content: "先给出根因判断。",
            messageKind: "message",
          }, {
            messageId: "message-2",
            roomId: "room-1",
            speakerType: "system",
            audience: "themis_only",
            content: "这条异常信息只对 Themis 可见。",
            messageKind: "error",
          }],
          rounds: [{
            roundId: "round-1",
            status: "running",
            targetParticipantIds: ["participant-agent-1"],
            respondedParticipantIds: [],
          }],
          resolutions: [{
            resolutionId: "resolution-1",
            roomId: "room-1",
            sourceMessageIds: ["message-1"],
            title: "补 migration 重试",
            summary: "先补重试和告警，再重新发版。",
            status: "promoted",
            promotedWorkItemId: "work-item-1",
          }],
          artifactRefs: [],
        },
        createDraft: {
          title: "发布阻塞讨论",
          goal: "找根因",
          discussionMode: "moderated",
          participantSpecsText: "agent-1:active_work_context",
        },
        selectedTargetParticipantIds: ["participant-agent-1"],
        selectedResolutionSourceMessageIds: ["message-1"],
        resolutionDraft: {
          title: "补 migration 重试",
          summary: "先补重试和告警，再重新发版。",
        },
        resolutionPromotionTargetAgentIds: {
          "resolution-1": "agent-1",
        },
        closingSummaryText: "已形成正式执行项，本次会议到此收口。",
        addParticipantsText: "agent-qa:blank",
        composerText: "",
      },
    },
  });

  harness.renderer.renderMeetingRoomsState();

  assert.equal(harness.dom.meetingRoomsStatusNote.textContent, "平台会议室已就绪。");
  assert.equal(harness.dom.meetingRoomsActiveTitle.textContent, "发布阻塞讨论");
  assert.match(harness.dom.meetingRoomsList.innerHTML, /发布阻塞讨论/);
  assert.match(harness.dom.meetingRoomsList.innerHTML, /主持模式/);
  assert.match(harness.dom.meetingRoomsActiveMeta.innerHTML, /讨论模式/);
  assert.match(harness.dom.meetingRoomsParticipantsList.innerHTML, /带当前工作上下文/);
  assert.match(harness.dom.meetingRoomsRoundsSummary.innerHTML, /进行中/);
  assert.match(harness.dom.meetingRoomsActiveMessages.innerHTML, /先给出根因判断/);
  assert.match(harness.dom.meetingRoomsActiveMessages.innerHTML, /仅 Themis 可见/);
  assert.match(harness.dom.meetingRoomsTargetParticipantsList.innerHTML, /后端·衡/);
  assert.match(harness.dom.meetingRoomsResolutionSelectionNote.textContent, /已选 1 条消息/);
  assert.match(harness.dom.meetingRoomsResolutionsList.innerHTML, /补 migration 重试/);
  assert.match(harness.dom.meetingRoomsResolutionsList.innerHTML, /work-item-1/);
  assert.equal(harness.dom.meetingRoomsCreateResolutionButton.disabled, false);
  assert.equal(harness.dom.meetingRoomsCloseButton.disabled, false);
});

test("renderMeetingRoomsState 会在关闭态把结论和收口动作切成只读", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      meetingRooms: {
        accessMode: "platform_gateway",
        ownerPrincipalId: "principal-owner",
        rooms: [{
          roomId: "room-1",
          organizationId: "org-1",
          title: "发布阻塞讨论",
          goal: "找根因",
          status: "closed",
          discussionMode: "moderated",
        }],
        activeRoomId: "room-1",
        activeRoom: {
          room: {
            roomId: "room-1",
            organizationId: "org-1",
            title: "发布阻塞讨论",
            goal: "找根因",
            status: "closed",
            discussionMode: "moderated",
            closingSummary: "已形成正式执行项，本次会议到此收口。",
          },
          participants: [{
            participantId: "participant-agent-1",
            roomId: "room-1",
            participantKind: "managed_agent",
            agentId: "agent-1",
            displayName: "后端·衡",
            entryMode: "blank",
          }],
          messages: [],
          rounds: [],
          resolutions: [{
            resolutionId: "resolution-1",
            roomId: "room-1",
            sourceMessageIds: ["message-1"],
            title: "补 migration 重试",
            summary: "先补重试和告警，再重新发版。",
            status: "promoted",
            promotedWorkItemId: "work-item-1",
          }],
          artifactRefs: [],
        },
        resolutionDraft: {
          title: "补 migration 重试",
          summary: "先补重试和告警，再重新发版。",
        },
        closingSummaryText: "已形成正式执行项，本次会议到此收口。",
      },
    },
  });

  harness.renderer.renderMeetingRoomsState();

  assert.equal(harness.dom.meetingRoomsCreateResolutionButton.disabled, true);
  assert.equal(harness.dom.meetingRoomsCloseSummaryInput.disabled, true);
  assert.equal(harness.dom.meetingRoomsCloseButton.disabled, true);
  assert.match(harness.dom.meetingRoomsActiveMeta.innerHTML, /收口说明/);
});

test("renderMeetingRoomsState 会在 terminated 态展示平台终止信息并保持只读", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: { enabled: false, reason: "" },
      steer: { enabled: false, reason: "" },
    },
    runtime: {
      meetingRooms: {
        accessMode: "platform_gateway",
        ownerPrincipalId: "principal-owner",
        rooms: [{
          roomId: "room-1",
          organizationId: "org-1",
          title: "发布阻塞讨论",
          goal: "找根因",
          status: "terminated",
          discussionMode: "moderated",
          terminationReason: "平台值班判断当前讨论进入异常循环。",
        }],
        activeRoomId: "room-1",
        activeRoom: {
          room: {
            roomId: "room-1",
            organizationId: "org-1",
            title: "发布阻塞讨论",
            goal: "找根因",
            status: "terminated",
            discussionMode: "moderated",
            terminationReason: "平台值班判断当前讨论进入异常循环。",
            terminatedByOperatorPrincipalId: "principal-owner",
          },
          participants: [{
            participantId: "participant-agent-1",
            roomId: "room-1",
            participantKind: "managed_agent",
            agentId: "agent-1",
            displayName: "后端·衡",
            entryMode: "blank",
          }],
          messages: [],
          rounds: [],
          resolutions: [],
          artifactRefs: [],
        },
        closingSummaryText: "不应再使用正常关闭输入框。",
      },
    },
  });

  harness.renderer.renderMeetingRoomsState();

  assert.equal(harness.dom.meetingRoomsStatusNote.textContent, "当前会议室已被平台终止，只读回看。");
  assert.equal(harness.dom.meetingRoomsCreateResolutionButton.disabled, true);
  assert.equal(harness.dom.meetingRoomsCloseSummaryInput.disabled, true);
  assert.equal(harness.dom.meetingRoomsCloseButton.disabled, true);
  assert.equal(harness.dom.meetingRoomsSendButton.disabled, true);
  assert.match(harness.dom.meetingRoomsActiveMeta.innerHTML, /终止原因/);
});

function createHarness({ actionBarState, threadControlState = null, runtime = {}, threadOverrides = {} }) {
  const thread = {
    id: "thread-composer",
    title: "Composer 线程",
    composerMode: actionBarState.mode,
    serverThreadId: threadControlState?.details?.find((item) => item.label === "serverThreadId")?.value || "",
    settings: {},
    draftInputAssets: [],
    turns: [],
    historyHydrated: true,
    storedTurnCount: 0,
    storedSummary: "",
    storedStatus: null,
    historyNeedsRehydrate: false,
    ...threadOverrides,
  };

  const dom = {
    goalInput: createInputStub(),
    submitButton: createTextStub(),
    composerActionBar: createTextStub(),
    composerInputAssetsList: createTextStub(),
    composerAuthNote: createTextStub(),
    conversation: createTextStub(),
    emptyThreadMarkup: "<div>empty-thread</div>",
    threadControlPanel: createPanelStub(),
    threadControlStatus: createTextStub(),
    threadControlConversationId: createTextStub(),
    threadControlSource: createTextStub(),
    threadControlDetails: createDetailsStub(),
    threadControlDetailsBody: createTextStub(),
    threadControlJoinHint: createTextStub(),
    threadControlJoinToggle: createButtonStub(),
    threadControlJoinPanel: createPanelStub(true),
    conversationLinkInput: createDisabledInputStub(),
    conversationLinkButton: createButtonStub(),
    conversationLinkNote: createTextStub(),
    forkThreadButton: createButtonStub(),
    resetPrincipalButton: createButtonStub(),
    newThreadButton: createButtonStub(),
    workspaceToolsToggle: createButtonStub(),
    workspaceToolsClose: createButtonStub(),
    workspaceToolsPanel: createPanelStub(true),
    workspaceToolsNavButtons: [],
    settingsOperationsCenterSection: createPanelStub(true),
    settingsRuntimeSection: createPanelStub(),
    settingsAuthSection: createPanelStub(true),
    settingsSkillsSection: createPanelStub(true),
    settingsMcpSection: createPanelStub(true),
    settingsPluginsSection: createPanelStub(true),
    settingsAgentsSection: createPanelStub(true),
    settingsMemoryCandidatesSection: createPanelStub(true),
    settingsMeetingRoomsSection: createPanelStub(true),
    settingsThirdPartySection: createPanelStub(true),
    settingsModeSwitchSection: createPanelStub(true),
    operationsCenterStatusNote: createTextStub(),
    operationsCenterFoundationGrid: createTextStub(),
    operationsCenterNextGrid: createTextStub(),
    operationsCenterLiveGrid: createTextStub(),
    operationsCenterPlatformLink: createLinkStub(),
    operationsCenterPlatformNote: createTextStub(),
    operationsBossViewStatusNote: createTextStub(),
    operationsBossViewRefreshButton: createButtonStub(),
    operationsBossViewHeadline: createTextStub(),
    operationsBossViewMetrics: createTextStub(),
    operationsBossViewFocusList: createTextStub(),
    operationsBossViewRelationsList: createTextStub(),
    operationsBossViewDecisionsList: createTextStub(),
    operationsAssetsStatusNote: createTextStub(),
    operationsAssetsRefreshButton: createButtonStub(),
    operationsAssetsNewButton: createButtonStub(),
    operationsAssetsFilterSelect: createDisabledInputStub(),
    operationsAssetsListEmpty: createTextStub(),
    operationsAssetsList: createTextStub(),
    operationsAssetsFormTitle: createTextStub(),
    operationsAssetsKindSelect: createDisabledInputStub(),
    operationsAssetsNameInput: createDisabledInputStub(),
    operationsAssetsStatusSelect: createDisabledInputStub(),
    operationsAssetsOwnerInput: createDisabledInputStub(),
    operationsAssetsTagsInput: createDisabledInputStub(),
    operationsAssetsRefsInput: createDisabledInputStub(),
    operationsAssetsSummaryInput: createDisabledInputStub(),
    operationsAssetsSaveButton: createButtonStub(),
    operationsAssetsResetButton: createButtonStub(),
    operationsCadencesStatusNote: createTextStub(),
    operationsCadencesRefreshButton: createButtonStub(),
    operationsCadencesNewButton: createButtonStub(),
    operationsCadencesFilterSelect: createDisabledInputStub(),
    operationsCadencesListEmpty: createTextStub(),
    operationsCadencesList: createTextStub(),
    operationsCadencesFormTitle: createTextStub(),
    operationsCadencesTitleInput: createDisabledInputStub(),
    operationsCadencesFrequencySelect: createDisabledInputStub(),
    operationsCadencesStatusSelect: createDisabledInputStub(),
    operationsCadencesNextRunAtInput: createDisabledInputStub(),
    operationsCadencesOwnerInput: createDisabledInputStub(),
    operationsCadencesPlaybookRefInput: createDisabledInputStub(),
    operationsCadencesRelatedAssetsInput: createDisabledInputStub(),
    operationsCadencesSummaryInput: createDisabledInputStub(),
    operationsCadencesSaveButton: createButtonStub(),
    operationsCadencesResetButton: createButtonStub(),
    operationsCommitmentsStatusNote: createTextStub(),
    operationsCommitmentsRefreshButton: createButtonStub(),
    operationsCommitmentsNewButton: createButtonStub(),
    operationsCommitmentsFilterSelect: createDisabledInputStub(),
    operationsCommitmentsListEmpty: createTextStub(),
    operationsCommitmentsList: createTextStub(),
    operationsCommitmentsFormTitle: createTextStub(),
    operationsCommitmentsTitleInput: createDisabledInputStub(),
    operationsCommitmentsStatusSelect: createDisabledInputStub(),
    operationsCommitmentsProgressInput: createDisabledInputStub(),
    operationsCommitmentsOwnerInput: createDisabledInputStub(),
    operationsCommitmentsStartsAtInput: createDisabledInputStub(),
    operationsCommitmentsDueAtInput: createDisabledInputStub(),
    operationsCommitmentsRelatedAssetsInput: createDisabledInputStub(),
    operationsCommitmentsLinkedDecisionsInput: createDisabledInputStub(),
    operationsCommitmentsLinkedRisksInput: createDisabledInputStub(),
    operationsCommitmentsRelatedCadencesInput: createDisabledInputStub(),
    operationsCommitmentsRelatedWorkItemsInput: createDisabledInputStub(),
    operationsCommitmentsMilestonesInput: createDisabledInputStub(),
    operationsCommitmentsEvidenceRefsInput: createDisabledInputStub(),
    operationsCommitmentsSummaryInput: createDisabledInputStub(),
    operationsCommitmentsSaveButton: createButtonStub(),
    operationsCommitmentsResetButton: createButtonStub(),
    operationsDecisionsStatusNote: createTextStub(),
    operationsDecisionsRefreshButton: createButtonStub(),
    operationsDecisionsNewButton: createButtonStub(),
    operationsDecisionsFilterSelect: createDisabledInputStub(),
    operationsDecisionsListEmpty: createTextStub(),
    operationsDecisionsList: createTextStub(),
    operationsDecisionsFormTitle: createTextStub(),
    operationsDecisionsTitleInput: createDisabledInputStub(),
    operationsDecisionsStatusSelect: createDisabledInputStub(),
    operationsDecisionsDecidedByInput: createDisabledInputStub(),
    operationsDecisionsDecidedAtInput: createDisabledInputStub(),
    operationsDecisionsRelatedAssetsInput: createDisabledInputStub(),
    operationsDecisionsRelatedWorkItemsInput: createDisabledInputStub(),
    operationsDecisionsSummaryInput: createDisabledInputStub(),
    operationsDecisionsSaveButton: createButtonStub(),
    operationsDecisionsResetButton: createButtonStub(),
    operationsEdgesStatusNote: createTextStub(),
    operationsEdgesRefreshButton: createButtonStub(),
    operationsEdgesNewButton: createButtonStub(),
    operationsEdgesFilterSelect: createDisabledInputStub(),
    operationsEdgesListEmpty: createTextStub(),
    operationsEdgesList: createTextStub(),
    operationsEdgesFormTitle: createTextStub(),
    operationsEdgesFromTypeSelect: createDisabledInputStub(),
    operationsEdgesFromIdInput: createDisabledInputStub(),
    operationsEdgesToTypeSelect: createDisabledInputStub(),
    operationsEdgesToIdInput: createDisabledInputStub(),
    operationsEdgesRelationSelect: createDisabledInputStub(),
    operationsEdgesStatusSelect: createDisabledInputStub(),
    operationsEdgesLabelInput: createDisabledInputStub(),
    operationsEdgesSummaryInput: createDisabledInputStub(),
    operationsEdgesSaveButton: createButtonStub(),
    operationsEdgesResetButton: createButtonStub(),
    operationsGraphStatusNote: createTextStub(),
    operationsGraphRefreshButton: createButtonStub(),
    operationsGraphRootTypeSelect: createDisabledInputStub(),
    operationsGraphRootIdInput: createDisabledInputStub(),
    operationsGraphTargetTypeSelect: createDisabledInputStub(),
    operationsGraphTargetIdInput: createDisabledInputStub(),
    operationsGraphDepthSelect: createDisabledInputStub(),
    operationsGraphSummary: createTextStub(),
    operationsGraphNodes: createTextStub(),
    operationsGraphEdges: createTextStub(),
    operationsGraphPath: createTextStub(),
    operationsRisksStatusNote: createTextStub(),
    operationsRisksRefreshButton: createButtonStub(),
    operationsRisksNewButton: createButtonStub(),
    operationsRisksFilterSelect: createDisabledInputStub(),
    operationsRisksListEmpty: createTextStub(),
    operationsRisksList: createTextStub(),
    operationsRisksFormTitle: createTextStub(),
    operationsRisksTypeSelect: createDisabledInputStub(),
    operationsRisksSeveritySelect: createDisabledInputStub(),
    operationsRisksStatusSelect: createDisabledInputStub(),
    operationsRisksTitleInput: createDisabledInputStub(),
    operationsRisksOwnerInput: createDisabledInputStub(),
    operationsRisksDetectedAtInput: createDisabledInputStub(),
    operationsRisksRelatedAssetsInput: createDisabledInputStub(),
    operationsRisksLinkedDecisionsInput: createDisabledInputStub(),
    operationsRisksRelatedWorkItemsInput: createDisabledInputStub(),
    operationsRisksSummaryInput: createDisabledInputStub(),
    operationsRisksSaveButton: createButtonStub(),
    operationsRisksResetButton: createButtonStub(),
    threadSearchInput: createDisabledInputStub(),
    assistantLanguageStyleInput: createDisabledInputStub(),
    assistantMbtiInput: createDisabledInputStub(),
    assistantStyleNotesInput: createDisabledInputStub(),
    assistantSoulInput: createDisabledInputStub(),
    reasoningSelect: createDisabledInputStub(),
    approvalSelect: createDisabledInputStub(),
    sandboxSelect: createDisabledInputStub(),
    webSearchSelect: createDisabledInputStub(),
    networkAccessSelect: createDisabledInputStub(),
    modelSelect: createDisabledInputStub(),
    identityLinkCodeButton: createButtonStub(),
    skillsLocalPathInput: createDisabledInputStub(),
    skillsGithubUrlInput: createDisabledInputStub(),
    skillsGithubUrlRefInput: createDisabledInputStub(),
    skillsGithubRepoInput: createDisabledInputStub(),
    skillsGithubPathInput: createDisabledInputStub(),
    skillsGithubRepoRefInput: createDisabledInputStub(),
    skillsInstallLocalButton: createButtonStub(),
    skillsInstallGithubUrlButton: createButtonStub(),
    skillsInstallGithubRepoButton: createButtonStub(),
    skillsRefreshButton: createButtonStub(),
    skillsPanelActions: {
      querySelectorAll() {
        return [];
      },
    },
    agentsRefreshButton: createButtonStub(),
    agentsOpenPlatformLink: createLinkStub(),
    agentsOpenPlatformNote: createTextStub(),
    agentsStatusNote: createTextStub(),
    agentsSummaryOrganizations: createTextStub(),
    agentsSummaryAgents: createTextStub(),
    agentsSummaryWorkItems: createTextStub(),
    agentsSummaryMailbox: createTextStub(),
    agentsGovernanceOverviewSummary: createTextStub(),
    agentsGovernanceSummaryGrid: createTextStub(),
    agentsGovernanceFilterManagerSelect: createDisabledInputStub(),
    agentsGovernanceFilterAttentionSelect: createDisabledInputStub(),
    agentsGovernanceFilterWaitingSelect: createDisabledInputStub(),
    agentsGovernanceFilterStaleInput: createCheckboxStub(),
    agentsGovernanceFilterFailedInput: createCheckboxStub(),
    agentsGovernanceFilterResetButton: createButtonStub(),
    agentsGovernanceHotspotsSummary: createTextStub(),
    agentsGovernanceHotspotsEmpty: createTextStub(),
    agentsGovernanceHotspotsList: createTextStub(),
    agentsWaitingSummary: createTextStub(),
    agentsWaitingEmpty: createTextStub(),
    agentsWaitingList: createTextStub(),
    agentsCollaborationSummary: createTextStub(),
    agentsCollaborationEmpty: createTextStub(),
    agentsCollaborationList: createTextStub(),
    agentsSpawnPolicySummary: createTextStub(),
    agentsSpawnPolicyMaxActiveInput: createDisabledInputStub(),
    agentsSpawnPolicyMaxRoleInput: createDisabledInputStub(),
    agentsSpawnPolicySaveButton: createButtonStub(),
    agentsSpawnSuggestionsSummary: createTextStub(),
    agentsSpawnSuggestionsEmpty: createTextStub(),
    agentsSpawnSuggestionsList: createTextStub(),
    agentsSuppressedSpawnSuggestionsSummary: createTextStub(),
    agentsSuppressedSpawnSuggestionsEmpty: createTextStub(),
    agentsSuppressedSpawnSuggestionsList: createTextStub(),
    agentsSpawnAuditSummary: createTextStub(),
    agentsSpawnAuditEmpty: createTextStub(),
    agentsSpawnAuditList: createTextStub(),
    agentsIdleRecoverySuggestionsSummary: createTextStub(),
    agentsIdleRecoverySuggestionsEmpty: createTextStub(),
    agentsIdleRecoverySuggestionsList: createTextStub(),
    agentsIdleRecoveryAuditSummary: createTextStub(),
    agentsIdleRecoveryAuditEmpty: createTextStub(),
    agentsIdleRecoveryAuditList: createTextStub(),
    agentsCreateRoleInput: createDisabledInputStub(),
    agentsCreateNameInput: createDisabledInputStub(),
    agentsCreateMissionInput: createDisabledInputStub(),
    agentsCreateButton: createButtonStub(),
    agentsSelect: createDisabledInputStub(),
    agentsListEmpty: createTextStub(),
    agentsList: createTextStub(),
    agentsDispatchTargetSelect: createDisabledInputStub(),
    agentsDispatchSourceTypeSelect: createDisabledInputStub(),
    agentsDispatchSourceAgentSelect: createDisabledInputStub(),
    agentsDispatchReasonInput: createDisabledInputStub(),
    agentsDispatchGoalInput: createDisabledInputStub(),
    agentsDispatchContextInput: createDisabledInputStub(),
    agentsDispatchPrioritySelect: createDisabledInputStub(),
    agentsDispatchButton: createButtonStub(),
    agentsSelectedAgentHeading: createTextStub(),
    agentsSelectedAgentCopy: createTextStub(),
    agentsSelectedAgentMeta: createTextStub(),
    agentsHandoffsSummary: createTextStub(),
    agentsHandoffsEmpty: createTextStub(),
    agentsHandoffsList: createTextStub(),
    agentsTimelineSummary: createTextStub(),
    agentsTimelineEmpty: createTextStub(),
    agentsTimelineList: createTextStub(),
    agentsWorkItemsEmpty: createTextStub(),
    agentsWorkItemsList: createTextStub(),
    agentsWorkItemDetail: createTextStub(),
    agentsMailboxEmpty: createTextStub(),
    agentsMailboxList: createTextStub(),
    memoryCandidatesRefreshButton: createButtonStub(),
    memoryCandidatesExtractButton: createButtonStub(),
    memoryCandidatesFilterSelect: createDisabledInputStub(),
    memoryCandidatesIncludeArchivedInput: createDisabledInputStub(),
    memoryCandidatesStatusNote: createTextStub(),
    memoryCandidatesListEmpty: createTextStub(),
    memoryCandidatesList: createTextStub(),
    meetingRoomsStatusNote: createTextStub(),
    meetingRoomsCreateOrganizationInput: createDisabledInputStub(),
    meetingRoomsCreateTitleInput: createDisabledInputStub(),
    meetingRoomsCreateDiscussionModeSelect: createDisabledInputStub(),
    meetingRoomsCreateGoalInput: createDisabledInputStub(),
    meetingRoomsCreateParticipantsInput: createDisabledInputStub(),
    meetingRoomsCreateButton: createButtonStub(),
    meetingRoomsRefreshButton: createButtonStub(),
    meetingRoomsListEmpty: createTextStub(),
    meetingRoomsList: createTextStub(),
    meetingRoomsActiveTitle: createTextStub(),
    meetingRoomsActiveGoal: createTextStub(),
    meetingRoomsActiveMeta: createTextStub(),
    meetingRoomsParticipantsList: createTextStub(),
    meetingRoomsRoundsSummary: createTextStub(),
    meetingRoomsAddParticipantsInput: createDisabledInputStub(),
    meetingRoomsAddParticipantsButton: createButtonStub(),
    meetingRoomsActiveMessages: createTextStub(),
    meetingRoomsResolutionTitleInput: createDisabledInputStub(),
    meetingRoomsResolutionSummaryInput: createDisabledInputStub(),
    meetingRoomsCreateResolutionButton: createButtonStub(),
    meetingRoomsResolutionSelectionNote: createTextStub(),
    meetingRoomsResolutionsList: createTextStub(),
    meetingRoomsCloseSummaryInput: createDisabledInputStub(),
    meetingRoomsCloseButton: createButtonStub(),
    meetingRoomsTargetParticipantsList: createTextStub(),
    meetingRoomsComposerInput: createDisabledInputStub(),
    meetingRoomsSendButton: createButtonStub(),
    accessModeSelect: createDisabledInputStub(),
    modeSwitchAuthAccountSelect: createDisabledInputStub(),
    accessModeApplyButton: createButtonStub(),
    sessionWorkspaceInput: createDisabledInputStub(),
    sessionWorkspaceApplyButton: createButtonStub(),
    thirdPartyProviderSelect: createDisabledInputStub(),
    thirdPartyEndpointProbeButton: createButtonStub(),
    thirdPartyModelSelect: createDisabledInputStub(),
    thirdPartyProbeButton: createButtonStub(),
    thirdPartyProbeApplyButton: createButtonStub(),
    thirdPartyAddProviderButton: createButtonStub(),
    thirdPartyAddModelButton: createButtonStub(),
    thirdPartyEditorClose: createButtonStub(),
    thirdPartyEditorBackdrop: createButtonStub(),
    thirdPartyProviderIdInput: createDisabledInputStub(),
    thirdPartyProviderNameInput: createDisabledInputStub(),
    thirdPartyProviderBaseUrlInput: createDisabledInputStub(),
    thirdPartyProviderApiKeyInput: createDisabledInputStub(),
    thirdPartyProviderEndpointCandidatesInput: createDisabledInputStub(),
    thirdPartyProviderWireApiSelect: createDisabledInputStub(),
    thirdPartyProviderWebsocketInput: createDisabledInputStub(),
    thirdPartyProviderSubmitButton: createButtonStub(),
    thirdPartyProviderCancelButton: createButtonStub(),
    thirdPartyModelProviderSelect: createDisabledInputStub(),
    thirdPartyModelIdInput: createDisabledInputStub(),
    thirdPartyModelDisplayNameInput: createDisabledInputStub(),
    thirdPartyModelDefaultReasoningSelect: createDisabledInputStub(),
    thirdPartyModelContextWindowInput: createDisabledInputStub(),
    thirdPartyModelDescriptionInput: createDisabledInputStub(),
    thirdPartyModelSupportsCodexInput: createDisabledInputStub(),
    thirdPartyModelImageInput: createDisabledInputStub(),
    thirdPartyModelSearchInput: createDisabledInputStub(),
    thirdPartyModelParallelToolsInput: createDisabledInputStub(),
    thirdPartyModelVerbosityInput: createDisabledInputStub(),
    thirdPartyModelReasoningSummaryInput: createDisabledInputStub(),
    thirdPartyModelImageDetailInput: createDisabledInputStub(),
    thirdPartyModelDefaultInput: createDisabledInputStub(),
    thirdPartyModelSubmitButton: createButtonStub(),
    thirdPartyModelCancelButton: createButtonStub(),
    authAccountSelect: createDisabledInputStub(),
    authAccountActivateButton: createButtonStub(),
    authAccountCreateInput: createDisabledInputStub(),
    authAccountCreateButton: createButtonStub(),
    authChatgptLoginButton: createButtonStub(),
    authChatgptDeviceLoginButton: createButtonStub(),
    authLogoutButton: createButtonStub(),
    authLoginCancelButton: createButtonStub(),
    authApiKeyInput: createDisabledInputStub(),
    authApiKeyButton: createButtonStub(),
  };

  const store = {
    state: {
      threads: [thread],
    },
    ensureActiveThread() {},
    getActiveThread() {
      return thread;
    },
    resolveComposerActionBarState() {
      return actionBarState;
    },
    createDefaultThreadSettings() {
      return {};
    },
    resolveThreadControlState() {
      return threadControlState;
    },
    resolveEffectiveSettings() {
      return {};
    },
    resolveTransientStatus() {
      return "";
    },
    isBusy() {
      return false;
    },
    getRunningThreadId() {
      return "";
    },
    getThreadById() {
      return null;
    },
    resolveAccessMode() {
      return "auth";
    },
    resolveThirdPartySelection() {
      return {
        provider: null,
        model: null,
        modelId: "",
      };
    },
    getVisibleModels() {
      return [];
    },
    getThirdPartyProviders() {
      return [];
    },
    getThirdPartyModels() {
      return [];
    },
    resolveAssistantDisplayLabel() {
      return "Themis Assistant";
    },
    getVisibleAssistantMessages(turn) {
      return Array.isArray(turn?.assistantMessages) ? turn.assistantMessages : [];
    },
    latestTurnMessage(turn) {
      return turn?.result?.summary ?? turn?.goal ?? "";
    },
    resolveTurnActionState() {
      return null;
    },
  };

  const renderer = createRenderer({
    dom,
    store,
    utils: {
      autoResizeTextarea() {},
      escapeHtml: (value) => String(value),
      formatRelativeTime: (value) => value || "",
      scrollConversationToBottom() {},
    },
    runtime: {
      auth: {
        status: "ready",
        errorMessage: "",
        authenticated: false,
        authMethod: "",
        requiresOpenaiAuth: false,
        account: {
          email: "",
          planType: "",
        },
        pendingLogin: null,
        browserLogin: {
          supportedOnThisBrowser: true,
          localOrigin: "",
          sshTunnelCommand: "",
        },
        lastError: "",
        providerProfile: {
          type: "",
          name: "",
          baseUrl: "",
          model: "",
          source: "",
          lockedModel: false,
        },
        rateLimits: null,
        accounts: [],
        activeAccountId: "",
        currentAccountId: "",
      },
      sessionControlBusy: false,
      authBusy: false,
      workspaceToolsOpen: false,
      workspaceToolsSection: "runtime",
      historyHydratingThreadId: null,
      thirdPartyEditor: createThirdPartyEditorState(),
      thirdPartyEndpointProbe: createProbeState(),
      thirdPartyProbe: createProbeState(),
      runtimeConfig: {
        status: "ready",
        defaults: {},
        accessModes: [],
        provider: null,
      },
      identity: {
        browserUserId: "",
        principalId: "",
        principalDisplayName: "",
      },
      skills: {
        loading: false,
        installing: false,
        syncing: false,
        skills: [],
        curated: [],
        noticeMessage: "",
        errorMessage: "",
      },
      memoryCandidates: {
        status: "idle",
        candidates: [],
        loading: false,
        reviewingCandidateId: "",
        filterStatus: "suggested",
        includeArchived: false,
        noticeMessage: "",
        errorMessage: "",
      },
      operationsBossView: {
        status: "idle",
        loading: false,
        errorMessage: "",
        noticeMessage: "",
        bossView: null,
      },
      operationsAssets: {
        status: "idle",
        loading: false,
        submitting: false,
        filterStatus: "active",
        selectedAssetId: "",
        noticeMessage: "",
        errorMessage: "",
        assets: [],
        draft: {
          kind: "site",
          name: "",
          status: "active",
          ownerPrincipalId: "",
          summary: "",
          tagsText: "",
          refsText: "",
        },
      },
      operationsCadences: {
        status: "idle",
        loading: false,
        submitting: false,
        filterStatus: "active",
        selectedCadenceId: "",
        noticeMessage: "",
        errorMessage: "",
        cadences: [],
        draft: {
          title: "",
          frequency: "weekly",
          status: "active",
          nextRunAt: "",
          ownerPrincipalId: "",
          playbookRef: "",
          relatedAssetIdsText: "",
          summary: "",
        },
      },
      operationsDecisions: {
        status: "idle",
        loading: false,
        submitting: false,
        filterStatus: "active",
        selectedDecisionId: "",
        noticeMessage: "",
        errorMessage: "",
        decisions: [],
        draft: {
          title: "",
          status: "active",
          decidedByPrincipalId: "",
          decidedAt: "",
          relatedAssetIdsText: "",
          relatedWorkItemIdsText: "",
          summary: "",
        },
      },
      operationsEdges: {
        status: "idle",
        loading: false,
        submitting: false,
        filterStatus: "active",
        selectedEdgeId: "",
        noticeMessage: "",
        errorMessage: "",
        edges: [],
        draft: {
          fromObjectType: "decision",
          fromObjectId: "",
          toObjectType: "risk",
          toObjectId: "",
          relationType: "relates_to",
          status: "active",
          label: "",
          summary: "",
        },
      },
      operationsGraph: {
        status: "idle",
        loading: false,
        errorMessage: "",
        noticeMessage: "",
        rootObjectType: "commitment",
        rootObjectId: "",
        targetObjectType: "asset",
        targetObjectId: "",
        maxDepth: "2",
        graph: null,
      },
      operationsRisks: {
        status: "idle",
        loading: false,
        submitting: false,
        filterStatus: "open",
        selectedRiskId: "",
        noticeMessage: "",
        errorMessage: "",
        risks: [],
        draft: {
          type: "risk",
          title: "",
          severity: "medium",
          status: "open",
          ownerPrincipalId: "",
          detectedAt: "",
          relatedAssetIdsText: "",
          linkedDecisionIdsText: "",
          relatedWorkItemIdsText: "",
          summary: "",
        },
      },
      pendingInterruptSubmit: null,
      activeRequestController: null,
      activeRunRef: null,
      restoredActionHydrationThreadId: null,
      threadControlJoinOpen: false,
      ...runtime,
    },
    history: {
      getDisplayTurnCount() {
        return 0;
      },
      threadNeedsHistoryHydration() {
        return false;
      },
      refreshHistoryFromServer() {},
    },
    modeSwitch: {
      getDraft() {
        return {
          accessMode: "auth",
          dirty: false,
          thirdPartyModel: "",
        };
      },
    },
  });

  return {
    dom,
    renderer,
    store,
    thread,
  };
}

function createTextStub() {
  return {
    disabled: false,
    textContent: "",
    innerHTML: "",
    dataset: {},
    classList: {
      add() {},
      remove() {},
      toggle(_className, force) {
        return Boolean(force);
      },
    },
  };
}

function createInputStub() {
  return {
    disabled: false,
    value: "",
    placeholder: "",
    scrollHeight: 0,
    style: {},
  };
}

function createDisabledInputStub() {
  return {
    ...createInputStub(),
    checked: false,
  };
}

function createCheckboxStub() {
  return {
    checked: false,
    disabled: false,
  };
}

function createButtonStub() {
  return {
    disabled: false,
    hidden: false,
    textContent: "",
    attributes: {},
    dataset: {},
    classList: {
      add() {},
      remove() {},
      toggle(_className, force) {
        return Boolean(force);
      },
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
  };
}

function createLinkStub() {
  return {
    ...createButtonStub(),
    href: "#",
    tabIndex: -1,
  };
}

function createPanelStub(hidden = false) {
  return {
    hidden,
    innerHTML: "static-shell",
    attributes: {},
    classList: {
      add() {},
      remove() {},
      toggle(_className, force) {
        if (typeof force === "boolean") {
          this.hidden = !force;
        }
        return Boolean(force);
      },
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
  };
}

function createDetailsStub() {
  return {
    ...createPanelStub(false),
    open: false,
  };
}

function createThirdPartyEditorState() {
  return {
    mode: "provider",
    open: false,
    errorMessage: "",
    submitting: false,
    providerForm: {
      id: "",
      name: "",
      baseUrl: "",
      apiKey: "",
      endpointCandidates: "",
      wireApi: "",
      supportsWebsockets: false,
    },
    modelForm: {
      providerId: "",
      model: "",
      displayName: "",
      defaultReasoningLevel: "medium",
      contextWindow: "",
      description: "",
      supportsCodexTasks: false,
      imageInput: false,
      supportsSearchTool: false,
      supportsParallelToolCalls: false,
      supportsVerbosity: false,
      supportsReasoningSummaries: false,
      supportsImageDetailOriginal: false,
      setAsDefault: false,
    },
  };
}

function createProbeState() {
  return {
    status: "idle",
    providerId: "",
    model: "",
    checkedAt: "",
    summary: "",
    detail: "",
    observedCommand: "",
    outputPreview: "",
    results: [],
    persistStatus: "idle",
    persistMessage: "",
  };
}
