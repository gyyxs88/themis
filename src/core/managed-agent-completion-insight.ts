export const MANAGED_AGENT_COMPLETION_DETAIL_LEVELS = [
  "metadata_only",
  "deliverable_only",
  "full_execution_snapshot",
] as const;

export type ManagedAgentCompletionDetailLevel = (typeof MANAGED_AGENT_COMPLETION_DETAIL_LEVELS)[number];

export interface ManagedAgentCompletionInsight {
  detailLevel: ManagedAgentCompletionDetailLevel;
  interpretationHint: string;
}

export function deriveManagedAgentCompletionInsight(
  structuredOutput: Record<string, unknown> | null | undefined,
): ManagedAgentCompletionInsight {
  const normalizedStructuredOutput = isRecord(structuredOutput) ? structuredOutput : null;
  const deliverable = normalizeOptionalText(normalizedStructuredOutput?.deliverable);
  const artifactContents = isRecord(normalizedStructuredOutput?.artifactContents)
    ? normalizedStructuredOutput.artifactContents
    : null;
  const hasArtifactContents = Boolean(artifactContents && Object.keys(artifactContents).length > 0);

  if (hasArtifactContents) {
    return {
      detailLevel: "full_execution_snapshot",
      interpretationHint: "当前 completion 已包含交付正文和完整执行快照，可直接据此判断当前链路具备完整结果回传能力。",
    };
  }

  if (deliverable) {
    return {
      detailLevel: "deliverable_only",
      interpretationHint: "当前 completion 已包含交付正文，但未附完整 artifactContents；可判断结果回传已恢复，但执行快照覆盖仍有限。",
    };
  }

  return {
    detailLevel: "metadata_only",
    interpretationHint: "当前 completion 只包含执行元数据，不含交付正文或 artifactContents。这类结果常见于升级前历史 run 或受限格式回传；除非有额外证据，不应据此判断当前现网链路仍未修复。",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
