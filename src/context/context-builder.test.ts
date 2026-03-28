import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ContextBuilder } from "./context-builder.js";
import type { TaskRequest } from "../types/task.js";

function createRequest(root: string): TaskRequest {
  return {
    requestId: "request-context-1",
    sourceChannel: "web",
    user: {
      userId: "user-1",
      displayName: "User",
    },
    goal: "请检查 provider search 支持，并遵守仓库规则。",
    inputText: "当前重点是补齐 context builder。",
    channelContext: {
      sessionId: "session-context-1",
    },
    createdAt: "2026-03-28T12:00:00.000Z",
    options: {
      additionalDirectories: [root],
    },
  };
}

test("ContextBuilder 会按优先级读取 README、AGENTS、memory 和 docs/memory，并记录缺失 warning", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-context-builder-"));

  try {
    writeFileSync(join(root, "README.md"), "# Demo\n\n当前重点是 context builder。\n", "utf8");
    writeFileSync(join(root, "AGENTS.md"), "始终使用中文回复。\n", "utf8");
    mkdirSync(join(root, "memory", "architecture"), { recursive: true });
    mkdirSync(join(root, "docs", "memory", "2026", "03"), { recursive: true });
    writeFileSync(join(root, "memory", "architecture", "overview.md"), "# 架构\n\n当前运行依赖 Codex thread。\n", "utf8");
    writeFileSync(join(root, "docs", "memory", "2026", "03", "provider-search.md"), "# Provider Search\n\nOpenRouter 需要显式声明 search tool。\n", "utf8");

    const builder = new ContextBuilder({
      workingDirectory: root,
    });

    const result = await builder.build({
      request: createRequest(root),
      principalId: "principal-local-owner",
      conversationId: "session-context-1",
    });

    assert.ok(result.blocks.some((block) => block.kind === "repoRules" && block.sourcePath === "AGENTS.md"));
    assert.ok(result.blocks.some((block) => block.kind === "projectState" && block.sourcePath === "README.md"));
    assert.ok(result.blocks.some((block) => block.kind === "relevantMemories" && block.sourcePath.endsWith("provider-search.md")));
    assert.ok(result.warnings.some((warning) => warning.sourceId === "memory/sessions/active.md"));
    assert.equal(result.sourceStats.find((stat) => stat.sourceId === "AGENTS.md")?.included, true);
    assert.deepEqual(
      result.blocks.map((block) => block.priority),
      [...result.blocks.map((block) => block.priority)].sort((left, right) => right - left),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ContextBuilder 只选择相关 docs/memory 文档并受 maxDocsMemoryFiles 限制", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-context-builder-limit-"));

  try {
    writeFileSync(join(root, "README.md"), "# Demo\n\n当前重点是 context builder。\n", "utf8");
    writeFileSync(join(root, "AGENTS.md"), "始终使用中文回复。\n", "utf8");
    mkdirSync(join(root, "memory", "architecture"), { recursive: true });
    mkdirSync(join(root, "docs", "memory", "2026", "03"), { recursive: true });
    writeFileSync(join(root, "memory", "architecture", "overview.md"), "# 架构\n\n当前运行依赖 Codex thread。\n", "utf8");
    writeFileSync(join(root, "docs", "memory", "2026", "03", "provider-search.md"), "# Provider Search\n\nOpenRouter 需要显式声明 search tool。\n", "utf8");
    writeFileSync(join(root, "docs", "memory", "2026", "03", "tooling-notes.md"), "# Notes\n\n这里记录 search 的集成细节。\n", "utf8");
    writeFileSync(join(root, "docs", "memory", "2026", "03", "unrelated-topic.md"), "# Topic\n\n这里只谈前端主题。\n", "utf8");

    const builder = new ContextBuilder({
      workingDirectory: root,
      maxDocsMemoryFiles: 1,
    });

    const result = await builder.build({
      request: createRequest(root),
      principalId: "principal-local-owner",
      conversationId: "session-context-1",
    });

    const relevantBlocks = result.blocks.filter((block) => block.kind === "relevantMemories");
    assert.equal(relevantBlocks.length, 1);
    assert.equal(relevantBlocks.some((block) => block.sourcePath.endsWith("unrelated-topic.md")), false);
    assert.equal(relevantBlocks.some((block) => block.sourcePath.endsWith("provider-search.md")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ContextBuilder 在 docs/memory 遍历失败时降级为 warning 而不是抛错", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-context-builder-docs-fallback-"));

  try {
    writeFileSync(join(root, "README.md"), "# Demo\n\n当前重点是 context builder。\n", "utf8");
    writeFileSync(join(root, "AGENTS.md"), "始终使用中文回复。\n", "utf8");
    mkdirSync(join(root, "memory", "architecture"), { recursive: true });
    writeFileSync(join(root, "memory", "architecture", "overview.md"), "# 架构\n\n当前运行依赖 Codex thread。\n", "utf8");
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "memory"), "not-a-directory", "utf8");

    const builder = new ContextBuilder({
      workingDirectory: root,
    });

    const result = await builder.build({
      request: createRequest(root),
      principalId: "principal-local-owner",
      conversationId: "session-context-1",
    });

    assert.ok(result.warnings.some((warning) => warning.sourceId === "docs/memory" && warning.code === "SOURCE_UNREADABLE"));
    assert.equal(result.sourceStats.some((stat) => stat.sourceId === "docs/memory" && stat.reason === "unreadable"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
