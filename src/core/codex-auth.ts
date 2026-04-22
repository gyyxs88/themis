import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import {
  buildCodexCliConfigArgs,
  buildCodexProcessEnv,
  copyCodexAuthFile,
  copyCodexConfigFile,
  createCodexAuthStorageConfigOverrides,
  createManagedAuthAccountRecord,
  ensureAuthAccountBootstrap,
  ensureAuthAccountCodexHome,
  normalizeAuthAccountSummary,
  resolveDefaultCodexHome,
  type CodexCliConfigOverrides,
  type CodexAuthAccountSummary,
} from "./auth-accounts.js";
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
import { SqliteCodexSessionRegistry, type StoredAuthAccountRecord } from "../storage/index.js";

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
  accountId: string;
  accountLabel: string;
  pendingLogin: CodexPendingLogin | null;
  lastError: string | null;
  providerProfile: OpenAICompatibleProviderSummary | null;
}

export interface CodexAuthRuntimeOptions {
  workingDirectory?: string;
  registry?: SqliteCodexSessionRegistry;
  onManagedAccountReady?: (account: StoredAuthAccountRecord) => Promise<void> | void;
}

export interface CodexAuthAccountCreateInput {
  accountId?: string;
  label: string;
  activate?: boolean;
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

interface AuthAccountRuntimeState {
  pendingBrowserLogin: PendingBrowserLoginSession | null;
  pendingDeviceLogin: PendingDeviceLoginSession | null;
  lastError: string | null;
}

export class CodexAuthRuntime {
  private readonly workingDirectory: string;
  private readonly registry: SqliteCodexSessionRegistry;
  private readonly onManagedAccountReady: ((account: StoredAuthAccountRecord) => Promise<void> | void) | undefined;
  private readonly accountStates = new Map<string, AuthAccountRuntimeState>();
  private operationChain: Promise<unknown> = Promise.resolve();

  constructor(options: CodexAuthRuntimeOptions = {}) {
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.registry = options.registry ?? new SqliteCodexSessionRegistry();
    this.onManagedAccountReady = options.onManagedAccountReady;
    ensureAuthAccountBootstrap(this.workingDirectory, this.registry);
  }

  readThirdPartyProviderProfile(): OpenAICompatibleProviderSummary | null {
    return readOpenAICompatibleProviderSummary(this.workingDirectory, this.registry);
  }

  listAccounts(): CodexAuthAccountSummary[] {
    ensureAuthAccountBootstrap(this.workingDirectory, this.registry);
    return this.registry
      .listAuthAccounts()
      .filter((record) => this.isVisibleAccountRecord(record))
      .map(normalizeAuthAccountSummary);
  }

  getRuntimeStore(): SqliteCodexSessionRegistry {
    return this.registry;
  }

  getActiveAccount(): CodexAuthAccountSummary | null {
    ensureAuthAccountBootstrap(this.workingDirectory, this.registry);
    const record = this.registry
      .listAuthAccounts()
      .find((entry) => entry.isActive && this.isVisibleAccountRecord(entry))
      ?? null;
    return record ? normalizeAuthAccountSummary(record) : null;
  }

  createAccount(input: CodexAuthAccountCreateInput): CodexAuthAccountSummary {
    const normalizedLabel = input.label.trim();

    if (!normalizedLabel) {
      throw new Error("账号名称不能为空。");
    }

    const record = createManagedAuthAccountRecord(this.workingDirectory, this.registry, {
      label: normalizedLabel,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      activate: input.activate !== false,
    });
    ensureAuthAccountCodexHome(this.workingDirectory, record.codexHome);
    this.registry.saveAuthAccount(record);
    return normalizeAuthAccountSummary(record);
  }

  setActiveAccount(accountId: string): CodexAuthAccountSummary {
    const updated = this.registry.setActiveAuthAccount(accountId);

    if (!updated) {
      throw new Error(`认证账号 ${accountId} 不存在。`);
    }

    const record = this.registry.getActiveAuthAccount();

    if (!record) {
      throw new Error("切换默认账号失败。");
    }

    return normalizeAuthAccountSummary(record);
  }

