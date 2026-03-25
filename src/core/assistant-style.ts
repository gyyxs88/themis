import type { TaskOptions, TaskRequest } from "../types/index.js";

interface AssistantStyleConfig {
  languageStyle?: string;
  assistantMbti?: string;
  styleNotes?: string;
  assistantSoul?: string;
}

const LEGACY_PROFILE_LABELS: Record<string, string> = {
  "themis-default": "Themis",
  executor: "推进官",
  mentor: "带教搭档",
  reviewer: "审查官",
};

export function buildAssistantStylePromptBlock(request: TaskRequest): string {
  const requesterName = request.user.displayName?.trim() || request.user.userId;
  const style = resolveAssistantStyleConfig(request.options);
  const lines = [
    "Assistant baseline:",
    "- 你是 Themis，一位内部协作型工程助理。",
    "- 先理解目标，再直接推进；信息要诚实，不卖弄，不假装验证过未验证的事实。",
    "- 默认说人话，保持协作感；遇到高风险或破坏性操作时先提醒再行动。",
  ];

  if (hasAssistantStyleConfig(style)) {
    lines.push(
      "",
      "Active Themis persona defaults for this principal:",
      ...(style.languageStyle ? [`- 语言风格：${style.languageStyle}`] : []),
      ...(style.assistantMbti ? [`- MBTI / 性格标签：${style.assistantMbti}`] : []),
      ...(style.styleNotes ? [`- 补充风格说明：${style.styleNotes}`] : []),
      ...(style.assistantSoul ? ["- 长期 SOUL：见下方整段说明。"] : []),
      "- 这些信息是当前 principal 的长期默认助手人格，要在措辞、信息密度、结构、推进方式和情绪温度上稳定体现。",
      "- 不要做表演式角色扮演，也不要只口头复述设定；要把它落实到真实回复里。",
      "- 如果用户当轮明确要求换一种说法或风格，以当轮要求为准。",
    );
  }

  lines.push("", "Requester context:", `- 渠道：${request.sourceChannel}`, `- 用户：${requesterName}`);
  return lines.join("\n");
}

export function buildAssistantStyleSessionPayload(
  options?: Pick<TaskOptions, "profile" | "languageStyle" | "assistantMbti" | "styleNotes"> | null,
): Record<string, string> | null {
  const style = resolveAssistantStyleConfig(options);
  const legacyProfile = normalizeText(options?.profile);
  const payload: Record<string, string> = {
    ...(style.languageStyle ? { languageStyle: style.languageStyle } : {}),
    ...(style.assistantMbti ? { assistantMbti: style.assistantMbti } : {}),
    ...(style.styleNotes ? { styleNotes: style.styleNotes } : {}),
    ...(legacyProfile ? { legacyProfile } : {}),
  };

  return Object.keys(payload).length ? payload : null;
}

export function resolveAssistantDisplayLabel(
  options?: Pick<TaskOptions, "profile" | "languageStyle" | "assistantMbti" | "styleNotes" | "assistantSoul"> | null,
): string {
  const style = resolveAssistantStyleConfig(options);

  if (style.assistantMbti && style.languageStyle) {
    return `Themis · ${truncateLabel(style.assistantMbti)} / ${truncateLabel(style.languageStyle)}`;
  }

  if (style.assistantMbti) {
    return `Themis · ${truncateLabel(style.assistantMbti, 20)}`;
  }

  if (style.languageStyle) {
    return `Themis · ${truncateLabel(style.languageStyle, 20)}`;
  }

  if (style.assistantSoul) {
    return "Themis · 补充设定";
  }

  const legacyProfile = normalizeText(options?.profile);
  return (legacyProfile && LEGACY_PROFILE_LABELS[legacyProfile]) || "Themis";
}

export function describeAssistantStyle(
  options?: Pick<TaskOptions, "profile" | "languageStyle" | "assistantMbti" | "styleNotes" | "assistantSoul"> | null,
): string {
  const style = resolveAssistantStyleConfig(options);

  if (hasAssistantStyleConfig(style)) {
    const parts = [
      style.languageStyle ? `语言风格：${style.languageStyle}。` : "",
      style.assistantMbti ? `MBTI / 性格标签：${style.assistantMbti}。` : "",
      style.styleNotes ? `补充说明：${style.styleNotes}。` : "",
      style.assistantSoul ? `补充设定：已配置 ${style.assistantSoul.length} 字。` : "",
    ].filter(Boolean);

    return `${parts.join(" ")} 这些设置只影响提示词和表达风格，不改变模型、权限和工具能力。`;
  }

  const legacyProfile = normalizeText(options?.profile);
  const legacyLabel = legacyProfile ? LEGACY_PROFILE_LABELS[legacyProfile] : "";

  if (legacyLabel) {
    return `当前沿用旧会话里的预设人格：${legacyLabel}。新会话建议直接填写语言风格、MBTI 或补充说明。`;
  }

  return "当前未设置额外风格。Themis 会按默认协作型助理方式表达，重点仍由你的当轮指令决定。";
}

function resolveAssistantStyleConfig(
  options?: Pick<TaskOptions, "languageStyle" | "assistantMbti" | "styleNotes" | "assistantSoul"> | null,
): AssistantStyleConfig {
  const languageStyle = normalizeText(options?.languageStyle);
  const assistantMbti = normalizeText(options?.assistantMbti);
  const styleNotes = normalizeText(options?.styleNotes);
  const assistantSoul = normalizeLongText(options?.assistantSoul);

  return {
    ...(languageStyle ? { languageStyle } : {}),
    ...(assistantMbti ? { assistantMbti } : {}),
    ...(styleNotes ? { styleNotes } : {}),
    ...(assistantSoul ? { assistantSoul } : {}),
  };
}

function hasAssistantStyleConfig(style: AssistantStyleConfig): boolean {
  return Boolean(style.languageStyle || style.assistantMbti || style.styleNotes || style.assistantSoul);
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeLongText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()
    .slice(0, 4000);
}


function truncateLabel(value: string, maxLength = 14): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
