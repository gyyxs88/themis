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

test("RuntimeDiagnosticsService 在无 SQLite 时也能识别环境变量 provider", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-diagnostics-env-provider-"));
  const previousEnv = {
    baseUrl: process.env.THEMIS_OPENAI_COMPAT_BASE_URL,
    apiKey: process.env.THEMIS_OPENAI_COMPAT_API_KEY,
    model: process.env.THEMIS_OPENAI_COMPAT_MODEL,
  };

  try {
    process.env.THEMIS_OPENAI_COMPAT_BASE_URL = "https://example.com/v1";
    process.env.THEMIS_OPENAI_COMPAT_API_KEY = "sk-test";
    process.env.THEMIS_OPENAI_COMPAT_MODEL = "gpt-5.4";

    const service = new RuntimeDiagnosticsService({
      workingDirectory: root,
      runtimeStore: null,
    });
    const summary = await service.readSummary();

    assert.equal(summary.provider.providerCount, 1);
    assert.deepEqual(summary.provider.providerIds, ["themis_openai_compatible"]);
    assert.equal(summary.provider.activeMode, "third-party");
  } finally {
    restoreEnv("THEMIS_OPENAI_COMPAT_BASE_URL", previousEnv.baseUrl);
    restoreEnv("THEMIS_OPENAI_COMPAT_API_KEY", previousEnv.apiKey);
    restoreEnv("THEMIS_OPENAI_COMPAT_MODEL", previousEnv.model);
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeDiagnosticsService 在传入 authRuntime 时优先以当前模式判断 activeMode", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-diagnostics-auth-mode-"));
  const previousEnv = {
    baseUrl: process.env.THEMIS_OPENAI_COMPAT_BASE_URL,
    apiKey: process.env.THEMIS_OPENAI_COMPAT_API_KEY,
    model: process.env.THEMIS_OPENAI_COMPAT_MODEL,
  };

  try {
    process.env.THEMIS_OPENAI_COMPAT_BASE_URL = "https://example.com/v1";
    process.env.THEMIS_OPENAI_COMPAT_API_KEY = "sk-test";
    process.env.THEMIS_OPENAI_COMPAT_MODEL = "gpt-5.4";

    const service = new RuntimeDiagnosticsService({
      workingDirectory: root,
      runtimeStore: null,
      authRuntime: {
        readSnapshot: async () => ({
          authenticated: false,
          requiresOpenaiAuth: false,
        }),
        readThirdPartyProviderProfile: () => null,
      } as never,
    });
    const summary = await service.readSummary();

    assert.equal(summary.provider.providerCount, 1);
    assert.equal(summary.provider.activeMode, "auth");
  } finally {
    restoreEnv("THEMIS_OPENAI_COMPAT_BASE_URL", previousEnv.baseUrl);
    restoreEnv("THEMIS_OPENAI_COMPAT_API_KEY", previousEnv.apiKey);
    restoreEnv("THEMIS_OPENAI_COMPAT_MODEL", previousEnv.model);
    rmSync(root, { recursive: true, force: true });
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (typeof value === "string") {
    process.env[key] = value;
    return;
  }

  delete process.env[key];
}