  async readSnapshot(accountId?: string): Promise<CodexAuthSnapshot> {
    return this.withLock(async () => {
      if (typeof accountId === "string" && accountId.trim()) {
        return await this.readSnapshotInternal(this.resolveAccountRecord(accountId));
      }

      const syncedAccount = await this.syncDefaultAuthAccount();
      return await this.readSnapshotInternal(syncedAccount ?? this.resolveAccountRecord());
    });
  }

  async startChatgptLogin(accountId?: string): Promise<CodexAuthSnapshot> {
    return this.withLock(async () => this.startChatgptLoginInternal(this.resolveAccountRecord(accountId)));
  }

  async startChatgptDeviceLogin(accountId?: string): Promise<CodexAuthSnapshot> {
    return this.withLock(async () => this.startChatgptDeviceLoginInternal(this.resolveAccountRecord(accountId)));
  }

  async loginWithApiKey(apiKey: string, accountId?: string): Promise<CodexAuthSnapshot> {
    return this.withLock(async () => this.loginWithApiKeyInternal(apiKey, this.resolveAccountRecord(accountId)));
  }

  async logout(accountId?: string): Promise<CodexAuthSnapshot> {
    return this.withLock(async () => this.logoutInternal(this.resolveAccountRecord(accountId)));
  }

  async cancelPendingLogin(accountId?: string): Promise<CodexAuthSnapshot> {
    return this.withLock(async () => this.cancelPendingLoginInternal(this.resolveAccountRecord(accountId)));
  }

  private async startChatgptLoginInternal(account: StoredAuthAccountRecord): Promise<CodexAuthSnapshot> {
    const state = this.getAccountState(account.accountId);
    const current = await this.readSnapshotInternal(account);

    if (current.authenticated || current.pendingLogin?.mode === "browser") {
      return current;
    }

    await this.cancelPendingSessions(state);
    state.lastError = null;

    const session = new CodexAppServerSession(this.workingDirectory, {
      env: this.buildAccountEnv(account),
      configOverrides: this.buildAccountConfigOverrides(),
    });

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

      state.pendingBrowserLogin = {
        provider: "chatgpt",
        mode: "browser",
        loginId,
        authUrl,
        startedAt: new Date().toISOString(),
        session,
      };

      return await this.readSnapshotInternal(account);
    } catch (error) {
      state.lastError = toErrorMessage(error);
      await closeQuietly(session);
      throw error;
    }
  }

  private async startChatgptDeviceLoginInternal(account: StoredAuthAccountRecord): Promise<CodexAuthSnapshot> {
    const state = this.getAccountState(account.accountId);
    const current = await this.readSnapshotInternal(account);

    if (current.authenticated || current.pendingLogin?.mode === "device") {
      return current;
    }

    await this.cancelPendingSessions(state);
    state.lastError = null;

    try {
      state.pendingDeviceLogin = await this.spawnDeviceLoginSession(account);
      return await this.readSnapshotInternal(account);
    } catch (error) {
      state.lastError = toErrorMessage(error);
      throw error;
    }
  }

  private async loginWithApiKeyInternal(apiKey: string, account: StoredAuthAccountRecord): Promise<CodexAuthSnapshot> {
    const normalizedApiKey = apiKey.trim();
    const state = this.getAccountState(account.accountId);

    if (!normalizedApiKey) {
      throw new Error("API Key 不能为空。");
    }

    await this.cancelPendingSessions(state);
    state.lastError = null;

    try {
      await runCodexCommand(this.workingDirectory, ["login", "--with-api-key"], {
        env: this.buildAccountEnv(account),
        configOverrides: this.buildAccountConfigOverrides(),
        stdinText: `${normalizedApiKey}\n`,
      });
    } catch (error) {
      state.lastError = toErrorMessage(error);
      throw error;
    }

    const snapshot = await this.readSnapshotInternal(account);

    if (!snapshot.authenticated && snapshot.requiresOpenaiAuth) {
      throw new Error("API Key 登录没有生效，请检查密钥是否正确。");
    }

    return snapshot;
  }

