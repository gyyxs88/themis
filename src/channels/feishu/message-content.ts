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

export function extractFeishuPostText(rawContent: string): string | null {
  try {
    const parsed = JSON.parse(rawContent) as Record<string, unknown>;
    const locale = pickPostLocale(parsed);

    if (!locale) {
      return null;
    }

    const lines: string[] = [];
    const title = normalizeText(locale.title);

    if (title) {
      lines.push(title);
    }

    for (const row of readPostRows(locale.content)) {
      const rowText = row.map((item) => {
        const tag = normalizeText(item.tag)?.toLowerCase();

        switch (tag) {
          case "text":
          case "md":
          case "a":
            return normalizeText(item.text) ?? "";
          case "at":
            return normalizeText(item.user_name) ?? normalizeText(item.name) ?? "";
          default:
            return "";
        }
      }).join("").trim();

      if (rowText) {
        lines.push(rowText);
      }
    }

    const normalized = lines.join("\n").replace(/\u00A0/g, " ").replace(/[ \t]+/g, " ").trim();
    return normalized || null;
  } catch {
    return null;
  }
}

export function extractFeishuPostImageKeys(rawContent: string): string[] {
  try {
    const parsed = JSON.parse(rawContent) as Record<string, unknown>;
    const locale = pickPostLocale(parsed);

    if (!locale) {
      return [];
    }

    const imageKeys: string[] = [];

    for (const row of readPostRows(locale.content)) {
      for (const item of row) {
        if (normalizeText(item.tag)?.toLowerCase() !== "img") {
          continue;
        }

        const imageKey = normalizeText(item.image_key);
        if (imageKey) {
          imageKeys.push(imageKey);
        }
      }
    }

    return imageKeys;
  } catch {
    return [];
  }
}
