import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type {
  PrincipalPersonaOnboardingState,
  PrincipalPersonaProfileData,
  TaskRequest,
} from "../types/index.js";
import { DEFAULT_PERSONA_PROFILE_ID } from "./persona-profiles.js";

interface PersonaOnboardingQuestion {
  key: keyof PrincipalPersonaProfileData;
  prompt: string;
}

export interface PrincipalPersonaOnboardingInterceptResult {
  message: string;
  status: "question" | "completed";
  phase: "started" | "continued" | "completed";
  stepIndex: number;
  totalSteps: number;
  draft: PrincipalPersonaProfileData;
  questionKey?: keyof PrincipalPersonaProfileData;
  questionPrompt?: string;
  profile?: PrincipalPersonaProfileData;
}

const ONBOARDING_QUESTIONS: PersonaOnboardingQuestion[] = [
  {
    key: "preferredAddress",
    prompt: "第 1 问：以后我该怎么称呼你？比如名字、昵称，或者你习惯的称呼都可以。",
  },
  {
    key: "assistantName",
    prompt: "第 2 问：你希望我在和你协作时怎么称呼自己？默认是 Themis，也可以给我一个你更顺手的名字。",
  },
  {
    key: "workSummary",
    prompt: "第 3 问：你现在主要负责什么角色、项目或领域？我会把它当作长期背景。",
  },
  {
    key: "collaborationStyle",
    prompt: "第 4 问：你希望我默认怎么和你协作？比如更直接推进、解释更多、偏审查，或者按你自己的说法描述。",
  },
  {
    key: "boundaries",
    prompt: "第 5 问：我和你协作时，有哪些明确偏好、禁忌或边界？比如先确认再改配置、回答别太绕、不要替你发外部消息。",
  },
];

const SYSTEM_PERSONA_USER_IDS = new Set(["themis-probe"]);

export class PrincipalPersonaService {
  private readonly store: SqliteCodexSessionRegistry;

  constructor(store: SqliteCodexSessionRegistry) {
    this.store = store;
  }

  shouldRunOnboarding(request: TaskRequest, principalId?: string): boolean {
    if (!principalId?.trim()) {
      return false;
    }

    if (SYSTEM_PERSONA_USER_IDS.has(request.user.userId.trim())) {
      return false;
    }

    return true;
  }

  maybeHandleOnboardingTurn(
    principalId: string,
    request: TaskRequest,
  ): PrincipalPersonaOnboardingInterceptResult | null {
    const normalizedPrincipalId = principalId.trim();

    if (!normalizedPrincipalId) {
      return null;
    }

    const now = request.createdAt || new Date().toISOString();
    const existingPrincipal = this.store.getPrincipal(normalizedPrincipalId);

    if (!existingPrincipal) {
      this.store.savePrincipal({
        principalId: normalizedPrincipalId,
        ...(request.user.displayName?.trim() ? { displayName: request.user.displayName.trim() } : {}),
        createdAt: now,
        updatedAt: now,
      });
    }

    const completedProfile = this.store.getPrincipalPersonaProfile(normalizedPrincipalId);

    if (completedProfile) {
      return null;
    }

    const existingState = this.store.getPrincipalPersonaOnboarding(normalizedPrincipalId);

    if (!existingState) {
      const firstQuestion = ONBOARDING_QUESTIONS[0];
      const state: PrincipalPersonaOnboardingState = {
        stepIndex: 0,
        draft: {},
      };

      this.store.savePrincipalPersonaOnboarding({
        principalId: normalizedPrincipalId,
        state,
        createdAt: now,
        updatedAt: now,
      });

      return {
        message: [
          "先花几轮把你的长期协作档案建起来。",
          "我只问这一次，记住后面都会自动带上。",
          "",
          ONBOARDING_QUESTIONS[0]?.prompt ?? "",
          "",
          "答完这一轮后，你再继续发正式任务就行。",
        ].join("\n"),
        status: "question",
        phase: "started",
        stepIndex: 0,
        totalSteps: ONBOARDING_QUESTIONS.length,
        draft: state.draft,
        ...(firstQuestion ? { questionKey: firstQuestion.key } : {}),
        ...(firstQuestion ? { questionPrompt: firstQuestion.prompt } : {}),
      };
    }

    const answer = normalizeAnswer(request.goal);
    const currentQuestion = ONBOARDING_QUESTIONS[existingState.state.stepIndex];

    if (!currentQuestion) {
      this.store.deletePrincipalPersonaOnboarding(normalizedPrincipalId);
      return null;
    }

    if (!answer) {
      return {
        message: [
          "我这轮没有收到有效答案。",
          "",
          currentQuestion.prompt,
        ].join("\n"),
        status: "question",
        phase: "continued",
        stepIndex: existingState.state.stepIndex,
        totalSteps: ONBOARDING_QUESTIONS.length,
        draft: existingState.state.draft,
        questionKey: currentQuestion.key,
        questionPrompt: currentQuestion.prompt,
      };
    }

    const nextDraft = applyAnswer(existingState.state.draft, currentQuestion.key, answer);
    const nextStepIndex = existingState.state.stepIndex + 1;

    if (nextStepIndex >= ONBOARDING_QUESTIONS.length) {
      const profile = finalizeProfile(nextDraft);

      this.store.savePrincipalPersonaProfile({
        principalId: normalizedPrincipalId,
        profile,
        createdAt: existingState.createdAt,
        updatedAt: now,
        completedAt: now,
      });
      this.store.deletePrincipalPersonaOnboarding(normalizedPrincipalId);

      return {
        message: buildCompletionMessage(profile),
        status: "completed",
        phase: "completed",
        stepIndex: ONBOARDING_QUESTIONS.length - 1,
        totalSteps: ONBOARDING_QUESTIONS.length,
        draft: profile,
        profile,
      };
    }

    this.store.savePrincipalPersonaOnboarding({
      principalId: normalizedPrincipalId,
      state: {
        stepIndex: nextStepIndex,
        draft: nextDraft,
      },
      createdAt: existingState.createdAt,
      updatedAt: now,
    });

    const nextQuestion = ONBOARDING_QUESTIONS[nextStepIndex];

    return {
      message: [
        "记下了。",
        "",
        nextQuestion?.prompt ?? "",
      ].join("\n"),
      status: "question",
      phase: "continued",
      stepIndex: nextStepIndex,
      totalSteps: ONBOARDING_QUESTIONS.length,
      draft: nextDraft,
      ...(nextQuestion ? { questionKey: nextQuestion.key } : {}),
      ...(nextQuestion ? { questionPrompt: nextQuestion.prompt } : {}),
    };
  }

