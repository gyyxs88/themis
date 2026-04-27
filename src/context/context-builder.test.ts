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
    assert.equal(result.blocks.find((block) => block.sourcePath === "README.md")?.delivery, "reference");
    assert.match(result.blocks.find((block) => block.sourcePath === "README.md")?.text ?? "", /Source file: README\.md/);
    assert.equal(result.blocks.find((block) => block.sourcePath === "AGENTS.md")?.delivery, "inline");
    assert.equal(result.sourceStats.find((stat) => stat.sourceId === "README.md")?.delivery, "reference");
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

test("ContextBuilder 会把任务台账和过大的 docs/memory 文档改成引用块", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-context-builder-reference-"));

  try {
    writeFileSync(join(root, "AGENTS.md"), "始终使用中文回复。", "utf8");
    writeFileSync(join(root, "README.md"), "# Demo\n\n短说明。\n", "utf8");
    mkdirSync(join(root, "memory", "tasks"), { recursive: true });
    mkdirSync(join(root, "docs", "memory", "2026", "03"), { recursive: true });
    writeFileSync(join(root, "memory", "tasks", "in-progress.md"), `# In Progress\n\n${"当前任务。\n".repeat(100)}`, "utf8");
    writeFileSync(join(root, "docs", "memory", "2026", "03", "large-provider-search.md"), `# Provider Search\n\n${"search 约束。\n".repeat(800)}`, "utf8");
    writeFileSync(join(root, "docs", "memory", "2026", "03", "small-provider-search.md"), "# Small\n\nprovider search 小记。\n", "utf8");

    const builder = new ContextBuilder({
      workingDirectory: root,
      maxDocsMemoryFiles: 2,
    });

    const result = await builder.build({
      request: createRequest(root),
      principalId: "principal-local-owner",
      conversationId: "session-context-1",
    });
    const inProgress = result.blocks.find((block) => block.sourcePath === "memory/tasks/in-progress.md");
    const largeMemory = result.blocks.find((block) => block.sourcePath.endsWith("large-provider-search.md"));
    const smallMemory = result.blocks.find((block) => block.sourcePath.endsWith("small-provider-search.md"));

    assert.equal(inProgress?.delivery, "reference");
    assert.match(inProgress?.text ?? "", /read it directly/);
    assert.equal(largeMemory?.delivery, "reference");
    assert.match(largeMemory?.text ?? "", /Original size:/);
    assert.equal(smallMemory?.delivery, "inline");
    assert.match(smallMemory?.text ?? "", /provider search 小记/);
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

test("ContextBuilder 在扫描过程中响应 abort signal", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-context-builder-abort-"));

  try {
    writeFileSync(join(root, "README.md"), "# Demo\n\n当前重点是 context builder。\n", "utf8");
    writeFileSync(join(root, "AGENTS.md"), "始终使用中文回复。\n", "utf8");
    mkdirSync(join(root, "memory", "architecture"), { recursive: true });
    writeFileSync(join(root, "memory", "architecture", "overview.md"), "# 架构\n\n当前运行依赖 Codex thread。\n", "utf8");
    mkdirSync(join(root, "docs", "memory", "2026", "03"), { recursive: true });
    for (let index = 0; index < 200; index += 1) {
      writeFileSync(
        join(root, "docs", "memory", "2026", "03", `note-${String(index).padStart(3, "0")}-provider-search.md`),
        "# note\nprovider search",
        "utf8",
      );
    }

    const builder = new ContextBuilder({
      workingDirectory: root,
    });
    const abortController = new AbortController();
    const buildPromise = builder.build({
      request: createRequest(root),
      signal: abortController.signal,
    });
    setTimeout(() => {
      abortController.abort(new Error("manual abort"));
    }, 0);

    await assert.rejects(async () => buildPromise, /abort/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
