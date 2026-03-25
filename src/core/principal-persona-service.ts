import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type {
  PrincipalPersonaOnboardingState,
  PrincipalPersonaProfileData,
  TaskRequest,
} from "../types/index.js";

type PersonaFieldKey = keyof PrincipalPersonaProfileData;

interface PersonaOnboardingStep {
  id: string;
  questionKey: string;
  prompt: string;
  isSatisfied(draft: PrincipalPersonaProfileData): boolean;
  applyAnswer(draft: PrincipalPersonaProfileData, answer: string): PersonaOnboardingStepResult;
}

export interface PrincipalPersonaOnboardingInterceptResult {
  message: string;
  status: "question" | "completed";
  phase: "started" | "continued" | "completed";
  stepIndex: number;
  totalSteps: number;
  draft: PrincipalPersonaProfileData;
  questionKey?: string;
  questionPrompt?: string;
  profile?: PrincipalPersonaProfileData;
}

interface PersonaOnboardingStepResult {
  draft: PrincipalPersonaProfileData;
  errorMessage?: string;
}

const ONBOARDING_STEPS: PersonaOnboardingStep[] = [
  {
    id: "identity",
    questionKey: "identity",
    prompt: "先认识一下。以后我怎么称呼你比较顺手？如果你也想顺手给我起个名字，可以一起告诉我。",
    isSatisfied(draft) {
      return Boolean(draft.preferredAddress);
    },
    applyAnswer(draft, answer) {
      const parsed = parseIdentityAnswer(answer);

      if (!parsed.preferredAddress) {
        return {
          draft,
          errorMessage: "这句我没完全听明白。你直接用自然话再说一遍也行，比如“叫我老板，你叫心心”。",
        };
      }

      return {
        draft: mergePersonaDraft(draft, parsed),
      };
    },
  },
  {
    id: "user-context",
    questionKey: "user-context",
    prompt: "再多告诉我一点你的长期背景吧。你现在主要在做什么，希望我平时怎么跟你配合？如果有明确边界，也可以顺手说。",
    isSatisfied(draft) {
      return Boolean(draft.workSummary && draft.collaborationStyle);
    },
    applyAnswer(draft, answer) {
      const parsed = parseUserContextAnswer(answer);

      if (!parsed.workSummary || !parsed.collaborationStyle) {
        return {
          draft,
          errorMessage: "这句我还没完全拆清。你直接用自然话告诉我：你在做什么，希望我怎么配合；如果有边界也顺手说。",
        };
      }

      return {
        draft: mergePersonaDraft(draft, parsed),
      };
    },
  },
  {
    id: "assistant-persona",
    questionKey: "assistant-persona",
    prompt: "也定一下我的默认风格吧。你希望我平时更像什么样的人？比如更直接一点、解释多一点、先下结论再展开；如果你有偏好的性格标签，也可以一起说。",
    isSatisfied(draft) {
      return Boolean(draft.assistantLanguageStyle);
    },
    applyAnswer(draft, answer) {
      const parsed = parseAssistantPersonaAnswer(answer);

      if (!parsed.assistantLanguageStyle) {
        return {
          draft,
          errorMessage: "这句我还没抓到你希望我的默认风格。你直接用自然话说也行，比如“平时直接一点，先下结论再展开”。",
        };
      }

      return {
        draft: mergePersonaDraft(draft, parsed),
      };
    },
  },
  {
    id: "assistant-soul",
    questionKey: "assistant-soul",
    prompt: "最后还有个可选项。如果你希望我长期带一点固定习惯或原则，也可以再补一句。比如“先给结论，不确定就直说，别太官话”。不写也没关系，我先按前面的风格走。",
    isSatisfied(draft) {
      return Boolean(draft.assistantSoul);
    },
    applyAnswer(draft, answer) {
      if (isSkipAnswer(answer)) {
        return { draft };
      }

      const assistantSoul = normalizeAssistantSoul(answer);

      if (!assistantSoul) {
        return {
          draft,
          errorMessage: "如果你想补这一段，就直接用自然话发我一段；如果先不写，回我一句“先跳过”就行。",
        };
      }

      return {
        draft: mergePersonaDraft(draft, { assistantSoul }),
      };
    },
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

    if (completedProfile && isBootstrapCompleted(completedProfile.profile)) {
      return null;
    }

    const existingState = this.store.getPrincipalPersonaOnboarding(normalizedPrincipalId);

    if (!existingState) {
      const initialDraft = completedProfile?.profile ?? {};
      const completedStepIds = resolveCompletedStepIds(initialDraft);
      const nextStepIndex = resolveNextStepIndex(initialDraft, completedStepIds);

      if (nextStepIndex === null) {
        return null;
      }

      const firstQuestion = ONBOARDING_STEPS[nextStepIndex];
      const state: PrincipalPersonaOnboardingState = {
        stepIndex: nextStepIndex,
        draft: initialDraft,
        completedStepIds,
      };

      this.store.savePrincipalPersonaOnboarding({
        principalId: normalizedPrincipalId,
        state,
        createdAt: now,
        updatedAt: now,
      });

      return {
        message: [
          nextStepIndex === 0
            ? "我先花几句把长期配合方式记下来，后面就按这个来。"
            : "前面的我已经记住了，这次把剩下的补齐就行。",
          "",
          firstQuestion?.prompt ?? "",
        ].join("\n"),
        status: "question",
        phase: "started",
        stepIndex: nextStepIndex,
        totalSteps: ONBOARDING_STEPS.length,
        draft: state.draft,
        ...(firstQuestion ? { questionKey: firstQuestion.questionKey } : {}),
        ...(firstQuestion ? { questionPrompt: firstQuestion.prompt } : {}),
      };
    }

    const answer = normalizeOnboardingAnswer(request.goal);
    const currentQuestion = ONBOARDING_STEPS[existingState.state.stepIndex];

    if (!currentQuestion) {
      const recoveredCompletedStepIds = resolveCompletedStepIds(
        existingState.state.draft,
        existingState.state.completedStepIds ?? [],
      );
      const recoveredStepIndex = resolveNextStepIndex(existingState.state.draft, recoveredCompletedStepIds);

      if (recoveredStepIndex === null) {
        this.store.deletePrincipalPersonaOnboarding(normalizedPrincipalId);
        return null;
      }

      const recoveredQuestion = ONBOARDING_STEPS[recoveredStepIndex];

      this.store.savePrincipalPersonaOnboarding({
        principalId: normalizedPrincipalId,
        state: {
          stepIndex: recoveredStepIndex,
          draft: existingState.state.draft,
          completedStepIds: recoveredCompletedStepIds,
        },
        createdAt: existingState.createdAt,
        updatedAt: now,
      });

      return {
        message: [
          "我把旧的建档进度自动切到了新版流程。",
          "",
          recoveredQuestion?.prompt ?? "",
        ].join("\n"),
        status: "question",
        phase: "continued",
        stepIndex: recoveredStepIndex,
        totalSteps: ONBOARDING_STEPS.length,
        draft: existingState.state.draft,
        ...(recoveredQuestion ? { questionKey: recoveredQuestion.questionKey } : {}),
        ...(recoveredQuestion ? { questionPrompt: recoveredQuestion.prompt } : {}),
      };
    }

    if (!answer) {
      return {
        message: [
          "我这轮没读到有效内容。",
          "",
          currentQuestion.prompt,
        ].join("\n"),
        status: "question",
        phase: "continued",
        stepIndex: existingState.state.stepIndex,
        totalSteps: ONBOARDING_STEPS.length,
        draft: existingState.state.draft,
        questionKey: currentQuestion.questionKey,
        questionPrompt: currentQuestion.prompt,
      };
    }

    const parsed = currentQuestion.applyAnswer(existingState.state.draft, answer);

    if (parsed.errorMessage) {
      return {
        message: parsed.errorMessage,
        status: "question",
        phase: "continued",
        stepIndex: existingState.state.stepIndex,
        totalSteps: ONBOARDING_STEPS.length,
        draft: existingState.state.draft,
        questionKey: currentQuestion.questionKey,
        questionPrompt: currentQuestion.prompt,
      };
    }

    const nextDraft = parsed.draft;
    const completedStepIds = resolveCompletedStepIds(
      nextDraft,
      [...(existingState.state.completedStepIds ?? []), currentQuestion.id],
    );
    const nextStepIndex = resolveNextStepIndex(nextDraft, completedStepIds);

    if (nextStepIndex === null) {
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
        stepIndex: ONBOARDING_STEPS.length - 1,
        totalSteps: ONBOARDING_STEPS.length,
        draft: profile,
        profile,
      };
    }

    this.store.savePrincipalPersonaOnboarding({
      principalId: normalizedPrincipalId,
      state: {
        stepIndex: nextStepIndex,
        draft: nextDraft,
        completedStepIds,
      },
      createdAt: existingState.createdAt,
      updatedAt: now,
    });

    const nextQuestion = ONBOARDING_STEPS[nextStepIndex];

    return {
      message: [
        "好，我记住了。",
        "",
        nextQuestion?.prompt ?? "",
      ].join("\n"),
      status: "question",
      phase: "continued",
      stepIndex: nextStepIndex,
      totalSteps: ONBOARDING_STEPS.length,
      draft: nextDraft,
      ...(nextQuestion ? { questionKey: nextQuestion.questionKey } : {}),
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
    const sections: string[] = [];
    const assistantPersonaLines = [
      "Persistent Themis persona for this principal:",
      "- 这是当前 principal 的长期默认 Themis 人格，除非用户当轮明确要求，否则所有会话都要稳定体现。",
      "- 优先把它落实到措辞、信息密度、结构、推进方式和情绪温度上，不要只把它当作背景备注。",
    ];
    const profileLines = ["Personalized long-term user profile:"];

    if (profile.assistantLanguageStyle) {
      assistantPersonaLines.push(`- 长期语言风格：${profile.assistantLanguageStyle}`);
    }

    if (profile.assistantMbti) {
      assistantPersonaLines.push(`- 长期 MBTI / 性格标签：${profile.assistantMbti}`);
    }

    if (profile.assistantStyleNotes) {
      assistantPersonaLines.push(`- 长期风格补充说明：${profile.assistantStyleNotes}`);
    }

    if (profile.assistantSoul) {
      assistantPersonaLines.push("- 长期 SOUL：见下方整段说明。");
    }

    if (assistantPersonaLines.length > 1) {
      sections.push(assistantPersonaLines.join("\n"));
    }

    if (profile.assistantSoul) {
      sections.push([
        "Persistent Themis SOUL for this principal:",
        "- 这段是当前 principal 的长期默认助手风格，所有会话都会默认继承。",
        "- 把它当作持续生效的助手指令来执行，而不是可忽略的背景描述。",
        profile.assistantSoul,
      ].join("\n"));
    }

    if (profile.preferredAddress) {
      profileLines.push(`- 对用户的默认称呼：${profile.preferredAddress}`);
    }

    if (profile.assistantName) {
      profileLines.push(`- 你的默认自称：${profile.assistantName}`);
    }

    if (profile.workSummary) {
      profileLines.push(`- 用户长期背景：${profile.workSummary}`);
    }

    if (profile.collaborationStyle) {
      profileLines.push(`- 用户期望的协作方式：${profile.collaborationStyle}`);
    }

    if (profile.boundaries) {
      profileLines.push(`- 用户明确偏好/边界：${profile.boundaries}`);
    }

    if (profileLines.length > 1) {
      sections.push(profileLines.join("\n"));
    }

    return sections.length ? sections.join("\n\n") : null;
  }

  getPrincipalProfile(principalId?: string): PrincipalPersonaProfileData | null {
    const normalizedPrincipalId = principalId?.trim();

    if (!normalizedPrincipalId) {
      return null;
    }

    return this.store.getPrincipalPersonaProfile(normalizedPrincipalId)?.profile ?? null;
  }

  savePrincipalAssistantPersona(
    principalId: string,
    persona: {
      assistantLanguageStyle?: string;
      assistantMbti?: string;
      assistantStyleNotes?: string;
      assistantSoul?: string;
    },
    options: { displayName?: string; now?: string } = {},
  ): PrincipalPersonaProfileData {
    const normalizedPrincipalId = principalId.trim();

    if (!normalizedPrincipalId) {
      throw new Error("缺少 principalId，无法保存长期人格。");
    }

    const now = options.now ?? new Date().toISOString();
    const existingPrincipal = this.store.getPrincipal(normalizedPrincipalId);

    if (!existingPrincipal) {
      this.store.savePrincipal({
        principalId: normalizedPrincipalId,
        ...(options.displayName?.trim() ? { displayName: options.displayName.trim() } : {}),
        createdAt: now,
        updatedAt: now,
      });
    } else if (options.displayName?.trim() && existingPrincipal.displayName !== options.displayName.trim()) {
      this.store.savePrincipal({
        ...existingPrincipal,
        displayName: options.displayName.trim(),
        updatedAt: now,
      });
    }

    const existingProfile = this.store.getPrincipalPersonaProfile(normalizedPrincipalId);
    const nextProfile: PrincipalPersonaProfileData = {
      ...(existingProfile?.profile ?? {}),
    };
    const normalizedLanguageStyle = normalizeOptionalText(persona.assistantLanguageStyle);
    const normalizedMbti = normalizeOptionalText(persona.assistantMbti);
    const normalizedStyleNotes = normalizeOptionalText(persona.assistantStyleNotes);
    const normalizedSoul = normalizeAssistantSoul(persona.assistantSoul ?? "");

    if (!existingProfile && !normalizedLanguageStyle && !normalizedMbti && !normalizedStyleNotes && !normalizedSoul) {
      return {};
    }

    if (normalizedLanguageStyle) {
      nextProfile.assistantLanguageStyle = normalizedLanguageStyle;
    } else {
      delete nextProfile.assistantLanguageStyle;
    }

    if (normalizedMbti) {
      nextProfile.assistantMbti = normalizedMbti;
    } else {
      delete nextProfile.assistantMbti;
    }

    if (normalizedStyleNotes) {
      nextProfile.assistantStyleNotes = normalizedStyleNotes;
    } else {
      delete nextProfile.assistantStyleNotes;
    }

    if (normalizedSoul) {
      nextProfile.assistantSoul = normalizedSoul;
    } else {
      delete nextProfile.assistantSoul;
    }

    this.store.savePrincipalPersonaProfile({
      principalId: normalizedPrincipalId,
      profile: nextProfile,
      createdAt: existingProfile?.createdAt ?? now,
      updatedAt: now,
      completedAt: existingProfile?.completedAt ?? now,
    });

    return nextProfile;
  }
}

