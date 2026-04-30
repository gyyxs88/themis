import assert from "node:assert/strict";
import test from "node:test";
import {
  parseThemisSecretIntake,
  redactThemisSecretIntakeText,
} from "./themis-secret-intake.js";

test("自然语言 Cloudflare 管理 token 会归一到固定 secretRef", () => {
  const value = "cf-management-token-1234567890abcdef1234567890";
  const intake = parseThemisSecretIntake(`这个是 Cloudflare 管理 token，给你保存好：${value}`);

  assert.deepEqual(intake, {
    secretRef: "cloudflare-management-token",
    value,
    label: "Cloudflare 管理 token",
    source: "known-alias",
  });
});

test("自然语言 secret intake 支持任意平台显式 secretRef", () => {
  const value = "github_pat_11AAAA2222_bbbbbbbbbbbbbbbbbbbbbbbb";
  const intake = parseThemisSecretIntake(`把这个 GitHub token 保存为 github-worker-token：${value}`);

  assert.deepEqual(intake, {
    secretRef: "github-worker-token",
    value,
    label: "github-worker-token",
    source: "explicit-secret-ref",
  });
});

test("自然语言飞书 App ID 会归一到固定 secretRef", () => {
  const value = "cli_a924f3bc42b89bc7";
  const intake = parseThemisSecretIntake(`这个是飞书 App ID，给你保存好：${value}`);

  assert.deepEqual(intake, {
    secretRef: "feishu-app-id",
    value,
    label: "飞书 App ID",
    source: "known-alias",
  });
});

test("自然语言飞书 App Secret 会归一到固定 secretRef", () => {
  const value = "feishu-secret-1234567890abcdef1234567890";
  const intake = parseThemisSecretIntake(`把这个 FEISHU_APP_SECRET 配置一下：${value}`);

  assert.deepEqual(intake, {
    secretRef: "feishu-app-secret",
    value,
    label: "飞书 App Secret",
    source: "known-alias",
  });
});

test("自然语言 secret intake 可从英文平台 token 推导通用 secretRef", () => {
  const value = "github_pat_11AAAA2222_bbbbbbbbbbbbbbbbbbbbbbbb";
  const intake = parseThemisSecretIntake(`This is the GitHub token: ${value}`);

  assert.deepEqual(intake, {
    secretRef: "github-token",
    value,
    label: "github-token",
    source: "generic-provider",
  });
});

test("自然语言 secret intake 日志脱敏支持通用平台 token", () => {
  const value = "github_pat_11AAAA2222_bbbbbbbbbbbbbbbbbbbbbbbb";
  const redacted = redactThemisSecretIntakeText(`This is the GitHub token: ${value}`);

  assert.equal(redacted, "This is the GitHub token: [REDACTED_SECRET]");
});

test("普通文本不会被误判成 secret intake", () => {
  assert.equal(parseThemisSecretIntake("帮我检查一下 GitHub Actions 为什么失败"), null);
});
