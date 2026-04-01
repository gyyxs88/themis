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
