function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pickPostLocale(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (Array.isArray(record.content)) {
    return record;
  }

  const preferredLocales = ["zh_cn", "en_us", "ja_jp", "zh_hk", "zh_tw"];

  for (const locale of preferredLocales) {
    const candidate = record[locale];
    if (candidate && typeof candidate === "object") {
      return candidate as Record<string, unknown>;
    }
  }

  for (const candidate of Object.values(record)) {
    if (candidate && typeof candidate === "object") {
      return candidate as Record<string, unknown>;
    }
  }

  return null;
}

function readPostRows(value: unknown): Array<Array<Record<string, unknown>>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((row) => {
    if (!Array.isArray(row)) {
      return [];
    }

    const normalizedRow = row.flatMap((item) => (
      item && typeof item === "object"
        ? [item as Record<string, unknown>]
        : []
    ));

    return normalizedRow.length ? [normalizedRow] : [];
  });
}

export type FeishuPostContentItem =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      imageKey: string;
    };

export function extractFeishuPostContentItems(rawContent: string): FeishuPostContentItem[] {
  try {
    const parsed = JSON.parse(rawContent) as Record<string, unknown>;
    const locale = pickPostLocale(parsed);

    if (!locale) {
      return [];
    }

    const items: FeishuPostContentItem[] = [];
    const title = normalizeText(locale.title);

    if (title) {
      items.push({
        type: "text",
        text: title,
      });
    }

    for (const row of readPostRows(locale.content)) {
      let pendingText = "";
      const flushPendingText = () => {
        const normalized = pendingText.replace(/\u00A0/g, " ").replace(/[ \t]+/g, " ").trim();
        pendingText = "";

        if (!normalized) {
          return;
        }

        items.push({
          type: "text",
          text: normalized,
        });
      };

      for (const item of row) {
        const tag = normalizeText(item.tag)?.toLowerCase();

        switch (tag) {
          case "text":
          case "md":
          case "a":
            pendingText += normalizeText(item.text) ?? "";
            break;
          case "at":
            pendingText += normalizeText(item.user_name) ?? normalizeText(item.name) ?? "";
            break;
          case "img": {
            flushPendingText();
            const imageKey = normalizeText(item.image_key);

            if (!imageKey) {
              break;
            }

            items.push({
              type: "image",
              imageKey,
            });
            break;
          }
          default:
            break;
        }
      }

      flushPendingText();
    }

    return items;
  } catch {
    return [];
  }
}

export function extractFeishuPostText(rawContent: string): string | null {
  const lines = extractFeishuPostContentItems(rawContent)
    .flatMap((item) => item.type === "text" ? [item.text] : []);
  const normalized = lines.join("\n").replace(/\u00A0/g, " ").replace(/[ \t]+/g, " ").trim();
  return normalized || null;
}

export function extractFeishuPostImageKeys(rawContent: string): string[] {
  return extractFeishuPostContentItems(rawContent)
    .flatMap((item) => item.type === "image" ? [item.imageKey] : []);
}