  private async logoutInternal(account: StoredAuthAccountRecord): Promise<CodexAuthSnapshot> {
    const state = this.getAccountState(account.accountId);
    await this.cancelPendingSessions(state);
    state.lastError = null;

    try {
      await runCodexCommand(this.workingDirectory, ["logout"], {
        env: this.buildAccountEnv(account),
        configOverrides: this.buildAccountConfigOverrides(),
      });
    } catch (error) {
      const message = toErrorMessage(error);

      if (!/not logged in/i.test(message)) {
        state.lastError = message;
        throw error;
      }
    }

    return await this.readSnapshotInternal(account);
  }

  private async cancelPendingLoginInternal(account: StoredAuthAccountRecord): Promise<CodexAuthSnapshot> {
    const state = this.getAccountState(account.accountId);
    await this.cancelPendingSessions(state);
    return await this.readSnapshotInternal(account);
  }

  private async readSnapshotInternal(account: StoredAuthAccountRecord): Promise<CodexAuthSnapshot> {
    const state = this.getAccountState(account.accountId);
    let status: CodexAuthStatus;

    if (state.pendingBrowserLogin) {
      try {
        status = await readCodexAuthStatusFromSession(state.pendingBrowserLogin.session);
      } catch (error) {
        state.lastError = toErrorMessage(error);
        await this.disposeBrowserLoginSession(state, false);
        status = await readCodexAuthStatus(this.workingDirectory, {
          env: this.buildAccountEnv(account),
          configOverrides: this.buildAccountConfigOverrides(),
        });
      }
    } else {
      status = await readCodexAuthStatus(this.workingDirectory, {
        env: this.buildAccountEnv(account),
        configOverrides: this.buildAccountConfigOverrides(),
      });
    }

    if (status.authenticated) {
      account = await this.syncAuthenticatedAccountRecord(account, status);
      state.lastError = null;
      await this.disposeBrowserLoginSession(state, false);
      await this.disposeDeviceLoginSession(state, false);
    }

    return {
      accountId: account.accountId,
      accountLabel: account.label,
      ...status,
      pendingLogin: this.getPendingLoginSnapshot(state),
      lastError: state.lastError,
      providerProfile: this.readThirdPartyProviderProfile(),
    };
  }

  private async syncDefaultAuthAccount(): Promise<StoredAuthAccountRecord | null> {
    const defaultCodexHome = resolveDefaultCodexHome();
    const status = await safeReadAuthStatus(this.workingDirectory, {
      env: buildCodexProcessEnv(defaultCodexHome),
      configOverrides: this.buildAccountConfigOverrides(),
    });

    if (!status?.authenticated) {
      return null;
    }

    const accountEmail = normalizeAccountEmail(status.account?.email);

    if (!accountEmail) {
      return null;
    }

    const existing = this.registry.getAuthAccountByEmail(accountEmail);
    const accountLabel = status.account?.email?.trim() || accountEmail;

    if (existing) {
      return await this.activateAuthenticatedAccount(existing, defaultCodexHome, accountEmail, accountLabel);
    }

    return await this.createAuthenticatedManagedAccount(defaultCodexHome, accountEmail, accountLabel);
  }

  private async syncAuthenticatedAccountRecord(
    account: StoredAuthAccountRecord,
    status: CodexAuthStatus,
  ): Promise<StoredAuthAccountRecord> {
    const accountEmail = normalizeAccountEmail(status.account?.email);

    if (!accountEmail) {
      return account;
    }

    const existing = this.registry.getAuthAccountByEmail(accountEmail);
    const accountLabel = status.account?.email?.trim() || accountEmail;

    if (existing && existing.accountId !== account.accountId) {
      return await this.activateAuthenticatedAccount(existing, account.codexHome, accountEmail, accountLabel);
    }

    if (this.isDefaultSourceAccountRecord(account)) {
      return await this.createAuthenticatedManagedAccount(account.codexHome, accountEmail, accountLabel);
    }

    const normalizedStoredEmail = normalizeAccountEmail(account.accountEmail);

    if (normalizedStoredEmail && normalizedStoredEmail !== accountEmail) {
      return await this.createAuthenticatedManagedAccount(account.codexHome, accountEmail, accountLabel);
    }

    return await this.updateManagedAccountIdentity(account, accountEmail, accountLabel);
  }

