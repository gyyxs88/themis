import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import {
  CodexAppServerSession,
  readCodexAuthStatus,
  readCodexAuthStatusFromSession,
  resolveCodexCliBinary,
  type CodexAuthStatus,
} from "./codex-app-server.js";
import {
  readOpenAICompatibleProviderSummary,
  type OpenAICompatibleProviderSummary,
} from "./openai-compatible-provider.js";

export interface CodexPendingBrowserLogin {
  provider: "chatgpt";
  mode: "browser";
  loginId: string;
  authUrl: string;
  startedAt: string;
}

export interface CodexPendingDeviceLogin {
  provider: "chatgpt";
  mode: "device";
  verificationUri: string;
  userCode: string;
  startedAt: string;
  expiresAt: string | null;
}

export type CodexPendingLogin = CodexPendingBrowserLogin | CodexPendingDeviceLogin;

export interface CodexAuthSnapshot extends CodexAuthStatus {
  pendingLogin: CodexPendingLogin | null;
  lastError: string | null;
  providerProfile: OpenAICompatibleProviderSummary | null;
}

export interface CodexAuthRuntimeOptions {
  workingDirectory?: string;
}

interface AppServerLoginStartResponse {
  loginId?: unknown;
  authUrl?: unknown;
}

interface PendingBrowserLoginSession extends CodexPendingBrowserLogin {
  session: CodexAppServerSession;
}

interface PendingDeviceLoginSession extends CodexPendingDeviceLogin {
  process: ChildProcessWithoutNullStreams;
  canceled: boolean;
  outputChunks: string[];
}

export class CodexAuthRuntime {
  private readonly workingDirectory: string;
  private readonly providerProfile: OpenAICompatibleProviderSummary | null;
  private pendingBrowserLogin: PendingBrowserLoginSession | null = null;
  private pendingDeviceLogin: PendingDeviceLoginSession | null = null;
  private lastError: string | null = null;
  private operationChain: Promise<unknown> = Promise.resolve();

  constructor(options: CodexAuthRuntimeOptions = {}) {
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.providerProfile = readOpenAICompatibleProviderSummary(this.workingDirectory);
  }

  async readSnapshot(): Promise<CodexAuthSnapshot> {
    return this.withLock(async () => this.readSnapshotInternal());
  }

  async startChatgptLogin(): Promise<CodexAuthSnapshot> {
    return this.withLock(async () => this.startChatgptLoginInternal());
  }

  async startChatgptDeviceLogin(): Promise<CodexAuthSnapshot> {
    return this.withLock(async () => this.startChatgptDeviceLoginInternal());
  }

  async loginWithApiKey(apiKey: string): Promise<CodexAuthSnapshot> {
    return this.withLock(async () => this.loginWithApiKeyInternal(apiKey));
  }

  async logout(): Promise<CodexAuthSnapshot> {
    return this.withLock(async () => this.logoutInternal());
  }

  async cancelPendingLogin(): Promise<CodexAuthSnapshot> {
    return this.withLock(async () => this.cancelPendingLoginInternal());
  }

  private async startChatgptLoginInternal(): Promise<CodexAuthSnapshot> {
    const current = await this.readSnapshotInternal();

    if (current.authenticated || current.pendingLogin?.mode === "browser") {
      return current;
    }

    await this.cancelPendingSessions();
    this.lastError = null;

    const session = new CodexAppServerSession(this.workingDirectory);

    try {
      await session.initialize();

      const result = await session.request<AppServerLoginStartResponse>("account/login/start", {
        type: "chatgpt",
      });

      const loginId = normalizeOptionalText(result.loginId);
      const authUrl = normalizeOptionalText(result.authUrl);

      if (!loginId || !authUrl) {
        throw new Error("Codex 没有返回可用的浏览器登录信息。");
      }

      this.pendingBrowserLogin = {
        provider: "chatgpt",
        mode: "browser",
        loginId,
        authUrl,
        startedAt: new Date().toISOString(),
        session,
      };

      return await this.readSnapshotInternal();
    } catch (error) {
      this.lastError = toErrorMessage(error);
      await closeQuietly(session);
      throw error;
    }
  }

  private async startChatgptDeviceLoginInternal(): Promise<CodexAuthSnapshot> {
    const current = await this.readSnapshotInternal();

    if (current.authenticated || current.pendingLogin?.mode === "device") {
      return current;
    }

    await this.cancelPendingSessions();
    this.lastError = null;

    try {
      this.pendingDeviceLogin = await this.spawnDeviceLoginSession();
      return await this.readSnapshotInternal();
    } catch (error) {
      this.lastError = toErrorMessage(error);
      throw error;
    }
  }

