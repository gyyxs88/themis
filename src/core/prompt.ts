import type { PrincipalPersonaProfileData, TaskAttachment, TaskRequest } from "../types/index.js";
import type { ContextBuildResult } from "../types/context.js";
import { buildAssistantStylePromptBlock } from "./assistant-style.js";
import type { PrincipalPersonaOnboardingInterceptResult } from "./principal-persona-service.js";

export interface BuildTaskPromptOptions {
  personalizedProfileContext?: string | null;
  taskContext?: ContextBuildResult | null;
  fallbackPromptSections?: string[] | null;
}

export function buildTaskPrompt(request: TaskRequest, options: BuildTaskPromptOptions = {}): string {
  const personalizedProfileContext = normalizePromptSection(options.personalizedProfileContext);
  const taskContextSection = normalizePromptSection(formatTaskContext(options.taskContext));
  const sections = [buildAssistantStylePromptBlock(request)];

  if (personalizedProfileContext) {
    sections.push(personalizedProfileContext);
  }

  sections.push(
    "You are running inside Themis, a LAN web UI built on top of the Codex SDK.",
    `Goal:\n${request.goal}`,
  );

  if (request.inputText) {
    sections.push(`Additional context:\n${request.inputText}`);
  }

  if (request.historyContext) {
    sections.push(
      [
        "Prior conversation transcript for this forked session:",
        "Treat it as conversation history that already happened.",
        "Do not summarize or restate it unless the user asks.",
        request.historyContext,
      ].join("\n"),
    );
  }

  if (request.attachments?.length) {
    sections.push(`Attachments:\n${formatAttachments(request.attachments)}`);
  }

  const fallbackPromptSections = options.fallbackPromptSections
    ?.map((section) => normalizePromptSection(section))
    .filter((section): section is string => Boolean(section));

  if (fallbackPromptSections?.length) {
    sections.push(...fallbackPromptSections);
  }

  if (taskContextSection) {
    sections.push(taskContextSection);
  }

  sections.push(
    [
      "Response guidance:",
      "- Treat the principal-level persona as the default assistant persona for every conversation under this principal.",
      "- Make that persona visible in wording, structure, directness, pacing, and collaboration style instead of merely mentioning it.",
      "- Treat the long-term profile as persistent collaboration preference, but explicit user instructions in this turn take precedence.",
      "- Solve the requested task directly.",
      "- Keep the final answer practical and concise.",
      "- Mention touched files when relevant.",
    ].join("\n"),
  );

  return sections.join("\n\n");
}

export function buildBootstrapPrompt(
  request: TaskRequest,
  onboarding: PrincipalPersonaOnboardingInterceptResult,
  options: BuildTaskPromptOptions = {},
): string {
  const isFeishu = request.sourceChannel === "feishu";
  const personalizedProfileContext = normalizePromptSection(options.personalizedProfileContext);
  const taskContextSection = normalizePromptSection(formatTaskContext(options.taskContext));
  const requesterName = request.user.displayName?.trim() || request.user.userId;
  const currentQuestionPrompt = normalizePromptSection(onboarding.questionPrompt);
  const draftSummary = formatPersonaDraft(onboarding.profile ?? onboarding.draft);
  const sections = [
    buildAssistantStylePromptBlock(request),
    "You are running inside Themis, a LAN web UI built on top of the Codex SDK.",
    "You are in first-run persona bootstrap mode for this user.",
    `Bootstrap progress: ${resolveBootstrapProgressLabel(onboarding)}`,
    `Requester: ${requesterName}`,
  ];

  if (personalizedProfileContext) {
    sections.push(personalizedProfileContext);
  }

  if (onboarding.phase === "started") {
    sections.push(
      [
        "Bootstrap instructions:",
        "- The user's latest message is their original task, not an answer to a prior onboarding question.",
        "- Do not solve that task yet.",
        "- Explain briefly that you need one short one-time bootstrap before normal collaboration.",
        "- Ask only the first missing question, naturally and conversationally.",
        "- Prefer natural conversational wording instead of rigid form-filling language.",
        "- Offer a short example reply pattern only if it clearly helps the user answer faster.",
        ...(isFeishu
          ? [
            "- This is Feishu chat. Keep it to 2-3 short lines.",
            "- Avoid long preambles, checklists, and explicit form instructions.",
          ]
          : []),
        "- Do not sound like a form, interrogation, or checklist.",
      ].join("\n"),
    );
  } else if (onboarding.status === "completed") {
    sections.push(
      [
        "Bootstrap instructions:",
        "- The user's latest message should be treated as the final bootstrap answer, not a normal task request.",
        "- Do not ask more questions.",
        "- Confirm that the long-term collaboration profile has been saved.",
        "- Summarize the saved profile briefly and naturally.",
        ...(isFeishu
          ? [
            "- In Feishu, keep the summary compact and teammate-like.",
            "- Prefer one short paragraph over a long checklist.",
          ]
          : []),
        "- Tell the user to resend the interrupted formal task.",
      ].join("\n"),
    );
  } else {
    sections.push(
      [
        "Bootstrap instructions:",
        "- The user's latest message should be treated as the answer to the previous bootstrap question.",
        "- Do not solve any formal task yet.",
        "- Briefly acknowledge the answer, then ask exactly one next question.",
        "- Keep the tone natural and collaborative, not robotic.",
        "- Prefer natural conversational wording instead of rigid form-filling language.",
        "- Offer a short example reply pattern only if it clearly helps the user answer faster.",
        ...(isFeishu
          ? [
            "- This is Feishu chat. Usually use one short acknowledgement plus one short prompt.",
            "- Avoid turning the reply into a mini guide or mini spec.",
          ]
          : []),
        "- Offer examples only if they help the user answer faster.",
      ].join("\n"),
    );
  }

  if (currentQuestionPrompt) {
    sections.push(`Current structural target:\n${currentQuestionPrompt}`);
  }

  sections.push(`Collected profile so far:\n${draftSummary}`);
  sections.push(`Latest user message:\n${request.goal}`);

  if (request.inputText) {
    sections.push(`Additional context:\n${request.inputText}`);
  }

  if (taskContextSection) {
    sections.push(taskContextSection);
  }

  sections.push(
    [
      "Response guidance:",
      "- Keep it concise and human.",
      "- Ask at most one question in this turn.",
      "- Do not expose internal field names, step numbers, or JSON.",
      ...(isFeishu
        ? [
          "- In Feishu, sound like a teammate chatting, not a wizard or form flow.",
          "- Prefer short sentences and low ceremony.",
        ]
        : []),
      "- The principal-level Themis persona should still be visible in tone, structure, and directness, even in bootstrap mode.",
      "- Explicit user instructions in this turn still take precedence over persona tone.",
    ].join("\n"),
  );

  return sections.join("\n\n");
}

