import Database from "better-sqlite3";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export interface CreatePlatformBackupInput {
  sourcePath: string;
  outputPath?: string;
  now?: string;
}

export interface CreatePlatformBackupResult {
  sourcePath: string;
  outputPath: string;
  createdAt: string;
  sizeBytes: number;
}

export interface RestorePlatformBackupInput {
  inputPath: string;
  targetPath: string;
  now?: string;
}

export interface RestorePlatformBackupResult {
  inputPath: string;
  targetPath: string;
  restoredAt: string;
  sizeBytes: number;
  previousBackupPath?: string;
}

export class PlatformBackupService {
  async createBackup(input: CreatePlatformBackupInput): Promise<CreatePlatformBackupResult> {
    const sourcePath = normalizeRequiredPath(input.sourcePath, "sourcePath is required.");

    if (!existsSync(sourcePath)) {
      throw new Error(`源数据库不存在：${sourcePath}`);
    }

    const createdAt = normalizeNow(input.now);
    const outputPath = normalizeOutputPath(
      input.outputPath,
      resolveDefaultBackupPath(sourcePath, createdAt),
    );

    if (sourcePath === outputPath) {
      throw new Error("备份输出路径不能和源数据库相同。");
    }

    mkdirSync(dirname(outputPath), { recursive: true });

    const sourceDb = new Database(sourcePath, { readonly: true });

    try {
      await sourceDb.backup(outputPath);
    } finally {
      sourceDb.close();
    }

    return {
      sourcePath,
      outputPath,
      createdAt,
      sizeBytes: statSync(outputPath).size,
    };
  }

  async restoreBackup(input: RestorePlatformBackupInput): Promise<RestorePlatformBackupResult> {
    const inputPath = normalizeRequiredPath(input.inputPath, "inputPath is required.");
    const targetPath = normalizeRequiredPath(input.targetPath, "targetPath is required.");

    if (!existsSync(inputPath)) {
      throw new Error(`备份文件不存在：${inputPath}`);
    }

    if (inputPath === targetPath) {
      throw new Error("恢复源和目标数据库不能是同一路径。");
    }

    const restoredAt = normalizeNow(input.now);
    mkdirSync(dirname(targetPath), { recursive: true });
    let previousBackupPath: string | undefined;

    if (existsSync(targetPath)) {
      previousBackupPath = resolveBeforeRestoreBackupPath(targetPath, restoredAt);
      mkdirSync(dirname(previousBackupPath), { recursive: true });

      const currentDb = new Database(targetPath, { readonly: true });

      try {
        await currentDb.backup(previousBackupPath);
      } finally {
        currentDb.close();
      }
    }

    const backupDb = new Database(inputPath, { readonly: true });

    try {
      await backupDb.backup(targetPath);
    } finally {
      backupDb.close();
    }

    return {
      inputPath,
      targetPath,
      restoredAt,
      sizeBytes: statSync(targetPath).size,
      ...(previousBackupPath ? { previousBackupPath } : {}),
    };
  }
}

function resolveDefaultBackupPath(sourcePath: string, now: string): string {
  return resolve(
    dirname(sourcePath),
    "../backups",
    `${stripExtension(basename(sourcePath))}-${formatTimestampForPath(now)}.db`,
  );
}

function resolveBeforeRestoreBackupPath(targetPath: string, now: string): string {
  return resolve(
    dirname(targetPath),
    "../backups",
    `${stripExtension(basename(targetPath))}-before-restore-${formatTimestampForPath(now)}.db`,
  );
}

function normalizeRequiredPath(value: string, message: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(message);
  }

  return resolve(normalized);
}

function normalizeOutputPath(value: string | undefined, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  return resolve(value.trim());
}

function normalizeNow(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized || new Date().toISOString();
}

function formatTimestampForPath(value: string): string {
  return value
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .replace(/\..+$/, "")
    .replace(/Z$/, "");
}

function stripExtension(filename: string): string {
  return filename.endsWith(".db") ? filename.slice(0, -3) : filename;
}
