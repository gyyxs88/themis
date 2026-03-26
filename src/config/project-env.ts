import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const PROJECT_ENV_FILENAMES = [".env", ".env.local"] as const;
export const PRIMARY_PROJECT_ENV_FILENAME = ".env.local";
export const PROJECT_ENV_EXAMPLE_FILENAME = ".env.example";

export interface ParsedEnvAssignmentLine {
  kind: "assignment";
  key: string;
  value: string;
}

export interface ParsedEnvOtherLine {
  kind: "other";
  raw: string;
}

export type ParsedEnvLine = ParsedEnvAssignmentLine | ParsedEnvOtherLine;

export interface ProjectEnvFileSnapshot {
  filePath: string;
  exists: boolean;
  values: Map<string, string>;
}

export function resolveProjectEnvFilePath(filename: string, cwd = process.cwd()): string {
  return resolve(cwd, filename);
}

export function resolvePrimaryProjectEnvFile(cwd = process.cwd()): string {
  return resolveProjectEnvFilePath(PRIMARY_PROJECT_ENV_FILENAME, cwd);
}

export function resolveProjectEnvExampleFile(cwd = process.cwd()): string {
  return resolveProjectEnvFilePath(PROJECT_ENV_EXAMPLE_FILENAME, cwd);
}

export function parseEnvContent(content: string): ParsedEnvLine[] {
  const normalized = content.replace(/^\uFEFF/, "");
  const rows = normalized.split(/\r?\n/);
  return rows.map(parseEnvLine);
}

export function readProjectEnvFile(filePath: string): ProjectEnvFileSnapshot {
  if (!existsSync(filePath)) {
    return {
      filePath,
      exists: false,
      values: new Map<string, string>(),
    };
  }

  const lines = parseEnvContent(readFileSync(filePath, "utf8"));
  const values = new Map<string, string>();

  for (const line of lines) {
    if (line.kind !== "assignment") {
      continue;
    }

    values.set(line.key, line.value);
  }

  return {
    filePath,
    exists: true,
    values,
  };
}

export function readProjectEnvFiles(cwd = process.cwd()): ProjectEnvFileSnapshot[] {
  return PROJECT_ENV_FILENAMES.map((filename) => readProjectEnvFile(resolveProjectEnvFilePath(filename, cwd)));
}

export function loadProjectEnv(cwd = process.cwd()): string[] {
  const loadedFiles: string[] = [];

  for (const filename of PROJECT_ENV_FILENAMES) {
    const filePath = resolveProjectEnvFilePath(filename, cwd);

    if (!existsSync(filePath)) {
      continue;
    }

    const lines = parseEnvContent(readFileSync(filePath, "utf8"));
    let applied = false;

    for (const line of lines) {
      if (line.kind !== "assignment") {
        continue;
      }

      const value = line.value.trim();

      if (!value || Object.prototype.hasOwnProperty.call(process.env, line.key)) {
        continue;
      }

      process.env[line.key] = value;
      applied = true;
    }

    if (applied) {
      loadedFiles.push(filePath);
    }
  }

  return loadedFiles;
}

export function setProjectEnvValue(filePath: string, key: string, value: string): void {
  const normalizedKey = key.trim();

  if (!normalizedKey) {
    throw new Error("配置键不能为空。");
  }

  const normalizedValue = value.trim();
  const existing = existsSync(filePath) ? parseEnvContent(readFileSync(filePath, "utf8")) : [];
  const nextLines: ParsedEnvLine[] = [];
  let updated = false;

  for (const line of existing) {
    if (line.kind !== "assignment" || line.key !== normalizedKey) {
      nextLines.push(line);
      continue;
    }

    if (!updated) {
      nextLines.push({
        kind: "assignment",
        key: normalizedKey,
        value: normalizedValue,
      });
      updated = true;
    }
  }

  if (!updated) {
    const lastLine = nextLines[nextLines.length - 1];

    if (lastLine?.kind === "other" && lastLine.raw.trim()) {
      nextLines.push({ kind: "other", raw: "" });
    }

    nextLines.push({
      kind: "assignment",
      key: normalizedKey,
      value: normalizedValue,
    });
  }

  writeFileSync(filePath, serializeEnvLines(nextLines), "utf8");
}

export function unsetProjectEnvValue(filePath: string, key: string): boolean {
  const normalizedKey = key.trim();

  if (!normalizedKey || !existsSync(filePath)) {
    return false;
  }

  const existing = parseEnvContent(readFileSync(filePath, "utf8"));
  const nextLines = existing.filter((line) => line.kind !== "assignment" || line.key !== normalizedKey);

  if (nextLines.length === existing.length) {
    return false;
  }

  writeFileSync(filePath, serializeEnvLines(nextLines), "utf8");
  return true;
}

export function escapeEnvValue(value: string): string {
  if (!value) {
    return "\"\"";
  }

  return /^[A-Za-z0-9_./:@,+-]+$/.test(value) ? value : JSON.stringify(value);
}

function parseEnvLine(raw: string): ParsedEnvLine {
  const trimmed = raw.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return {
      kind: "other",
      raw,
    };
  }

  const matched = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);

  if (!matched) {
    return {
      kind: "other",
      raw,
    };
  }

  const key = matched[1];
  const rawValue = matched[2];

  if (!key || typeof rawValue !== "string") {
    return {
      kind: "other",
      raw,
    };
  }

  return {
    kind: "assignment",
    key,
    value: normalizeEnvValue(rawValue),
  };
}

function normalizeEnvValue(rawValue: string): string {
  const value = rawValue.trim();

  if (!value) {
    return "";
  }

  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return unquoteEnvValue(value);
  }

  return value;
}

function unquoteEnvValue(value: string): string {
  const quote = value[0];
  const inner = value.slice(1, -1);

  if (quote === "\"") {
    return inner.replace(/\\([\\nrt"])/g, (_match, token: string) => {
      switch (token) {
        case "n":
          return "\n";
        case "r":
          return "\r";
        case "t":
          return "\t";
        case "\"":
          return "\"";
        case "\\":
        default:
          return "\\";
      }
    });
  }

  return inner.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

function serializeEnvLines(lines: ParsedEnvLine[]): string {
  const serialized = lines.map((line) => (
    line.kind === "assignment"
      ? `${line.key}=${escapeEnvValue(line.value)}`
      : line.raw
  ));

  return `${trimTrailingEmptyLines(serialized).join("\n")}\n`;
}

function trimTrailingEmptyLines(lines: string[]): string[] {
  const next = [...lines];

  while (next.length > 0 && !next[next.length - 1]?.trim()) {
    next.pop();
  }

  return next;
}