function finalizeProfile(draft: PrincipalPersonaProfileData): PrincipalPersonaProfileData {
  return {
    ...(draft.preferredAddress ? { preferredAddress: draft.preferredAddress } : {}),
    ...(draft.assistantName ? { assistantName: draft.assistantName } : {}),
    ...(draft.assistantLanguageStyle ? { assistantLanguageStyle: draft.assistantLanguageStyle } : {}),
    ...(draft.assistantMbti ? { assistantMbti: draft.assistantMbti } : {}),
    ...(draft.assistantStyleNotes ? { assistantStyleNotes: draft.assistantStyleNotes } : {}),
    ...(draft.assistantSoul ? { assistantSoul: draft.assistantSoul } : {}),
    ...(draft.workSummary ? { workSummary: draft.workSummary } : {}),
    ...(draft.collaborationStyle ? { collaborationStyle: draft.collaborationStyle } : {}),
    ...(draft.boundaries ? { boundaries: draft.boundaries } : {}),
  };
}

function buildCompletionMessage(profile: PrincipalPersonaProfileData): string {
  const personaParts = [
    profile.assistantLanguageStyle,
    profile.assistantMbti,
    profile.assistantStyleNotes,
  ].filter(Boolean);
  const summaryParts = [
    profile.preferredAddress ? `以后我叫你 ${profile.preferredAddress}` : "",
    profile.assistantName ? `我这边叫 ${profile.assistantName}` : "",
    profile.workSummary ? `我会按“${profile.workSummary}”这个背景理解你` : "",
    profile.collaborationStyle ? `默认按“${profile.collaborationStyle}”跟你配合` : "",
    personaParts.length ? `我的表达风格按“${personaParts.join(" / ")}”走` : "",
    profile.assistantSoul ? "那段补充设定我也记住了" : "",
  ].filter(Boolean);

  return [
    "好，记住了。",
    summaryParts.join("；") + "。",
    "正式任务再发我一次，我直接开始。",
  ].join("\n");
}

