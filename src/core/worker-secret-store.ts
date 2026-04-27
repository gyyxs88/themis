import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_WORKER_SECRET_STORE_RELATIVE_PATH = "../themis-worker-node/infra/local/worker-secrets.json";
const WORKER_SECRET_FILE_MODE = 0o600;

export interface WorkerSecretStoreOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  filePath?: string;
}

export interface WorkerSecretStoreSnapshot {
  filePath: string;
  secretRefs: string[];
}

export class WorkerSecretStore {
  private readonly filePath: string;

  constructor(options: WorkerSecretStoreOptions = {}) {
    this.filePath = resolveWorkerSecretStoreFilePath(options);
  }

  getFilePath(): string {
    return this.filePath;
  }

  readSnapshot(): WorkerSecretStoreSnapshot {
    const store = this.readStore();
    return {
      filePath: this.filePath,
      secretRefs: Object.keys(store).sort((left, right) => left.localeCompare(right)),
    };
  }

  getSecret(secretRef: string): string | null {
    const normalizedRef = normalizeWorkerSecretRef(secretRef);
    return normalizeSecretStoreEntry(this.readStore()[normalizedRef]);
  }

  setSecret(secretRef: string, value: string): WorkerSecretStoreSnapshot {
    const normalizedRef = normalizeWorkerSecretRef(secretRef);
    const normalizedValue = normalizeWorkerSecretValue(value);
    const store = this.readStore();
    store[normalizedRef] = normalizedValue;
    this.writeStore(store);
    return this.readSnapshot();
  }

  removeSecret(secretRef: string): { removed: boolean; snapshot: WorkerSecretStoreSnapshot } {
    const normalizedRef = normalizeWorkerSecretRef(secretRef);
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

  private readStore(): Record<string, unknown> {
    if (!existsSync(this.filePath)) {
      return {};
    }

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      return isRecord(parsed) ? { ...parsed } : {};
    } catch (error) {
      throw new Error(`Worker secret store 已损坏，拒绝覆盖：${this.filePath}: ${toErrorMessage(error)}`);
    }
  }

  private writeStore(store: Record<string, unknown>): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempFile = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tempFile, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: "utf8",
      mode: WORKER_SECRET_FILE_MODE,
    });
    renameSync(tempFile, this.filePath);
    chmodSync(this.filePath, WORKER_SECRET_FILE_MODE);
  }
}

export function resolveWorkerSecretStoreFilePath(options: WorkerSecretStoreOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const configured = normalizeOptionalText(options.filePath)
    ?? normalizeOptionalText(env.THEMIS_MANAGED_AGENT_WORKER_SECRET_STORE_FILE)
    ?? normalizeOptionalText(env.THEMIS_WORKER_SECRET_STORE_FILE);

  return resolve(cwd, configured ?? DEFAULT_WORKER_SECRET_STORE_RELATIVE_PATH);
}

function normalizeWorkerSecretRef(value: string): string {
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

function normalizeWorkerSecretValue(value: string): string {
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

function normalizeSecretStoreEntry(value: unknown): string | null {
  const directValue = normalizeOptionalText(value);

  if (directValue) {
    return directValue;
  }

  if (!isRecord(value)) {
    return null;
  }

  return normalizeOptionalText(value.value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
