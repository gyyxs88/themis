import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { PlatformBackupService } from "./platform-backup.js";

test("PlatformBackupService 会创建一致性的 SQLite 备份", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-platform-backup-"));
  const databaseFile = join(root, "infra/local/themis.db");
  const registry = new SqliteCodexSessionRegistry({ databaseFile });
  const service = new PlatformBackupService();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "初始负责人",
      createdAt: "2026-04-12T15:30:00.000Z",
      updatedAt: "2026-04-12T15:30:00.000Z",
    });

    const backup = await service.createBackup({
      sourcePath: databaseFile,
      now: "2026-04-12T15:31:00.000Z",
    });

    assert.equal(existsSync(backup.outputPath), true);
    assert.match(backup.outputPath, /infra\/backups\/themis-20260412-153100\.db$/);
    assert.ok(backup.sizeBytes > 0);

    const restoredRegistry = new SqliteCodexSessionRegistry({
      databaseFile: backup.outputPath,
    });
    assert.equal(restoredRegistry.getPrincipal("principal-owner")?.displayName, "初始负责人");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("PlatformBackupService restore 会先备份当前库，再恢复指定快照", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-platform-restore-"));
  const databaseFile = join(root, "infra/local/themis.db");
  const registry = new SqliteCodexSessionRegistry({ databaseFile });
  const service = new PlatformBackupService();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "初始负责人",
      createdAt: "2026-04-12T15:40:00.000Z",
      updatedAt: "2026-04-12T15:40:00.000Z",
    });

    const snapshot = await service.createBackup({
      sourcePath: databaseFile,
      outputPath: join(root, "manual/themis-snapshot.db"),
      now: "2026-04-12T15:41:00.000Z",
    });

    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "已漂移负责人",
      createdAt: "2026-04-12T15:40:00.000Z",
      updatedAt: "2026-04-12T15:42:00.000Z",
    });

    const restored = await service.restoreBackup({
      inputPath: snapshot.outputPath,
      targetPath: databaseFile,
      now: "2026-04-12T15:43:00.000Z",
    });

    assert.equal(existsSync(restored.targetPath), true);
    assert.equal(existsSync(restored.previousBackupPath ?? ""), true);
    assert.ok(restored.sizeBytes > 0);

    const liveRegistry = new SqliteCodexSessionRegistry({ databaseFile });
    assert.equal(liveRegistry.getPrincipal("principal-owner")?.displayName, "初始负责人");

    const previousRegistry = new SqliteCodexSessionRegistry({
      databaseFile: restored.previousBackupPath ?? "",
    });
    assert.equal(previousRegistry.getPrincipal("principal-owner")?.displayName, "已漂移负责人");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
