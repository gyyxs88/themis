import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createManagedAgentControlPlaneRuntimeFromEnv,
  createManagedAgentControlPlaneStoreFromEnv,
  THEMIS_PLATFORM_CONTROL_PLANE_DRIVER_ENV_KEY,
  THEMIS_PLATFORM_MYSQL_DATABASE_ENV_KEY,
  THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE_ENV_KEY,
} from "./managed-agent-control-plane-bootstrap.js";
import {
  createEmptyManagedAgentControlPlaneSnapshot,
  SqliteCodexSessionRegistry,
} from "../storage/index.js";

test("createManagedAgentControlPlaneStoreFromEnv 会把共享控制面事实与本地 session task settings 拆开", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-control-plane-bootstrap-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/runtime.db"),
  });
  const controlPlaneStore = createManagedAgentControlPlaneStoreFromEnv({
    workingDirectory: root,
    runtimeStore,
    env: {
      [THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE_ENV_KEY]: "infra/platform/control-plane.db",
    },
  });
  const sharedRegistry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/platform/control-plane.db"),
  });
  const now = "2026-04-13T10:00:00.000Z";

  try {
    controlPlaneStore.managedAgentsStore.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      kind: "human_user",
      createdAt: now,
      updatedAt: now,
    });
    controlPlaneStore.managedAgentsStore.saveOrganization({
      organizationId: "org-1",
      ownerPrincipalId: "principal-owner",
      displayName: "Org",
      slug: "org",
      createdAt: now,
      updatedAt: now,
    });
    controlPlaneStore.managedAgentsStore.savePrincipal({
      principalId: "principal-agent-1",
      displayName: "平台员工",
      kind: "managed_agent",
      organizationId: "org-1",
      createdAt: now,
      updatedAt: now,
    });
    controlPlaneStore.executionStateStore.saveManagedAgent({
      agentId: "agent-1",
      principalId: "principal-agent-1",
      organizationId: "org-1",
      createdByPrincipalId: "principal-owner",
      displayName: "平台员工",
      slug: "platform-agent",
      departmentRole: "工程",
      mission: "验证控制面装配。",
      status: "active",
      autonomyLevel: "supervised",
      creationMode: "manual",
      exposurePolicy: "gateway_only",
      createdAt: now,
      updatedAt: now,
    });
    controlPlaneStore.executionStateStore.saveSessionTaskSettings({
      sessionId: "agent-work-item:work-item-1",
      settings: {
        workspacePath: join(root, "workspace/site-a"),
      },
      createdAt: now,
      updatedAt: now,
    });

    assert.ok(controlPlaneStore.managedAgentsStore.getManagedAgent("agent-1"));
    assert.ok(controlPlaneStore.executionStateStore.getManagedAgent("agent-1"));
    assert.equal(runtimeStore.getManagedAgent("agent-1"), null);
    assert.ok(runtimeStore.getSessionTaskSettings("agent-work-item:work-item-1"));
    assert.equal(sharedRegistry.getSessionTaskSettings("agent-work-item:work-item-1"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("createManagedAgentControlPlaneRuntimeFromEnv 在 mysql 驱动下会先从 shared snapshot 引导本地缓存", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-control-plane-bootstrap-mysql-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/runtime.db"),
  });
  const now = "2026-04-13T12:00:00.000Z";
  const sharedSnapshot = createEmptyManagedAgentControlPlaneSnapshot();
  sharedSnapshot.principals.push({
    principal_id: "principal-remote-owner",
    display_name: "Remote Owner",
    kind: "human_user",
    organization_id: null,
    created_at: now,
    updated_at: now,
  });
  let ensureSchemaCalls = 0;

  try {
    const result = await createManagedAgentControlPlaneRuntimeFromEnv({
      workingDirectory: root,
      runtimeStore,
      env: {
        [THEMIS_PLATFORM_CONTROL_PLANE_DRIVER_ENV_KEY]: "mysql",
        [THEMIS_PLATFORM_MYSQL_DATABASE_ENV_KEY]: "themis_platform",
      },
      createMySqlStore: () => ({
        async ensureSchema() {
          ensureSchemaCalls += 1;
        },
        async exportSharedSnapshot() {
          return sharedSnapshot;
        },
        async replaceSharedSnapshot(snapshot) {
          Object.assign(sharedSnapshot, snapshot);
        },
      }),
    });

    assert.equal(result.driver, "mysql");
    assert.equal(ensureSchemaCalls, 1);
    assert.ok(result.mirror);
    assert.equal(
      result.sharedDatabaseFile,
      join(root, "infra/platform/control-plane.db"),
    );
    assert.ok(result.controlPlaneStore.managedAgentsStore.getPrincipal("principal-remote-owner"));
    assert.equal(runtimeStore.getPrincipal("principal-remote-owner"), null);
    assert.equal(result.bootstrapResult?.source, "shared_store");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
