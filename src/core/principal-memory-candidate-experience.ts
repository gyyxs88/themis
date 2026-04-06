import type { MemoryUpdate, TaskRequest, TaskResult } from "../types/index.js";
import type { StoredPrincipalMainMemoryCandidateRecord, StoredPrincipalMainMemoryRecord } from "../types/index.js";
import type { PrincipalActorsService } from "./principal-actors-service.js";

export interface PrincipalMemoryCandidateExperienceServiceOptions {
  principalActorsService: PrincipalActorsService;
}

export interface SuggestCandidatesFromTaskInput {
  principalId: string;
  request: TaskRequest;
  result: TaskResult;
  conversationId?: string;
  now?: string;
}

export interface SuggestCandidatesFromTaskResult {
  candidates: StoredPrincipalMainMemoryCandidateRecord[];
  updates: MemoryUpdate[];
}

interface CandidateDraft {
  kind: StoredPrincipalMainMemoryRecord["kind"];
  title: string;
  summary: string;
  rationale: string;
  suggestedContent: string;
  extractor: "request-pattern" | "structured-output";
}

const STABLE_CUE_PATTERN = /(以后|后续|长期|平时|默认|统一|一直|始终)/u;
const TEMPORARY_CUE_PATTERN = /(这次|本轮|当前|先这样|暂时|今天|现在先|这条任务)/u;
const COLLABORATION_CUE_PATTERN = /(结论|展开|解释|说明|回复|回答|表达|语气|语言|中文|简洁|详细|直接|口语|官话|人话|配合|协作|推进|复盘|审查|总结|风险)/u;
const BEHAVIOR_CUE_PATTERN = /(不要|别|禁止|必须|不确定|先给|优先)/u;

export class PrincipalMemoryCandidateExperienceService {
  private readonly principalActorsService: PrincipalActorsService;

  constructor(options: PrincipalMemoryCandidateExperienceServiceOptions) {
    this.principalActorsService = options.principalActorsService;
  }

  suggestFromTask(input: SuggestCandidatesFromTaskInput): SuggestCandidatesFromTaskResult {
    const principalId = input.principalId.trim();

    if (!principalId || input.result.status !== "completed") {
      return {
        candidates: [],
        updates: [],
      };
    }

    const candidateDrafts = collectCandidateDrafts(input);
    if (!candidateDrafts.length) {
      return {
        candidates: [],
        updates: [],
      };
    }

    const existingFingerprints = buildExistingFingerprintSet(this.principalActorsService, principalId);
    const savedCandidates: StoredPrincipalMainMemoryCandidateRecord[] = [];

    for (const draft of candidateDrafts) {
      const fingerprint = buildCandidateFingerprint(draft.kind, draft.suggestedContent);

      if (!fingerprint || existingFingerprints.has(fingerprint)) {
        continue;
      }

      const candidate = this.principalActorsService.suggestMainMemoryCandidate({
        principalId,
        kind: draft.kind,
        title: draft.title,
        summary: draft.summary,
        rationale: draft.rationale,
        suggestedContent: draft.suggestedContent,
        sourceType: "themis",
        sourceLabel: buildSourceLabel(input, draft.extractor),
        ...(input.request.taskId ? { sourceTaskId: input.request.taskId } : {}),
        ...(input.conversationId ? { sourceConversationId: input.conversationId } : {}),
        ...(input.now ? { now: input.now } : {}),
      });

      savedCandidates.push(candidate);
      existingFingerprints.add(fingerprint);
    }

    return {
      candidates: savedCandidates,
      updates: savedCandidates.map((candidate) => ({
        kind: "project",
        target: `principal-main-memory-candidate:${candidate.candidateId}`,
        action: "suggested",
      })),
    };
  }
}

