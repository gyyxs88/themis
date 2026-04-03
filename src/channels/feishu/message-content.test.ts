import assert from "node:assert/strict";
import test from "node:test";

import {
  extractFeishuPostContentItems,
  extractFeishuPostImageKeys,
  extractFeishuPostText,
} from "./message-content.js";

test("extractFeishuPostContentItems 会保留 post 中的文本和图片原始顺序", () => {
  const rawContent = JSON.stringify({
    zh_cn: {
      title: "日报",
      content: [[
        {
          tag: "text",
          text: "请",
        },
        {
          tag: "at",
          user_name: "小王",
        },
        {
          tag: "a",
          text: "看这里",
        },
      ], [
        {
          tag: "img",
          image_key: "img-key-1",
        },
        {
          tag: "text",
          text: "这是补充说明",
        },
      ]],
    },
  });

  assert.deepEqual(extractFeishuPostContentItems(rawContent), [
    {
      type: "text",
      text: "日报",
    },
    {
      type: "text",
      text: "请小王看这里",
    },
    {
      type: "image",
      imageKey: "img-key-1",
    },
    {
      type: "text",
      text: "这是补充说明",
    },
  ]);
  assert.equal(extractFeishuPostText(rawContent), "日报\n请小王看这里\n这是补充说明");
  assert.deepEqual(extractFeishuPostImageKeys(rawContent), ["img-key-1"]);
});

test("extractFeishuPostContentItems 也支持真实入站 post 顶层结构", () => {
  const rawContent = JSON.stringify({
    title: "",
    content: [[
      {
        tag: "img",
        image_key: "img-key-2",
      },
    ], [
      {
        tag: "text",
        text: "帮我看看这张图",
      },
    ]],
  });

  assert.deepEqual(extractFeishuPostContentItems(rawContent), [
    {
      type: "image",
      imageKey: "img-key-2",
    },
    {
      type: "text",
      text: "帮我看看这张图",
    },
  ]);
  assert.equal(extractFeishuPostText(rawContent), "帮我看看这张图");
  assert.deepEqual(extractFeishuPostImageKeys(rawContent), ["img-key-2"]);
});
