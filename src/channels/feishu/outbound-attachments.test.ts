import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TaskResult } from "../../types/index.js";
import {
  finalizeFeishuOutboundAttachmentResult,
  readFeishuExplicitAttachmentPaths,
  resolveFeishuOutboundAttachmentPlans,
} from "./outbound-attachments.js";

test("finalizeFeishuOutboundAttachmentResult 会提取隐藏附件指令并清理可见输出", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-outbound-attachments-"));

  try {
    const reportPath = join(root, "docs", "handoff.md");
    const imagePath = join(root, "temp", "exports", "chart.png");
    const result: TaskResult = {
      taskId: "task-1",
      requestId: "request-1",
      status: "completed",
      summary: "原始摘要",
      output: [
        "老板，材料我已经整理好了。",
        "",
        "```themis-feishu-attachments",
        reportPath,
        `- ${imagePath}`,
        "```",
      ].join("\n"),
      completedAt: new Date().toISOString(),
    };

    const finalized = finalizeFeishuOutboundAttachmentResult(result);

    assert.equal(finalized.output, "老板，材料我已经整理好了。");
    assert.equal(finalized.summary, "老板，材料我已经整理好了。");
    assert.deepEqual(readFeishuExplicitAttachmentPaths(finalized.structuredOutput), [
      reportPath,
      imagePath,
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveFeishuOutboundAttachmentPlans 只会消费显式附件动作，不再根据普通本地链接和 touchedFiles 自动回传", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-outbound-disabled-auto-"));

  try {
    const result = resolveFeishuOutboundAttachmentPlans({
      structuredOutput: {
        session: {
          engine: "app-server",
        },
      },
      workspaceDirectory: root,
    });

    assert.deepEqual(result, {
      plans: [],
      notices: [],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveFeishuOutboundAttachmentPlans 会把显式附件动作转成飞书回传计划", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-outbound-ready-"));

  try {
    const reportPath = join(root, "docs", "handoff.md");
    const imagePath = join(root, "temp", "exports", "chart.png");
    mkdirSync(join(root, "docs"), { recursive: true });
    mkdirSync(join(root, "temp", "exports"), { recursive: true });
    writeFileSync(reportPath, "# handoff\n", "utf8");
    writeFileSync(imagePath, "fake-image", "utf8");

    const result = resolveFeishuOutboundAttachmentPlans({
      structuredOutput: {
        channelActions: {
          feishu: {
            attachmentPaths: [reportPath, imagePath],
          },
        },
      },
      workspaceDirectory: root,
    });

    assert.deepEqual(result.notices, []);
    assert.deepEqual(result.plans, [
      {
        absolutePath: reportPath,
        fileName: "handoff.md",
        messageType: "file",
        uploadFileType: "stream",
      },
      {
        absolutePath: imagePath,
        fileName: "chart.png",
        messageType: "image",
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveFeishuOutboundAttachmentPlans 会拦截工作区外路径和源码文件", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-outbound-guard-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "themis-feishu-outbound-outside-"));

  try {
    const outsidePath = join(outsideRoot, "outside.pdf");
    const sourcePath = join(root, "src", "demo.ts");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(outsidePath, "outside", "utf8");
    writeFileSync(sourcePath, "export const demo = 1;\n", "utf8");

    const result = resolveFeishuOutboundAttachmentPlans({
      structuredOutput: {
        channelActions: {
          feishu: {
            attachmentPaths: [outsidePath, sourcePath],
          },
        },
      },
      workspaceDirectory: root,
    });

    assert.deepEqual(result.plans, []);
    assert.deepEqual(result.notices, [
      "结果文件 outside.pdf 不在当前工作区内，当前不会回传。",
      "结果文件 demo.ts 属于源码文件，当前不会作为飞书附件回传。",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});
