import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type {
  ContextBlock,
  ContextBuildInput,
  ContextBuildResult,
  ContextBuildWarning,
  ContextSourceStat,
} from "../types/context.js";

interface ContextBuilderOptions {
  workingDirectory: string;
  maxDocsMemoryFiles?: number;
}

interface SourceCandidate {
  path: string;
  kind: ContextBlock["kind"];
  title: string;
  priority: number;
}

const SOURCE_CANDIDATES: SourceCandidate[] = [
  {
    path: "AGENTS.md",
    kind: "repoRules",
    title: "Repository rules",
    priority: 90,
  },
  {
    path: "README.md",
    kind: "projectState",
    title: "Repository overview",
    priority: 80,
  },
  {
    path: "memory/architecture/overview.md",
    kind: "projectState",
    title: "Architecture",
    priority: 75,
  },
  {
    path: "memory/project/overview.md",
    kind: "projectState",
    title: "Project overview",
    priority: 70,
  },
  {
    path: "memory/tasks/backlog.md",
    kind: "projectState",
    title: "Backlog",
    priority: 65,
  },
  {
    path: "memory/tasks/in-progress.md",
    kind: "projectState",
    title: "In progress",
    priority: 64,
  },
  {
    path: "memory/tasks/done.md",
    kind: "projectState",
    title: "Done",
    priority: 63,
  },
];

export class ContextBuilder {
  private readonly workingDirectory: string;

  private readonly maxDocsMemoryFiles: number;

  constructor(options: ContextBuilderOptions) {
    this.workingDirectory = options.workingDirectory;
    this.maxDocsMemoryFiles = options.maxDocsMemoryFiles ?? 3;
  }

  async build(input: ContextBuildInput): Promise<ContextBuildResult> {
    const signal = input.signal;
    const blocks: ContextBlock[] = [];
    const warnings: ContextBuildWarning[] = [];
    const sourceStats: ContextSourceStat[] = [];

    for (const candidate of SOURCE_CANDIDATES) {
      await checkpointAbort(signal);
      const filePath = join(this.workingDirectory, candidate.path);
      if (!existsSync(filePath)) {
        warnings.push({
          code: "SOURCE_MISSING",
          sourceId: candidate.path,
          message: `${candidate.path} 不存在。`,
          fatal: false,
        });
        sourceStats.push({
          sourceId: candidate.path,
          included: false,
          includedChars: 0,
          truncated: false,
          reason: "missing",
        });
        continue;
      }

      let text: string;
      try {
        text = readFileSync(filePath, "utf8").trim();
      } catch {
        warnings.push({
          code: "SOURCE_UNREADABLE",
          sourceId: candidate.path,
          message: `${candidate.path} 无法读取。`,
          fatal: false,
        });
        sourceStats.push({
          sourceId: candidate.path,
          included: false,
          includedChars: 0,
          truncated: false,
          reason: "unreadable",
        });
        continue;
      }

      if (!text) {
        sourceStats.push({
          sourceId: candidate.path,
          included: false,
          includedChars: 0,
          truncated: false,
          reason: "budget",
        });
        continue;
      }

      blocks.push({
        kind: candidate.kind,
        title: candidate.title,
        text,
        sourcePath: candidate.path,
        priority: candidate.priority,
        truncated: false,
      });
      sourceStats.push({
        sourceId: candidate.path,
        included: true,
        includedChars: text.length,
        truncated: false,
        reason: "selected",
      });
    }

    for (const filePath of await pickRelevantMemoryFiles({
      root: this.workingDirectory,
      goal: input.request.goal,
      inputText: input.request.inputText,
      limit: this.maxDocsMemoryFiles,
      warnings,
      sourceStats,
      signal,
    })) {
      await checkpointAbort(signal);
      let text: string;
      try {
        text = readFileSync(filePath, "utf8").trim();
      } catch {
        const sourceId = relative(this.workingDirectory, filePath);
        warnings.push({
          code: "SOURCE_UNREADABLE",
          sourceId,
          message: `${sourceId} 无法读取。`,
          fatal: false,
        });
        sourceStats.push({
          sourceId,
          included: false,
          includedChars: 0,
          truncated: false,
          reason: "unreadable",
        });
        continue;
      }

      if (!text) {
        continue;
      }

      const sourcePath = relative(this.workingDirectory, filePath);
      blocks.push({
        kind: "relevantMemories",
        title: "Relevant memory",
        text,
        sourcePath,
        priority: 55,
        truncated: false,
      });
      sourceStats.push({
        sourceId: sourcePath,
        included: true,
        includedChars: text.length,
        truncated: false,
        reason: "selected",
      });
    }

    await checkpointAbort(signal);
    if (!existsSync(join(this.workingDirectory, "memory", "sessions", "active.md"))) {
      warnings.push({
        code: "SOURCE_MISSING",
        sourceId: "memory/sessions/active.md",
        message: "当前没有活动会话工作台文件。",
        fatal: false,
      });
    }

    blocks.sort((a, b) => b.priority - a.priority);

    return {
      blocks,
      warnings,
      sourceStats,
    };
  }
}

