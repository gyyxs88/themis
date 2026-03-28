import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { RuntimeDiagnosticsService } from "./runtime-diagnostics.js";

test("RuntimeDiagnosticsService.readSummary 返回 auth/provider/context/memory/service 基本字段", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-diagnostics-"));

  try {
    writeFileSync(join(root, "README.md"), "# demo\n", "utf8");
    mkdirSync(join(root, "memory", "architecture"), { recursive: true });
    writeFileSync(join(root, "memory", "architecture", "overview.md"), "# arch\n", "utf8");
    mkdirSync(join(root, "memory", "tasks"), { recursive: true });
    writeFileSync(join(root, "memory", "tasks", "backlog.md"), "# backlog\n", "utf8");
    writeFileSync(join(root, "memory", "tasks", "in-progress.md"), "# in-progress\n", "utf8");
    writeFileSync(join(root, "memory", "tasks", "done.md"), "# done\n", "utf8");
    const runtimeStore = new SqliteCodexSessionRegistry({
      databaseFile: join(root, "infra/local/themis.db"),
    });

    const service = new RuntimeDiagnosticsService({
      workingDirectory: root,
      runtimeStore,
    });
    const summary = await service.readSummary();

    assert.ok(summary.generatedAt);
    assert.equal(summary.workingDirectory, root);
    assert.ok(summary.auth);
    assert.ok(summary.provider);
    assert.ok(summary.context);
    assert.ok(summary.memory);
    assert.ok(summary.service);
    assert.equal(summary.context.files.some((item) => item.path === "README.md" && item.status === "ok"), true);
    assert.equal(summary.context.files.some((item) => item.path === "AGENTS.md" && item.status === "missing"), true);
    assert.equal(summary.provider.activeMode === "auth" || summary.provider.activeMode === "third-party", true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
