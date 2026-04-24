import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ensureAuthAccountCodexHome,
  ensureManagedAgentExecutionCodexHome,
  resolveManagedCodexHome,
} from "./auth-accounts.js";

test("ensureAuthAccountCodexHome 会为受管账号写入默认模型配置", () => {
  const root = join(tmpdir(), `themis-auth-accounts-${Date.now()}`);

  try {
    const codexHome = resolveManagedCodexHome(root, "default");
    ensureAuthAccountCodexHome(root, codexHome);

    assert.equal(
      readFileSync(join(codexHome, "config.toml"), "utf8"),
      [
        "# Managed by Themis for multi-account Codex auth isolation.",
        "cli_auth_credentials_store = \"file\"",
        "model = \"gpt-5.5\"",
        "model_reasoning_effort = \"xhigh\"",
        "",
      ].join("\n"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureManagedAgentExecutionCodexHome 会在无 source 时写入默认模型配置", () => {
  const root = join(tmpdir(), `themis-agent-runtime-${Date.now()}`);

  try {
    const codexHome = ensureManagedAgentExecutionCodexHome(root, "agent-alpha");

    assert.equal(
      readFileSync(join(codexHome, "config.toml"), "utf8"),
      [
        "# Managed by Themis for managed-agent runtime isolation.",
        "cli_auth_credentials_store = \"file\"",
        "model = \"gpt-5.5\"",
        "model_reasoning_effort = \"xhigh\"",
        "",
      ].join("\n"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureManagedAgentExecutionCodexHome 会复制 source codex home 的 config", () => {
  const root = join(tmpdir(), `themis-agent-runtime-source-${Date.now()}`);
  const sourceCodexHome = join(root, "source-codex-home");

  try {
    mkdirSync(sourceCodexHome, { recursive: true });
    writeFileSync(join(sourceCodexHome, "auth.json"), "{\"token\":\"demo\"}\n", "utf8");
    writeFileSync(
      join(sourceCodexHome, "config.toml"),
      "model = \"gpt-5.4\"\nmodel_reasoning_effort = \"xhigh\"\nprofile = \"engineering\"\n",
      "utf8",
    );

    const targetCodexHome = ensureManagedAgentExecutionCodexHome(root, "agent-beta", {
      sourceCodexHome,
    });

    assert.equal(readFileSync(join(targetCodexHome, "auth.json"), "utf8"), "{\"token\":\"demo\"}\n");
    assert.equal(
      readFileSync(join(targetCodexHome, "config.toml"), "utf8"),
      "model = \"gpt-5.4\"\nmodel_reasoning_effort = \"xhigh\"\nprofile = \"engineering\"\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureManagedAgentExecutionCodexHome 不会用普通受管账号默认 config 覆盖员工运行时隔离 config", () => {
  const root = join(tmpdir(), `themis-agent-runtime-managed-source-${Date.now()}`);
  const sourceCodexHome = resolveManagedCodexHome(root, "acct-managed");

  try {
    ensureAuthAccountCodexHome(root, sourceCodexHome);
    const targetCodexHome = ensureManagedAgentExecutionCodexHome(root, "agent-gamma", {
      sourceCodexHome,
    });

    assert.equal(
      readFileSync(join(targetCodexHome, "config.toml"), "utf8"),
      [
        "# Managed by Themis for managed-agent runtime isolation.",
        "cli_auth_credentials_store = \"file\"",
        "model = \"gpt-5.5\"",
        "model_reasoning_effort = \"xhigh\"",
        "",
      ].join("\n"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
