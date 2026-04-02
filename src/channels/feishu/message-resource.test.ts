import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  downloadFeishuMessageResources,
  extractFeishuMessageResources,
  type FeishuMessageResourceClient,
  type FeishuMessageResourceReference,
} from "./message-resource.js";
import type { TaskInputAsset } from "../../types/index.js";

test("extractFeishuMessageResources 会解析图片消息", () => {
  const resources = extractFeishuMessageResources({
    message: {
      message_type: "image",
      message_id: "msg-image-1",
      create_time: "1711958400000",
      content: JSON.stringify({
        image_key: "img-key-1",
      }),
    },
  });

  assert.deepEqual(resources, [{
    id: "msg-image-1::img-key-1",
    type: "image",
    resourceKey: "img-key-1",
    sourceMessageId: "msg-image-1",
    createdAt: new Date(1711958400000).toISOString(),
  }]);
});

test("extractFeishuMessageResources 会解析文件消息并保留文件名", () => {
  const resources = extractFeishuMessageResources({
    message: {
      message_type: "file",
      message_id: "msg-file-1",
      create_time: "1711958460000",
      content: JSON.stringify({
        file_key: "file-key-1",
        file_name: "report.pdf",
      }),
    },
  });

  assert.deepEqual(resources, [{
    id: "msg-file-1::file-key-1",
    type: "file",
    resourceKey: "file-key-1",
    name: "report.pdf",
    sourceMessageId: "msg-file-1",
    createdAt: new Date(1711958460000).toISOString(),
  }]);
});

test("extractFeishuMessageResources 会解析 post 富文本中的图片节点", () => {
  const resources = extractFeishuMessageResources({
    message: {
      message_type: "post",
      message_id: "msg-post-1",
      create_time: "1711958400000",
      content: JSON.stringify({
        zh_cn: {
          title: "",
          content: [[
            {
              tag: "text",
              text: "帮我看看这张图",
            },
            {
              tag: "img",
              image_key: "img-key-post-1",
            },
          ]],
        },
      }),
    },
  });

  assert.deepEqual(resources, [{
    id: "msg-post-1::img-key-post-1",
    type: "image",
    resourceKey: "img-key-post-1",
    sourceMessageId: "msg-post-1",
    createdAt: new Date(1711958400000).toISOString(),
  }]);
});

test("extractFeishuMessageResources 也会解析真实入站 post 顶层结构中的图片节点", () => {
  const resources = extractFeishuMessageResources({
    message: {
      message_type: "post",
      message_id: "msg-post-2",
      create_time: "1775040596104",
      content: JSON.stringify({
        title: "",
        content: [[
          {
            tag: "img",
            image_key: "img-key-post-2",
            width: 1226,
            height: 780,
          },
        ], [
          {
            tag: "text",
            text: "帮我看看这张图",
            style: [],
          },
        ]],
      }),
    },
  });

  assert.deepEqual(resources, [{
    id: "msg-post-2::img-key-post-2",
    type: "image",
    resourceKey: "img-key-post-2",
    sourceMessageId: "msg-post-2",
    createdAt: new Date(1775040596104).toISOString(),
  }]);
});

test("extractFeishuMessageResources 在非附件消息或缺少资源键时返回 null", () => {
  assert.equal(extractFeishuMessageResources({
    message: {
      message_type: "text",
      message_id: "msg-text-1",
      create_time: "1711958400000",
      content: JSON.stringify({ text: "hello" }),
    },
  }), null);

  assert.equal(extractFeishuMessageResources({
    message: {
      message_type: "image",
      message_id: "msg-image-2",
      create_time: "1711958400000",
      content: JSON.stringify({}),
    },
  }), null);
});

