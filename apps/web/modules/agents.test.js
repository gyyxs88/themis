import assert from "node:assert/strict";
import test from "node:test";
import { createAgentsController, createDefaultAgentsState } from "./agents.js";

test("load 会读取 agent 列表并补齐当前选中 agent 的任务与 mailbox", async () => {
  const state = createDefaultAgentsState();
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/spawn-suggestions") {
        return jsonResponse({ suggestions: [] });
      }

      if (url === "/api/agents/idle-suggestions") {
        return jsonResponse({ suggestions: [], recentAuditLogs: [] });
      }

      if (url === "/api/agents/list") {
        return jsonResponse({
          organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
          agents: [
            {
              agentId: "agent-backend",
              principalId: "principal-backend",
              displayName: "后端·衡",
              departmentRole: "后端",
              mission: "负责服务端。",
              status: "active",
            },
          ],
        });
      }

      if (url === "/api/agents/waiting/list") {
        return jsonResponse({
          summary: {
            totalCount: 0,
            waitingHumanCount: 0,
            waitingAgentCount: 0,
            escalationCount: 0,
          },
          items: [],
        });
      }

      if (url === "/api/agents/collaboration-dashboard") {
        return jsonResponse({
          summary: {
            totalCount: 1,
            urgentCount: 1,
            attentionCount: 0,
            normalCount: 0,
          },
          items: [
            {
              parentWorkItem: {
                workItemId: "work-item-parent-1",
                targetAgentId: "agent-backend",
                status: "waiting_human",
                goal: "把组织级跨父任务汇总挂到 Agents 面板",
              },
              managerAgent: {
                agentId: "agent-backend",
                displayName: "后端·衡",
              },
              attentionLevel: "urgent",
              attentionReasons: ["1 条任务等待顶层治理"],
              lastActivityAt: "2026-04-07T12:10:00.000Z",
              lastActivityKind: "waiting",
              lastActivitySummary: "需要顶层拍板当前交互方案。",
            },
          ],
        });
      }

      if (url === "/api/agents/detail") {
        return jsonResponse({
          organization: { organizationId: "org-1", displayName: "老板团队" },
          principal: { principalId: "principal-backend" },
          agent: {
            agentId: "agent-backend",
            principalId: "principal-backend",
            displayName: "后端·衡",
            departmentRole: "后端",
            mission: "负责服务端。",
            status: "active",
          },
        });
      }

      if (url === "/api/agents/work-items/list") {
        return jsonResponse({
          workItems: [
            {
              workItemId: "work-item-1",
              targetAgentId: "agent-backend",
              status: "queued",
              sourceType: "human",
              goal: "补 detail 接口",
            },
          ],
        });
      }

      if (url === "/api/agents/mailbox/list") {
        return jsonResponse({
          items: [
            {
              entry: {
                mailboxEntryId: "mailbox-1",
                ownerAgentId: "agent-backend",
                status: "pending",
                availableAt: "2026-04-06T07:40:00.000Z",
              },
              message: {
                messageId: "msg-1",
                messageType: "dispatch",
                workItemId: "work-item-1",
                payload: {
                  goal: "补 detail 接口",
                },
              },
            },
          ],
        });
      }

      if (url === "/api/agents/handoffs/list") {
        return jsonResponse({ handoffs: [], timeline: [] });
      }

      if (url === "/api/agents/work-items/detail") {
        return jsonResponse({
          workItem: {
            workItemId: "work-item-1",
            goal: "补 detail 接口",
            status: "queued",
            contextPacket: {
              ticket: "AG-1",
            },
          },
          targetAgent: {
            agentId: "agent-backend",
          },
          messages: [],
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    const result = await controller.load();

    assert.deepEqual(
      calls.map((call) => call.url),
      [
        "/api/agents/list",
        "/api/agents/waiting/list",
        "/api/agents/collaboration-dashboard",
        "/api/agents/spawn-suggestions",
        "/api/agents/idle-suggestions",
        "/api/agents/detail",
        "/api/agents/work-items/list",
        "/api/agents/mailbox/list",
        "/api/agents/handoffs/list",
        "/api/agents/work-items/detail",
      ],
    );
    assert.equal(result.organizations.length, 1);
    assert.equal(result.agents.length, 1);
    assert.equal(result.selectedAgentId, "agent-backend");
    assert.equal(result.organizationCollaborationSummary?.totalCount, 1);
    assert.equal(result.organizationCollaborationItems.length, 1);
    assert.equal(result.workItems.length, 1);
    assert.equal(result.mailboxItems.length, 1);
    assert.equal(result.selectedWorkItemId, "work-item-1");
    assert.equal(result.selectedWorkItemDetail?.workItem?.workItemId, "work-item-1");
    assert.ok(app.renderer.renderAllCallCount >= 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createAgent 会调用创建接口并刷新列表，把焦点切到新 agent", async () => {
  const state = createDefaultAgentsState();
  state.createDraft = {
    departmentRole: "运维",
    displayName: "运维·砺",
    mission: "负责线上环境与发布。",
  };
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/spawn-suggestions") {
        return jsonResponse({ suggestions: [] });
      }

      if (url === "/api/agents/idle-suggestions") {
        return jsonResponse({ suggestions: [], recentAuditLogs: [] });
      }

      if (url === "/api/agents/create") {
        return jsonResponse({
          agent: {
            agentId: "agent-ops",
          },
        });
      }

      if (url === "/api/agents/list") {
        return jsonResponse({
          organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
          agents: [
            {
              agentId: "agent-ops",
              principalId: "principal-ops",
              displayName: "运维·砺",
              departmentRole: "运维",
              mission: "负责线上环境与发布。",
              status: "active",
            },
          ],
        });
      }

      if (url === "/api/agents/waiting/list") {
        return jsonResponse({
          summary: {
            totalCount: 0,
            waitingHumanCount: 0,
            waitingAgentCount: 0,
            escalationCount: 0,
          },
          items: [],
        });
      }

      if (url === "/api/agents/detail") {
        return jsonResponse({
          organization: { organizationId: "org-1", displayName: "老板团队" },
          principal: { principalId: "principal-ops" },
          agent: {
            agentId: "agent-ops",
            principalId: "principal-ops",
            displayName: "运维·砺",
            departmentRole: "运维",
            mission: "负责线上环境与发布。",
            status: "active",
          },
        });
      }

      if (url === "/api/agents/work-items/list") {
        return jsonResponse({ workItems: [] });
      }

      if (url === "/api/agents/mailbox/list") {
        return jsonResponse({ items: [] });
      }

      if (url === "/api/agents/handoffs/list") {
        return jsonResponse({ handoffs: [], timeline: [] });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    await controller.createAgent();

    assert.equal(calls[0].url, "/api/agents/create");
    assert.equal(calls[0].body.agent.departmentRole, "运维");
    assert.equal(calls[0].body.agent.displayName, "运维·砺");
    assert.equal(calls[0].body.agent.mission, "负责线上环境与发布。");
    assert.equal(app.runtime.agents.selectedAgentId, "agent-ops");
    assert.equal(app.runtime.agents.noticeMessage, "已创建新的持久化 agent。");
    assert.equal(app.runtime.agents.createDraft.departmentRole, "");
    assert.equal(app.runtime.agents.agents.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("approveSpawnSuggestion 会创建 bootstrapping agent，并定位到首次建档 work item", async () => {
  const state = createDefaultAgentsState();
  state.organizations = [{ organizationId: "org-1", displayName: "老板团队" }];
  state.agents = [
    {
      agentId: "agent-ops",
      organizationId: "org-1",
      principalId: "principal-ops",
      displayName: "运维·曜",
      departmentRole: "运维",
      mission: "负责发布和值班。",
      status: "active",
    },
  ];
  state.selectedAgentId = "agent-ops";
  state.spawnSuggestions = [
    {
      suggestionId: "spawn-suggestion-1",
      organizationId: "org-1",
      departmentRole: "运维",
      displayName: "运维·砺",
      mission: "负责运维值班与巡检分流。",
      rationale: "运维积压较高，建议增员。",
      supportingAgentId: "agent-ops",
      supportingAgentDisplayName: "运维·曜",
      suggestedSupervisorAgentId: "agent-ops",
      openWorkItemCount: 4,
      waitingWorkItemCount: 1,
      highPriorityWorkItemCount: 2,
      spawnPolicy: {
        organizationId: "org-1",
        maxActiveAgents: 12,
        maxActiveAgentsPerRole: 3,
      },
      guardrail: {
        organizationActiveAgentCount: 1,
        organizationActiveAgentLimit: 12,
        roleActiveAgentCount: 1,
        roleActiveAgentLimit: 3,
        blocked: false,
      },
      auditFacts: {
        creationReason: "运维积压较高，建议增员。",
        expectedScope: "负责分担运维持续性工作。",
        insufficiencyReason: "当前积压较高。",
        namingBasis: "沿用自动命名规则。",
      },
    },
  ];
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/spawn-approve") {
        return jsonResponse({
          agent: {
            agentId: "agent-ops-2",
            organizationId: "org-1",
            principalId: "principal-ops-2",
            displayName: "运维·砺",
            departmentRole: "运维",
            mission: "负责运维值班与巡检分流。",
            creationMode: "auto",
            status: "bootstrapping",
            bootstrapProfile: {
              state: "pending",
              bootstrapWorkItemId: "work-item-bootstrap-1",
            },
          },
          bootstrapWorkItem: {
            workItemId: "work-item-bootstrap-1",
            targetAgentId: "agent-ops-2",
            status: "queued",
          },
        });
      }

      if (url === "/api/agents/list") {
        return jsonResponse({
          organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
          agents: [
            state.agents[0],
            {
              agentId: "agent-ops-2",
              organizationId: "org-1",
              principalId: "principal-ops-2",
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
        });
      }

      if (url === "/api/agents/waiting/list") {
        return jsonResponse({
          summary: {
            totalCount: 0,
            waitingHumanCount: 0,
            waitingAgentCount: 0,
            escalationCount: 0,
          },
          items: [],
        });
      }

      if (url === "/api/agents/spawn-suggestions") {
        return jsonResponse({
          spawnPolicies: [
            {
              organizationId: "org-1",
              maxActiveAgents: 12,
              maxActiveAgentsPerRole: 3,
            },
          ],
          suggestions: [],
          suppressedSuggestions: [],
          recentAuditLogs: [],
        });
      }

      if (url === "/api/agents/idle-suggestions") {
        return jsonResponse({
          suggestions: [],
          recentAuditLogs: [],
        });
      }

      if (url === "/api/agents/detail") {
        return jsonResponse({
          organization: { organizationId: "org-1", displayName: "老板团队" },
          principal: { principalId: "principal-ops-2" },
          agent: {
            agentId: "agent-ops-2",
            organizationId: "org-1",
            principalId: "principal-ops-2",
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
        });
      }

      if (url === "/api/agents/work-items/list") {
        return jsonResponse({
          workItems: [
            {
              workItemId: "work-item-bootstrap-1",
              targetAgentId: "agent-ops-2",
              status: "queued",
              dispatchReason: "完成 运维·砺 的首次职责建档",
              goal: "完成首次职责建档。",
              priority: "high",
            },
          ],
        });
      }

      if (url === "/api/agents/work-items/detail") {
        return jsonResponse({
          workItem: {
            workItemId: "work-item-bootstrap-1",
            targetAgentId: "agent-ops-2",
            status: "queued",
            dispatchReason: "完成 运维·砺 的首次职责建档",
            goal: "完成首次职责建档。",
            priority: "high",
          },
          messages: [],
        });
      }

      if (url === "/api/agents/mailbox/list") {
        return jsonResponse({ items: [] });
      }

      if (url === "/api/agents/handoffs/list") {
        return jsonResponse({ handoffs: [], timeline: [] });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    await controller.approveSpawnSuggestion("spawn-suggestion-1");

    assert.equal(calls[0].url, "/api/agents/spawn-approve");
    assert.equal(calls[0].body.agent.departmentRole, "运维");
    assert.equal(calls[0].body.agent.supervisorAgentId, "agent-ops");
    assert.equal(app.runtime.agents.selectedAgentId, "agent-ops-2");
    assert.equal(app.runtime.agents.selectedWorkItemId, "work-item-bootstrap-1");
    assert.equal(app.runtime.agents.noticeMessage, "已按建议创建 运维·砺 agent，并进入首次建档。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("saveSpawnPolicy 会提交自动创建护栏并刷新列表", async () => {
  const state = createDefaultAgentsState();
  state.organizations = [{ organizationId: "org-1", displayName: "老板团队" }];
  state.agents = [
    {
      agentId: "agent-ops",
      organizationId: "org-1",
      principalId: "principal-ops",
      displayName: "运维·曜",
      departmentRole: "运维",
      mission: "负责发布和值班。",
      status: "active",
    },
  ];
  state.spawnPolicies = [
    {
      organizationId: "org-1",
      maxActiveAgents: 12,
      maxActiveAgentsPerRole: 3,
    },
  ];
  state.spawnPolicyDraft = {
    organizationId: "org-1",
    maxActiveAgents: 5,
    maxActiveAgentsPerRole: 2,
  };
  state.selectedAgentId = "agent-ops";
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/spawn-policy/update") {
        return jsonResponse({
          policy: {
            organizationId: "org-1",
            maxActiveAgents: 5,
            maxActiveAgentsPerRole: 2,
          },
        });
      }

      if (url === "/api/agents/spawn-suggestions") {
        return jsonResponse({
          spawnPolicies: [
            {
              organizationId: "org-1",
              maxActiveAgents: 5,
              maxActiveAgentsPerRole: 2,
            },
          ],
          suggestions: [],
          recentAuditLogs: [],
        });
      }

      if (url === "/api/agents/idle-suggestions") {
        return jsonResponse({
          suggestions: [],
          recentAuditLogs: [],
        });
      }

      if (url === "/api/agents/list") {
        return jsonResponse({
          organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
          agents: state.agents,
        });
      }

      if (url === "/api/agents/waiting/list") {
        return jsonResponse({
          summary: {
            totalCount: 0,
            waitingHumanCount: 0,
            waitingAgentCount: 0,
            escalationCount: 0,
          },
          items: [],
        });
      }

      if (url === "/api/agents/detail") {
        return jsonResponse({
          organization: { organizationId: "org-1", displayName: "老板团队" },
          principal: { principalId: "principal-ops" },
          agent: state.agents[0],
        });
      }

      if (url === "/api/agents/work-items/list") {
        return jsonResponse({ workItems: [] });
      }

      if (url === "/api/agents/mailbox/list") {
        return jsonResponse({ items: [] });
      }

      if (url === "/api/agents/handoffs/list") {
        return jsonResponse({ handoffs: [], timeline: [] });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    await controller.saveSpawnPolicy();

    assert.equal(calls[0].url, "/api/agents/spawn-policy/update");
    assert.deepEqual(calls[0].body.policy, {
      organizationId: "org-1",
      maxActiveAgents: 5,
      maxActiveAgentsPerRole: 2,
    });
    assert.equal(app.runtime.agents.noticeMessage, "已更新当前组织的自动创建护栏。");
    assert.equal(app.runtime.agents.spawnPolicyDraft.maxActiveAgents, 5);
    assert.equal(app.runtime.agents.spawnPolicyDraft.maxActiveAgentsPerRole, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("saveExecutionBoundary 会提交当前 draft 并刷新选中 agent 的执行边界", async () => {
  const state = createDefaultAgentsState();
  state.selectedAgentId = "agent-backend";
  state.availableAuthAccounts = [{ accountId: "acct-1", label: "默认账号" }];
  state.availableThirdPartyProviders = [{ id: "gateway-a", name: "Gateway A" }];
  state.executionBoundaryDraft = {
    workspacePath: " /workspace/backend ",
    additionalDirectoriesText: "/workspace/shared\n/workspace/cache",
    allowNetworkAccess: false,
    accessMode: "third-party",
    authAccountId: "",
    thirdPartyProviderId: "gateway-a",
    model: " gpt-5.4-mini ",
    reasoning: "high",
    memoryMode: "confirm",
    sandboxMode: "danger-full-access",
    approvalPolicy: "on-request",
    webSearchMode: "disabled",
    networkAccessEnabled: false,
  };
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/execution-boundary/update") {
        return jsonResponse({ ok: true });
      }

      if (url === "/api/agents/detail") {
        return jsonResponse({
          organization: { organizationId: "org-1", displayName: "老板团队" },
          principal: { principalId: "principal-backend" },
          agent: {
            agentId: "agent-backend",
            principalId: "principal-backend",
            displayName: "后端·衡",
            departmentRole: "后端",
            mission: "负责服务端。",
            status: "active",
          },
          workspacePolicy: {
            policyId: "policy-1",
            workspacePath: "/workspace/backend",
            additionalDirectories: ["/workspace/shared", "/workspace/cache"],
            allowNetworkAccess: false,
          },
          runtimeProfile: {
            profileId: "profile-1",
            accessMode: "third-party",
            thirdPartyProviderId: "gateway-a",
            model: "gpt-5.4-mini",
            reasoning: "high",
            memoryMode: "confirm",
            sandboxMode: "danger-full-access",
            approvalPolicy: "on-request",
            webSearchMode: "disabled",
            networkAccessEnabled: false,
          },
          authAccounts: [{ accountId: "acct-1", label: "默认账号" }],
          thirdPartyProviders: [{ id: "gateway-a", name: "Gateway A" }],
        });
      }

      if (url === "/api/agents/work-items/list") {
        return jsonResponse({ workItems: [] });
      }

      if (url === "/api/agents/mailbox/list") {
        return jsonResponse({ items: [] });
      }

      if (url === "/api/agents/handoffs/list") {
        return jsonResponse({ handoffs: [], timeline: [] });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    await controller.saveExecutionBoundary();

    assert.equal(calls[0].url, "/api/agents/execution-boundary/update");
    assert.deepEqual(calls[0].body.boundary.workspacePolicy, {
      workspacePath: "/workspace/backend",
      additionalDirectories: ["/workspace/shared", "/workspace/cache"],
      allowNetworkAccess: false,
    });
    assert.deepEqual(calls[0].body.boundary.runtimeProfile, {
      accessMode: "third-party",
      thirdPartyProviderId: "gateway-a",
      model: "gpt-5.4-mini",
      reasoning: "high",
      memoryMode: "confirm",
      sandboxMode: "danger-full-access",
      approvalPolicy: "on-request",
      webSearchMode: "disabled",
      networkAccessEnabled: false,
    });
    assert.equal(app.runtime.agents.noticeMessage, "已更新当前 agent 的默认执行边界。");
    assert.equal(app.runtime.agents.selectedWorkspacePolicy.workspacePath, "/workspace/backend");
    assert.equal(app.runtime.agents.selectedRuntimeProfile.thirdPartyProviderId, "gateway-a");
    assert.equal(app.runtime.agents.executionBoundaryDraft.workspacePath, "/workspace/backend");
    assert.equal(app.runtime.agents.executionBoundaryDraft.accessMode, "third-party");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ignoreSpawnSuggestion 与 restoreSpawnSuggestion 会提交治理动作并刷新建议列表", async () => {
  const state = createDefaultAgentsState();
  state.organizations = [{ organizationId: "org-1", displayName: "老板团队" }];
  state.agents = [
    {
      agentId: "agent-ops",
      organizationId: "org-1",
      principalId: "principal-ops",
      displayName: "运维·曜",
      departmentRole: "运维",
      mission: "负责发布和值班。",
      status: "active",
    },
  ];
  state.selectedAgentId = "agent-ops";
  state.spawnSuggestions = [
    {
      suggestionId: "spawn-suggestion-1",
      organizationId: "org-1",
      departmentRole: "运维",
      displayName: "运维·砺",
      mission: "负责运维值班与巡检分流。",
      rationale: "运维积压较高，建议增员。",
      supportingAgentId: "agent-ops",
      supportingAgentDisplayName: "运维·曜",
      suggestedSupervisorAgentId: "agent-ops",
      openWorkItemCount: 4,
      waitingWorkItemCount: 1,
      highPriorityWorkItemCount: 2,
      spawnPolicy: {
        organizationId: "org-1",
        maxActiveAgents: 12,
        maxActiveAgentsPerRole: 3,
      },
      guardrail: {
        organizationActiveAgentCount: 1,
        organizationActiveAgentLimit: 12,
        roleActiveAgentCount: 1,
        roleActiveAgentLimit: 3,
        blocked: false,
      },
      auditFacts: {
        creationReason: "运维积压较高，建议增员。",
        expectedScope: "负责分担运维持续性工作。",
        insufficiencyReason: "当前积压较高。",
        namingBasis: "沿用自动命名规则。",
      },
    },
  ];
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/spawn-ignore") {
        return jsonResponse({
          suppressedSuggestion: {
            suggestionId: "spawn-suggestion-1",
            organizationId: "org-1",
            displayName: "运维·砺",
            departmentRole: "运维",
            suppressionState: "ignored",
          },
          auditLog: {
            eventType: "spawn_suggestion_ignored",
          },
        });
      }

      if (url === "/api/agents/spawn-restore") {
        return jsonResponse({
          auditLog: {
            eventType: "spawn_suggestion_restored",
          },
        });
      }

      if (url === "/api/agents/spawn-suggestions") {
        const ignored = calls.some((entry) => entry.url === "/api/agents/spawn-ignore");
        const restored = calls.some((entry) => entry.url === "/api/agents/spawn-restore");
        return jsonResponse({
          spawnPolicies: [
            {
              organizationId: "org-1",
              maxActiveAgents: 12,
              maxActiveAgentsPerRole: 3,
            },
          ],
          suggestions: restored
            ? state.spawnSuggestions
            : ignored
              ? []
              : state.spawnSuggestions,
          suppressedSuggestions: ignored && !restored
            ? [
              {
                suggestionId: "spawn-suggestion-1",
                organizationId: "org-1",
                departmentRole: "运维",
                displayName: "运维·砺",
                suppressionState: "ignored",
              },
            ]
            : [],
          recentAuditLogs: [],
        });
      }

      if (url === "/api/agents/idle-suggestions") {
        return jsonResponse({
          suggestions: [],
          recentAuditLogs: [],
        });
      }

      if (url === "/api/agents/list") {
        return jsonResponse({
          organizations: state.organizations,
          agents: state.agents,
        });
      }

      if (url === "/api/agents/waiting/list") {
        return jsonResponse({
          summary: {
            totalCount: 0,
            waitingHumanCount: 0,
            waitingAgentCount: 0,
            escalationCount: 0,
          },
          items: [],
        });
      }

      if (url === "/api/agents/detail") {
        return jsonResponse({
          organization: state.organizations[0],
          principal: { principalId: "principal-ops" },
          agent: state.agents[0],
        });
      }

      if (url === "/api/agents/work-items/list") {
        return jsonResponse({ workItems: [] });
      }

      if (url === "/api/agents/mailbox/list") {
        return jsonResponse({ items: [] });
      }

      if (url === "/api/agents/handoffs/list") {
        return jsonResponse({ handoffs: [], timeline: [] });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    await controller.ignoreSpawnSuggestion("spawn-suggestion-1");

    assert.equal(calls[0].url, "/api/agents/spawn-ignore");
    assert.equal(calls[0].body.suggestion.suggestionId, "spawn-suggestion-1");
    assert.equal(app.runtime.agents.noticeMessage, "已忽略自动创建建议 运维·砺。");

    app.runtime.agents.suppressedSpawnSuggestions = [
      {
        suggestionId: "spawn-suggestion-1",
        organizationId: "org-1",
        displayName: "运维·砺",
        departmentRole: "运维",
        suppressionState: "ignored",
      },
    ];

    await controller.restoreSpawnSuggestion("spawn-suggestion-1");

    assert.equal(calls.find((entry) => entry.url === "/api/agents/spawn-restore")?.body.suggestion.suggestionId, "spawn-suggestion-1");
    assert.equal(app.runtime.agents.noticeMessage, "已恢复自动创建建议 运维·砺。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("approveIdleRecoverySuggestion 会提交空闲回收治理并刷新列表", async () => {
  const state = createDefaultAgentsState();
  state.organizations = [{ organizationId: "org-1", displayName: "老板团队" }];
  state.agents = [
    {
      agentId: "agent-ops",
      organizationId: "org-1",
      principalId: "principal-ops",
      displayName: "运维·砺",
      departmentRole: "运维",
      mission: "负责运维值班与巡检分流。",
      creationMode: "auto",
      status: "active",
    },
  ];
  state.selectedAgentId = "agent-ops";
  state.idleRecoverySuggestions = [
    {
      suggestionId: "idle-suggestion-1",
      organizationId: "org-1",
      agentId: "agent-ops",
      displayName: "运维·砺",
      departmentRole: "运维",
      currentStatus: "active",
      creationMode: "auto",
      recommendedAction: "pause",
      idleSinceAt: "2026-04-03T09:00:00.000Z",
      idleHours: 99,
      lastActivityAt: "2026-04-03T09:00:00.000Z",
      lastActivitySummary: "最近一次 handoff 已完成交接。",
      openWorkItemCount: 0,
      pendingMailboxCount: 0,
      recentClosedWorkItemCount: 1,
      recentHandoffCount: 1,
      rationale: "该 auto agent 已连续空闲 99 小时，且当前没有未完成任务或待处理 mailbox。",
    },
  ];
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/idle-approve") {
        return jsonResponse({
          agent: {
            agentId: "agent-ops",
            status: "paused",
          },
          auditLog: {
            eventType: "idle_recovery_pause_approved",
          },
        });
      }

      if (url === "/api/agents/idle-suggestions") {
        return jsonResponse({
          suggestions: [],
          recentAuditLogs: [
            {
              auditLogId: "agent-audit-idle-1",
              eventType: "idle_recovery_pause_approved",
              displayName: "运维·砺",
              departmentRole: "运维",
              summary: "已按建议暂停空闲 agent 运维·砺。",
              createdAt: "2026-04-07T12:00:00.000Z",
            },
          ],
        });
      }

      if (url === "/api/agents/spawn-suggestions") {
        return jsonResponse({
          spawnPolicies: [],
          suggestions: [],
          suppressedSuggestions: [],
          recentAuditLogs: [],
        });
      }

      if (url === "/api/agents/list") {
        return jsonResponse({
          organizations: state.organizations,
          agents: [
            {
              ...state.agents[0],
              status: "paused",
            },
          ],
        });
      }

      if (url === "/api/agents/waiting/list") {
        return jsonResponse({
          summary: {
            totalCount: 0,
            waitingHumanCount: 0,
            waitingAgentCount: 0,
            escalationCount: 0,
          },
          items: [],
        });
      }

      if (url === "/api/agents/detail") {
        return jsonResponse({
          organization: state.organizations[0],
          principal: { principalId: "principal-ops" },
          agent: {
            ...state.agents[0],
            status: "paused",
          },
        });
      }

      if (url === "/api/agents/work-items/list") {
        return jsonResponse({ workItems: [] });
      }

      if (url === "/api/agents/mailbox/list") {
        return jsonResponse({ items: [] });
      }

      if (url === "/api/agents/handoffs/list") {
        return jsonResponse({ handoffs: [], timeline: [] });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    await controller.approveIdleRecoverySuggestion("idle-suggestion-1");

    assert.equal(calls[0].url, "/api/agents/idle-approve");
    assert.equal(calls[0].body.suggestion.suggestionId, "idle-suggestion-1");
    assert.equal(calls[0].body.suggestion.agentId, "agent-ops");
    assert.equal(calls[0].body.suggestion.action, "pause");
    assert.equal(app.runtime.agents.noticeMessage, "已按建议暂停 运维·砺。");
    assert.equal(app.runtime.agents.selectedAgentId, "agent-ops");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dispatchWorkItem 会发送结构化派工并刷新目标 agent 详情", async () => {
  const state = createDefaultAgentsState();
  state.agents = [
    {
      agentId: "agent-frontend",
      principalId: "principal-frontend",
      displayName: "前端·澄",
      departmentRole: "前端",
      mission: "负责 Web 工作台。",
      status: "active",
    },
    {
      agentId: "agent-backend",
      principalId: "principal-backend",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责服务端。",
      status: "active",
    },
  ];
  state.selectedAgentId = "agent-backend";
  state.dispatchDraft = {
    targetAgentId: "agent-backend",
    sourceType: "agent",
    sourceAgentId: "agent-frontend",
    dispatchReason: "前端需要新的详情接口",
    goal: "补 work-item detail 接口",
    contextPacketText: "{\"ticket\":\"AG-2\"}",
    priority: "urgent",
  };
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/spawn-suggestions") {
        return jsonResponse({ suggestions: [] });
      }

      if (url === "/api/agents/idle-suggestions") {
        return jsonResponse({ suggestions: [], recentAuditLogs: [] });
      }

      if (url === "/api/agents/dispatch") {
        return jsonResponse({
          targetAgent: {
            agentId: "agent-backend",
          },
          workItem: {
            workItemId: "work-item-2",
          },
        });
      }

      if (url === "/api/agents/list") {
        return jsonResponse({
          organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
          agents: state.agents,
        });
      }

      if (url === "/api/agents/waiting/list") {
        return jsonResponse({
          summary: {
            totalCount: 0,
            waitingHumanCount: 0,
            waitingAgentCount: 0,
            escalationCount: 0,
          },
          items: [],
        });
      }

      if (url === "/api/agents/detail") {
        return jsonResponse({
          organization: { organizationId: "org-1", displayName: "老板团队" },
          principal: { principalId: "principal-backend" },
          agent: state.agents[1],
        });
      }

      if (url === "/api/agents/work-items/list") {
        return jsonResponse({
          workItems: [
            {
              workItemId: "work-item-2",
              targetAgentId: "agent-backend",
              status: "queued",
              sourceType: "agent",
              goal: "补 work-item detail 接口",
            },
          ],
        });
      }

      if (url === "/api/agents/mailbox/list") {
        return jsonResponse({ items: [] });
      }

      if (url === "/api/agents/handoffs/list") {
        return jsonResponse({ handoffs: [], timeline: [] });
      }

      if (url === "/api/agents/work-items/detail") {
        return jsonResponse({
          workItem: {
            workItemId: "work-item-2",
            goal: "补 work-item detail 接口",
            status: "queued",
          },
          targetAgent: {
            agentId: "agent-backend",
          },
          sourceAgent: {
            agentId: "agent-frontend",
          },
          messages: [],
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    await controller.dispatchWorkItem();

    assert.equal(calls[0].url, "/api/agents/dispatch");
    assert.equal(calls[0].body.workItem.targetAgentId, "agent-backend");
    assert.equal(calls[0].body.workItem.sourceType, "agent");
    assert.equal(calls[0].body.workItem.sourceAgentId, "agent-frontend");
    assert.equal(calls[0].body.workItem.priority, "urgent");
    assert.deepEqual(calls[0].body.workItem.contextPacket, { ticket: "AG-2" });
    assert.equal(app.runtime.agents.noticeMessage, "已把任务派给目标 agent。");
    assert.equal(app.runtime.agents.dispatchDraft.dispatchReason, "");
    assert.equal(app.runtime.agents.selectedWorkItemId, "work-item-2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dispatchWorkItem 在当前父任务下派 agent 子任务时会自动挂上 parentWorkItemId，并留在父任务详情页", async () => {
  const state = createDefaultAgentsState();
  state.agents = [
    {
      agentId: "agent-manager",
      principalId: "principal-manager",
      displayName: "经理·曜",
      departmentRole: "经理",
      mission: "负责拆解任务与汇总结果。",
      status: "active",
    },
    {
      agentId: "agent-backend",
      principalId: "principal-backend",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责服务端。",
      status: "active",
    },
  ];
  state.selectedAgentId = "agent-manager";
  state.selectedWorkItemId = "work-item-parent-1";
  state.selectedWorkItemDetail = {
    workItem: {
      workItemId: "work-item-parent-1",
      targetAgentId: "agent-manager",
      status: "running",
      goal: "汇总当前协作进展",
    },
    targetAgent: {
      agentId: "agent-manager",
      displayName: "经理·曜",
    },
    messages: [],
  };
  state.dispatchDraft = {
    targetAgentId: "agent-backend",
    sourceType: "agent",
    sourceAgentId: "agent-manager",
    dispatchReason: "把接口汇总交给后端",
    goal: "补 child summary 接口",
    contextPacketText: "",
    priority: "high",
  };
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/spawn-suggestions") {
        return jsonResponse({ suggestions: [] });
      }

      if (url === "/api/agents/idle-suggestions") {
        return jsonResponse({ suggestions: [], recentAuditLogs: [] });
      }

      if (url === "/api/agents/dispatch") {
        return jsonResponse({
          targetAgent: {
            agentId: "agent-backend",
          },
          workItem: {
            workItemId: "work-item-child-1",
          },
        });
      }

      if (url === "/api/agents/list") {
        return jsonResponse({
          organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
          agents: state.agents,
        });
      }

      if (url === "/api/agents/waiting/list") {
        return jsonResponse({
          summary: {
            totalCount: 0,
            waitingHumanCount: 0,
            waitingAgentCount: 0,
            escalationCount: 0,
          },
          items: [],
        });
      }

      if (url === "/api/agents/detail") {
        return jsonResponse({
          organization: { organizationId: "org-1", displayName: "老板团队" },
          principal: { principalId: "principal-manager" },
          agent: state.agents[0],
        });
      }

      if (url === "/api/agents/work-items/list") {
        return jsonResponse({
          workItems: [
            {
              workItemId: "work-item-parent-1",
              targetAgentId: "agent-manager",
              status: "running",
              sourceType: "human",
              goal: "汇总当前协作进展",
            },
            {
              workItemId: "work-item-child-1",
              targetAgentId: "agent-backend",
              parentWorkItemId: "work-item-parent-1",
              status: "queued",
              sourceType: "agent",
              goal: "补 child summary 接口",
            },
          ],
        });
      }

      if (url === "/api/agents/mailbox/list") {
        return jsonResponse({ items: [] });
      }

      if (url === "/api/agents/handoffs/list") {
        return jsonResponse({ handoffs: [], timeline: [] });
      }

      if (url === "/api/agents/work-items/detail") {
        return jsonResponse({
          workItem: {
            workItemId: "work-item-parent-1",
            targetAgentId: "agent-manager",
            status: "running",
            goal: "汇总当前协作进展",
          },
          targetAgent: {
            agentId: "agent-manager",
            displayName: "经理·曜",
          },
          childSummary: {
            totalCount: 1,
            openCount: 1,
            waitingCount: 0,
            completedCount: 0,
            failedCount: 0,
            cancelledCount: 0,
          },
          childWorkItems: [
            {
              workItem: {
                workItemId: "work-item-child-1",
                targetAgentId: "agent-backend",
                status: "queued",
                goal: "补 child summary 接口",
              },
              targetAgent: {
                agentId: "agent-backend",
                displayName: "后端·衡",
              },
              latestHandoff: null,
            },
          ],
          messages: [],
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    await controller.dispatchWorkItem();

    assert.equal(calls[0].url, "/api/agents/dispatch");
    assert.equal(calls[0].body.workItem.parentWorkItemId, "work-item-parent-1");
    assert.equal(app.runtime.agents.noticeMessage, "已为当前 work item 派出下游子任务。");
    assert.equal(app.runtime.agents.selectedAgentId, "agent-manager");
    assert.equal(app.runtime.agents.selectedWorkItemId, "work-item-parent-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("respondHumanWaitingWorkItem 会提交治理回复并刷新当前 work item", async () => {
  const state = createDefaultAgentsState();
  state.agents = [
    {
      agentId: "agent-ops",
      principalId: "principal-ops",
      displayName: "运维·曜",
      departmentRole: "运维",
      mission: "负责发布和值班。",
      status: "active",
    },
  ];
  state.selectedAgentId = "agent-ops";
  state.selectedWorkItemId = "work-item-1";
  state.selectedWorkItemDetail = {
    workItem: {
      workItemId: "work-item-1",
      targetAgentId: "agent-ops",
      status: "waiting_human",
      goal: "确认是否可以继续发布",
      waitingActionRequest: {
        actionType: "approval",
        prompt: "是否允许继续执行发布命令？",
        choices: ["approve", "deny"],
      },
    },
    targetAgent: {
      agentId: "agent-ops",
    },
    messages: [],
  };
  state.humanResponseDraft = {
    workItemId: "work-item-1",
    decision: "approve",
    inputText: "可以继续，但请补 release note。",
  };
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/spawn-suggestions") {
        return jsonResponse({ suggestions: [] });
      }

      if (url === "/api/agents/idle-suggestions") {
        return jsonResponse({ suggestions: [], recentAuditLogs: [] });
      }

      if (url === "/api/agents/work-items/respond") {
        return jsonResponse({
          ok: true,
          workItem: {
            workItemId: "work-item-1",
            status: "queued",
          },
        });
      }

      if (url === "/api/agents/list") {
        return jsonResponse({
          organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
          agents: state.agents,
        });
      }

      if (url === "/api/agents/waiting/list") {
        return jsonResponse({
          summary: {
            totalCount: 1,
            waitingHumanCount: 0,
            waitingAgentCount: 1,
            escalationCount: 0,
          },
          items: [
            {
              workItem: {
                workItemId: "work-item-1",
                targetAgentId: "agent-ops",
                status: "queued",
                goal: "确认是否可以继续发布",
              },
              targetAgent: state.agents[0],
              sourceAgent: null,
              sourcePrincipal: {
                principalId: "principal-owner",
                displayName: "Owner",
              },
              latestWaitingMessage: null,
            },
          ],
        });
      }

      if (url === "/api/agents/detail") {
        return jsonResponse({
          organization: { organizationId: "org-1", displayName: "老板团队" },
          principal: { principalId: "principal-ops" },
          agent: state.agents[0],
        });
      }

      if (url === "/api/agents/work-items/list") {
        return jsonResponse({
          workItems: [
            {
              workItemId: "work-item-1",
              targetAgentId: "agent-ops",
              status: "queued",
              sourceType: "human",
              goal: "确认是否可以继续发布",
            },
          ],
        });
      }

      if (url === "/api/agents/mailbox/list") {
        return jsonResponse({ items: [] });
      }

      if (url === "/api/agents/handoffs/list") {
        return jsonResponse({ handoffs: [], timeline: [] });
      }

      if (url === "/api/agents/work-items/detail") {
        return jsonResponse({
          workItem: {
            workItemId: "work-item-1",
            targetAgentId: "agent-ops",
            status: "queued",
            goal: "确认是否可以继续发布",
          },
          targetAgent: {
            agentId: "agent-ops",
          },
          messages: [],
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    await controller.respondHumanWaitingWorkItem("work-item-1");

    assert.equal(calls[0].url, "/api/agents/work-items/respond");
    assert.equal(calls[0].body.workItemId, "work-item-1");
    assert.equal(calls[0].body.response.decision, "approve");
    assert.equal(calls[0].body.response.inputText, "可以继续，但请补 release note。");
    assert.equal(app.runtime.agents.noticeMessage, "已提交治理回复，work item 已重新排队。");
    assert.equal(app.runtime.agents.humanResponseDraft.workItemId, "");
    assert.equal(app.runtime.agents.selectedWorkItemDetail?.workItem?.status, "queued");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("respondOrganizationWaitingWorkItem 会在组织级等待队列直接提交治理回复", async () => {
  const state = createDefaultAgentsState();
  state.agents = [
    {
      agentId: "agent-ops",
      principalId: "principal-ops",
      displayName: "运维·曜",
      departmentRole: "运维",
      mission: "负责发布和值班。",
      status: "active",
    },
  ];
  state.selectedAgentId = "agent-ops";
  state.selectedWorkItemId = "work-item-1";
  state.selectedWorkItemDetail = {
    workItem: {
      workItemId: "work-item-1",
      targetAgentId: "agent-ops",
      status: "waiting_human",
      goal: "确认是否可以继续发布",
      waitingActionRequest: {
        actionType: "approval",
        prompt: "是否允许继续执行发布命令？",
        choices: ["approve", "deny"],
      },
    },
    targetAgent: {
      agentId: "agent-ops",
    },
    messages: [],
  };
  state.organizationWaitingItems = [
    {
      workItem: {
        workItemId: "work-item-1",
        targetAgentId: "agent-ops",
        status: "waiting_human",
        goal: "确认是否可以继续发布",
        waitingActionRequest: {
          actionType: "approval",
          prompt: "是否允许继续执行发布命令？",
          choices: ["approve", "deny"],
        },
      },
      targetAgent: state.agents[0],
      sourceAgent: null,
      sourcePrincipal: {
        principalId: "principal-owner",
        displayName: "Owner",
      },
      latestWaitingMessage: null,
    },
  ];
  state.organizationWaitingResponseDrafts = {
    "work-item-1": {
      decision: "deny",
      inputText: "先暂停，等监控恢复正常。",
    },
  };
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/spawn-suggestions") {
        return jsonResponse({ suggestions: [] });
      }

      if (url === "/api/agents/idle-suggestions") {
        return jsonResponse({ suggestions: [], recentAuditLogs: [] });
      }

      if (url === "/api/agents/work-items/respond") {
        return jsonResponse({
          ok: true,
          workItem: {
            workItemId: "work-item-1",
            status: "queued",
          },
        });
      }

      if (url === "/api/agents/list") {
        return jsonResponse({
          organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
          agents: state.agents,
        });
      }

      if (url === "/api/agents/waiting/list") {
        return jsonResponse({
          summary: {
            totalCount: 0,
            waitingHumanCount: 0,
            waitingAgentCount: 0,
            escalationCount: 0,
          },
          items: [],
        });
      }

      if (url === "/api/agents/detail") {
        return jsonResponse({
          organization: { organizationId: "org-1", displayName: "老板团队" },
          principal: { principalId: "principal-ops" },
          agent: state.agents[0],
        });
      }

      if (url === "/api/agents/work-items/list") {
        return jsonResponse({
          workItems: [
            {
              workItemId: "work-item-1",
              targetAgentId: "agent-ops",
              status: "queued",
              sourceType: "human",
              goal: "确认是否可以继续发布",
            },
          ],
        });
      }

      if (url === "/api/agents/mailbox/list") {
        return jsonResponse({ items: [] });
      }

      if (url === "/api/agents/handoffs/list") {
        return jsonResponse({ handoffs: [], timeline: [] });
      }

      if (url === "/api/agents/work-items/detail") {
        return jsonResponse({
          workItem: {
            workItemId: "work-item-1",
            targetAgentId: "agent-ops",
            status: "queued",
            goal: "确认是否可以继续发布",
          },
          targetAgent: {
            agentId: "agent-ops",
          },
          messages: [],
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    await controller.respondOrganizationWaitingWorkItem("work-item-1");

    assert.equal(calls[0].url, "/api/agents/work-items/respond");
    assert.equal(calls[0].body.workItemId, "work-item-1");
    assert.equal(calls[0].body.response.decision, "deny");
    assert.equal(calls[0].body.response.inputText, "先暂停，等监控恢复正常。");
    assert.equal(app.runtime.agents.noticeMessage, "已从组织级等待队列提交治理回复。");
    assert.equal(app.runtime.agents.organizationWaitingResponseDrafts["work-item-1"], undefined);
    assert.equal(app.runtime.agents.humanResponseDraft.workItemId, "");
    assert.equal(app.runtime.agents.selectedWorkItemDetail?.workItem?.status, "queued");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("escalateOrganizationWaitingWorkItem 会把 waiting_agent 升级到顶层治理", async () => {
  const state = createDefaultAgentsState();
  state.agents = [
    {
      agentId: "agent-frontend",
      principalId: "principal-frontend",
      displayName: "前端·岚",
      departmentRole: "前端",
      mission: "负责 Web 工作台。",
      status: "active",
    },
    {
      agentId: "agent-backend",
      principalId: "principal-backend",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责接口与存储。",
      status: "active",
    },
  ];
  state.organizationWaitingItems = [
    {
      workItem: {
        workItemId: "work-item-2",
        targetAgentId: "agent-backend",
        status: "waiting_agent",
        goal: "确认是否可以继续部署",
        waitingActionRequest: {
          waitingFor: "agent",
          actionType: "approval",
          prompt: "是否允许执行 deploy production？",
          choices: ["approve", "deny"],
        },
      },
      targetAgent: state.agents[1],
      sourceAgent: state.agents[0],
      sourcePrincipal: {
        principalId: "principal-owner",
        displayName: "Owner",
      },
      latestWaitingMessage: {
        messageId: "msg-waiting-2",
        messageType: "approval_request",
      },
    },
  ];
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/spawn-suggestions") {
        return jsonResponse({ suggestions: [] });
      }

      if (url === "/api/agents/idle-suggestions") {
        return jsonResponse({ suggestions: [], recentAuditLogs: [] });
      }

      if (url === "/api/agents/work-items/escalate") {
        return jsonResponse({
          ok: true,
          workItem: {
            workItemId: "work-item-2",
            status: "waiting_human",
          },
          ackedMailboxEntries: [
            {
              mailboxEntryId: "mailbox-waiting-2",
              status: "acked",
            },
          ],
        });
      }

      if (url === "/api/agents/list") {
        return jsonResponse({
          organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
          agents: state.agents,
        });
      }

      if (url === "/api/agents/waiting/list") {
        return jsonResponse({
          summary: {
            totalCount: 1,
            waitingHumanCount: 1,
            waitingAgentCount: 0,
            escalationCount: 1,
          },
          items: [
            {
              workItem: {
                workItemId: "work-item-2",
                targetAgentId: "agent-backend",
                status: "waiting_human",
                goal: "确认是否可以继续部署",
                waitingActionRequest: {
                  waitingFor: "human",
                  sourceType: "agent_escalation",
                  actionType: "approval",
                  prompt: "是否允许执行 deploy production？",
                  choices: ["approve", "deny"],
                },
              },
              targetAgent: state.agents[1],
              sourceAgent: state.agents[0],
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
        });
      }

      if (url === "/api/agents/detail") {
        return jsonResponse({
          organization: { organizationId: "org-1", displayName: "老板团队" },
          principal: { principalId: "principal-backend" },
          agent: state.agents[1],
        });
      }

      if (url === "/api/agents/work-items/list") {
        return jsonResponse({
          workItems: [
            {
              workItemId: "work-item-2",
              targetAgentId: "agent-backend",
              status: "waiting_human",
              sourceType: "agent",
              goal: "确认是否可以继续部署",
            },
          ],
        });
      }

      if (url === "/api/agents/mailbox/list") {
        return jsonResponse({ items: [] });
      }

      if (url === "/api/agents/handoffs/list") {
        return jsonResponse({ handoffs: [], timeline: [] });
      }

      if (url === "/api/agents/work-items/detail") {
        return jsonResponse({
          workItem: {
            workItemId: "work-item-2",
            targetAgentId: "agent-backend",
            status: "waiting_human",
            goal: "确认是否可以继续部署",
            waitingActionRequest: {
              waitingFor: "human",
              sourceType: "agent_escalation",
              actionType: "approval",
              prompt: "是否允许执行 deploy production？",
              choices: ["approve", "deny"],
            },
          },
          targetAgent: {
            agentId: "agent-backend",
          },
          sourceAgent: {
            agentId: "agent-frontend",
          },
          messages: [],
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    await controller.escalateOrganizationWaitingWorkItem("work-item-2");

    assert.equal(calls[0].url, "/api/agents/work-items/escalate");
    assert.equal(calls[0].body.workItemId, "work-item-2");
    assert.equal(calls[0].body.escalation.inputText, "由顶层 Themis 接管当前等待中的 agent 阻塞。");
    assert.equal(app.runtime.agents.noticeMessage, "已把等待中的 agent 阻塞升级到顶层治理。");
    assert.equal(app.runtime.agents.organizationWaitingItems[0]?.workItem?.status, "waiting_human");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cancelWorkItem 会调用取消接口并刷新当前 work item 详情", async () => {
  const state = createDefaultAgentsState();
  state.agents = [
    {
      agentId: "agent-backend",
      principalId: "principal-backend",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责接口与存储。",
      status: "active",
    },
  ];
  state.selectedAgentId = "agent-backend";
  state.selectedWorkItemId = "work-item-3";
  state.selectedWorkItemDetail = {
    workItem: {
      workItemId: "work-item-3",
      targetAgentId: "agent-backend",
      status: "queued",
      goal: "这条任务现在应该被取消",
    },
    targetAgent: {
      agentId: "agent-backend",
    },
    messages: [],
  };
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/spawn-suggestions") {
        return jsonResponse({ suggestions: [] });
      }

      if (url === "/api/agents/idle-suggestions") {
        return jsonResponse({ suggestions: [], recentAuditLogs: [] });
      }

      if (url === "/api/agents/work-items/cancel") {
        return jsonResponse({
          ok: true,
          workItem: {
            workItemId: "work-item-3",
            status: "cancelled",
          },
        });
      }

      if (url === "/api/agents/list") {
        return jsonResponse({
          organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
          agents: state.agents,
        });
      }

      if (url === "/api/agents/waiting/list") {
        return jsonResponse({
          summary: {
            totalCount: 0,
            waitingHumanCount: 0,
            waitingAgentCount: 0,
            escalationCount: 0,
          },
          items: [],
        });
      }

      if (url === "/api/agents/detail") {
        return jsonResponse({
          organization: { organizationId: "org-1", displayName: "老板团队" },
          principal: { principalId: "principal-backend" },
          agent: state.agents[0],
        });
      }

      if (url === "/api/agents/work-items/list") {
        return jsonResponse({
          workItems: [
            {
              workItemId: "work-item-3",
              targetAgentId: "agent-backend",
              status: "cancelled",
              sourceType: "human",
              goal: "这条任务现在应该被取消",
            },
          ],
        });
      }

      if (url === "/api/agents/mailbox/list") {
        return jsonResponse({ items: [] });
      }

      if (url === "/api/agents/handoffs/list") {
        return jsonResponse({ handoffs: [], timeline: [] });
      }

      if (url === "/api/agents/work-items/detail") {
        return jsonResponse({
          workItem: {
            workItemId: "work-item-3",
            targetAgentId: "agent-backend",
            status: "cancelled",
            goal: "这条任务现在应该被取消",
          },
          targetAgent: {
            agentId: "agent-backend",
          },
          messages: [],
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    await controller.cancelWorkItem("work-item-3");

    assert.equal(calls[0].url, "/api/agents/work-items/cancel");
    assert.equal(calls[0].body.workItemId, "work-item-3");
    assert.equal(app.runtime.agents.noticeMessage, "已取消该条 work item。");
    assert.equal(app.runtime.agents.cancelingWorkItemId, "");
    assert.equal(app.runtime.agents.selectedWorkItemDetail?.workItem?.status, "cancelled");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pauseManagedAgent 会调用 lifecycle 接口并刷新当前 agent 详情", async () => {
  const state = createDefaultAgentsState();
  state.selectedAgentId = "agent-ops";
  state.agents = [
    {
      agentId: "agent-ops",
      principalId: "principal-ops",
      displayName: "运维·曜",
      departmentRole: "运维",
      mission: "负责部署与值班。",
      status: "active",
    },
  ];
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/spawn-suggestions") {
        return jsonResponse({ suggestions: [] });
      }

      if (url === "/api/agents/idle-suggestions") {
        return jsonResponse({ suggestions: [], recentAuditLogs: [] });
      }

      if (url === "/api/agents/pause") {
        return jsonResponse({
          agent: {
            agentId: "agent-ops",
            status: "paused",
          },
        });
      }

      if (url === "/api/agents/list") {
        return jsonResponse({
          organizations: [{ organizationId: "org-1", displayName: "老板团队" }],
          agents: [
            {
              agentId: "agent-ops",
              principalId: "principal-ops",
              displayName: "运维·曜",
              departmentRole: "运维",
              mission: "负责部署与值班。",
              status: "paused",
            },
          ],
        });
      }

      if (url === "/api/agents/waiting/list") {
        return jsonResponse({
          summary: {
            totalCount: 0,
            waitingHumanCount: 0,
            waitingAgentCount: 0,
            escalationCount: 0,
          },
          items: [],
        });
      }

      if (url === "/api/agents/detail") {
        return jsonResponse({
          organization: { organizationId: "org-1", displayName: "老板团队" },
          principal: { principalId: "principal-ops" },
          agent: {
            agentId: "agent-ops",
            principalId: "principal-ops",
            displayName: "运维·曜",
            departmentRole: "运维",
            mission: "负责部署与值班。",
            status: "paused",
          },
        });
      }

      if (url === "/api/agents/work-items/list") {
        return jsonResponse({ workItems: [] });
      }

      if (url === "/api/agents/mailbox/list") {
        return jsonResponse({ items: [] });
      }

      if (url === "/api/agents/handoffs/list") {
        return jsonResponse({ handoffs: [], timeline: [] });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    await controller.pauseManagedAgent("agent-ops");

    assert.equal(calls[0].url, "/api/agents/pause");
    assert.equal(calls[0].body.agentId, "agent-ops");
    assert.equal(app.runtime.agents.noticeMessage, "已暂停该 agent。");
    assert.equal(app.runtime.agents.selectedAgent?.status, "paused");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ackMailboxEntry 会确认消息并刷新当前 agent 的 mailbox", async () => {
  const state = createDefaultAgentsState();
  state.selectedAgentId = "agent-backend";
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/mailbox/ack") {
        return jsonResponse({
          mailboxEntry: {
            mailboxEntryId: "mailbox-1",
            status: "acked",
          },
        });
      }

      if (url === "/api/agents/detail") {
        return jsonResponse({
          organization: { organizationId: "org-1", displayName: "老板团队" },
          principal: { principalId: "principal-backend" },
          agent: {
            agentId: "agent-backend",
            principalId: "principal-backend",
            displayName: "后端·衡",
            departmentRole: "后端",
            mission: "负责服务端。",
            status: "active",
          },
        });
      }

      if (url === "/api/agents/work-items/list") {
        return jsonResponse({ workItems: [] });
      }

      if (url === "/api/agents/mailbox/list") {
        return jsonResponse({ items: [] });
      }

      if (url === "/api/agents/handoffs/list") {
        return jsonResponse({ handoffs: [], timeline: [] });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    await controller.ackMailboxEntry("mailbox-1", "agent-backend");

    assert.equal(calls[0].url, "/api/agents/mailbox/ack");
    assert.equal(calls[0].body.agentId, "agent-backend");
    assert.equal(calls[0].body.mailboxEntryId, "mailbox-1");
    assert.equal(app.runtime.agents.noticeMessage, "已确认该条内部消息。");
    assert.equal(app.runtime.agents.ackingMailboxEntryId, "");
    assert.equal(app.runtime.agents.selectedAgentId, "agent-backend");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createAppStub(agentsState) {
  return {
    runtime: {
      agents: agentsState,
      identity: {
        browserUserId: "browser-123",
      },
      auth: {
        account: {
          email: "",
        },
      },
      workspaceToolsOpen: false,
      workspaceToolsSection: "runtime",
    },
    renderer: {
      renderAllCallCount: 0,
      renderAll() {
        this.renderAllCallCount += 1;
      },
    },
    dom: {
      agentsRefreshButton: null,
      agentsCreateButton: null,
      agentsSelect: null,
      agentsCreateRoleInput: null,
      agentsCreateNameInput: null,
      agentsCreateMissionInput: null,
      agentsDispatchTargetSelect: null,
      agentsDispatchSourceTypeSelect: null,
      agentsDispatchSourceAgentSelect: null,
      agentsDispatchReasonInput: null,
      agentsDispatchGoalInput: null,
      agentsDispatchContextInput: null,
      agentsDispatchPrioritySelect: null,
      agentsDispatchButton: null,
      agentsList: null,
      agentsWaitingList: null,
      agentsCollaborationList: null,
      agentsSpawnPolicyMaxActiveInput: null,
      agentsSpawnPolicyMaxRoleInput: null,
      agentsSpawnPolicySaveButton: null,
      agentsSpawnSuggestionsList: null,
      agentsSuppressedSpawnSuggestionsList: null,
      agentsIdleRecoverySuggestionsList: null,
      agentsWorkItemsList: null,
      agentsMailboxList: null,
      workspaceToolsPanel: null,
      workspaceToolsToggle: null,
    },
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