function formatAttachments(attachments: TaskAttachment[]): string {
  return attachments
    .map((attachment) => {
      const namePart = attachment.name ? ` (${attachment.name})` : "";
      return `- [${attachment.type}]${namePart}: ${attachment.value}`;
    })
    .join("\n");
}

function normalizePromptSection(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function resolveBootstrapProgressLabel(onboarding: PrincipalPersonaOnboardingInterceptResult): string {
  if (onboarding.status === "completed") {
    return `completed (${onboarding.totalSteps}/${onboarding.totalSteps})`;
  }

  return `in_progress (${onboarding.stepIndex + 1}/${onboarding.totalSteps})`;
}

function formatTaskContext(taskContext?: ContextBuildResult | null): string | null {
  if (!taskContext) {
    return null;
  }

  const sections: string[] = [];

  if (taskContext.blocks.length) {
    sections.push(
      [
        "Task context blocks:",
        ...taskContext.blocks.flatMap((block, index) => [
          `--- block ${index + 1} ---`,
          `kind: ${block.kind}`,
          `title: ${block.title}`,
          `source: ${block.sourcePath}`,
          `priority: ${block.priority}`,
          `truncated: ${String(block.truncated)}`,
          "content:",
          ...prefixBlockLines(block.text, "| "),
        ]),
      ].join("\n"),
    );
  }

  if (taskContext.warnings.length) {
    sections.push(
      [
        "Task context warnings:",
        ...taskContext.warnings.map((warning) => `- [${warning.code}] ${warning.sourceId}: ${warning.message}`),
      ].join("\n"),
    );
  }

  if (!sections.length) {
    return null;
  }

  return sections.join("\n\n");
}

function prefixBlockLines(text: string, prefix: string): string[] {
  return text.split("\n").map((line) => `${prefix}${line}`);
}

function formatPersonaDraft(profile: PrincipalPersonaProfileData): string {
  const lines = [
    typeof profile.preferredAddress === "string" && profile.preferredAddress
      ? `- 对用户的默认称呼：${profile.preferredAddress}`
      : "- 对用户的默认称呼：<unknown>",
    typeof profile.assistantName === "string" && profile.assistantName
      ? `- 你的默认自称：${profile.assistantName}`
      : "- 你的默认自称：Themis",
    typeof profile.workSummary === "string" && profile.workSummary
      ? `- 用户长期背景：${profile.workSummary}`
      : "- 用户长期背景：<unknown>",
    typeof profile.collaborationStyle === "string" && profile.collaborationStyle
      ? `- 用户期望的协作方式：${profile.collaborationStyle}`
      : "- 用户期望的协作方式：<unknown>",
    typeof profile.boundaries === "string" && profile.boundaries
      ? `- 用户明确偏好/边界：${profile.boundaries}`
      : "- 用户明确偏好/边界：<unknown>",
    typeof profile.assistantLanguageStyle === "string" && profile.assistantLanguageStyle
      ? `- Themis 长期语言风格：${profile.assistantLanguageStyle}`
      : "- Themis 长期语言风格：<unknown>",
    typeof profile.assistantMbti === "string" && profile.assistantMbti
      ? `- Themis 长期性格标签：${profile.assistantMbti}`
      : "- Themis 长期性格标签：<unknown>",
    typeof profile.assistantStyleNotes === "string" && profile.assistantStyleNotes
      ? `- Themis 长期补充说明：${profile.assistantStyleNotes}`
      : "- Themis 长期补充说明：<unknown>",
    typeof profile.assistantSoul === "string" && profile.assistantSoul
      ? `- Themis 长期 SOUL：已配置 ${profile.assistantSoul.length} 字`
      : "- Themis 长期 SOUL：<optional>",
  ];

  return lines.join("\n");
}