test("downloadFeishuMessageResources 会下载附件并返回标准化结果", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-message-resource-"));
  const resources: FeishuMessageResourceReference[] = [{
    id: "msg-file-1::file-key-1",
    type: "file",
    resourceKey: "file-key-1",
    name: "report.pdf",
    sourceMessageId: "msg-file-1",
    createdAt: "2026-04-01T08:00:00.000Z",
  }];
  const calls: Array<{ type: string; messageId: string; fileKey: string }> = [];
  const client: FeishuMessageResourceClient = {
    im: {
      v1: {
        messageResource: {
          async get(payload) {
            calls.push({
              type: payload?.params.type ?? "",
              messageId: payload?.path.message_id ?? "",
              fileKey: payload?.path.file_key ?? "",
            });

            return {
              headers: {
                "content-type": "application/pdf",
              },
              async writeFile(filePath: string) {
                await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-pdf"));
              },
              getReadableStream() {
                throw new Error("not implemented");
              },
            };
          },
        },
      },
    },
  };

  try {
    const attachments = await downloadFeishuMessageResources({
      client,
      resources,
      targetDirectory: join(root, "downloads"),
    });

    assert.deepEqual(calls, [{
      type: "file",
      messageId: "msg-file-1",
      fileKey: "file-key-1",
    }]);
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0]?.id, "msg-file-1::file-key-1");
    assert.equal(attachments[0]?.type, "file");
    assert.equal(attachments[0]?.name, "report.pdf");
    assert.equal(readFileSync(attachments[0]?.value ?? "", "utf8"), "fake-pdf");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("downloadFeishuMessageResources 会把 markdown 文件资源交给共享文档富化器", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-message-resource-text-"));
  const resources: FeishuMessageResourceReference[] = [{
    id: "msg-file-text::file-key-text",
    type: "file",
    resourceKey: "file-key-text",
    name: "guide.md",
    sourceMessageId: "msg-file-text",
    createdAt: "2026-04-03T08:00:00.000Z",
  }];
  let enrichCalls = 0;

  const client: FeishuMessageResourceClient = {
    im: {
      v1: {
        messageResource: {
          async get() {
            return {
              headers: {
                "content-type": "text/markdown",
              },
              async writeFile(filePath: string) {
                await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "# Guide\n\nhello"));
              },
              getReadableStream() {
                throw new Error("not implemented");
              },
            };
          },
        },
      },
    },
  };

  try {
    const attachments = await downloadFeishuMessageResources({
      client,
      resources,
      targetDirectory: join(root, "downloads"),
      enrichDocumentAsset: async (asset) => {
        enrichCalls += 1;
        return {
          ...asset,
          ingestionStatus: "ready",
          textExtraction: {
            status: "completed",
            textPath: `${asset.localPath}.themis.txt`,
            textPreview: "# Guide",
          },
        };
      },
    });

    assert.equal(enrichCalls, 1);
    assert.equal(attachments[0]?.mimeType, "text/markdown");
    assert.equal(attachments[0]?.textExtraction?.status, "completed");
    assert.equal(attachments[0]?.textExtraction?.textPreview, "# Guide");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("downloadFeishuMessageResources 会在显式 PDF 文件上调用富化器并返回富化结果", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-message-resource-pdf-"));
  const resources: FeishuMessageResourceReference[] = [{
    id: "msg-file-2::file-key-2",
    type: "file",
    resourceKey: "file-key-2",
    name: "report.pdf",
    sourceMessageId: "msg-file-2",
    createdAt: "2026-04-01T08:00:00.000Z",
  }];
  const receivedAssets: TaskInputAsset[] = [];
  const client: FeishuMessageResourceClient = {
    im: {
      v1: {
        messageResource: {
          async get() {
            return {
              headers: {
                "content-type": "application/pdf",
              },
              async writeFile(filePath: string) {
                await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-pdf"));
              },
              getReadableStream() {
                throw new Error("not implemented");
              },
            };
          },
        },
      },
    },
  };

  try {
    const attachments = await downloadFeishuMessageResources({
      client,
      resources,
      targetDirectory: join(root, "downloads"),
      enrichPdfAsset: async (asset) => {
        receivedAssets.push(asset);
        return {
          ...asset,
          ingestionStatus: "ready",
          metadata: {
            pageCount: 8,
          },
          textExtraction: {
            status: "completed",
            textPath: "/tmp/report.txt",
            textPreview: "fake text",
          },
        };
      },
    });

    assert.equal(receivedAssets.length, 1);
    assert.equal(receivedAssets[0]?.mimeType, "application/pdf");
    assert.equal(attachments[0]?.textExtraction?.status, "completed");
    assert.equal(attachments[0]?.metadata?.pageCount, 8);
    assert.equal(attachments[0]?.textExtraction?.textPath, "/tmp/report.txt");
    assert.equal(readFileSync(attachments[0]?.value ?? "", "utf8"), "fake-pdf");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("downloadFeishuMessageResources 会在文件名后缀是 pdf 但 MIME 未显式时仍然调用富化器", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-message-resource-pdf-suffix-"));
  const resources: FeishuMessageResourceReference[] = [{
    id: "msg-file-3::file-key-3",
    type: "file",
    resourceKey: "file-key-3",
    name: "report.pdf",
    sourceMessageId: "msg-file-3",
    createdAt: "2026-04-01T08:00:00.000Z",
  }];
  let enrichCalls = 0;
  const client: FeishuMessageResourceClient = {
    im: {
      v1: {
        messageResource: {
          async get() {
            return {
              headers: {
                "content-type": "application/octet-stream",
              },
              async writeFile(filePath: string) {
                await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-pdf"));
              },
              getReadableStream() {
                throw new Error("not implemented");
              },
            };
          },
        },
      },
    },
  };

  try {
    const attachments = await downloadFeishuMessageResources({
      client,
      resources,
      targetDirectory: join(root, "downloads"),
      enrichPdfAsset: async (asset) => {
        enrichCalls++;
        return {
          ...asset,
          ingestionStatus: "ready",
          textExtraction: {
            status: "completed",
            textPath: "/tmp/report.txt",
          },
        };
      },
    });

    assert.equal(enrichCalls, 1);
    assert.equal(attachments[0]?.mimeType, "application/pdf");
    assert.equal(attachments[0]?.textExtraction?.status, "completed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("downloadFeishuMessageResources 会把带参数的 PDF content-type 归一化后再走富化", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-message-resource-pdf-parameterized-"));
  const resources: FeishuMessageResourceReference[] = [{
    id: "msg-file-parameterized::file-key-parameterized",
    type: "file",
    resourceKey: "file-key-parameterized",
    sourceMessageId: "msg-file-parameterized",
    createdAt: "2026-04-01T08:00:00.000Z",
  }];
  let enrichCalls = 0;
  const client: FeishuMessageResourceClient = {
    im: {
      v1: {
        messageResource: {
          async get() {
            return {
              headers: {
                "content-type": "application/pdf; charset=binary",
              },
              async writeFile(filePath: string) {
                await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-pdf"));
              },
              getReadableStream() {
                throw new Error("not implemented");
              },
            };
          },
        },
      },
    },
  };

  try {
    const attachments = await downloadFeishuMessageResources({
      client,
      resources,
      targetDirectory: join(root, "downloads"),
      enrichPdfAsset: async (asset) => {
        enrichCalls++;
        return {
          ...asset,
          ingestionStatus: "ready",
          textExtraction: {
            status: "completed",
          },
        };
      },
    });

    assert.equal(enrichCalls, 1);
    assert.equal(attachments[0]?.mimeType, "application/pdf");
    assert.equal(attachments[0]?.name?.endsWith(".pdf"), true);
    assert.equal(attachments[0]?.textExtraction?.status, "completed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("downloadFeishuMessageResources 会在 PDF 富化失败时保留落盘资产并标记失败", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-message-resource-pdf-failed-"));
  const resources: FeishuMessageResourceReference[] = [{
    id: "msg-file-4::file-key-4",
    type: "file",
    resourceKey: "file-key-4",
    name: "report.pdf",
    sourceMessageId: "msg-file-4",
    createdAt: "2026-04-01T08:00:00.000Z",
  }];
  const client: FeishuMessageResourceClient = {
    im: {
      v1: {
        messageResource: {
          async get() {
            return {
              headers: {
                "content-type": "application/pdf",
              },
              async writeFile(filePath: string) {
                await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-pdf"));
              },
              getReadableStream() {
                throw new Error("not implemented");
              },
            };
          },
        },
      },
    },
  };

  try {
    const attachments = await downloadFeishuMessageResources({
      client,
      resources,
      targetDirectory: join(root, "downloads"),
      enrichPdfAsset: async () => {
        throw new Error("pdf enrichment failed");
      },
    });

    assert.equal(attachments[0]?.ingestionStatus, "ready");
    assert.equal(attachments[0]?.textExtraction?.status, "failed");
    assert.equal(attachments[0]?.name, "report.pdf");
    assert.equal(readFileSync(attachments[0]?.value ?? "", "utf8"), "fake-pdf");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("downloadFeishuMessageResources 会为无文件名的图片推导回退文件名", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-message-resource-image-"));
  const resources: FeishuMessageResourceReference[] = [{
    id: "msg-image-1::img-key-1",
    type: "image",
    resourceKey: "img-key-1",
    sourceMessageId: "msg-image-1",
    createdAt: "2026-04-01T08:00:00.000Z",
  }];
  const client: FeishuMessageResourceClient = {
    im: {
      v1: {
        messageResource: {
          async get() {
            return {
              headers: {
                "content-type": "image/png",
              },
              async writeFile(filePath: string) {
                await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
              },
              getReadableStream() {
                throw new Error("not implemented");
              },
            };
          },
        },
      },
    },
  };

  try {
    const attachments = await downloadFeishuMessageResources({
      client,
      resources,
      targetDirectory: join(root, "downloads"),
    });

    assert.equal(attachments[0]?.type, "image");
    assert.equal(attachments[0]?.name, "image-msg-image-1-img-key-1.png");
    assert.equal(readFileSync(attachments[0]?.value ?? "", "utf8"), "fake-image");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("downloadFeishuMessageResources 不会对非 PDF 资源调用富化器", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-message-resource-image-no-pdf-"));
  const resources: FeishuMessageResourceReference[] = [{
    id: "msg-image-2::img-key-2",
    type: "image",
    resourceKey: "img-key-2",
    sourceMessageId: "msg-image-2",
    createdAt: "2026-04-01T08:00:00.000Z",
  }];
  let enrichCalls = 0;
  let enrichDocumentCalls = 0;
  const client: FeishuMessageResourceClient = {
    im: {
      v1: {
        messageResource: {
          async get() {
            return {
              headers: {
                "content-type": "image/png",
              },
              async writeFile(filePath: string) {
                await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
              },
              getReadableStream() {
                throw new Error("not implemented");
              },
            };
          },
        },
      },
    },
  };

  try {
    const attachments = await downloadFeishuMessageResources({
      client,
      resources,
      targetDirectory: join(root, "downloads"),
      enrichPdfAsset: async () => {
        enrichCalls++;
        throw new Error("should not be called");
      },
      enrichDocumentAsset: async () => {
        enrichDocumentCalls++;
        throw new Error("should not be called");
      },
    });

    assert.equal(enrichCalls, 0);
    assert.equal(enrichDocumentCalls, 0);
    assert.equal(attachments[0]?.type, "image");
    assert.equal(attachments[0]?.textExtraction, undefined);
    assert.equal(readFileSync(attachments[0]?.value ?? "", "utf8"), "fake-image");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("downloadFeishuMessageResources 会在图片缺少 content-type 时维持 png 回退名和默认 mimeType 一致", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-message-resource-image-default-mime-"));
  const resources: FeishuMessageResourceReference[] = [{
    id: "msg-image-default::img-key-default",
    type: "image",
    resourceKey: "img-key-default",
    sourceMessageId: "msg-image-default",
    createdAt: "2026-04-01T08:00:00.000Z",
  }];
  const client: FeishuMessageResourceClient = {
    im: {
      v1: {
        messageResource: {
          async get() {
            return {
              headers: {},
              async writeFile(filePath: string) {
                await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-image"));
              },
              getReadableStream() {
                throw new Error("not implemented");
              },
            };
          },
        },
      },
    },
  };

  try {
    const attachments = await downloadFeishuMessageResources({
      client,
      resources,
      targetDirectory: join(root, "downloads"),
    });

    assert.equal(attachments[0]?.mimeType, "image/png");
    assert.equal(attachments[0]?.name?.endsWith(".png"), true);
    assert.equal(readFileSync(attachments[0]?.value ?? "", "utf8"), "fake-image");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("downloadFeishuMessageResources 会保留飞书资源自己的身份字段，不允许富化回填冲散它们", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-message-resource-invariants-"));
  const resources: FeishuMessageResourceReference[] = [{
    id: "msg-file-invariants::file-key-invariants",
    type: "file",
    resourceKey: "file-key-invariants",
    name: "report.pdf",
    sourceMessageId: "msg-file-invariants",
    createdAt: "2026-04-01T08:00:00.000Z",
  }];
  const client: FeishuMessageResourceClient = {
    im: {
      v1: {
        messageResource: {
          async get() {
            return {
              headers: {
                "content-type": "application/pdf",
              },
              async writeFile(filePath: string) {
                await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "fake-pdf"));
              },
              getReadableStream() {
                throw new Error("not implemented");
              },
            };
          },
        },
      },
    },
  };

  try {
    const attachments = await downloadFeishuMessageResources({
      client,
      resources,
      targetDirectory: join(root, "downloads"),
      enrichPdfAsset: async (asset) => ({
        ...asset,
        assetId: "other-asset-id",
        localPath: "/tmp/other-path.pdf",
        sourceChannel: "web",
        ingestionStatus: "processed",
        metadata: {
          pageCount: 2,
        },
        textExtraction: {
          status: "completed",
        },
      }),
    });

    assert.equal(attachments[0]?.id, "msg-file-invariants::file-key-invariants");
    assert.equal(attachments[0]?.assetId, "msg-file-invariants::file-key-invariants");
    assert.match(attachments[0]?.localPath ?? "", /msg-file-invariants/);
    assert.equal(attachments[0]?.value, attachments[0]?.localPath);
    assert.equal(attachments[0]?.sourceChannel, "feishu");
    assert.equal(attachments[0]?.ingestionStatus, "processed");
    assert.equal(attachments[0]?.metadata?.pageCount, 2);
    assert.equal(attachments[0]?.textExtraction?.status, "completed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
