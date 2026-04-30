import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { addOpenAICompatibleProvider } from "./openai-compatible-provider.js";
import { ManagedAgentsService } from "./managed-agents-service.js";

function createServiceContext() {
  const root = mkdtempSync(join(tmpdir(), "themis-managed-agents-service-"));
  const databaseFile = join(root, "infra/local/themis.db");
  const registry = new SqliteCodexSessionRegistry({ databaseFile });
  const service = new ManagedAgentsService({ registry, workingDirectory: root });

  return { root, databaseFile, registry, service };
}

const OPENAI_COMPAT_ENV_KEYS = [
  "THEMIS_OPENAI_COMPAT_BASE_URL",
  "THEMIS_OPENAI_COMPAT_API_KEY",
  "THEMIS_OPENAI_COMPAT_MODEL",
  "THEMIS_OPENAI_COMPAT_NAME",
  "THEMIS_OPENAI_COMPAT_ENDPOINT_CANDIDATES",
  "THEMIS_OPENAI_COMPAT_WIRE_API",
  "THEMIS_OPENAI_COMPAT_SUPPORTS_WEBSOCKETS",
  "THEMIS_OPENAI_COMPAT_MODEL_CATALOG_JSON",
] as const;

function withClearedOpenAICompatEnv<T>(fn: () => T): T {
  const savedEnv = new Map<string, string | undefined>();

  for (const key of OPENAI_COMPAT_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("ManagedAgentsService 会为 principal 自动补默认 organization，并创建 managed principal", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-06T07:00:00.000Z",
      updatedAt: "2026-04-06T07:00:00.000Z",
    });

    const created = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "前端·澄",
      departmentRole: "前端",
      mission: "负责 Web 工作台相关实现。",
      now: "2026-04-06T07:01:00.000Z",
    });

    assert.equal(created.organization.ownerPrincipalId, "principal-owner");
    assert.equal(created.principal.kind, "managed_agent");
    assert.equal(created.principal.organizationId, created.organization.organizationId);
    assert.equal(created.agent.principalId, created.principal.principalId);
    assert.equal(created.agent.status, "active");
    assert.equal(created.agent.exposurePolicy, "gateway_only");
    assert.equal(created.agent.agentCard?.title, "前端");
    assert.equal(created.agent.agentCard?.responsibilitySummary, "负责 Web 工作台相关实现。");
    assert.match(created.agent.agentCard?.employeeCode ?? "", /^EMP-/);

    const owner = registry.getPrincipal("principal-owner");
    assert.equal(owner?.organizationId, created.organization.organizationId);
    assert.equal(service.listManagedAgents("principal-owner").length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentsService 支持更新员工档案，并保留汇报关系与空列表清空语义", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-16T08:00:00.000Z",
      updatedAt: "2026-04-16T08:00:00.000Z",
    });

    const supervisor = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "交付经理·岚",
      departmentRole: "交付经理",
      now: "2026-04-16T08:01:00.000Z",
    });
    const created = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·衡",
      departmentRole: "后端",
      supervisorAgentId: supervisor.agent.agentId,
      mission: "负责接口实现和存储设计。",
      now: "2026-04-16T08:02:00.000Z",
    });

    const updated = service.updateManagedAgentCard({
      ownerPrincipalId: "principal-owner",
      agentId: created.agent.agentId,
      card: {
        domainTags: ["交易", "结算"],
        skillTags: ["TypeScript", "MySQL"],
        allowedScopes: ["订单服务", "支付回调"],
        forbiddenScopes: [],
        currentFocus: "推进结算链路重构。",
        reviewSummary: "最近两周交付稳定。",
        representativeProjects: ["清结算升级"],
      },
      now: "2026-04-16T08:03:00.000Z",
    });

    assert.equal(updated.agent.agentCard?.reportLine?.supervisorAgentId, supervisor.agent.agentId);
    assert.deepEqual(updated.agent.agentCard?.domainTags, ["交易", "结算"]);
    assert.deepEqual(updated.agent.agentCard?.forbiddenScopes, []);
    assert.equal(updated.agent.agentCard?.currentFocus, "推进结算链路重构。");
    assert.equal(updated.agent.agentCard?.reviewSummary, "最近两周交付稳定。");
    assert.equal(updated.agent.agentCard?.updatedAt, "2026-04-16T08:03:00.000Z");

    assert.throws(
      () => service.updateManagedAgentCard({
        ownerPrincipalId: "principal-owner",
        agentId: created.agent.agentId,
        card: {
          reportLine: {
            supervisorDisplayName: "老板",
          },
        } as never,
      }),
      /Unsupported agent card field\(s\): reportLine/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentsService 在未指定 displayName 时会自动命名并生成唯一 slug", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-04-06T07:10:00.000Z",
      updatedAt: "2026-04-06T07:10:00.000Z",
    });

    const first = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      departmentRole: "ops",
      now: "2026-04-06T07:11:00.000Z",
    });
    const second = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      departmentRole: "ops",
      now: "2026-04-06T07:12:00.000Z",
    });

    assert.match(first.agent.displayName, /^ops·/);
    assert.match(second.agent.displayName, /^ops·/);
    assert.notEqual(first.agent.displayName, second.agent.displayName);
    assert.notEqual(first.agent.slug, second.agent.slug);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentsService 支持 pause、resume、archive 三类 lifecycle 治理动作", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-04-07T01:00:00.000Z",
      updatedAt: "2026-04-07T01:00:00.000Z",
    });

    const created = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      departmentRole: "运维",
      displayName: "运维·曜",
      now: "2026-04-07T01:01:00.000Z",
    });

    const paused = service.pauseManagedAgent(
      "principal-owner",
      created.agent.agentId,
      "2026-04-07T01:02:00.000Z",
    );
    assert.equal(paused.status, "paused");
    assert.equal(paused.updatedAt, "2026-04-07T01:02:00.000Z");

    const resumed = service.resumeManagedAgent(
      "principal-owner",
      created.agent.agentId,
      "2026-04-07T01:03:00.000Z",
    );
    assert.equal(resumed.status, "active");
    assert.equal(resumed.updatedAt, "2026-04-07T01:03:00.000Z");

    const archived = service.archiveManagedAgent(
      "principal-owner",
      created.agent.agentId,
      "2026-04-07T01:04:00.000Z",
    );
    assert.equal(archived.status, "archived");
    assert.equal(archived.updatedAt, "2026-04-07T01:04:00.000Z");

    assert.throws(
      () => service.resumeManagedAgent("principal-owner", created.agent.agentId, "2026-04-07T01:05:00.000Z"),
      /Archived managed agent cannot be resumed\./,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentsService 会为 agent 自动补齐默认执行边界，并绑定当前活跃 auth account", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-04-07T11:00:00.000Z",
      updatedAt: "2026-04-07T11:00:00.000Z",
    });
    registry.saveAuthAccount({
      accountId: "acct-default",
      label: "默认账号",
      codexHome: join(root, "infra/local/codex-auth/acct-default"),
      isActive: true,
      createdAt: "2026-04-07T11:00:30.000Z",
      updatedAt: "2026-04-07T11:00:30.000Z",
    });

    const created = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·衡",
      departmentRole: "后端",
      now: "2026-04-07T11:01:00.000Z",
    });
    const boundary = service.getManagedAgentExecutionBoundary("principal-owner", created.agent.agentId);

    assert.ok(boundary);
    assert.equal(boundary?.agent.defaultWorkspacePolicyId, boundary?.workspacePolicy.policyId);
    assert.equal(boundary?.agent.defaultRuntimeProfileId, boundary?.runtimeProfile.profileId);
    assert.equal(boundary?.workspacePolicy.workspacePath, root);
    assert.deepEqual(boundary?.workspacePolicy.additionalDirectories, []);
    assert.equal(boundary?.workspacePolicy.allowNetworkAccess, true);
    assert.equal(boundary?.runtimeProfile.accessMode, "auth");
    assert.equal(boundary?.runtimeProfile.authAccountId, "acct-default");
    assert.equal(boundary?.runtimeProfile.model, "gpt-5.5");
    assert.equal(boundary?.runtimeProfile.reasoning, "xhigh");
    assert.equal(boundary?.runtimeProfile.sandboxMode, "workspace-write");
    assert.equal(boundary?.runtimeProfile.approvalPolicy, "never");
    assert.equal(boundary?.runtimeProfile.webSearchMode, "live");
    assert.equal(boundary?.runtimeProfile.networkAccessEnabled, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentsService 支持持久化更新默认执行边界", () => {
  withClearedOpenAICompatEnv(() => {
    const { root, registry, service } = createServiceContext();

    try {
      registry.savePrincipal({
        principalId: "principal-owner",
        displayName: "Owner",
        createdAt: "2026-04-07T11:10:00.000Z",
        updatedAt: "2026-04-07T11:10:00.000Z",
      });
      registry.saveAuthAccount({
        accountId: "acct-backup",
        label: "备用账号",
        codexHome: join(root, "infra/local/codex-auth/acct-backup"),
        isActive: true,
        createdAt: "2026-04-07T11:10:10.000Z",
        updatedAt: "2026-04-07T11:10:10.000Z",
      });
      addOpenAICompatibleProvider(root, {
        id: "gateway-a",
        name: "Gateway A",
        baseUrl: "https://gateway.example.com/v1",
        apiKey: "sk-gateway",
      }, registry);

      const created = service.createManagedAgent({
        ownerPrincipalId: "principal-owner",
        displayName: "运维·曜",
        departmentRole: "运维",
        now: "2026-04-07T11:11:00.000Z",
      });
      const workspacePath = join(root, "workspace/ops");
      const sharedPath = join(root, "workspace/shared");
      mkdirSync(workspacePath, { recursive: true });
      mkdirSync(sharedPath, { recursive: true });

      const updated = service.updateManagedAgentExecutionBoundary({
        ownerPrincipalId: "principal-owner",
        agentId: created.agent.agentId,
        workspacePolicy: {
          workspacePath,
          additionalDirectories: [sharedPath, workspacePath, sharedPath],
          allowNetworkAccess: false,
        },
        runtimeProfile: {
          accessMode: "third-party",
          thirdPartyProviderId: "gateway-a",
          model: "gpt-5.4-mini",
          reasoning: "high",
          memoryMode: "confirm",
          sandboxMode: "danger-full-access",
          approvalPolicy: "on-request",
          webSearchMode: "disabled",
          networkAccessEnabled: false,
          secretEnvRefs: [{
            envName: "CLOUDFLARE_API_TOKEN",
            secretRef: "cloudflare-readonly-token",
            required: true,
          }],
        },
        now: "2026-04-07T11:12:00.000Z",
      });
      const reloaded = service.getManagedAgentExecutionBoundary("principal-owner", created.agent.agentId);

      assert.equal(updated.workspacePolicy.workspacePath, workspacePath);
      assert.deepEqual(updated.workspacePolicy.additionalDirectories, [sharedPath]);
      assert.equal(updated.workspacePolicy.allowNetworkAccess, false);
      assert.equal(updated.runtimeProfile.accessMode, "third-party");
      assert.equal(updated.runtimeProfile.thirdPartyProviderId, "gateway-a");
      assert.equal(updated.runtimeProfile.authAccountId, undefined);
      assert.equal(updated.runtimeProfile.model, "gpt-5.4-mini");
      assert.equal(updated.runtimeProfile.reasoning, "high");
      assert.equal(updated.runtimeProfile.memoryMode, "confirm");
      assert.equal(updated.runtimeProfile.sandboxMode, "danger-full-access");
      assert.equal(updated.runtimeProfile.approvalPolicy, "on-request");
      assert.equal(updated.runtimeProfile.webSearchMode, "disabled");
      assert.equal(updated.runtimeProfile.networkAccessEnabled, false);
      assert.deepEqual(updated.runtimeProfile.secretEnvRefs, [{
        envName: "CLOUDFLARE_API_TOKEN",
        secretRef: "cloudflare-readonly-token",
        required: true,
      }]);
      assert.equal(reloaded?.workspacePolicy.workspacePath, workspacePath);
      assert.equal(reloaded?.runtimeProfile.thirdPartyProviderId, "gateway-a");
      assert.deepEqual(reloaded?.runtimeProfile.secretEnvRefs, [{
        envName: "CLOUDFLARE_API_TOKEN",
        secretRef: "cloudflare-readonly-token",
        required: true,
      }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test("ManagedAgentsService 允许保存只存在于远端 worker 的工作区边界", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-04-13T09:00:00.000Z",
      updatedAt: "2026-04-13T09:00:00.000Z",
    });

    const created = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "联调验证·远端工位",
      departmentRole: "联调验证",
      now: "2026-04-13T09:01:00.000Z",
    });

    const updated = service.updateManagedAgentExecutionBoundary({
      ownerPrincipalId: "principal-owner",
      agentId: created.agent.agentId,
      workspacePolicy: {
        workspacePath: "/srv/worker-only/site-a",
        additionalDirectories: ["/mnt/shared/site-a", "/srv/worker-only/site-a"],
        allowNetworkAccess: true,
      },
      now: "2026-04-13T09:02:00.000Z",
    });

    assert.equal(updated.workspacePolicy.workspacePath, "/srv/worker-only/site-a");
    assert.deepEqual(updated.workspacePolicy.additionalDirectories, ["/mnt/shared/site-a"]);
    assert.equal(updated.workspacePolicy.allowNetworkAccess, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentsService 支持持久化项目工作区绑定", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-04-13T08:00:00.000Z",
      updatedAt: "2026-04-13T08:00:00.000Z",
    });

    const created = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "前端·澄",
      departmentRole: "前端",
      mission: "负责网站项目开发。",
      now: "2026-04-13T08:01:00.000Z",
    });
    const boundary = service.getManagedAgentExecutionBoundary("principal-owner", created.agent.agentId);
    const workspacePolicyId = boundary?.workspacePolicy.policyId;
    assert.ok(workspacePolicyId);
    registry.saveManagedAgentNode({
      nodeId: "node-site-a",
      organizationId: created.organization.organizationId,
      displayName: "Site Node A",
      status: "online",
      slotCapacity: 1,
      slotAvailable: 1,
      labels: ["linux"],
      workspaceCapabilities: [boundary?.workspacePolicy.workspacePath ?? root],
      credentialCapabilities: [],
      providerCapabilities: [],
      heartbeatTtlSeconds: 300,
      lastHeartbeatAt: "2026-04-13T08:01:30.000Z",
      createdAt: "2026-04-13T08:01:30.000Z",
      updatedAt: "2026-04-13T08:01:30.000Z",
    });

    const binding = service.upsertProjectWorkspaceBinding({
      ownerPrincipalId: "principal-owner",
      projectId: "project-site-foo",
      displayName: "官网 site-foo",
      organizationId: created.organization.organizationId,
      owningAgentId: created.agent.agentId,
      workspacePolicyId,
      preferredNodeId: "node-site-a",
      continuityMode: "sticky",
      now: "2026-04-13T08:02:00.000Z",
    });

    assert.equal(binding.projectId, "project-site-foo");
    assert.equal(binding.owningAgentId, created.agent.agentId);
    assert.equal(binding.workspacePolicyId, workspacePolicyId);
    assert.equal(binding.canonicalWorkspacePath, boundary?.workspacePolicy.workspacePath);
    assert.equal(binding.preferredNodeId, "node-site-a");
    assert.equal(binding.continuityMode, "sticky");

    const detail = service.getProjectWorkspaceBinding("principal-owner", "project-site-foo");
    assert.equal(detail?.displayName, "官网 site-foo");

    const listed = service.listProjectWorkspaceBindings("principal-owner");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.projectId, "project-site-foo");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentsService 会基于当前负载给出自动创建建议，并预生成默认命名", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-04-07T08:00:00.000Z",
      updatedAt: "2026-04-07T08:00:00.000Z",
    });

    const ops = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·曜",
      departmentRole: "运维",
      now: "2026-04-07T08:01:00.000Z",
    });

    registry.saveAgentWorkItem({
      workItemId: "work-item-overload-1",
      organizationId: ops.organization.organizationId,
      targetAgentId: ops.agent.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-owner",
      dispatchReason: "发布巡检",
      goal: "跟进本周发布巡检",
      priority: "urgent",
      status: "running",
      createdAt: "2026-04-07T08:02:00.000Z",
      updatedAt: "2026-04-07T08:02:00.000Z",
    });
    registry.saveAgentWorkItem({
      workItemId: "work-item-overload-2",
      organizationId: ops.organization.organizationId,
      targetAgentId: ops.agent.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-owner",
      dispatchReason: "值班交接",
      goal: "跟进本周值班交接",
      priority: "high",
      status: "waiting_human",
      createdAt: "2026-04-07T08:03:00.000Z",
      updatedAt: "2026-04-07T08:03:00.000Z",
    });
    registry.saveAgentWorkItem({
      workItemId: "work-item-overload-3",
      organizationId: ops.organization.organizationId,
      targetAgentId: ops.agent.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-owner",
      dispatchReason: "监控看板调整",
      goal: "补齐本周监控项",
      priority: "normal",
      status: "queued",
      createdAt: "2026-04-07T08:04:00.000Z",
      updatedAt: "2026-04-07T08:04:00.000Z",
    });

    const suggestions = service.listSpawnSuggestions("principal-owner");

    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0]?.departmentRole, "运维");
    assert.match(suggestions[0]?.displayName ?? "", /^运维·/);
    assert.notEqual(suggestions[0]?.displayName, ops.agent.displayName);
    assert.equal(suggestions[0]?.supportingAgentId, ops.agent.agentId);
    assert.equal(suggestions[0]?.suggestedSupervisorAgentId, ops.agent.agentId);
    assert.equal(suggestions[0]?.openWorkItemCount, 3);
    assert.equal(suggestions[0]?.waitingWorkItemCount, 1);
    assert.equal(suggestions[0]?.highPriorityWorkItemCount, 2);
    assert.match(suggestions[0]?.rationale ?? "", /建议增设一个 运维 长期 agent/);
    assert.equal(suggestions[0]?.guardrail.organizationActiveAgentCount, 1);
    assert.equal(suggestions[0]?.guardrail.organizationActiveAgentLimit, 12);
    assert.equal(suggestions[0]?.guardrail.roleActiveAgentCount, 1);
    assert.equal(suggestions[0]?.guardrail.roleActiveAgentLimit, 3);
    assert.equal(suggestions[0]?.guardrail.blocked, false);
    assert.equal(suggestions[0]?.spawnPolicy.maxActiveAgents, 12);
    assert.equal(suggestions[0]?.spawnPolicy.maxActiveAgentsPerRole, 3);
    assert.match(suggestions[0]?.auditFacts.creationReason ?? "", /运维·曜 当前有 3 个未完成 work item/);
    assert.match(suggestions[0]?.auditFacts.namingBasis ?? "", /运维·/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentsService 支持持久化更新 organization 级 spawn policy，并让建议读取新护栏", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-04-07T08:05:00.000Z",
      updatedAt: "2026-04-07T08:05:00.000Z",
    });

    const ops = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·曜",
      departmentRole: "运维",
      now: "2026-04-07T08:06:00.000Z",
    });

    const updatedPolicy = service.updateSpawnPolicy({
      ownerPrincipalId: "principal-owner",
      organizationId: ops.organization.organizationId,
      maxActiveAgents: 5,
      maxActiveAgentsPerRole: 2,
      now: "2026-04-07T08:07:00.000Z",
    });

    assert.equal(updatedPolicy.maxActiveAgents, 5);
    assert.equal(updatedPolicy.maxActiveAgentsPerRole, 2);

    registry.saveAgentWorkItem({
      workItemId: "work-item-policy-1",
      organizationId: ops.organization.organizationId,
      targetAgentId: ops.agent.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-owner",
      dispatchReason: "发布巡检",
      goal: "处理本周发布巡检",
      priority: "urgent",
      status: "running",
      createdAt: "2026-04-07T08:08:00.000Z",
      updatedAt: "2026-04-07T08:08:00.000Z",
    });
    registry.saveAgentWorkItem({
      workItemId: "work-item-policy-2",
      organizationId: ops.organization.organizationId,
      targetAgentId: ops.agent.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-owner",
      dispatchReason: "值班交接",
      goal: "处理值班交接",
      priority: "high",
      status: "waiting_human",
      createdAt: "2026-04-07T08:09:00.000Z",
      updatedAt: "2026-04-07T08:09:00.000Z",
    });
    registry.saveAgentWorkItem({
      workItemId: "work-item-policy-3",
      organizationId: ops.organization.organizationId,
      targetAgentId: ops.agent.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-owner",
      dispatchReason: "监控看板调整",
      goal: "处理监控看板调整",
      priority: "normal",
      status: "queued",
      createdAt: "2026-04-07T08:10:00.000Z",
      updatedAt: "2026-04-07T08:10:00.000Z",
    });

    const policies = service.listSpawnPolicies("principal-owner");
    const suggestions = service.listSpawnSuggestions("principal-owner");

    assert.equal(policies.length, 1);
    assert.equal(policies[0]?.maxActiveAgents, 5);
    assert.equal(policies[0]?.maxActiveAgentsPerRole, 2);
    assert.equal(suggestions[0]?.spawnPolicy.maxActiveAgents, 5);
    assert.equal(suggestions[0]?.spawnPolicy.maxActiveAgentsPerRole, 2);
    assert.equal(suggestions[0]?.guardrail.organizationActiveAgentLimit, 5);
    assert.equal(suggestions[0]?.guardrail.roleActiveAgentLimit, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentsService 支持批准自动创建建议，并为新 agent 自动补首次职责建档 work item", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-04-07T08:10:00.000Z",
      updatedAt: "2026-04-07T08:10:00.000Z",
    });

    const ops = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·曜",
      departmentRole: "运维",
      now: "2026-04-07T08:11:00.000Z",
    });
    const suggestions = service.listSpawnSuggestions("principal-owner");
    const preview = service.previewManagedAgentIdentity({
      ownerPrincipalId: "principal-owner",
      organizationId: ops.organization.organizationId,
      departmentRole: "运维",
    });

    const created = service.approveSpawnSuggestion({
      ownerPrincipalId: "principal-owner",
      organizationId: ops.organization.organizationId,
      departmentRole: "运维",
      displayName: preview.displayName,
      mission: "负责运维值班与巡检分流。",
      supervisorAgentId: ops.agent.agentId,
      now: "2026-04-07T08:12:00.000Z",
    });

    assert.equal(suggestions.length, 0);
    assert.equal(created.agent.creationMode, "auto");
    assert.equal(created.agent.status, "bootstrapping");
    assert.equal(created.agent.createdByPrincipalId, "principal-owner");
    assert.equal(created.agent.mission, "负责运维值班与巡检分流。");
    assert.equal(created.agent.supervisorPrincipalId, ops.principal.principalId);
    assert.equal(created.agent.displayName, preview.displayName);
    assert.equal(created.agent.bootstrapProfile?.state, "pending");
    assert.equal(created.agent.bootstrapProfile?.bootstrapWorkItemId, created.bootstrapWorkItem.workItemId);
    assert.equal(created.auditLog.eventType, "spawn_suggestion_approved");
    assert.equal(created.auditLog.subjectAgentId, created.agent.agentId);
    assert.equal(created.auditLog.displayName, preview.displayName);
    assert.equal(created.bootstrapWorkItem.targetAgentId, created.agent.agentId);
    assert.equal(created.bootstrapWorkItem.sourceType, "agent");
    assert.equal(created.bootstrapWorkItem.sourceAgentId, ops.agent.agentId);
    assert.equal(created.bootstrapWorkItem.status, "queued");
    assert.equal(
      created.bootstrapWorkItem.contextPacket && typeof created.bootstrapWorkItem.contextPacket === "object"
        ? (created.bootstrapWorkItem.contextPacket as Record<string, unknown>).systemTaskKind
        : null,
      "auto_spawn_onboarding",
    );

    const auditLogs = service.listSpawnAuditLogs("principal-owner");
    assert.equal(auditLogs.length, 1);
    assert.equal(auditLogs[0]?.eventType, "spawn_suggestion_approved");
    assert.equal(auditLogs[0]?.subjectAgentId, created.agent.agentId);
    assert.match(auditLogs[0]?.summary ?? "", /已批准自动创建/);
    assert.equal(auditLogs[0]?.guardrail.roleActiveAgentCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentsService 会在同角色达到上限时阻止自动创建，并写入 blocked 审计", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-04-07T08:20:00.000Z",
      updatedAt: "2026-04-07T08:20:00.000Z",
    });

    const primaryOps = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·曜",
      departmentRole: "运维",
      now: "2026-04-07T08:21:00.000Z",
    });
    service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·砺",
      departmentRole: "运维",
      now: "2026-04-07T08:22:00.000Z",
    });
    service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·岚",
      departmentRole: "运维",
      now: "2026-04-07T08:23:00.000Z",
    });

    registry.saveAgentWorkItem({
      workItemId: "work-item-role-limit-1",
      organizationId: primaryOps.organization.organizationId,
      targetAgentId: primaryOps.agent.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-owner",
      dispatchReason: "发布巡检",
      goal: "处理本周发布巡检",
      priority: "urgent",
      status: "running",
      createdAt: "2026-04-07T08:24:00.000Z",
      updatedAt: "2026-04-07T08:24:00.000Z",
    });
    registry.saveAgentWorkItem({
      workItemId: "work-item-role-limit-2",
      organizationId: primaryOps.organization.organizationId,
      targetAgentId: primaryOps.agent.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-owner",
      dispatchReason: "值班交接",
      goal: "处理值班交接",
      priority: "high",
      status: "waiting_human",
      createdAt: "2026-04-07T08:25:00.000Z",
      updatedAt: "2026-04-07T08:25:00.000Z",
    });
    registry.saveAgentWorkItem({
      workItemId: "work-item-role-limit-3",
      organizationId: primaryOps.organization.organizationId,
      targetAgentId: primaryOps.agent.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-owner",
      dispatchReason: "监控看板调整",
      goal: "处理监控看板调整",
      priority: "normal",
      status: "queued",
      createdAt: "2026-04-07T08:26:00.000Z",
      updatedAt: "2026-04-07T08:26:00.000Z",
    });

    const suggestions = service.listSpawnSuggestions("principal-owner");

    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0]?.guardrail.blocked, true);
    assert.equal(suggestions[0]?.guardrail.roleActiveAgentCount, 3);
    assert.equal(suggestions[0]?.guardrail.roleActiveAgentLimit, 3);
    assert.equal(suggestions[0]?.guardrail.blockedReason, "当前 运维 角色已达到活跃 agent 上限。");

    assert.throws(
      () => {
        const displayName = suggestions[0]?.displayName;

        if (!displayName) {
          throw new Error("Expected spawn suggestion display name.");
        }

        return service.approveSpawnSuggestion({
          ownerPrincipalId: "principal-owner",
          organizationId: primaryOps.organization.organizationId,
          departmentRole: "运维",
          displayName,
          mission: "负责运维值班与巡检分流。",
          supervisorAgentId: primaryOps.agent.agentId,
          now: "2026-04-07T08:27:00.000Z",
        });
      },
      /当前 运维 角色已达到活跃 agent 上限。/,
    );

    const auditLogs = service.listSpawnAuditLogs("principal-owner");
    assert.equal(auditLogs.length, 1);
    assert.equal(auditLogs[0]?.eventType, "spawn_suggestion_blocked");
    assert.equal(auditLogs[0]?.displayName, suggestions[0]?.displayName);
    assert.equal(auditLogs[0]?.guardrail.blocked, true);
    assert.equal(auditLogs[0]?.guardrail.roleActiveAgentCount, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentsService 支持忽略并恢复自动创建建议，同时保留 suppressed state 与审计轨迹", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-04-07T08:30:00.000Z",
      updatedAt: "2026-04-07T08:30:00.000Z",
    });

    const ops = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·曜",
      departmentRole: "运维",
      now: "2026-04-07T08:31:00.000Z",
    });

    registry.saveAgentWorkItem({
      workItemId: "work-item-ignore-1",
      organizationId: ops.organization.organizationId,
      targetAgentId: ops.agent.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-owner",
      dispatchReason: "发布巡检",
      goal: "处理本周发布巡检",
      priority: "urgent",
      status: "running",
      createdAt: "2026-04-07T08:32:00.000Z",
      updatedAt: "2026-04-07T08:32:00.000Z",
    });
    registry.saveAgentWorkItem({
      workItemId: "work-item-ignore-2",
      organizationId: ops.organization.organizationId,
      targetAgentId: ops.agent.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-owner",
      dispatchReason: "值班交接",
      goal: "处理值班交接",
      priority: "high",
      status: "waiting_human",
      createdAt: "2026-04-07T08:33:00.000Z",
      updatedAt: "2026-04-07T08:33:00.000Z",
    });
    registry.saveAgentWorkItem({
      workItemId: "work-item-ignore-3",
      organizationId: ops.organization.organizationId,
      targetAgentId: ops.agent.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-owner",
      dispatchReason: "监控看板调整",
      goal: "处理监控看板调整",
      priority: "normal",
      status: "queued",
      createdAt: "2026-04-07T08:34:00.000Z",
      updatedAt: "2026-04-07T08:34:00.000Z",
    });

    const suggestions = service.listSpawnSuggestions("principal-owner");
    assert.equal(suggestions.length, 1);
    const suggestion = suggestions[0];

    if (!suggestion) {
      throw new Error("Expected spawn suggestion.");
    }

    const ignored = service.ignoreSpawnSuggestion({
      ownerPrincipalId: "principal-owner",
      ...suggestion,
      now: "2026-04-07T08:35:00.000Z",
    });

    assert.equal(ignored.auditLog.eventType, "spawn_suggestion_ignored");
    assert.equal(ignored.suppressedSuggestion?.suppressionState, "ignored");
    assert.equal(service.listSpawnSuggestions("principal-owner").length, 0);
    assert.equal(service.listSuppressedSpawnSuggestions("principal-owner").length, 1);
    assert.equal(service.listSuppressedSpawnSuggestions("principal-owner")[0]?.displayName, suggestion.displayName);

    const restored = service.restoreSpawnSuggestion({
      ownerPrincipalId: "principal-owner",
      suggestionId: suggestion.suggestionId,
      organizationId: ops.organization.organizationId,
      now: "2026-04-07T08:36:00.000Z",
    });

    assert.equal(restored.eventType, "spawn_suggestion_restored");
    assert.equal(service.listSuppressedSpawnSuggestions("principal-owner").length, 0);
    assert.equal(service.listSpawnSuggestions("principal-owner").length, 1);

    const auditLogs = service.listSpawnAuditLogs("principal-owner", 5);
    assert.equal(auditLogs[0]?.eventType, "spawn_suggestion_restored");
    assert.equal(auditLogs[1]?.eventType, "spawn_suggestion_ignored");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentsService 会基于空闲时长、近期 work item 与 handoff 事实生成 idle 回收建议，并在批准后写审计", () => {
  const { root, registry, service } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-03-10T08:00:00.000Z",
      updatedAt: "2026-03-10T08:00:00.000Z",
    });

    const supervisor = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·曜",
      departmentRole: "运维",
      now: "2026-03-10T08:01:00.000Z",
    });
    const autoPause = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      organizationId: supervisor.organization.organizationId,
      displayName: "运维·砺",
      departmentRole: "运维",
      creationMode: "auto",
      status: "active",
      now: "2026-03-12T08:00:00.000Z",
    });
    const autoArchive = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      organizationId: supervisor.organization.organizationId,
      displayName: "运维·岚",
      departmentRole: "运维",
      creationMode: "auto",
      status: "paused",
      now: "2026-03-01T08:00:00.000Z",
    });
    const stillBusy = service.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      organizationId: supervisor.organization.organizationId,
      displayName: "运维·策",
      departmentRole: "运维",
      creationMode: "auto",
      status: "active",
      now: "2026-04-06T08:00:00.000Z",
    });

    registry.saveAgentWorkItem({
      workItemId: "work-item-idle-completed-1",
      organizationId: supervisor.organization.organizationId,
      targetAgentId: autoPause.agent.agentId,
      sourceType: "agent",
      sourcePrincipalId: supervisor.principal.principalId,
      sourceAgentId: supervisor.agent.agentId,
      dispatchReason: "补巡检脚本",
      goal: "完成巡检脚本收尾",
      priority: "normal",
      status: "completed",
      createdAt: "2026-04-03T07:00:00.000Z",
      completedAt: "2026-04-03T08:00:00.000Z",
      updatedAt: "2026-04-03T08:00:00.000Z",
    });
    registry.saveAgentMessage({
      messageId: "message-idle-handoff-1",
      organizationId: supervisor.organization.organizationId,
      fromAgentId: autoPause.agent.agentId,
      toAgentId: supervisor.agent.agentId,
      workItemId: "work-item-idle-completed-1",
      messageType: "handoff",
      payload: {
        summary: "巡检脚本已完成交接。",
      },
      artifactRefs: [],
      priority: "normal",
      requiresAck: false,
      createdAt: "2026-04-03T09:00:00.000Z",
    });

    registry.saveAgentWorkItem({
      workItemId: "work-item-idle-completed-2",
      organizationId: supervisor.organization.organizationId,
      targetAgentId: autoArchive.agent.agentId,
      sourceType: "agent",
      sourcePrincipalId: supervisor.principal.principalId,
      sourceAgentId: supervisor.agent.agentId,
      dispatchReason: "补文档",
      goal: "补值班交接文档",
      priority: "normal",
      status: "completed",
      createdAt: "2026-03-19T07:00:00.000Z",
      completedAt: "2026-03-20T08:00:00.000Z",
      updatedAt: "2026-03-20T08:00:00.000Z",
    });
    registry.saveAgentMessage({
      messageId: "message-idle-handoff-2",
      organizationId: supervisor.organization.organizationId,
      fromAgentId: autoArchive.agent.agentId,
      toAgentId: supervisor.agent.agentId,
      workItemId: "work-item-idle-completed-2",
      messageType: "handoff",
      payload: {
        summary: "值班交接文档已完成交接。",
      },
      artifactRefs: [],
      priority: "normal",
      requiresAck: false,
      createdAt: "2026-03-20T09:00:00.000Z",
    });

    registry.saveAgentMessage({
      messageId: "message-idle-busy-1",
      organizationId: supervisor.organization.organizationId,
      fromAgentId: supervisor.agent.agentId,
      toAgentId: stillBusy.agent.agentId,
      messageType: "dispatch",
      payload: {
        summary: "还有待处理的巡检任务。",
      },
      artifactRefs: [],
      priority: "high",
      requiresAck: true,
      createdAt: "2026-04-07T07:00:00.000Z",
    });
    registry.saveAgentMailboxEntry({
      mailboxEntryId: "mailbox-idle-busy-1",
      organizationId: supervisor.organization.organizationId,
      ownerAgentId: stillBusy.agent.agentId,
      messageId: "message-idle-busy-1",
      priority: "high",
      status: "pending",
      requiresAck: true,
      availableAt: "2026-04-07T07:00:00.000Z",
      createdAt: "2026-04-07T07:00:00.000Z",
      updatedAt: "2026-04-07T07:00:00.000Z",
    });

    const suggestions = service.listIdleRecoverySuggestions(
      "principal-owner",
      "2026-04-07T12:00:00.000Z",
    );

    assert.equal(suggestions.length, 2);
    assert.equal(suggestions[0]?.agentId, autoArchive.agent.agentId);
    assert.equal(suggestions[0]?.recommendedAction, "archive");
    assert.equal(suggestions[0]?.currentStatus, "paused");
    assert.equal(suggestions[0]?.recentClosedWorkItemCount, 1);
    assert.equal(suggestions[0]?.recentHandoffCount, 1);
    assert.equal(suggestions[1]?.agentId, autoPause.agent.agentId);
    assert.equal(suggestions[1]?.recommendedAction, "pause");
    assert.equal(suggestions[1]?.currentStatus, "active");
    assert.equal(suggestions[1]?.recentClosedWorkItemCount, 1);
    assert.equal(suggestions[1]?.recentHandoffCount, 1);
    assert.equal(suggestions.find((entry) => entry.agentId === stillBusy.agent.agentId), undefined);

    const pauseApproved = service.approveIdleRecoverySuggestion({
      ownerPrincipalId: "principal-owner",
      suggestionId: suggestions[1]?.suggestionId ?? "",
      organizationId: supervisor.organization.organizationId,
      agentId: autoPause.agent.agentId,
      action: "pause",
      now: "2026-04-07T12:10:00.000Z",
    });
    assert.equal(pauseApproved.agent.status, "paused");
    assert.equal(pauseApproved.auditLog.eventType, "idle_recovery_pause_approved");

    const archiveApproved = service.approveIdleRecoverySuggestion({
      ownerPrincipalId: "principal-owner",
      suggestionId: suggestions[0]?.suggestionId ?? "",
      organizationId: supervisor.organization.organizationId,
      agentId: autoArchive.agent.agentId,
      action: "archive",
      now: "2026-04-07T12:20:00.000Z",
    });
    assert.equal(archiveApproved.agent.status, "archived");
    assert.equal(archiveApproved.auditLog.eventType, "idle_recovery_archive_approved");

    const auditLogs = service.listIdleRecoveryAuditLogs("principal-owner", 4);
    assert.equal(auditLogs.length, 2);
    assert.equal(auditLogs[0]?.eventType, "idle_recovery_archive_approved");
    assert.equal(auditLogs[1]?.eventType, "idle_recovery_pause_approved");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("schema 25 迁移会为 principals 补 kind/org 列，并补齐 managed agent bootstrap、handoff 表与相关表", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-managed-agents-schema-"));
  const databaseFile = join(root, "infra/local/themis.db");
  mkdirSync(join(root, "infra/local"), { recursive: true });
  const bootstrap = new Database(databaseFile);

  try {
    bootstrap.exec(`
      PRAGMA user_version = 16;

      CREATE TABLE themis_principals (
        principal_id TEXT PRIMARY KEY,
        display_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } finally {
    bootstrap.close();
  }

  const registry = new SqliteCodexSessionRegistry({ databaseFile });
  void registry;

  const verify = new Database(databaseFile, { readonly: true });

  try {
    const principalColumns = verify
      .prepare(`PRAGMA table_info(themis_principals)`)
      .all() as Array<{ name: string }>;
    const principalColumnNames = new Set(principalColumns.map((column) => column.name));
    assert.ok(principalColumnNames.has("principal_kind"));
    assert.ok(principalColumnNames.has("organization_id"));

    const organizationTable = verify
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'themis_organizations'
      `)
      .get() as { name: string } | undefined;
    const managedAgentsTable = verify
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'themis_managed_agents'
      `)
      .get() as { name: string } | undefined;
    const managedAgentColumns = verify
      .prepare(`PRAGMA table_info(themis_managed_agents)`)
      .all() as Array<{ name: string }>;
    const managedAgentColumnNames = new Set(managedAgentColumns.map((column) => column.name));
    const spawnPolicyTable = verify
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'themis_agent_spawn_policies'
      `)
      .get() as { name: string } | undefined;
    const spawnSuggestionStateTable = verify
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'themis_agent_spawn_suggestion_states'
      `)
      .get() as { name: string } | undefined;
    const agentAuditTable = verify
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'themis_agent_audit_logs'
      `)
      .get() as { name: string } | undefined;
    const handoffTable = verify
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'themis_agent_handoffs'
      `)
      .get() as { name: string } | undefined;

    assert.equal(organizationTable?.name, "themis_organizations");
    assert.equal(spawnPolicyTable?.name, "themis_agent_spawn_policies");
    assert.ok(managedAgentColumnNames.has("agent_card_json"));
    assert.ok(managedAgentColumnNames.has("bootstrap_profile_json"));
    assert.ok(managedAgentColumnNames.has("bootstrapped_at"));
    assert.equal(spawnSuggestionStateTable?.name, "themis_agent_spawn_suggestion_states");
    assert.equal(managedAgentsTable?.name, "themis_managed_agents");
    assert.equal(agentAuditTable?.name, "themis_agent_audit_logs");
    assert.equal(handoffTable?.name, "themis_agent_handoffs");
  } finally {
    verify.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("旧版 managed agent work_items 表缺 project_id 时，升级不会在索引初始化阶段失败", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-managed-agents-project-id-migration-"));
  const databaseFile = join(root, "infra/local/themis.db");
  mkdirSync(join(root, "infra/local"), { recursive: true });
  const bootstrap = new Database(databaseFile);

  try {
    bootstrap.exec(`
      PRAGMA user_version = 24;

      CREATE TABLE themis_agent_work_items (
        work_item_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        target_agent_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_principal_id TEXT,
        source_agent_id TEXT,
        parent_work_item_id TEXT,
        dispatch_reason TEXT NOT NULL,
        goal TEXT NOT NULL,
        context_packet_json TEXT,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        waiting_for TEXT,
        waiting_reason TEXT,
        waiting_since TEXT,
        latest_waiting_run_id TEXT,
        latest_waiting_kind TEXT,
        result_summary TEXT,
        result_payload_json TEXT,
        failure_code TEXT,
        failure_message TEXT,
        workspace_policy_snapshot_json TEXT,
        runtime_profile_snapshot_json TEXT,
        scheduled_at TEXT,
        claimed_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } finally {
    bootstrap.close();
  }

  const registry = new SqliteCodexSessionRegistry({ databaseFile });
  void registry;

  const verify = new Database(databaseFile, { readonly: true });

  try {
    const workItemColumns = verify
      .prepare(`PRAGMA table_info(themis_agent_work_items)`)
      .all() as Array<{ name: string }>;
    const workItemColumnNames = new Set(workItemColumns.map((column) => column.name));
    assert.ok(workItemColumnNames.has("project_id"));
    assert.ok(workItemColumnNames.has("waiting_action_request_json"));
    assert.ok(workItemColumnNames.has("latest_human_response_json"));

    const projectIndex = verify
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND name = 'themis_agent_work_items_project_idx'
      `)
      .get() as { name: string } | undefined;

    assert.equal(projectIndex?.name, "themis_agent_work_items_project_idx");
  } finally {
    verify.close();
    rmSync(root, { recursive: true, force: true });
  }
});
