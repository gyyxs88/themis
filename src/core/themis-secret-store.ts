import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_THEMIS_SECRET_STORE_RELATIVE_PATH = "infra/local/themis-secrets.json";
const THEMIS_SECRET_FILE_MODE = 0o600;

export interface ThemisSecretStoreOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  filePath?: string;
}

export interface ThemisSecretStoreSnapshot {
  filePath: string;
  secretRefs: string[];
}

export class ThemisSecretStore {
  private readonly filePath: string;

  constructor(options: ThemisSecretStoreOptions = {}) {
    this.filePath = resolveThemisSecretStoreFilePath(options);
  }

  getFilePath(): string {
    return this.filePath;
  }

  readSnapshot(): ThemisSecretStoreSnapshot {
    const store = this.readStore();
    return {
      filePath: this.filePath,
      secretRefs: Object.keys(store).sort((left, right) => left.localeCompare(right)),
    };
  }

  getSecret(secretRef: string): string | null {
    const normalizedRef = normalizeThemisSecretRef(secretRef);
    const store = this.readStore();
    return store[normalizedRef] ?? null;
  }

  setSecret(secretRef: string, value: string): ThemisSecretStoreSnapshot {
    const normalizedRef = normalizeThemisSecretRef(secretRef);
    const normalizedValue = normalizeThemisSecretValue(value);
    const store = this.readStore();
    store[normalizedRef] = normalizedValue;
    this.writeStore(store);
    return this.readSnapshot();
  }

  removeSecret(secretRef: string): { removed: boolean; snapshot: ThemisSecretStoreSnapshot } {
    const normalizedRef = normalizeThemisSecretRef(secretRef);
    const store = this.readStore();
    const removed = Object.prototype.hasOwnProperty.call(store, normalizedRef);

    if (removed) {
      delete store[normalizedRef];
      this.writeStore(store);
    }

    return {
      removed,
      snapshot: this.readSnapshot(),
    };
  }

  private readStore(): Record<string, string> {
    if (!existsSync(this.filePath)) {
      return {};
    }

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;

      if (!isRecord(parsed)) {
        return {};
      }

      const store: Record<string, string> = {};

      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== "string") {
          throw new Error(`secretRef ${key} 的值不是字符串`);
        }

        store[key] = value;
      }

      return store;
    } catch (error) {
      throw new Error(`Themis secret store 已损坏，拒绝覆盖：${this.filePath}: ${toErrorMessage(error)}`);
    }
  }

  private writeStore(store: Record<string, string>): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempFile = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tempFile, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: "utf8",
      mode: THEMIS_SECRET_FILE_MODE,
    });
    renameSync(tempFile, this.filePath);
    chmodSync(this.filePath, THEMIS_SECRET_FILE_MODE);
  }
}

export function resolveThemisSecretStoreFilePath(options: ThemisSecretStoreOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const configured = normalizeOptionalText(options.filePath)
    ?? normalizeOptionalText(env.THEMIS_SECRET_STORE_FILE);

  return resolve(cwd, configured ?? DEFAULT_THEMIS_SECRET_STORE_RELATIVE_PATH);
}

function normalizeThemisSecretRef(value: string): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    throw new Error("secretRef 不能为空。");
  }

  if (/\s/.test(normalized)) {
    throw new Error("secretRef 不能包含空白字符。");
  }

  if (normalized.length > 160) {
    throw new Error("secretRef 过长。");
  }

  return normalized;
}

function normalizeThemisSecretValue(value: string): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    throw new Error("secret 值不能为空。");
  }

  return normalized;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
