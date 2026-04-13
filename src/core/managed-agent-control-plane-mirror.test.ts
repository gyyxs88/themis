import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry, createEmptyManagedAgentControlPlaneSnapshot } from "../storage/index.js";
import { ManagedAgentControlPlaneMirror } from "./managed-agent-control-plane-mirror.js";

test("ManagedAgentControlPlaneMirror 会优先用 shared snapshot 覆盖本地缓存", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-control-plane-mirror-shared-"));
  const localDatabaseFile = join(root, "cache.db");
  const localStore = new SqliteCodexSessionRegistry({ databaseFile: localDatabaseFile });
  const now = "2026-04-13T12:30:00.000Z";
  const sharedSnapshot = createEmptyManagedAgentControlPlaneSnapshot();
  sharedSnapshot.principals.push({
    principal_id: "principal-remote",
    display_name: "Remote Owner",
    kind: "human_user",
    organization_id: null,
    created_at: now,
    updated_at: now,
  });

  try {
    localStore.savePrincipal({
      principalId: "principal-local",
      displayName: "Local Owner",
      kind: "human_user",
      createdAt: now,
      updatedAt: now,
    });

    const mirror = new ManagedAgentControlPlaneMirror({
      localDatabaseFile,
      sharedSnapshotStore: {
        async ensureSchema() {},
        async exportSharedSnapshot() {
          return sharedSnapshot;
        },
        async replaceSharedSnapshot(snapshot) {
          Object.assign(sharedSnapshot, snapshot);
        },
      },
    });

    const result = await mirror.bootstrapFromSharedStore();
    assert.equal(result.source, "shared_store");
    assert.equal(localStore.getPrincipal("principal-local"), null);
    assert.ok(localStore.getPrincipal("principal-remote"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentControlPlaneMirror 会在 shared 为空时把本地缓存推到 shared store", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-control-plane-mirror-local-"));
  const localDatabaseFile = join(root, "cache.db");
  const localStore = new SqliteCodexSessionRegistry({ databaseFile: localDatabaseFile });
  const now = "2026-04-13T12:40:00.000Z";
  const sharedSnapshot = createEmptyManagedAgentControlPlaneSnapshot();

  try {
    localStore.savePrincipal({
      principalId: "principal-local",
      displayName: "Local Owner",
      kind: "human_user",
      createdAt: now,
      updatedAt: now,
    });

    const mirror = new ManagedAgentControlPlaneMirror({
      localDatabaseFile,
      sharedSnapshotStore: {
        async ensureSchema() {},
        async exportSharedSnapshot() {
          return sharedSnapshot;
        },
        async replaceSharedSnapshot(snapshot) {
          Object.assign(sharedSnapshot, snapshot);
        },
      },
    });

    const result = await mirror.bootstrapFromSharedStore();
    assert.equal(result.source, "local_cache");
    assert.equal(sharedSnapshot.principals.length, 1);
    assert.equal(sharedSnapshot.principals[0]?.principal_id, "principal-local");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentControlPlaneMirror runMirroredMutation 在回刷失败时会恢复本地 shared cache", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-control-plane-mirror-rollback-"));
  const localDatabaseFile = join(root, "cache.db");
  const localStore = new SqliteCodexSessionRegistry({ databaseFile: localDatabaseFile });
  const sharedSnapshot = createEmptyManagedAgentControlPlaneSnapshot();
  const now = "2026-04-13T12:50:00.000Z";

  try {
    const mirror = new ManagedAgentControlPlaneMirror({
      localDatabaseFile,
      sharedSnapshotStore: {
        async ensureSchema() {},
        async exportSharedSnapshot() {
          return sharedSnapshot;
        },
        async replaceSharedSnapshot() {
          throw new Error("shared store unavailable");
        },
      },
    });

    await assert.rejects(
      mirror.runMirroredMutation(async () => {
        localStore.savePrincipal({
          principalId: "principal-local",
          displayName: "Local Owner",
          kind: "human_user",
          createdAt: now,
          updatedAt: now,
        });
      }),
      /shared store unavailable/,
    );

    assert.equal(localStore.getPrincipal("principal-local"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