function normalizeOnboardingAnswer(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim()
    .slice(0, 4000);
}

function normalizeAssistantSoul(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()
    .slice(0, 4000);
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isBootstrapCompleted(profile: PrincipalPersonaProfileData): boolean {
  return Boolean(
    profile.preferredAddress
    && profile.workSummary
    && profile.collaborationStyle
    && profile.assistantLanguageStyle,
  );
}

function isDefaultThemisName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "themis" || normalized === "默认" || normalized === "就叫themis";
}

function resolveCompletedStepIds(
  draft: PrincipalPersonaProfileData,
  completedStepIds: string[] = [],
): string[] {
  const validStepIds = new Set(ONBOARDING_STEPS.map((step) => step.id));
  const resolved = new Set(completedStepIds.filter((stepId) => validStepIds.has(stepId)));

  for (const step of ONBOARDING_STEPS) {
    if (step.isSatisfied(draft)) {
      resolved.add(step.id);
    }
  }

  return [...resolved];
}

function resolveNextStepIndex(
  draft: PrincipalPersonaProfileData,
  completedStepIds: string[],
): number | null {
  const resolved = new Set(resolveCompletedStepIds(draft, completedStepIds));
  const nextIndex = ONBOARDING_STEPS.findIndex((step) => !resolved.has(step.id));
  return nextIndex >= 0 ? nextIndex : null;
}

