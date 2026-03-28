import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildForkContextFromThread } from "./codex-session-fork.js";

function responseItem(role: "user" | "assistant", text: string): string {
  return JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [
        {
          type: role === "assistant" ? "output_text" : "input_text",
          text,
        },
      ],
    },
  });
}

function themisPrompt(goal: string, inputText?: string): string {
  return [
    "You are running inside Themis",
    "",
    "Goal:",
    goal,
    ...(inputText ? ["", "Additional context:", inputText] : []),
    "",
    "Response guidance:",
    "- keep going",
  ].join("\n");
}

test("buildForkContextFromThread 找不到 thread 对应文件时返回 null", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-fork-missing-"));

  try {
    const result = await buildForkContextFromThread("thread-missing", {
      sessionRoot: root,
    });

    assert.equal(result, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildForkContextFromThread 只提取 Themis turn，并附着 assistant 回复", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-fork-turns-"));
  const nested = join(root, "2026", "03");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "session-thread-123.jsonl"), [
    responseItem("user", "plain user message"),
    responseItem("assistant", "plain assistant reply"),
    responseItem("user", themisPrompt("补 fork 测试", "重点看 transcript 裁剪")),
    responseItem("assistant", "这是 Themis assistant reply"),
  ].join("\n"), "utf8");

  try {
    const result = await buildForkContextFromThread("thread-123", {
      sessionRoot: root,
    });

    assert.ok(result);
    assert.equal(result?.sourceThreadId, "thread-123");
    assert.equal(result?.totalTurns, 1);
    assert.equal(result?.includedTurns, 1);
    assert.match(result?.historyContext ?? "", /User goal:\n补 fork 测试/);
    assert.match(result?.historyContext ?? "", /User context:\n重点看 transcript 裁剪/);
    assert.match(result?.historyContext ?? "", /Assistant reply:\n这是 Themis assistant reply/);
    assert.doesNotMatch(result?.historyContext ?? "", /plain user message/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildForkContextFromThread 在 transcript 超字符预算时会裁剪", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-fork-char-truncated-"));
  const nested = join(root, "2026", "03");
  mkdirSync(nested, { recursive: true });

  const lines: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    lines.push(responseItem("user", themisPrompt(`目标 ${index}`, `上下文 ${index} ${"x".repeat(13000)}`)));
    lines.push(responseItem("assistant", `回复 ${index} ${"y".repeat(400)}`));
  }

  writeFileSync(join(nested, "session-thread-456.jsonl"), lines.join("\n"), "utf8");

  try {
    const result = await buildForkContextFromThread("thread-456", {
      sessionRoot: root,
    });

    assert.ok(result);
    assert.equal(result?.totalTurns, 3);
    assert.equal(Boolean(result?.truncated), true);
    assert.ok((result?.includedTurns ?? 0) < 3);
    assert.equal(result?.includedTurns, 1);
    assert.match(result?.historyContext ?? "", /Older \d+ turns were omitted/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildForkContextFromThread 在 transcript 超 turn 上限时会裁剪", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-fork-turn-truncated-"));
  const nested = join(root, "2026", "03");
  mkdirSync(nested, { recursive: true });

  const lines: string[] = [];
  for (let index = 0; index < 30; index += 1) {
    lines.push(responseItem("user", themisPrompt(`目标 ${index}`, `上下文 ${index}`)));
    lines.push(responseItem("assistant", `回复 ${index}`));
  }

  writeFileSync(join(nested, "session-thread-789.jsonl"), lines.join("\n"), "utf8");

  try {
    const result = await buildForkContextFromThread("thread-789", {
      sessionRoot: root,
    });

    assert.ok(result);
    assert.equal(result?.totalTurns, 30);
    assert.equal(Boolean(result?.truncated), true);
    assert.equal(result?.includedTurns, 24);
    assert.match(result?.historyContext ?? "", /Older \d+ turns were omitted/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
