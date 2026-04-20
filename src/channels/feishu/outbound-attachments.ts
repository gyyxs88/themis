import { existsSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";

export type FeishuImFileType = "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream";

export interface FeishuOutboundAttachmentPlan {
  absolutePath: string;
  fileName: string;
  messageType: "image" | "file";
  uploadFileType?: FeishuImFileType;
}

export interface ResolveFeishuOutboundAttachmentPlansOptions {
  outputText?: string | null;
  touchedFiles?: string[] | null;
  workspaceDirectory: string;
}

export interface ResolveFeishuOutboundAttachmentPlansResult {
  plans: FeishuOutboundAttachmentPlan[];
  notices: string[];
}

const MAX_FEISHU_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FEISHU_FILE_BYTES = 30 * 1024 * 1024;

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

type CandidateSource = "explicit" | "touched-temp";

interface CandidateRecord {
  absolutePath: string;
  source: CandidateSource;
}

export function resolveFeishuOutboundAttachmentPlans(
  options: ResolveFeishuOutboundAttachmentPlansOptions,
): ResolveFeishuOutboundAttachmentPlansResult {
  const workspaceDirectory = resolve(options.workspaceDirectory);
  const tempDirectory = resolve(workspaceDirectory, "temp");
  const candidates = new Map<string, CandidateRecord>();

  for (const absolutePath of extractExplicitLocalLinkPaths(options.outputText)) {
    candidates.set(absolutePath, {
      absolutePath,
      source: "explicit",
    });
  }

  for (const filePath of options.touchedFiles ?? []) {
    const absolutePath = resolveTouchedFilePath(filePath, workspaceDirectory);

    if (!absolutePath || !isWithinDirectory(tempDirectory, absolutePath)) {
      continue;
    }

    if (!candidates.has(absolutePath)) {
      candidates.set(absolutePath, {
        absolutePath,
        source: "touched-temp",
      });
    }
  }

  const plans: FeishuOutboundAttachmentPlan[] = [];
  const notices: string[] = [];

  for (const candidate of candidates.values()) {
    const plan = buildAttachmentPlan(candidate);

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

function extractExplicitLocalLinkPaths(text: string | null | undefined): string[] {
  if (typeof text !== "string" || !text.trim()) {
    return [];
  }

  const matches = text.matchAll(/!?\[[^\]\n]*\]\((<[^>\n]+>|[^)\n]+)\)/g);
  const paths: string[] = [];

  for (const match of matches) {
    const rawTarget = typeof match[1] === "string" ? match[1].trim() : "";

    if (!rawTarget) {
      continue;
    }

    const normalizedTarget = rawTarget.startsWith("<") && rawTarget.endsWith(">")
      ? rawTarget.slice(1, -1).trim()
      : rawTarget;

    if (!normalizedTarget.startsWith("/")) {
      continue;
    }

    paths.push(stripLocalFileLineSuffix(normalizedTarget));
  }

  return dedupeStrings(paths.map((item) => resolve(item)));
}

function stripLocalFileLineSuffix(target: string): string {
  return target.replace(/:\d+$/, "");
}

function resolveTouchedFilePath(filePath: string, workspaceDirectory: string): string | null {
  const normalized = filePath.trim();

  if (!normalized) {
    return null;
  }

  return isAbsolute(normalized) ? resolve(normalized) : resolve(workspaceDirectory, normalized);
}

function buildAttachmentPlan(candidate: CandidateRecord):
  | { kind: "ready"; plan: FeishuOutboundAttachmentPlan }
  | { kind: "skip" }
  | { kind: "notice"; message: string } {
  const filePath = candidate.absolutePath;

  if (!existsSync(filePath)) {
    return { kind: "skip" };
  }

  const stats = statSync(filePath, { throwIfNoEntry: false });

  if (!stats || !stats.isFile()) {
    return { kind: "skip" };
  }

  const extension = extname(filePath).toLowerCase();

  if (SOURCE_CODE_EXTENSIONS.has(extension)) {
    return { kind: "skip" };
  }

  if (candidate.source === "explicit" && extension && !SUPPORTED_EXPLICIT_FILE_EXTENSIONS.has(extension)) {
    return { kind: "skip" };
  }

  if (SUPPORTED_IMAGE_EXTENSIONS.has(extension) && stats.size <= MAX_FEISHU_IMAGE_BYTES) {
    return {
      kind: "ready",
      plan: {
        absolutePath: filePath,
        fileName: basename(filePath),
        messageType: "image",
      },
    };
  }

  if (stats.size > MAX_FEISHU_FILE_BYTES) {
    return {
      kind: "notice",
      message: `结果文件 ${basename(filePath)} 超过飞书 IM 附件 30MB 上限，当前没有自动回传。`,
    };
  }

  return {
    kind: "ready",
    plan: {
      absolutePath: filePath,
      fileName: basename(filePath),
      messageType: "file",
      uploadFileType: mapFeishuImFileType(extension),
    },
  };
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
  return relativePath !== "" && !relativePath.startsWith("..") && !relativePath.startsWith("../");
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