  private async activateAuthenticatedAccount(
    account: StoredAuthAccountRecord,
    sourceCodexHome: string,
    accountEmail: string,
    accountLabel: string,
  ): Promise<StoredAuthAccountRecord> {
    ensureAuthAccountCodexHome(this.workingDirectory, account.codexHome);
    copyCodexAuthFile(sourceCodexHome, account.codexHome);
    copyCodexConfigFile(sourceCodexHome, account.codexHome);
    const shouldNotify = !account.isActive
      || normalizeAccountEmail(account.accountEmail) !== accountEmail
      || account.label !== accountLabel;

    const updated: StoredAuthAccountRecord = {
      ...account,
      label: accountLabel || account.label,
      accountEmail,
      isActive: true,
      updatedAt: new Date().toISOString(),
    };

    this.registry.saveAuthAccount(updated);
    const hydrated = this.registry.getAuthAccount(updated.accountId) ?? updated;

    if (shouldNotify) {
      await this.notifyManagedAccountReady(hydrated);
    }

    return hydrated;
  }

  private async createAuthenticatedManagedAccount(
    sourceCodexHome: string,
    accountEmail: string,
    accountLabel: string,
  ): Promise<StoredAuthAccountRecord> {
    const record = createManagedAuthAccountRecord(this.workingDirectory, this.registry, {
      label: accountLabel,
      accountEmail,
      activate: true,
    });
    ensureAuthAccountCodexHome(this.workingDirectory, record.codexHome);
    copyCodexAuthFile(sourceCodexHome, record.codexHome);
    copyCodexConfigFile(sourceCodexHome, record.codexHome);
    this.registry.saveAuthAccount(record);
    const hydrated = this.registry.getAuthAccount(record.accountId) ?? record;
    await this.notifyManagedAccountReady(hydrated);
    return hydrated;
  }

  private async updateManagedAccountIdentity(
    account: StoredAuthAccountRecord,
    accountEmail: string,
    accountLabel: string,
  ): Promise<StoredAuthAccountRecord> {
    if (account.label === accountLabel && normalizeAccountEmail(account.accountEmail) === accountEmail && account.isActive) {
      return account;
    }

    const updated: StoredAuthAccountRecord = {
      ...account,
      label: accountLabel,
      accountEmail,
      isActive: true,
      updatedAt: new Date().toISOString(),
    };

    this.registry.saveAuthAccount(updated);
    const hydrated = this.registry.getAuthAccount(updated.accountId) ?? updated;
    await this.notifyManagedAccountReady(hydrated);
    return hydrated;
  }

  private async cancelPendingSessions(state: AuthAccountRuntimeState): Promise<void> {
    await this.disposeBrowserLoginSession(state, true);
    await this.disposeDeviceLoginSession(state, true);
  }

