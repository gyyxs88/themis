import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveFeishuOutboundAttachmentPlans } from "./outbound-attachments.js";

test("resolveFeishuOutboundAttachmentPlans 会从显式本地链接和 temp touchedFiles 生成回传计划", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-outbound-attachments-"));

  try {
    const reportPath = join(root, "docs", "handoff.md");
    const imagePath = join(root, "temp", "exports", "chart.png");
    mkdirSync(join(root, "docs"), { recursive: true });
    mkdirSync(join(root, "temp", "exports"), { recursive: true });
    writeFileSync(reportPath, "# handoff\n", "utf8");
    writeFileSync(imagePath, "fake-image", "utf8");

    const result = resolveFeishuOutboundAttachmentPlans({
      outputText: `请查看[交接文档](<${reportPath}:12>)`,
      touchedFiles: [imagePath],
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

test("resolveFeishuOutboundAttachmentPlans 不会把源码链接误识别成飞书附件", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-outbound-source-"));

  try {
    const sourcePath = join(root, "src", "index.ts");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(sourcePath, "export const value = 1;\n", "utf8");

    const result = resolveFeishuOutboundAttachmentPlans({
      outputText: `实现见[source](${sourcePath}:3)`,
      touchedFiles: [],
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

test("resolveFeishuOutboundAttachmentPlans 会为超过 30MB 的结果文件给出提示", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-outbound-large-"));

  try {
    const archivePath = join(root, "temp", "exports", "archive.zip");
    mkdirSync(join(root, "temp", "exports"), { recursive: true });
    writeFileSync(archivePath, Buffer.alloc(30 * 1024 * 1024 + 1, 1));

    const result = resolveFeishuOutboundAttachmentPlans({
      outputText: `压缩包见[archive](${archivePath})`,
      touchedFiles: [],
      workspaceDirectory: root,
    });

    assert.deepEqual(result.plans, []);
    assert.deepEqual(result.notices, [
      "结果文件 archive.zip 超过飞书 IM 附件 30MB 上限，当前没有自动回传。",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
