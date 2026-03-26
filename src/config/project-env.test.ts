import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadProjectEnv,
  readProjectEnvFile,
  resolvePrimaryProjectEnvFile,
  setProjectEnvValue,
  unsetProjectEnvValue,
} from "./project-env.js";

test("loadProjectEnv 会按 .env -> .env.local 顺序加载且不覆盖已有环境变量", () => {
  const cwd = mkdtempSync(join(tmpdir(), "themis-project-env-"));
  const envPath = join(cwd, ".env");
  const localPath = join(cwd, ".env.local");
  const originalPort = process.env.THEMIS_PORT;
  const originalHost = process.env.THEMIS_HOST;
  const originalApiKey = process.env.CODEX_API_KEY;

  try {
    writeFileSync(envPath, "THEMIS_HOST=127.0.0.1\nTHEMIS_PORT=3200\n", "utf8");
    writeFileSync(localPath, "THEMIS_PORT=3300\nCODEX_API_KEY=sk-local\n", "utf8");
    delete process.env.THEMIS_HOST;
    process.env.THEMIS_PORT = "9999";
    delete process.env.CODEX_API_KEY;

    const loaded = loadProjectEnv(cwd);

    assert.deepEqual(loaded, [envPath, localPath]);
    assert.equal(process.env.THEMIS_HOST, "127.0.0.1");
    assert.equal(process.env.THEMIS_PORT, "9999");
    assert.equal(process.env.CODEX_API_KEY, "sk-local");
  } finally {
    restoreEnv("THEMIS_HOST", originalHost);
    restoreEnv("THEMIS_PORT", originalPort);
    restoreEnv("CODEX_API_KEY", originalApiKey);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("setProjectEnvValue 和 unsetProjectEnvValue 会更新 .env.local", () => {
  const cwd = mkdtempSync(join(tmpdir(), "themis-project-env-edit-"));
  const localPath = resolvePrimaryProjectEnvFile(cwd);

  try {
    writeFileSync(localPath, "# local\nFEISHU_APP_ID=cli_old\n", "utf8");

    setProjectEnvValue(localPath, "FEISHU_APP_ID", "cli_new");
    setProjectEnvValue(localPath, "FEISHU_APP_SECRET", "secret");

    let snapshot = readProjectEnvFile(localPath);
    assert.equal(snapshot.values.get("FEISHU_APP_ID"), "cli_new");
    assert.equal(snapshot.values.get("FEISHU_APP_SECRET"), "secret");

    const removed = unsetProjectEnvValue(localPath, "FEISHU_APP_ID");
    snapshot = readProjectEnvFile(localPath);

    assert.equal(removed, true);
    assert.equal(snapshot.values.has("FEISHU_APP_ID"), false);
    assert.equal(snapshot.values.get("FEISHU_APP_SECRET"), "secret");
    assert.match(readFileSync(localPath, "utf8"), /FEISHU_APP_SECRET=secret/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (typeof value === "string") {
    process.env[key] = value;
    return;
  }

  delete process.env[key];
}
