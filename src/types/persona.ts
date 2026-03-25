export interface PrincipalPersonaProfileData {
  preferredAddress?: string;
  assistantName?: string;
  assistantLanguageStyle?: string;
  assistantMbti?: string;
  assistantStyleNotes?: string;
  assistantSoul?: string;
  workSummary?: string;
  collaborationStyle?: string;
  boundaries?: string;
}

export interface PrincipalPersonaOnboardingState {
  stepIndex: number;
  draft: PrincipalPersonaProfileData;
  completedStepIds?: string[];
}