  buildPromptContext(principalId?: string): string | null {
    const normalizedPrincipalId = principalId?.trim();

    if (!normalizedPrincipalId) {
      return null;
    }

    const record = this.store.getPrincipalPersonaProfile(normalizedPrincipalId);

    if (!record) {
      return null;
    }

    const profile = record.profile;
    const lines = ["Personalized long-term user profile:"];

    if (profile.preferredAddress) {
      lines.push(`- 对用户的默认称呼：${profile.preferredAddress}`);
    }

    if (profile.assistantName) {
      lines.push(`- 你的默认自称：${profile.assistantName}`);
    }

    if (profile.workSummary) {
      lines.push(`- 用户长期背景：${profile.workSummary}`);
    }

    if (profile.collaborationStyle) {
      lines.push(`- 用户期望的协作方式：${profile.collaborationStyle}`);
    }

    if (profile.boundaries) {
      lines.push(`- 用户明确偏好/边界：${profile.boundaries}`);
    }

    return lines.length > 1 ? lines.join("\n") : null;
  }

  applyProfileDefaults(principalId: string | undefined, request: TaskRequest): TaskRequest {
    const normalizedPrincipalId = principalId?.trim();

    if (!normalizedPrincipalId) {
      return request;
    }

    const record = this.store.getPrincipalPersonaProfile(normalizedPrincipalId);
    const defaultProfileId = record?.profile.defaultProfileId?.trim();

    if (!defaultProfileId || request.options?.profile?.trim()) {
      return request;
    }

    return {
      ...request,
      options: {
        ...(request.options ?? {}),
        profile: defaultProfileId,
      },
    };
  }
}

function applyAnswer(
  draft: PrincipalPersonaProfileData,
  key: keyof PrincipalPersonaProfileData,
  answer: string,
): PrincipalPersonaProfileData {
  const next = {
    ...draft,
    [key]: answer,
  };

  if (key === "assistantName" && isDefaultThemisName(answer)) {
    delete next.assistantName;
  }

  if (key === "collaborationStyle") {
    const resolvedProfileId = resolveDefaultProfileId(answer);

    if (resolvedProfileId) {
      next.defaultProfileId = resolvedProfileId;
    }
  }

  return next;
}

function finalizeProfile(draft: PrincipalPersonaProfileData): PrincipalPersonaProfileData {
  const normalized: PrincipalPersonaProfileData = {
    ...(draft.preferredAddress ? { preferredAddress: draft.preferredAddress } : {}),
    ...(draft.assistantName ? { assistantName: draft.assistantName } : {}),
    ...(draft.workSummary ? { workSummary: draft.workSummary } : {}),
    ...(draft.collaborationStyle ? { collaborationStyle: draft.collaborationStyle } : {}),
    ...(draft.boundaries ? { boundaries: draft.boundaries } : {}),
  };
  const defaultProfileId = resolveDefaultProfileId(draft.collaborationStyle) ?? DEFAULT_PERSONA_PROFILE_ID;

  return {
    ...normalized,
    defaultProfileId,
  };
}

function buildCompletionMessage(profile: PrincipalPersonaProfileData): string {
  const summaryLines = [
    "长期协作档案已经记住了，后面我会自动带上这些信息。",
    "",
    ...(profile.preferredAddress ? [`- 对你的称呼：${profile.preferredAddress}`] : []),
    ...(profile.assistantName ? [`- 我的自称：${profile.assistantName}`] : []),
    ...(profile.workSummary ? [`- 你的长期背景：${profile.workSummary}`] : []),
    ...(profile.collaborationStyle ? [`- 默认协作方式：${profile.collaborationStyle}`] : []),
    ...(profile.boundaries ? [`- 偏好/边界：${profile.boundaries}`] : []),
    "",
    "现在可以继续发正式任务了。第一次被打断的那条任务不会自动续跑，需要你再发一次。",
  ];

  return summaryLines.join("\n");
}

function normalizeAnswer(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 800);
}

function resolveDefaultProfileId(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (!normalized) {
    return undefined;
  }

  if (normalized.includes("审查") || normalized.includes("review") || normalized.includes("挑错")) {
    return "reviewer";
  }

  if (normalized.includes("带教") || normalized.includes("解释") || normalized.includes("教学")) {
    return "mentor";
  }

  if (normalized.includes("推进") || normalized.includes("执行") || normalized.includes("利落")) {
    return "executor";
  }

  if (normalized.includes("默认") || normalized.includes("themis") || normalized.includes("稳")) {
    return DEFAULT_PERSONA_PROFILE_ID;
  }

  return undefined;
}

function isDefaultThemisName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "themis" || normalized === "默认" || normalized === "就叫themis";
}