function parseIdentityAnswer(answer: string): Partial<PrincipalPersonaProfileData> {
  const labeled = parseLabeledSegments(answer);
  const preferredAddress = pickLabeledValue(
    labeled,
    ["你", "称呼我", "叫我", "对我的称呼", "称呼"],
  );
  const assistantName = pickLabeledValue(
    labeled,
    ["我", "我自称", "我的名字", "自称", "助手"],
  );

  if (preferredAddress || assistantName) {
    return {
      ...(preferredAddress ? { preferredAddress } : {}),
      ...(assistantName ? { assistantName } : {}),
    };
  }

  const sequence = splitAnswerSequence(answer, true);
  const firstValue = normalizeOptionalText(sequence[0]);
  const secondValue = normalizeOptionalText(sequence[1]);

  return {
    ...(firstValue ? { preferredAddress: firstValue } : {}),
    ...(secondValue ? { assistantName: secondValue } : {}),
  };
}

function parseUserContextAnswer(answer: string): Partial<PrincipalPersonaProfileData> {
  const labeled = parseLabeledSegments(answer);
  const workSummary = pickLabeledValue(
    labeled,
    ["背景", "现状", "你在做什么", "角色", "项目", "工作"],
  );
  const collaborationStyle = pickLabeledValue(
    labeled,
    ["协作", "配合", "方式", "默认协作", "协作方式"],
  );
  const boundaries = pickLabeledValue(
    labeled,
    ["边界", "禁忌", "限制", "注意", "偏好"],
  );

  if (workSummary || collaborationStyle || boundaries) {
    return {
      ...(workSummary ? { workSummary } : {}),
      ...(collaborationStyle ? { collaborationStyle } : {}),
      ...(isDefaultAnswer(boundaries) ? {} : boundaries ? { boundaries } : {}),
    };
  }

  const sequence = splitAnswerSequence(answer, true);
  const firstValue = normalizeOptionalText(sequence[0]);
  const secondValue = normalizeOptionalText(sequence[1]);
  const thirdValue = normalizeOptionalText(sequence[2]);

  return {
    ...(firstValue ? { workSummary: firstValue } : {}),
    ...(secondValue ? { collaborationStyle: secondValue } : {}),
    ...(isDefaultAnswer(thirdValue) ? {} : thirdValue ? { boundaries: thirdValue } : {}),
  };
}