function collectCandidateDrafts(input: SuggestCandidatesFromTaskInput): CandidateDraft[] {
  const drafts = [
    ...extractStructuredCandidates(input.result.output),
    ...extractStructuredCandidates(input.result.summary),
    ...extractHeuristicCandidates(input.request.goal, input.result.summary),
    ...extractHeuristicCandidates(input.request.inputText, input.result.summary),
  ];
  const deduped = new Map<string, CandidateDraft>();

  for (const draft of drafts) {
    const fingerprint = buildCandidateFingerprint(draft.kind, draft.suggestedContent);

    if (!fingerprint || deduped.has(fingerprint)) {
      continue;
    }

    deduped.set(fingerprint, draft);
  }

  return [...deduped.values()].slice(0, 3);
}

function extractStructuredCandidates(text: string | undefined): CandidateDraft[] {
  const normalized = normalizeText(text);

  if (!normalized || !normalized.includes("长期记忆")) {
    return [];
  }

  const blocks = normalized
    .split(/(?:^|\n)长期记忆(?:建议|候选)?：/u)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map(parseStructuredCandidateBlock)
    .filter((draft): draft is CandidateDraft => draft !== null);
}

function parseStructuredCandidateBlock(block: string): CandidateDraft | null {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return null;
  }

  const fieldMap = new Map<string, string>();
  for (const line of lines) {
    const matched = line.match(/^(类型|kind|标题|title|摘要|summary|理由|rationale|内容|content)\s*[：:]\s*(.+)$/iu);

    if (!matched) {
      continue;
    }

    const fieldName = matched[1];
    const fieldValue = matched[2];

    if (!fieldName || !fieldValue) {
      continue;
    }

    fieldMap.set(fieldName.toLowerCase(), fieldValue.trim());
  }

  const suggestedContent = fieldMap.get("内容") || fieldMap.get("content") || "";
  const title = fieldMap.get("标题") || fieldMap.get("title") || "";
  const summary = fieldMap.get("摘要") || fieldMap.get("summary") || suggestedContent;
  const rationale = fieldMap.get("理由") || fieldMap.get("rationale") || "任务结果中显式给出了长期记忆建议。";

  if (!suggestedContent || !title) {
    return null;
  }

  return {
    kind: normalizeCandidateKind(fieldMap.get("类型") || fieldMap.get("kind")),
    title: title.slice(0, 40),
    summary: summary.slice(0, 120),
    rationale: rationale.slice(0, 200),
    suggestedContent: suggestedContent.slice(0, 800),
    extractor: "structured-output",
  };
}

function extractHeuristicCandidates(text: string | undefined, resultSummary: string): CandidateDraft[] {
  const normalized = normalizeText(text);

  if (!normalized) {
    return [];
  }

  return splitCandidateSentences(normalized)
    .filter((sentence) => shouldSuggestCandidate(sentence))
    .map((sentence) => {
      const kind = classifyCandidateKind(sentence);
      return {
        kind,
        title: buildCandidateTitle(sentence, kind),
        summary: sentence,
        rationale: buildHeuristicRationale(sentence, resultSummary),
        suggestedContent: buildSuggestedContent(sentence),
        extractor: "request-pattern",
      };
    });
}

function splitCandidateSentences(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/[\n。！？；]/u)
    .map((sentence) => sentence.trim().replace(/^[-*]\s*/u, ""))
    .filter((sentence) => sentence.length >= 8 && sentence.length <= 120);
}

function shouldSuggestCandidate(sentence: string): boolean {
  if (!STABLE_CUE_PATTERN.test(sentence)) {
    return false;
  }

  if (TEMPORARY_CUE_PATTERN.test(sentence)) {
    return false;
  }

  return COLLABORATION_CUE_PATTERN.test(sentence) || BEHAVIOR_CUE_PATTERN.test(sentence);
}

function classifyCandidateKind(sentence: string): StoredPrincipalMainMemoryRecord["kind"] {
  if (BEHAVIOR_CUE_PATTERN.test(sentence)) {
    return "behavior";
  }

  if (/(配合|协作|推进|复盘|审查|总结|风险)/u.test(sentence)) {
    return "collaboration-style";
  }

  if (/(任务|项目|工作区|分支)/u.test(sentence)) {
    return "task-note";
  }

  return "preference";
}

