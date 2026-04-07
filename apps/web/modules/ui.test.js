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

test("renderAgentsState 会在组织级等待队列渲染直接治理入口", () => {
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

test("renderAgentsState 会渲染组织级跨父任务汇总台卡片，并暴露父任务跳转动作", () => {
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
            latestGovernanceResponse: null,
            lastActivityAt: "2026-04-07T12:10:00.000Z",
            lastActivityKind: "waiting",
            lastActivitySummary: "当前 UI 交互还需要顶层治理拍板。",
            attentionLevel: "urgent",
            attentionReasons: ["1 条任务等待顶层治理", "最近出现升级阻塞"],
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
});

test("renderAgentsState 会渲染自动创建建议卡片与批准按钮", () => {
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

test("renderAgentsState 会渲染 idle 回收建议与审计记录", () => {
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

test("renderAgentsState 会把 bootstrapping agent 的建档状态和提示文案渲染出来", () => {
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

test("renderAgentsState 会在 waiting_agent 卡片渲染升级入口", () => {
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

test("renderAgentsState 会在可安全取消的 work item 详情里渲染取消动作", () => {
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

test("renderAgentsState 会在 work item 详情里渲染父任务与下游协作汇总", () => {
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

test("renderAgentsState 会在当前 agent 面板渲染 lifecycle 治理动作", () => {
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

test("renderAgentsState 会渲染 handoff 卡片与交接时间线", () => {
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
    settingsRuntimeSection: createPanelStub(),
    settingsAuthSection: createPanelStub(true),
    settingsSkillsSection: createPanelStub(true),
    settingsAgentsSection: createPanelStub(true),
    settingsMemoryCandidatesSection: createPanelStub(true),
    settingsThirdPartySection: createPanelStub(true),
    settingsModeSwitchSection: createPanelStub(true),
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
    agentsStatusNote: createTextStub(),
    agentsSummaryOrganizations: createTextStub(),
    agentsSummaryAgents: createTextStub(),
    agentsSummaryWorkItems: createTextStub(),
    agentsSummaryMailbox: createTextStub(),
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
