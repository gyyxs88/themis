import assert from "node:assert/strict";
import test from "node:test";
import { deriveManagedAgentCompletionInsight } from "./managed-agent-completion-insight.js";

test("deriveManagedAgentCompletionInsight 会把只有元数据的 completion 识别为 metadata_only", () => {
  const insight = deriveManagedAgentCompletionInsight({
    reportFile: "/tmp/run/report.json",
    workspacePath: "/tmp/workspace",
    runtimeContext: {
      contextFile: "/tmp/run/runtime-context.json",
    },
  });

  assert.equal(insight.detailLevel, "metadata_only");
  assert.match(insight.interpretationHint, /不应据此判断当前现网链路仍未修复/);
});

test("deriveManagedAgentCompletionInsight 会把含交付正文但无 artifactContents 的 completion 识别为 deliverable_only", () => {
  const insight = deriveManagedAgentCompletionInsight({
    deliverable: "这里是交付正文。",
    deliverableFile: "/tmp/run/deliverable.md",
  });

  assert.equal(insight.detailLevel, "deliverable_only");
  assert.match(insight.interpretationHint, /结果回传已恢复/);
});

test("deriveManagedAgentCompletionInsight 会把含 artifactContents 的 completion 识别为 full_execution_snapshot", () => {
  const insight = deriveManagedAgentCompletionInsight({
    deliverable: "这里是交付正文。",
    artifactContents: {
      stdout: {
        content: "stdout line",
      },
    },
  });

  assert.equal(insight.detailLevel, "full_execution_snapshot");
  assert.match(insight.interpretationHint, /完整结果回传能力/);
});
