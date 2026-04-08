export interface FeishuRenderedMessageDraft {
  msgType: "text" | "post" | "interactive";
  content: string;
}

const FEISHU_POST_SAFE_BYTES = 28 * 1024;
const FEISHU_POST_DEFAULT_TITLE = "";

export function renderFeishuAssistantMessage(text: string): FeishuRenderedMessageDraft {
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    return {
      msgType: "text",
      content: JSON.stringify({ text: "" }),
    };
  }

  const sanitizedMarkdown = sanitizeMarkdownForFeishu(normalizedText);
  const postContent = JSON.stringify({
    zh_cn: {
      title: FEISHU_POST_DEFAULT_TITLE,
      content: [[{ tag: "md", text: sanitizedMarkdown }]],
    },
  });

  if (Buffer.byteLength(postContent, "utf8") <= FEISHU_POST_SAFE_BYTES) {
    return {
      msgType: "post",
      content: postContent,
    };
  }

  return {
    msgType: "text",
    content: JSON.stringify({
      text: sanitizedMarkdown,
    }),
  };
}

function sanitizeMarkdownForFeishu(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/!\[([^\]\n]*)\]\(([^)\n]+)\)/g, (_match, altText: string, href: string) => {
      if (isSupportedHref(href)) {
        return `![${altText}](${href})`;
      }

      return altText.trim() || "图片";
    })
    .replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (match, label: string, href: string) => {
      if (isSupportedHref(href)) {
        return match;
      }

      return `\`${label.trim() || "引用"}\``;
    });
}

function isSupportedHref(href: string): boolean {
  const normalizedHref = href.trim();
  return /^https?:\/\//i.test(normalizedHref) || /^mailto:/i.test(normalizedHref);
}

function normalizeText(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}
