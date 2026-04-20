import { existsSync, statSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";
import type { TaskResult } from "../../types/index.js";

export type FeishuImFileType = "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream";

export interface FeishuOutboundAttachmentPlan {
  absolutePath: string;
  fileName: string;
  messageType: "image" | "file";
  uploadFileType?: FeishuImFileType;
}

export interface ResolveFeishuOutboundAttachmentPlansOptions {
  structuredOutput?: Record<string, unknown>;
  workspaceDirectory: string;
}

export interface ResolveFeishuOutboundAttachmentPlansResult {
  plans: FeishuOutboundAttachmentPlan[];
  notices: string[];
}

const MAX_FEISHU_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FEISHU_FILE_BYTES = 30 * 1024 * 1024;
const FEISHU_ATTACHMENT_DIRECTIVE_LANGUAGE = "themis-feishu-attachments";
const CHANNEL_ACTIONS_KEY = "channelActions";
const FEISHU_CHANNEL_ACTION_KEY = "feishu";
const FEISHU_ATTACHMENT_PATHS_KEY = "attachmentPaths";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".tif",
  ".tiff",
  ".bmp",
  ".ico",
]);

const SUPPORTED_EXPLICIT_FILE_EXTENSIONS = new Set([
  ...SUPPORTED_IMAGE_EXTENSIONS,
  ".svg",
  ".pdf",
  ".md",
  ".txt",
  ".rtf",
  ".csv",
  ".tsv",
  ".json",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".7z",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".mp4",
  ".mov",
  ".mp3",
  ".wav",
  ".opus",
]);

const SOURCE_CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".yml",
  ".yaml",
]);

export function finalizeFeishuOutboundAttachmentResult(result: TaskResult): TaskResult {
  if (result.status !== "completed" || typeof result.output !== "string" || !result.output.trim()) {
    return result;
  }

  const extracted = extractFeishuAttachmentDirective(result.output);

  if (!extracted) {
    return result;
  }

  const nextOutput = extracted.cleanedOutput.trim();
  const nextStructuredOutput = extracted.attachmentPaths.length
    ? mergeFeishuAttachmentPaths(result.structuredOutput, extracted.attachmentPaths)
    : result.structuredOutput;
  const nextSummary = nextOutput ? summarizeVisibleOutput(nextOutput, result.summary) : result.summary;
  const { output: _output, ...rest } = result;

  return {
    ...rest,
    summary: nextSummary,
    ...(nextOutput ? { output: nextOutput } : {}),
    ...(nextStructuredOutput ? { structuredOutput: nextStructuredOutput } : {}),
  };
}

export function resolveFeishuOutboundAttachmentPlans(
  options: ResolveFeishuOutboundAttachmentPlansOptions,
): ResolveFeishuOutboundAttachmentPlansResult {
  const workspaceDirectory = resolve(options.workspaceDirectory);
  const plans: FeishuOutboundAttachmentPlan[] = [];
  const notices: string[] = [];

  for (const absolutePath of readFeishuExplicitAttachmentPaths(options.structuredOutput)) {
    const normalizedPath = resolve(absolutePath);

    if (!isWithinDirectory(workspaceDirectory, normalizedPath)) {
      notices.push(`结果文件 ${basename(normalizedPath)} 不在当前工作区内，当前不会回传。`);
      continue;
    }

    const plan = buildAttachmentPlan(normalizedPath);

    if (plan.kind === "ready") {
      plans.push(plan.plan);
      continue;
    }

    if (plan.kind === "notice") {
      notices.push(plan.message);
    }
  }

  return {
    plans,
    notices,
  };
}

export function readFeishuExplicitAttachmentPaths(structuredOutput: Record<string, unknown> | undefined): string[] {
  if (!isRecord(structuredOutput)) {
    return [];
  }

  const channelActions = structuredOutput[CHANNEL_ACTIONS_KEY];

  if (!isRecord(channelActions)) {
    return [];
  }

  const feishuActions = channelActions[FEISHU_CHANNEL_ACTION_KEY];

  if (!isRecord(feishuActions)) {
    return [];
  }

  const attachmentPaths = feishuActions[FEISHU_ATTACHMENT_PATHS_KEY];

  if (!Array.isArray(attachmentPaths)) {
    return [];
  }

  return dedupeStrings(
    attachmentPaths
      .map((value) => normalizeExplicitAttachmentPath(typeof value === "string" ? value : ""))
      .filter((value): value is string => Boolean(value)),
  );
}

function extractFeishuAttachmentDirective(
  output: string,
): { cleanedOutput: string; attachmentPaths: string[] } | null {
  const normalizedOutput = output.replace(/\r\n?/g, "\n");
  const blockPattern = new RegExp(
    `(?:^|\\n)\`\`\`${escapeRegExp(FEISHU_ATTACHMENT_DIRECTIVE_LANGUAGE)}[ \\t]*\\n([\\s\\S]*?)\\n\`\`\`[ \\t]*$`,
  );
  const match = blockPattern.exec(normalizedOutput);

  if (!match || typeof match.index !== "number") {
    return null;
  }

  const blockBody = typeof match[1] === "string" ? match[1] : "";
  const attachmentPaths = dedupeStrings(
    blockBody
      .split("\n")
      .map((line) => normalizeExplicitAttachmentPath(line))
      .filter((value): value is string => Boolean(value)),
  );

  return {
    cleanedOutput: normalizedOutput.slice(0, match.index).trimEnd(),
    attachmentPaths,
  };
}