  private async disposeBrowserLoginSession(state: AuthAccountRuntimeState, cancel: boolean): Promise<void> {
    const pending = state.pendingBrowserLogin;

    if (!pending) {
      return;
    }

    state.pendingBrowserLogin = null;

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

  private async disposeDeviceLoginSession(state: AuthAccountRuntimeState, cancel: boolean): Promise<void> {
    const pending = state.pendingDeviceLogin;

    if (!pending) {
      return;
    }

    state.pendingDeviceLogin = null;
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

  private getPendingLoginSnapshot(state: AuthAccountRuntimeState): CodexPendingLogin | null {
    if (state.pendingBrowserLogin) {
      const { session: _session, ...pending } = state.pendingBrowserLogin;
      return pending;
    }

    if (state.pendingDeviceLogin) {
      const { process: _process, canceled: _canceled, outputChunks: _outputChunks, ...pending } = state.pendingDeviceLogin;
      return pending;
    }

    return null;
  }

  private async spawnDeviceLoginSession(account: StoredAuthAccountRecord): Promise<PendingDeviceLoginSession> {
    const child = spawn(resolveCodexCliBinary(), [...buildCodexCliConfigArgs(this.buildAccountConfigOverrides()), "login", "--device-auth"], {
      cwd: this.workingDirectory,
      env: this.buildAccountEnv(account),
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
          void this.withLock(async () => this.handleDeviceLoginProcessExit(account, session, code, signal));
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
    account: StoredAuthAccountRecord,
    session: PendingDeviceLoginSession,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    const state = this.getAccountState(account.accountId);
    const status = await safeReadAuthStatus(this.workingDirectory, {
      env: this.buildAccountEnv(account),
      configOverrides: this.buildAccountConfigOverrides(),
    });

    if (status?.authenticated) {
      if (state.pendingDeviceLogin === session) {
        state.pendingDeviceLogin = null;
      }

      state.lastError = null;
      return;
    }

    if (state.pendingDeviceLogin === session) {
      state.pendingDeviceLogin = null;
    }

    if (session.canceled) {
      return;
    }

    state.lastError = buildProcessFailureMessage(
      "codex login --device-auth",
      code,
      signal,
      session.outputChunks.join(""),
    );
  }

  private getAccountState(accountId: string): AuthAccountRuntimeState {
    const existing = this.accountStates.get(accountId);

    if (existing) {
      return existing;
    }

    const created: AuthAccountRuntimeState = {
      pendingBrowserLogin: null,
      pendingDeviceLogin: null,
      lastError: null,
    };

    this.accountStates.set(accountId, created);
    return created;
  }

  private resolveAccountRecord(accountId?: string): StoredAuthAccountRecord {
    ensureAuthAccountBootstrap(this.workingDirectory, this.registry);

    if (typeof accountId === "string" && accountId.trim()) {
      const explicit = this.registry.getAuthAccount(accountId.trim());

      if (!explicit) {
        throw new Error(`认证账号 ${accountId.trim()} 不存在。`);
      }

      return explicit;
    }

    const active = this.registry.getActiveAuthAccount();

    if (active) {
      return active;
    }

    return ensureAuthAccountBootstrap(this.workingDirectory, this.registry);
  }

  private buildAccountEnv(account: StoredAuthAccountRecord): Record<string, string> {
    ensureAuthAccountCodexHome(this.workingDirectory, account.codexHome);
    return buildCodexProcessEnv(account.codexHome);
  }

  private buildAccountConfigOverrides(): CodexCliConfigOverrides {
    return createCodexAuthStorageConfigOverrides();
  }

  private isVisibleAccountRecord(record: StoredAuthAccountRecord): boolean {
    return !this.isDefaultSourceAccountRecord(record);
  }

  private isDefaultSourceAccountRecord(record: StoredAuthAccountRecord): boolean {
    return record.accountId === "default"
      && record.codexHome === resolveDefaultCodexHome();
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.operationChain.then(operation, operation);
    this.operationChain = task.then(() => undefined, () => undefined);
    return await task;
  }

  private async notifyManagedAccountReady(account: StoredAuthAccountRecord): Promise<void> {
    await this.onManagedAccountReady?.(account);
  }
}

interface RunCodexCommandOptions {
  stdinText?: string;
  env?: Record<string, string>;
  configOverrides?: CodexCliConfigOverrides;
}

async function runCodexCommand(
  cwd: string,
  args: string[],
  options: RunCodexCommandOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(resolveCodexCliBinary(), [...buildCodexCliConfigArgs(options.configOverrides), ...args], {
      cwd,
      ...(options.env ? { env: options.env } : {}),
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

async function safeReadAuthStatus(
  workingDirectory: string,
  options: {
    env?: Record<string, string>;
    configOverrides?: CodexCliConfigOverrides;
  } = {},
): Promise<CodexAuthStatus | null> {
  try {
    return await readCodexAuthStatus(workingDirectory, {
      ...(options.env ? { env: options.env } : {}),
      ...(options.configOverrides ? { configOverrides: options.configOverrides } : {}),
    });
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

function normalizeAccountEmail(value: unknown): string | null {
  const normalized = normalizeOptionalText(value);
  return normalized ? normalized.toLowerCase() : null;
}

function matchFirst(value: string, pattern: RegExp): string | null {
  const match = value.match(pattern);
  return normalizeOptionalText(match?.[1] ?? match?.[0]);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