function parseAssistantPersonaAnswer(answer: string): Partial<PrincipalPersonaProfileData> {
  const labeled = parseLabeledSegments(answer);
  const assistantLanguageStyle = pickLabeledValue(
    labeled,
    ["风格", "语言风格", "表达", "语气"],
  );
  const assistantMbti = pickLabeledValue(
    labeled,
    ["性格", "mbti", "人格", "标签"],
  );
  const assistantStyleNotes = pickLabeledValue(
    labeled,
    ["补充", "要求", "说明", "额外"],
  );

  if (assistantLanguageStyle || assistantMbti || assistantStyleNotes) {
    return {
      ...(assistantLanguageStyle ? { assistantLanguageStyle } : {}),
      ...(isDefaultAnswer(assistantMbti) ? {} : assistantMbti ? { assistantMbti } : {}),
      ...(isDefaultAnswer(assistantStyleNotes) ? {} : assistantStyleNotes ? { assistantStyleNotes } : {}),
    };
  }

  const sequence = splitAnswerSequence(answer, true);
  const firstValue = normalizeOptionalText(sequence[0]);
  const secondValue = normalizeOptionalText(sequence[1]);
  const thirdValue = normalizeOptionalText(sequence[2]);

  return {
    ...(firstValue ? { assistantLanguageStyle: firstValue } : {}),
    ...(isDefaultAnswer(secondValue) ? {} : secondValue ? { assistantMbti: secondValue } : {}),
    ...(isDefaultAnswer(thirdValue) ? {} : thirdValue ? { assistantStyleNotes: thirdValue } : {}),
  };
}

