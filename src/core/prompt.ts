import type { PrincipalPersonaProfileData, TaskAttachment, TaskRequest } from "../types/index.js";
import { buildPersonaPromptBlock } from "./persona-profiles.js";
import type { PrincipalPersonaOnboardingInterceptResult } from "./principal-persona-service.js";

export interface BuildTaskPromptOptions {
  personalizedProfileContext?: string | null;
}

export function buildTaskPrompt(request: TaskRequest, options: BuildTaskPromptOptions = {}): string {
  const personalizedProfileContext = normalizePromptSection(options.personalizedProfileContext);
  const sections = [buildPersonaPromptBlock(request)];

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

  sections.push(
    [
      "Response guidance:",
      "- Treat the long-term profile as persistent collaboration preference, but explicit user instructions in this turn take precedence.",
      "- Follow the selected persona, but explicit user instructions take precedence.",
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
): string {
  const requesterName = request.user.displayName?.trim() || request.user.userId;
  const currentQuestionPrompt = normalizePromptSection(onboarding.questionPrompt);
  const draftSummary = formatPersonaDraft(onboarding.profile ?? onboarding.draft);
  const sections = [
    buildPersonaPromptBlock(request),
    "You are running inside Themis, a LAN web UI built on top of the Codex SDK.",
    "You are in first-run persona bootstrap mode for this user.",
    `Bootstrap progress: ${resolveBootstrapProgressLabel(onboarding)}`,
    `Requester: ${requesterName}`,
  ];

  if (onboarding.phase === "started") {
    sections.push(
      [
        "Bootstrap instructions:",
        "- The user's latest message is their original task, not an answer to a prior onboarding question.",
        "- Do not solve that task yet.",
        "- Explain briefly that you need one short one-time bootstrap before normal collaboration.",
        "- Ask only the first missing question, naturally and conversationally.",
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

  sections.push(
    [
      "Response guidance:",
      "- Keep it concise and human.",
      "- Ask at most one question in this turn.",
      "- Do not expose internal field names, step numbers, or JSON.",
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
  ];

  return lines.join("\n");
}
