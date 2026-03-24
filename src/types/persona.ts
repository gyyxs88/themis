export interface PrincipalPersonaProfileData {
  preferredAddress?: string;
  assistantName?: string;
  workSummary?: string;
  collaborationStyle?: string;
  boundaries?: string;
  defaultProfileId?: string;
}

export interface PrincipalPersonaOnboardingState {
  stepIndex: number;
  draft: PrincipalPersonaProfileData;
}
