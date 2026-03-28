import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCodexAuthFilePath, resolveDefaultCodexHome } from "../core/auth-accounts.js";
import type { CodexAuthRuntime } from "../core/codex-auth.js";
import { readOpenAICompatibleProviderConfigs } from "../core/openai-compatible-provider.js";
import type { SqliteCodexSessionRegistry } from "../storage/index.js";

export interface RuntimeDiagnosticFileStatus {
  path: string;
  status: "ok" | "missing" | "unreadable";
}

export interface RuntimeDiagnosticsSummary {
  generatedAt: string;
  workingDirectory: string;
  auth: {
    defaultCodexHome: string;
    authFilePath: string;
    authFileExists: boolean;
    snapshotAuthenticated: boolean | null;
    snapshotError?: string;
  };
  provider: {
    activeMode: "auth" | "third-party";
    providerCount: number;
    providerIds: string[];
    readError?: string;
  };
  context: {
    files: RuntimeDiagnosticFileStatus[];
  };
  memory: {
    files: RuntimeDiagnosticFileStatus[];
  };
  service: {
    sqlite: {
      path: string;
      exists: boolean;
    };
  };
}

export interface RuntimeDiagnosticsServiceOptions {
  workingDirectory: string;
  runtimeStore?: SqliteCodexSessionRegistry | null;
  authRuntime?: CodexAuthRuntime | null;
  sqliteFilePath?: string;
}

const CONTEXT_FILES = [
  "README.md",
  "AGENTS.md",
  "memory/project/overview.md",
  "memory/architecture/overview.md",
] as const;

const MEMORY_FILES = [
  "memory/sessions/active.md",
  "memory/tasks/backlog.md",
  "memory/tasks/in-progress.md",
  "memory/tasks/done.md",
] as const;

export class RuntimeDiagnosticsService {
  private readonly workingDirectory: string;
  private readonly runtimeStore: SqliteCodexSessionRegistry | null;
  private readonly authRuntime: CodexAuthRuntime | null;
  private readonly sqliteFilePath: string;

  constructor(options: RuntimeDiagnosticsServiceOptions) {
    this.workingDirectory = options.workingDirectory;
    this.runtimeStore = options.runtimeStore ?? null;
    this.authRuntime = options.authRuntime ?? null;
    this.sqliteFilePath = options.sqliteFilePath ?? join(this.workingDirectory, "infra/local/themis.db");
  }

  async readSummary(): Promise<RuntimeDiagnosticsSummary> {
    const defaultCodexHome = resolveDefaultCodexHome();
    const authFilePath = resolveCodexAuthFilePath(defaultCodexHome);
    const authFileExists = existsSync(authFilePath);
    let snapshotAuthenticated: boolean | null = null;
    let snapshotError: string | undefined;

    if (this.authRuntime) {
      try {
        const snapshot = await this.authRuntime.readSnapshot();
        snapshotAuthenticated = snapshot.authenticated;
      } catch (error) {
        snapshotError = toErrorMessage(error);
      }
    }

    let providerCount = 0;
    let providerIds: string[] = [];
    let providerReadError: string | undefined;
    const activeProviderProfile = this.authRuntime?.readThirdPartyProviderProfile() ?? null;
    if (this.runtimeStore) {
      try {
        const configs = readOpenAICompatibleProviderConfigs(this.workingDirectory, this.runtimeStore);
        providerCount = configs.length;
        providerIds = configs.map((config) => config.id);
      } catch (error) {
        providerReadError = toErrorMessage(error);
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      workingDirectory: this.workingDirectory,
      auth: {
        defaultCodexHome,
        authFilePath,
        authFileExists,
        snapshotAuthenticated,
        ...(snapshotError ? { snapshotError } : {}),
      },
      provider: {
        activeMode: activeProviderProfile ? "third-party" : "auth",
        providerCount,
        providerIds,
        ...(providerReadError ? { readError: providerReadError } : {}),
      },
      context: {
        files: CONTEXT_FILES.map((path) => readPathStatus(this.workingDirectory, path)),
      },
      memory: {
        files: MEMORY_FILES.map((path) => readPathStatus(this.workingDirectory, path)),
      },
      service: {
        sqlite: {
          path: this.sqliteFilePath,
          exists: existsSync(this.sqliteFilePath),
        },
      },
    };
  }
}

function readPathStatus(root: string, relativePath: string): RuntimeDiagnosticFileStatus {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    return {
      path: relativePath,
      status: "missing",
    };
  }

  try {
    readFileSync(absolutePath, "utf8");
    return {
      path: relativePath,
      status: "ok",
    };
  } catch {
    return {
      path: relativePath,
      status: "unreadable",
    };
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