  private async loginWithApiKeyInternal(apiKey: string): Promise<CodexAuthSnapshot> {
    const normalizedApiKey = apiKey.trim();

    if (!normalizedApiKey) {
      throw new Error("API Key 不能为空。");
    }

    await this.cancelPendingSessions();
    this.lastError = null;

    try {
      await runCodexCommand(this.workingDirectory, ["login", "--with-api-key"], {
        stdinText: `${normalizedApiKey}\n`,
      });
    } catch (error) {
      this.lastError = toErrorMessage(error);
      throw error;
    }

    const snapshot = await this.readSnapshotInternal();

    if (!snapshot.authenticated && snapshot.requiresOpenaiAuth) {
      throw new Error("API Key 登录没有生效，请检查密钥是否正确。");
    }

    return snapshot;
  }

  private async logoutInternal(): Promise<CodexAuthSnapshot> {
    await this.cancelPendingSessions();
    this.lastError = null;

    try {
      await runCodexCommand(this.workingDirectory, ["logout"]);
    } catch (error) {
      const message = toErrorMessage(error);

      if (!/not logged in/i.test(message)) {
        this.lastError = message;
        throw error;
      }
    }

    return await this.readSnapshotInternal();
  }

  private async cancelPendingLoginInternal(): Promise<CodexAuthSnapshot> {
    await this.cancelPendingSessions();
    return await this.readSnapshotInternal();
  }

  private async readSnapshotInternal(): Promise<CodexAuthSnapshot> {
    let status: CodexAuthStatus;

    if (this.pendingBrowserLogin) {
      try {
        status = await readCodexAuthStatusFromSession(this.pendingBrowserLogin.session);
      } catch (error) {
        this.lastError = toErrorMessage(error);
        await this.disposeBrowserLoginSession(false);
        status = await readCodexAuthStatus(this.workingDirectory);
      }
    } else {
      status = await readCodexAuthStatus(this.workingDirectory);
    }

    if (status.authenticated) {
      this.lastError = null;
      await this.disposeBrowserLoginSession(false);
      await this.disposeDeviceLoginSession(false);
    }

    return {
      ...status,
      pendingLogin: this.getPendingLoginSnapshot(),
      lastError: this.lastError,
      providerProfile: this.providerProfile,
    };
  }

  private async cancelPendingSessions(): Promise<void> {
    await this.disposeBrowserLoginSession(true);
    await this.disposeDeviceLoginSession(true);
  }

  private async disposeBrowserLoginSession(cancel: boolean): Promise<void> {
    const pending = this.pendingBrowserLogin;

    if (!pending) {
      return;
    }

    this.pendingBrowserLogin = null;

    if (cancel) {
      try {
        await pending.session.request("account/login/cancel", {
          loginId: pending.loginId,
        });
      } catch {
        // Browser login sessions can already be gone by the time the user cancels.
      }
    }

    await closeQuietly(pending.session);
  }

  private async disposeDeviceLoginSession(cancel: boolean): Promise<void> {
    const pending = this.pendingDeviceLogin;

    if (!pending) {
      return;
    }

    this.pendingDeviceLogin = null;
    pending.canceled = pending.canceled || cancel;

    if (!cancel || pending.process.exitCode !== null || pending.process.signalCode !== null) {
      return;
    }

    pending.process.kill("SIGTERM");
    await waitForChildExit(pending.process, 500);

    if (pending.process.exitCode === null && pending.process.signalCode === null) {
      pending.process.kill("SIGKILL");
      await waitForChildExit(pending.process, 500);
    }
  }

  private getPendingLoginSnapshot(): CodexPendingLogin | null {
    if (this.pendingBrowserLogin) {
      const { session: _session, ...pending } = this.pendingBrowserLogin;
      return pending;
    }

    if (this.pendingDeviceLogin) {
      const { process: _process, canceled: _canceled, outputChunks: _outputChunks, ...pending } = this.pendingDeviceLogin;
      return pending;
    }

    return null;
  }

