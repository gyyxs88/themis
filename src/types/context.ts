import type { TaskRequest } from "./task.js";

export const CONTEXT_BLOCK_KINDS = [
  "taskBrief",
  "repoRules",
  "projectState",
  "relevantMemories",
  "sessionHistory",
  "workspaceContext",
] as const;

export type ContextBlockKind = (typeof CONTEXT_BLOCK_KINDS)[number];

export interface ContextBlock {
  kind: ContextBlockKind;
  title: string;
  text: string;
  sourcePath: string;
  priority: number;
  truncated: boolean;
}

export interface ContextBuildWarning {
  code: "SOURCE_MISSING" | "SOURCE_UNREADABLE" | "BUDGET_TRUNCATED";
  sourceId: string;
  message: string;
  fatal: boolean;
}

export interface ContextSourceStat {
  sourceId: string;
  included: boolean;
  includedChars: number;
  truncated: boolean;
  reason: "selected" | "missing" | "unreadable" | "budget";
}

export interface ContextBuildInput {
  request: TaskRequest;
  principalId?: string;
  conversationId?: string;
  signal?: AbortSignal;
}

export interface ContextBuildResult {
  blocks: ContextBlock[];
  warnings: ContextBuildWarning[];
  sourceStats: ContextSourceStat[];
}
