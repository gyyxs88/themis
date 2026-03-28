import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type {
  ContextBlock,
  ContextBuildInput,
  ContextBuildResult,
  ContextBuildWarning,
  ContextSourceStat,
} from "../types/context.js";

interface ContextBuilderOptions {
  workingDirectory: string;
  runtimeStore: SqliteCodexSessionRegistry;
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

  private readonly runtimeStore: SqliteCodexSessionRegistry;

  private readonly maxDocsMemoryFiles: number;

  constructor(options: ContextBuilderOptions) {
    this.workingDirectory = options.workingDirectory;
    this.runtimeStore = options.runtimeStore;
    this.maxDocsMemoryFiles = options.maxDocsMemoryFiles ?? 3;
  }

  async build(input: ContextBuildInput): Promise<ContextBuildResult> {
    void input;
    void this.runtimeStore;

    const blocks: ContextBlock[] = [];
    const warnings: ContextBuildWarning[] = [];
    const sourceStats: ContextSourceStat[] = [];

    for (const candidate of SOURCE_CANDIDATES) {
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

    for (const filePath of pickRelevantMemoryFiles(this.workingDirectory, input.request.goal, this.maxDocsMemoryFiles)) {
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

function pickRelevantMemoryFiles(root: string, goal: string, limit: number): string[] {
  const docsRoot = join(root, "docs", "memory");
  if (!existsSync(docsRoot)) {
    return [];
  }

  const keywordTokens = goal.toLowerCase().split(/\s+/).filter((token) => token.length > 1);
  const result: string[] = [];

  collectMarkdownFiles(docsRoot, result);

  return result
    .filter((filePath) => {
      const normalized = filePath.toLowerCase();
      return keywordTokens.some((token) => normalized.includes(token))
        || normalized.includes("provider");
    })
    .slice(0, limit);
}

function collectMarkdownFiles(dirPath: string, output: string[]): void {
  for (const entry of readdirSync(dirPath)) {
    const absolutePath = join(dirPath, entry);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      collectMarkdownFiles(absolutePath, output);
      continue;
    }
    if (stat.isFile() && absolutePath.endsWith(".md")) {
      output.push(absolutePath);
    }
  }
}