function normalizeExplicitAttachmentPath(line: string): string | null {
  const normalizedLine = line.trim().replace(/^[-*]\s+/, "");

  if (!normalizedLine) {
    return null;
  }

  const unwrapped = unwrapAttachmentPathToken(normalizedLine);

  if (!unwrapped.startsWith("/")) {
    return null;
  }

  return resolve(stripLocalFileLineSuffix(unwrapped));
}

function unwrapAttachmentPathToken(value: string): string {
  const trimmed = value.trim();

  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim();
  }

  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function stripLocalFileLineSuffix(target: string): string {
  return target.replace(/:\d+$/, "");
}

function buildAttachmentPlan(absolutePath: string):
  | { kind: "ready"; plan: FeishuOutboundAttachmentPlan }
  | { kind: "notice"; message: string } {
  if (!existsSync(absolutePath)) {
    return {
      kind: "notice",
      message: `结果文件 ${basename(absolutePath)} 不存在，当前没有回传。`,
    };
  }

  const stats = statSync(absolutePath, { throwIfNoEntry: false });

  if (!stats || !stats.isFile()) {
    return {
      kind: "notice",
      message: `结果路径 ${basename(absolutePath)} 不是文件，当前没有回传。`,
    };
  }

  const extension = extname(absolutePath).toLowerCase();

  if (SOURCE_CODE_EXTENSIONS.has(extension)) {
    return {
      kind: "notice",
      message: `结果文件 ${basename(absolutePath)} 属于源码文件，当前不会作为飞书附件回传。`,
    };
  }

  if (extension && !SUPPORTED_EXPLICIT_FILE_EXTENSIONS.has(extension)) {
    return {
      kind: "notice",
      message: `结果文件 ${basename(absolutePath)} 当前不在飞书附件回传白名单内，已跳过。`,
    };
  }

  if (SUPPORTED_IMAGE_EXTENSIONS.has(extension) && stats.size <= MAX_FEISHU_IMAGE_BYTES) {
    return {
      kind: "ready",
      plan: {
        absolutePath,
        fileName: basename(absolutePath),
        messageType: "image",
      },
    };
  }

  if (stats.size > MAX_FEISHU_FILE_BYTES) {
    return {
      kind: "notice",
      message: `结果文件 ${basename(absolutePath)} 超过飞书 IM 附件 30MB 上限，当前没有回传。`,
    };
  }

  return {
    kind: "ready",
    plan: {
      absolutePath,
      fileName: basename(absolutePath),
      messageType: "file",
      uploadFileType: mapFeishuImFileType(extension),
    },
  };
}

function mergeFeishuAttachmentPaths(
  structuredOutput: Record<string, unknown> | undefined,
  attachmentPaths: string[],
): Record<string, unknown> {
  const existingChannelActions = isRecord(structuredOutput?.[CHANNEL_ACTIONS_KEY])
    ? structuredOutput?.[CHANNEL_ACTIONS_KEY] as Record<string, unknown>
    : {};
  const existingFeishuActions = isRecord(existingChannelActions[FEISHU_CHANNEL_ACTION_KEY])
    ? existingChannelActions[FEISHU_CHANNEL_ACTION_KEY] as Record<string, unknown>
    : {};

  return {
    ...(structuredOutput ?? {}),
    [CHANNEL_ACTIONS_KEY]: {
      ...existingChannelActions,
      [FEISHU_CHANNEL_ACTION_KEY]: {
        ...existingFeishuActions,
        [FEISHU_ATTACHMENT_PATHS_KEY]: attachmentPaths,
      },
    },
  };
}

function summarizeVisibleOutput(output: string, fallbackSummary: string): string {
  const normalized = output.trim();

  if (!normalized) {
    return fallbackSummary;
  }

  const [firstLine] = normalized.split("\n");
  const summary = firstLine ? firstLine.slice(0, 200) : normalized.slice(0, 200);
  return summary || fallbackSummary;
}

function mapFeishuImFileType(extension: string): FeishuImFileType {
  switch (extension) {
    case ".pdf":
      return "pdf";
    case ".doc":
    case ".docx":
      return "doc";
    case ".xls":
    case ".xlsx":
      return "xls";
    case ".ppt":
    case ".pptx":
      return "ppt";
    case ".mp4":
      return "mp4";
    case ".opus":
      return "opus";
    default:
      return "stream";
  }
}

function isWithinDirectory(parentDirectory: string, targetPath: string): boolean {
  const relativePath = relative(parentDirectory, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith("../"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    results.push(value);
  }

  return results;
}