function mergePersonaDraft(
  draft: PrincipalPersonaProfileData,
  patch: Partial<PrincipalPersonaProfileData>,
): PrincipalPersonaProfileData {
  const next: PrincipalPersonaProfileData = { ...draft };

  applyPersonaDraftValue(next, "preferredAddress", patch.preferredAddress);
  applyPersonaDraftValue(next, "assistantName", patch.assistantName);
  applyPersonaDraftValue(next, "assistantLanguageStyle", patch.assistantLanguageStyle);
  applyPersonaDraftValue(next, "assistantMbti", patch.assistantMbti);
  applyPersonaDraftValue(next, "assistantStyleNotes", patch.assistantStyleNotes);
  applyPersonaDraftValue(next, "assistantSoul", patch.assistantSoul);
  applyPersonaDraftValue(next, "workSummary", patch.workSummary);
  applyPersonaDraftValue(next, "collaborationStyle", patch.collaborationStyle);
  applyPersonaDraftValue(next, "boundaries", patch.boundaries);

  return next;
}

function applyPersonaDraftValue(
  draft: PrincipalPersonaProfileData,
  key: PersonaFieldKey,
  value: string | undefined,
): void {
  if (typeof value !== "string") {
    return;
  }

  if (key === "assistantSoul") {
    const normalizedSoul = normalizeAssistantSoul(value);

    if (normalizedSoul) {
      draft.assistantSoul = normalizedSoul;
    }

    return;
  }

  const normalizedValue = normalizeOptionalText(value);

  if (!normalizedValue) {
    return;
  }

  if (key === "assistantName" && isDefaultThemisName(normalizedValue)) {
    delete draft.assistantName;
    return;
  }

  switch (key) {
    case "preferredAddress":
      draft.preferredAddress = normalizedValue;
      return;
    case "assistantName":
      draft.assistantName = normalizedValue;
      return;
    case "assistantLanguageStyle":
      draft.assistantLanguageStyle = normalizedValue;
      return;
    case "assistantMbti":
      draft.assistantMbti = normalizedValue;
      return;
    case "assistantStyleNotes":
      draft.assistantStyleNotes = normalizedValue;
      return;
    case "workSummary":
      draft.workSummary = normalizedValue;
      return;
    case "collaborationStyle":
      draft.collaborationStyle = normalizedValue;
      return;
    case "boundaries":
      draft.boundaries = normalizedValue;
      return;
    default:
      return;
  }
}

function parseLabeledSegments(answer: string): Array<{ label: string; value: string }> {
  return answer
    .replace(/\r\n/g, "\n")
    .split(/\n|；|;/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .flatMap((segment) => {
      const separatorIndex = segment.search(/[:：=]/);

      if (separatorIndex < 0) {
        return [];
      }

      const label = normalizeLabel(segment.slice(0, separatorIndex));
      const value = normalizeOptionalText(segment.slice(separatorIndex + 1));

      if (!label || !value) {
        return [];
      }

      return [{ label, value }];
    });
}

function pickLabeledValue(
  segments: Array<{ label: string; value: string }>,
  aliases: string[],
): string | undefined {
  const normalizedAliases = aliases.map(normalizeLabel);
  const matched = segments.find((segment) => normalizedAliases.includes(segment.label));
  return matched?.value;
}

function splitAnswerSequence(answer: string, includeComma = false): string[] {
  const separator = includeComma ? /\n|；|;|，|,/ : /\n|；|;/;
  return answer
    .replace(/\r\n/g, "\n")
    .split(separator)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[：:=]/g, "");
}

function isSkipAnswer(value: string): boolean {
  const normalized = normalizeLabel(value);
  return normalized === "跳过"
    || normalized === "略过"
    || normalized === "skip"
    || normalized === "none"
    || normalized === "没有"
    || normalized === "暂时没有";
}

function isDefaultAnswer(value: string | undefined): boolean {
  const normalized = normalizeLabel(value ?? "");
  return normalized === "默认"
    || normalized === "慢慢磨合"
    || normalized === "暂时没有"
    || normalized === "没有"
    || normalized === "无";
}