interface PickRelevantMemoryFilesInput {
  root: string;
  goal: string;
  inputText: string | undefined;
  limit: number;
  warnings: ContextBuildWarning[];
  sourceStats: ContextSourceStat[];
  signal: AbortSignal | undefined;
}

async function pickRelevantMemoryFiles(input: PickRelevantMemoryFilesInput): Promise<string[]> {
  const docsFiles = await collectMarkdownFilesUnderDocsMemory(
    input.root,
    input.warnings,
    input.sourceStats,
    input.signal,
  );
  if (docsFiles.length === 0) {
    return [];
  }

  const keywordTokens = extractKeywords(input.goal, input.inputText);
  const matched: string[] = [];

  for (const filePath of docsFiles) {
    await checkpointAbort(input.signal);
    let text = "";
    try {
      text = readFileSync(filePath, "utf8").toLowerCase();
    } catch {
      continue;
    }
    const sourcePath = relative(input.root, filePath).toLowerCase();
    const haystack = `${sourcePath}\n${text}`;
    const isRelated = keywordTokens.length === 0
      ? true
      : keywordTokens.some((token) => haystack.includes(token));
    if (isRelated) {
      matched.push(filePath);
    }
  }

  return matched.slice(0, input.limit);
}

function collectMarkdownFilesUnderDocsMemory(
  root: string,
  warnings: ContextBuildWarning[],
  sourceStats: ContextSourceStat[],
  signal: AbortSignal | undefined,
): Promise<string[]> {
  return collectMarkdownFilesUnderDocsMemoryImpl(root, warnings, sourceStats, signal);
}

async function collectMarkdownFilesUnderDocsMemoryImpl(
  root: string,
  warnings: ContextBuildWarning[],
  sourceStats: ContextSourceStat[],
  signal: AbortSignal | undefined,
): Promise<string[]> {
  await checkpointAbort(signal);
  const docsRoot = join(root, "docs", "memory");
  if (!existsSync(docsRoot)) {
    return [];
  }

  try {
    if (!statSync(docsRoot).isDirectory()) {
      warnings.push({
        code: "SOURCE_UNREADABLE",
        sourceId: "docs/memory",
        message: "docs/memory 不是目录，无法遍历。",
        fatal: false,
      });
      sourceStats.push({
        sourceId: "docs/memory",
        included: false,
        includedChars: 0,
        truncated: false,
        reason: "unreadable",
      });
      return [];
    }
  } catch {
    warnings.push({
      code: "SOURCE_UNREADABLE",
      sourceId: "docs/memory",
      message: "docs/memory 无法访问。",
      fatal: false,
    });
    sourceStats.push({
      sourceId: "docs/memory",
      included: false,
      includedChars: 0,
      truncated: false,
      reason: "unreadable",
    });
    return [];
  }

  const output: string[] = [];
  await collectMarkdownFiles(root, docsRoot, output, warnings, sourceStats, signal);
  output.sort((left, right) => left.localeCompare(right));
  return output;
}

async function collectMarkdownFiles(
  root: string,
  dirPath: string,
  output: string[],
  warnings: ContextBuildWarning[],
  sourceStats: ContextSourceStat[],
  signal: AbortSignal | undefined,
): Promise<void> {
  await checkpointAbort(signal);
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    const sourceId = relative(root, dirPath);
    warnings.push({
      code: "SOURCE_UNREADABLE",
      sourceId,
      message: `${sourceId} 无法读取目录内容。`,
      fatal: false,
    });
    sourceStats.push({
      sourceId,
      included: false,
      includedChars: 0,
      truncated: false,
      reason: "unreadable",
    });
    return;
  }

  for (const entry of entries) {
    await checkpointAbort(signal);
    const absolutePath = join(dirPath, entry);
    let stat;
    try {
      stat = statSync(absolutePath);
    } catch {
      const sourceId = relative(root, absolutePath);
      warnings.push({
        code: "SOURCE_UNREADABLE",
        sourceId,
        message: `${sourceId} 无法读取文件信息。`,
        fatal: false,
      });
      sourceStats.push({
        sourceId,
        included: false,
        includedChars: 0,
        truncated: false,
        reason: "unreadable",
      });
      continue;
    }

    if (stat.isDirectory()) {
      await collectMarkdownFiles(root, absolutePath, output, warnings, sourceStats, signal);
      continue;
    }
    if (stat.isFile() && absolutePath.endsWith(".md")) {
      output.push(absolutePath);
    }
  }
}

function extractKeywords(goal: string, inputText?: string): string[] {
  const raw = `${goal} ${inputText ?? ""}`.toLowerCase();
  const tokens = raw
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .filter((token) => token.length >= 2);

  return [...new Set(tokens)];
}

async function checkpointAbort(signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);
  await Promise.resolve();
  throwIfAborted(signal);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  if (signal.reason instanceof Error) {
    throw signal.reason;
  }

  const abortError = new Error(typeof signal.reason === "string" ? signal.reason : "Context build aborted.");
  abortError.name = "AbortError";
  throw abortError;
}
