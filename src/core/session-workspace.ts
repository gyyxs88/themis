import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export function normalizeWorkspacePath(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

export function validateWorkspacePath(input: string): string {
  const resolved = normalizeAbsoluteWorkspacePath(input);
  let stats: ReturnType<typeof statSync>;

  try {
    stats = statSync(resolved);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error("工作区不存在。");
    }
    throw new Error("工作区不可访问。");
  }

  if (!stats.isDirectory()) {
    throw new Error("工作区不是目录。");
  }

  try {
    accessSync(resolved, constants.R_OK | constants.X_OK);
  } catch {
    throw new Error("工作区不可访问。");
  }

  return resolved;
}

export function normalizeAbsoluteWorkspacePath(input: string): string {
  const normalized = normalizeWorkspacePath(input);
  if (!normalized) {
    throw new Error("工作区不能为空。");
  }

  if (!isAbsolute(normalized)) {
    throw new Error("只支持服务端本机绝对路径。");
  }

  return resolve(normalized);
}