  private async spawnDeviceLoginSession(): Promise<PendingDeviceLoginSession> {
    const child = spawn(resolveCodexCliBinary(), ["login", "--device-auth"], {
      cwd: this.workingDirectory,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const outputChunks: string[] = [];
    const collectChunk = (chunk: string | Buffer): void => {
      outputChunks.push(stripAnsi(String(chunk)));
    };

    child.stdout.on("data", collectChunk);
    child.stderr.on("data", collectChunk);

    return await new Promise<PendingDeviceLoginSession>((resolve, reject) => {
      let resolved = false;
      let verificationUri: string | null = null;
      let userCode: string | null = null;
      let expiresMinutes: number | null = null;
      let activeSession: PendingDeviceLoginSession | null = null;

      const finalizeReady = (): void => {
        if (resolved || !verificationUri || !userCode) {
          return;
        }

        resolved = true;
        const startedAt = new Date().toISOString();

        activeSession = {
          provider: "chatgpt",
          mode: "device",
          verificationUri,
          userCode,
          startedAt,
          expiresAt: resolveExpiryIso(startedAt, expiresMinutes),
          process: child,
          canceled: false,
          outputChunks,
        };

        resolve(activeSession);
      };

      const parseLine = (line: string): void => {
        const text = stripAnsi(line).trim();

        if (!text) {
          return;
        }

        verificationUri = verificationUri ?? matchFirst(text, /https:\/\/auth\.openai\.com\/codex\/device\S*/i);
        userCode = userCode ?? matchFirst(text, /\b([A-Z0-9]{4,6}-[A-Z0-9]{4,6})\b/);

        const expiresMatch = text.match(/expires in (\d+)\s+minute/i);

        if (!expiresMinutes && expiresMatch) {
          const parsed = Number.parseInt(expiresMatch[1] ?? "", 10);
          expiresMinutes = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        }

        finalizeReady();
      };

      const stdoutReader = createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
      });
      const stderrReader = createInterface({
        input: child.stderr,
        crlfDelay: Infinity,
      });

      stdoutReader.on("line", parseLine);
      stderrReader.on("line", parseLine);

      child.once("error", (error) => {
        if (resolved) {
          return;
        }

        resolved = true;
        reject(error);
      });

      child.once("close", (code, signal) => {
        if (activeSession) {
          const session = activeSession;
          void this.withLock(async () => this.handleDeviceLoginProcessExit(session, code, signal));
          return;
        }

        if (resolved) {
          return;
        }

        resolved = true;
        reject(new Error(buildProcessFailureMessage("codex login --device-auth", code, signal, outputChunks.join(""))));
      });
    });
  }

  private async handleDeviceLoginProcessExit(
    session: PendingDeviceLoginSession,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    const status = await safeReadAuthStatus(this.workingDirectory);

    if (status?.authenticated) {
      if (this.pendingDeviceLogin === session) {
        this.pendingDeviceLogin = null;
      }

      this.lastError = null;
      return;
    }

    if (this.pendingDeviceLogin === session) {
      this.pendingDeviceLogin = null;
    }

    if (session.canceled) {
      return;
    }

    this.lastError = buildProcessFailureMessage(
      "codex login --device-auth",
      code,
      signal,
      session.outputChunks.join(""),
    );
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.operationChain.then(operation, operation);
    this.operationChain = task.then(() => undefined, () => undefined);
    return await task;
  }
}

interface RunCodexCommandOptions {
  stdinText?: string;
}

async function runCodexCommand(
  cwd: string,
  args: string[],
  options: RunCodexCommandOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(resolveCodexCliBinary(), args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string | Buffer) => {
      stdoutChunks.push(stripAnsi(String(chunk)));
    });

    child.stderr.on("data", (chunk: string | Buffer) => {
      stderrChunks.push(stripAnsi(String(chunk)));
    });

    child.once("error", (error) => {
      reject(error);
    });

    child.once("close", (code, signal) => {
      const stdout = stdoutChunks.join("");
      const stderr = stderrChunks.join("");

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(buildProcessFailureMessage(`codex ${args.join(" ")}`, code, signal, `${stdout}${stderr}`)));
    });

    if (typeof options.stdinText === "string") {
      child.stdin.end(options.stdinText, "utf8");
      return;
    }

    child.stdin.end();
  });
}

async function waitForChildExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await Promise.race([
    new Promise<void>((resolve) => {
      child.once("close", () => {
        resolve();
      });
    }),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}

async function closeQuietly(session: CodexAppServerSession): Promise<void> {
  try {
    await session.close();
  } catch {
    // Best effort shutdown only.
  }
}

async function safeReadAuthStatus(workingDirectory: string): Promise<CodexAuthStatus | null> {
  try {
    return await readCodexAuthStatus(workingDirectory);
  } catch {
    return null;
  }
}

function resolveExpiryIso(startedAt: string, expiresMinutes: number | null): string | null {
  if (!expiresMinutes) {
    return null;
  }

  const startedAtMs = Date.parse(startedAt);

  if (!Number.isFinite(startedAtMs)) {
    return null;
  }

  return new Date(startedAtMs + expiresMinutes * 60_000).toISOString();
}

function buildProcessFailureMessage(
  label: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  output: string,
): string {
  const normalizedOutput = normalizeOptionalText(stripAnsi(output));

  if (normalizedOutput) {
    return normalizedOutput;
  }

  return `${label} 失败了（code: ${code ?? "unknown"}, signal: ${signal ?? "none"}）。`;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text ? text : null;
}

function matchFirst(value: string, pattern: RegExp): string | null {
  const match = value.match(pattern);
  return normalizeOptionalText(match?.[1] ?? match?.[0]);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
