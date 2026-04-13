import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { ManagedAgentControlPlaneMirror } from "./managed-agent-control-plane-mirror.js";
import { MySqlManagedAgentControlPlaneStore, SqliteCodexSessionRegistry } from "../storage/index.js";

function isDockerAvailable(): boolean {
  const result = spawnSync("docker", ["version"], { stdio: "ignore" });
  return result.status === 0;
}

function runDocker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

function parseDockerPort(output: string): number {
  const matched = output.match(/:(\d+)\s*$/);

  if (!matched) {
    throw new Error(`无法解析 docker port 输出：${output}`);
  }

  return Number.parseInt(matched[1] ?? "", 10);
}

async function waitForMySql(store: MySqlManagedAgentControlPlaneStore): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < 60_000) {
    try {
      await store.ping();
      return;
    } catch (error) {
      lastError = error;
      await delay(1_000);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("等待 MySQL 就绪超时。");
}

test("ManagedAgentControlPlaneMirror 会在真实 MySQL 上完成 bootstrap / restore / flush 闭环", {
  timeout: 120_000,
}, async (t) => {
  if (!isDockerAvailable()) {
    t.skip("当前环境不可用 docker，跳过 MySQL mirror 集成测试。");
    return;
  }

  const containerName = `themis-mysql-mirror-${randomUUID().slice(0, 8)}`;
  runDocker([
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "-e",
    "MYSQL_ROOT_PASSWORD=root",
    "-e",
    "MYSQL_DATABASE=themis_test",
    "-p",
    "127.0.0.1::3306",
    "mysql:8.4",
  ]);
  t.after(() => {
    spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
  });

  const port = parseDockerPort(runDocker(["port", containerName, "3306/tcp"]));
  const mysqlStore = new MySqlManagedAgentControlPlaneStore({
    host: "127.0.0.1",
    port,
    user: "root",
    password: "root",
    database: "themis_test",
  });
  t.after(async () => {
    await mysqlStore.close();
  });

  await waitForMySql(mysqlStore);
  await mysqlStore.ensureSchema();

  const root = mkdtempSync(join(tmpdir(), "themis-control-plane-mirror-mysql-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const now = "2026-04-13T15:00:00.000Z";
  const later = "2026-04-13T15:30:00.000Z";
  const localDatabaseFile = join(root, "platform-cache.db");
  const localStore = new SqliteCodexSessionRegistry({ databaseFile: localDatabaseFile });

  localStore.savePrincipal({
    principalId: "principal-owner",
    displayName: "Owner",
    kind: "human_user",
    createdAt: now,
    updatedAt: now,
  });
  localStore.saveOrganization({
    organizationId: "org-1",
    ownerPrincipalId: "principal-owner",
    displayName: "Themis Org",
    slug: "themis-org",
    createdAt: now,
    updatedAt: now,
  });
  localStore.savePrincipal({
    principalId: "principal-agent-1",
    displayName: "平台员工",
    kind: "managed_agent",
    organizationId: "org-1",
    createdAt: now,
    updatedAt: now,
  });
  localStore.saveManagedAgent({
    agentId: "agent-1",
    principalId: "principal-agent-1",
    organizationId: "org-1",
    createdByPrincipalId: "principal-owner",
    displayName: "平台员工",
    slug: "platform-agent",
    departmentRole: "platform",
    mission: "验证 mysql mirror。",
    status: "active",
    autonomyLevel: "bounded",
    creationMode: "manual",
    exposurePolicy: "gateway_only",
    createdAt: now,
    updatedAt: now,
  });
  localStore.saveAgentWorkspacePolicy({
    policyId: "workspace-1",
    organizationId: "org-1",
    ownerAgentId: "agent-1",
    displayName: "官网工作区",
    workspacePath: "/srv/site-a",
    additionalDirectories: ["/srv/site-a/docs"],
    allowNetworkAccess: true,
    createdAt: now,
    updatedAt: now,
  });
  localStore.saveManagedAgentNode({
    nodeId: "node-a",
    organizationId: "org-1",
    displayName: "Node A",
    status: "online",
    slotCapacity: 2,
    slotAvailable: 1,
    labels: [],
    workspaceCapabilities: ["/srv/site-a"],
    credentialCapabilities: [],
    providerCapabilities: [],
    heartbeatTtlSeconds: 60,
    lastHeartbeatAt: now,
    createdAt: now,
    updatedAt: now,
  });
  localStore.saveProjectWorkspaceBinding({
    projectId: "project-site-a",
    organizationId: "org-1",
    displayName: "官网项目",
    owningAgentId: "agent-1",
    workspacePolicyId: "workspace-1",
    canonicalWorkspacePath: "/srv/site-a",
    preferredNodeId: "node-a",
    lastActiveNodeId: "node-a",
    lastActiveWorkspacePath: "/srv/site-a",
    continuityMode: "sticky",
    createdAt: now,
    updatedAt: now,
  });
  localStore.saveAgentWorkItem({
    workItemId: "work-item-1",
    organizationId: "org-1",
    targetAgentId: "agent-1",
    projectId: "project-site-a",
    sourceType: "human",
    sourcePrincipalId: "principal-owner",
    dispatchReason: "继续开发官网",
    goal: "继续完善官网首页。",
    priority: "high",
    status: "queued",
    workspacePolicySnapshot: {
      policyId: "workspace-1",
      displayName: "官网工作区",
      workspacePath: "/srv/site-a",
    },
    createdAt: now,
    updatedAt: now,
  });

  const mirror = new ManagedAgentControlPlaneMirror({
    localDatabaseFile,
    sharedSnapshotStore: mysqlStore,
  });
  let bootstrapFromLocal;

  try {
    bootstrapFromLocal = await mirror.bootstrapFromSharedStore();
  } catch (error) {
    throw new Error(`bootstrap local -> mysql failed: ${String(error)}`);
  }

  assert.equal(bootstrapFromLocal.source, "local_cache");
  assert.ok(await mysqlStore.getPrincipal("principal-owner"));
  assert.ok(await mysqlStore.getProjectWorkspaceBinding("project-site-a"));
  assert.ok(await mysqlStore.getAgentWorkItem("work-item-1"));

  const restoredDatabaseFile = join(root, "platform-cache-restored.db");
  const restoredLocalStore = new SqliteCodexSessionRegistry({ databaseFile: restoredDatabaseFile });
  const restoreMirror = new ManagedAgentControlPlaneMirror({
    localDatabaseFile: restoredDatabaseFile,
    sharedSnapshotStore: mysqlStore,
  });
  let bootstrapFromShared;

  try {
    bootstrapFromShared = await restoreMirror.bootstrapFromSharedStore();
  } catch (error) {
    throw new Error(`bootstrap mysql -> local failed: ${String(error)}`);
  }

  assert.equal(bootstrapFromShared.source, "shared_store");
  assert.ok(restoredLocalStore.getPrincipal("principal-owner"));
  assert.equal(
    restoredLocalStore.getProjectWorkspaceBinding("project-site-a")?.preferredNodeId,
    "node-a",
  );
  assert.equal(restoredLocalStore.getAgentWorkItem("work-item-1")?.projectId, "project-site-a");

  try {
    await restoreMirror.runMirroredMutation(async () => {
      restoredLocalStore.saveManagedAgentNode({
        nodeId: "node-b",
        organizationId: "org-1",
        displayName: "Node B",
        status: "online",
        slotCapacity: 2,
        slotAvailable: 2,
        labels: [],
        workspaceCapabilities: ["/srv/site-a"],
        credentialCapabilities: [],
        providerCapabilities: [],
        heartbeatTtlSeconds: 60,
        lastHeartbeatAt: later,
        createdAt: later,
        updatedAt: later,
      });
      restoredLocalStore.saveProjectWorkspaceBinding({
        projectId: "project-site-a",
        organizationId: "org-1",
        displayName: "官网项目",
        owningAgentId: "agent-1",
        workspacePolicyId: "workspace-1",
        canonicalWorkspacePath: "/srv/site-a",
        preferredNodeId: "node-b",
        lastActiveNodeId: "node-b",
        lastActiveWorkspacePath: "/srv/site-a",
        continuityMode: "sticky",
        createdAt: now,
        updatedAt: later,
      });
      restoredLocalStore.saveAgentWorkItem({
        workItemId: "work-item-1",
        organizationId: "org-1",
        targetAgentId: "agent-1",
        projectId: "project-site-a",
        sourceType: "human",
        sourcePrincipalId: "principal-owner",
        dispatchReason: "继续开发官网",
        goal: "继续完善官网首页。",
        priority: "high",
        status: "running",
        workspacePolicySnapshot: {
          policyId: "workspace-1",
          displayName: "官网工作区",
          workspacePath: "/srv/site-a",
        },
        createdAt: now,
        startedAt: later,
        updatedAt: later,
      });
    });
  } catch (error) {
    throw new Error(`flush local mutation -> mysql failed: ${String(error)}`);
  }

  assert.equal((await mysqlStore.getProjectWorkspaceBinding("project-site-a"))?.preferredNodeId, "node-b");
  assert.equal((await mysqlStore.getAgentWorkItem("work-item-1"))?.status, "running");
});