function buildCandidateTitle(sentence: string, kind: StoredPrincipalMainMemoryRecord["kind"]): string {
  if (/中文/u.test(sentence)) {
    return "默认中文沟通";
  }

  if (/先.*结论|结论.*再/u.test(sentence)) {
    return "回答先给结论";
  }

  if (/说人话|口语/u.test(sentence)) {
    return "默认口语化表达";
  }

  if (/不要.*官话|别.*官话/u.test(sentence)) {
    return "避免官话";
  }

  if (/简洁|少铺垫|简短/u.test(sentence)) {
    return "回答保持简洁";
  }

  if (/详细|展开|解释/u.test(sentence)) {
    return "保留过程说明";
  }

  if (/风险/u.test(sentence) && /先/u.test(sentence)) {
    return "复盘先说风险";
  }

  const base = sentence
    .replace(/^(以后|后续|长期|平时|默认|统一|一直|始终)/u, "")
    .trim();
  const truncated = base.length > 18 ? `${base.slice(0, 17)}…` : base;

  if (truncated) {
    return truncated;
  }

  switch (kind) {
    case "behavior":
      return "长期行为约束";
    case "collaboration-style":
      return "长期协作方式";
    case "task-note":
      return "长期任务备注";
    default:
      return "长期协作偏好";
  }
}

function buildHeuristicRationale(sentence: string, resultSummary: string): string {
  const normalizedSummary = normalizeText(resultSummary);
  return normalizedSummary
    ? `本轮已完成任务里出现了明确的长期协作偏好表达：“${sentence}”。任务结果摘要：${normalizedSummary}`
    : `本轮已完成任务里出现了明确的长期协作偏好表达：“${sentence}”。`;
}

function buildSuggestedContent(sentence: string): string {
  return sentence
    .replace(/^(以后|后续|长期|平时)\s*/u, "默认")
    .replace(/\s+/gu, " ")
    .trim();
}

function buildExistingFingerprintSet(
  principalActorsService: PrincipalActorsService,
  principalId: string,
): Set<string> {
  const fingerprints = new Set<string>();
  const candidates = principalActorsService.listMainMemoryCandidates({
    principalId,
    includeArchived: true,
    limit: 200,
  });
  const memories = principalActorsService.listMainMemory(principalId, 200);

  for (const candidate of candidates) {
    const fingerprint = buildCandidateFingerprint(candidate.kind, candidate.suggestedContent);

    if (fingerprint) {
      fingerprints.add(fingerprint);
    }
  }

  for (const memory of memories) {
    const fingerprint = buildCandidateFingerprint(memory.kind, memory.bodyMarkdown);

    if (fingerprint) {
      fingerprints.add(fingerprint);
    }
  }

  return fingerprints;
}

function buildCandidateFingerprint(kind: string, content: string): string {
  const normalizedKind = normalizeText(kind);
  const normalizedContent = normalizeFingerprintContent(content);

  return normalizedKind && normalizedContent ? `${normalizedKind}:${normalizedContent}` : "";
}

function normalizeFingerprintContent(content: string | undefined): string {
  return normalizeText(content)
    .toLowerCase()
    .replace(/[“”"'\s，。！？；：:,.-]+/gu, "");
}

function buildSourceLabel(input: SuggestCandidatesFromTaskInput, extractor: CandidateDraft["extractor"]): string {
  const sessionId = input.conversationId?.trim() || input.request.channelContext.sessionId?.trim() || "<unknown-session>";
  const taskId = input.request.taskId?.trim() || input.request.requestId.trim();
  return `session ${sessionId} / task ${taskId} / ${extractor}`;
}

function normalizeCandidateKind(kind: string | undefined): StoredPrincipalMainMemoryRecord["kind"] {
  switch (normalizeText(kind).toLowerCase()) {
    case "collaboration-style":
    case "behavior":
    case "preference":
    case "task-note":
      return normalizeText(kind).toLowerCase() as StoredPrincipalMainMemoryRecord["kind"];
    default:
      return "preference";
  }
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
