import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export interface CodexRuntimeReasoningOption {
  reasoningEffort: string;
  description: string;
}

export interface CodexRuntimeModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: CodexRuntimeReasoningOption[];
  defaultReasoningEffort: string | null;
  supportsPersonality: boolean;
  isDefault: boolean;
}

export interface CodexRuntimeDefaults {
  model: string | null;
  reasoning: string | null;
  approvalPolicy: string | null;
}

export interface CodexRuntimeCatalog {
  models: CodexRuntimeModel[];
  defaults: CodexRuntimeDefaults;
}

interface JsonRpcSuccess<TResult> {
  id: number;
  result: TResult;
}

interface JsonRpcFailure {
  id: number;
  error: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

type JsonRpcResponse<TResult> = JsonRpcSuccess<TResult> | JsonRpcFailure;

interface AppServerModelListResponse {
  data?: unknown;
}

interface AppServerConfigReadResponse {
  config?: Record<string, unknown>;
}

interface PendingRequest<TResult> {
  resolve: (value: TResult) => void;
  reject: (error: Error) => void;
}

const DEFAULT_REASONING_OPTIONS: CodexRuntimeReasoningOption[] = [
  { reasoningEffort: "low", description: "low" },
  { reasoningEffort: "medium", description: "medium" },
  { reasoningEffort: "high", description: "high" },
  { reasoningEffort: "xhigh", description: "xhigh" },
];

export async function readCodexRuntimeCatalog(cwd: string): Promise<CodexRuntimeCatalog> {
  const session = new CodexAppServerSession(cwd);

  try {
    await session.initialize();

    const [modelList, configRead] = await Promise.all([
      session.request<AppServerModelListResponse>("model/list", {
        limit: 100,
        includeHidden: true,
      }),
      session.request<AppServerConfigReadResponse>("config/read", {
        includeLayers: false,
        cwd,
      }),
    ]);

    const defaults = normalizeRuntimeDefaults(configRead);
    const models = normalizeRuntimeModels(modelList, defaults);

    return {
      models,
      defaults: {
        model: defaults.model ?? models.find((model) => model.isDefault)?.model ?? models[0]?.model ?? null,
        reasoning: defaults.reasoning,
        approvalPolicy: defaults.approvalPolicy,
      },
    };
  } finally {
    await session.close();
  }
}

class CodexAppServerSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest<unknown>>();
  private readonly stderrChunks: string[] = [];
  private nextId = 1;
  private closed = false;

  constructor(cwd: string) {
    this.child = spawn(resolveCodexBinary(), ["app-server"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");

    const output = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });

    output.on("line", (line) => {
      this.handleOutputLine(line);
    });

    this.child.stderr.on("data", (chunk: string) => {
      this.stderrChunks.push(chunk);
    });

    this.child.on("error", (error) => {
      this.rejectAll(error);
    });

    this.child.on("close", (code, signal) => {
      this.closed = true;

      if (!this.pending.size) {
        return;
      }

      const stderrText = this.stderrChunks.join("").trim();
      const message = stderrText || `codex app-server exited unexpectedly (code: ${code ?? "unknown"}, signal: ${signal ?? "none"}).`;
      this.rejectAll(new Error(message));
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: {
        name: "themis-webui",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: false,
      },
    });
  }

  async request<TResult>(method: string, params: unknown): Promise<TResult> {
    if (this.closed) {
      throw new Error("codex app-server is not available.");
    }

    const id = this.nextId;
    this.nextId += 1;

    const payload = JSON.stringify({
      method,
      id,
      params,
    });

    return await new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as PendingRequest<unknown>["resolve"],
        reject,
      });

      this.child.stdin.write(`${payload}\n`, "utf8", (error) => {
        if (!error) {
          return;
        }

        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    const waitForClose = new Promise<void>((resolve) => {
      this.child.once("close", () => {
        resolve();
      });
    });

    this.child.kill("SIGTERM");

    await Promise.race([
      waitForClose,
      new Promise<void>((resolve) => {
        setTimeout(resolve, 500);
      }),
    ]);

    if (!this.closed) {
      this.child.kill("SIGKILL");
      await waitForClose;
    }
  }

  private handleOutputLine(line: string): void {
    const trimmed = line.trim();

    if (!trimmed) {
      return;
    }

    let parsed: JsonRpcResponse<unknown>;

    try {
      parsed = JSON.parse(trimmed) as JsonRpcResponse<unknown>;
    } catch {
      return;
    }

    if (typeof parsed.id !== "number") {
      return;
    }

    const pending = this.pending.get(parsed.id);

    if (!pending) {
      return;
    }

    this.pending.delete(parsed.id);

    if ("error" in parsed) {
      const message = parsed.error?.message?.trim() || `codex app-server request failed: ${parsed.id}`;
      pending.reject(new Error(message));
      return;
    }

    pending.resolve(parsed.result);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}

function normalizeRuntimeDefaults(response: AppServerConfigReadResponse): CodexRuntimeDefaults {
  const config = isRecord(response.config) ? response.config : {};

  return {
    model: normalizeOptionalText(config.model),
    reasoning: normalizeOptionalText(config.model_reasoning_effort),
    approvalPolicy: normalizeOptionalText(config.approval_policy),
  };
}

function normalizeRuntimeModels(
  response: AppServerModelListResponse,
  defaults: CodexRuntimeDefaults,
): CodexRuntimeModel[] {
  const data = Array.isArray(response.data) ? response.data : [];
  const models = data
    .map(normalizeRuntimeModel)
    .filter((model): model is CodexRuntimeModel => model !== null);
  const configuredModel = defaults.model;

  if (configuredModel && !models.some((model) => model.model === configuredModel)) {
    models.unshift(createSyntheticConfiguredModel(configuredModel, defaults.reasoning));
  }

  return models;
}

function normalizeRuntimeModel(value: unknown): CodexRuntimeModel | null {
  if (!isRecord(value)) {
    return null;
  }

  const model = normalizeOptionalText(value.model) ?? normalizeOptionalText(value.id);

  if (!model) {
    return null;
  }

  return {
    id: normalizeOptionalText(value.id) ?? model,
    model,
    displayName: normalizeOptionalText(value.displayName) ?? model,
    description: normalizeOptionalText(value.description) ?? "",
    hidden: Boolean(value.hidden),
    supportedReasoningEfforts: normalizeReasoningOptions(value.supportedReasoningEfforts),
    defaultReasoningEffort: normalizeOptionalText(value.defaultReasoningEffort),
    supportsPersonality: Boolean(value.supportsPersonality),
    isDefault: Boolean(value.isDefault),
  };
}

function normalizeReasoningOptions(value: unknown): CodexRuntimeReasoningOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const reasoningEffort = normalizeOptionalText(entry.reasoningEffort);

      if (!reasoningEffort) {
        return null;
      }

      return {
        reasoningEffort,
        description: normalizeOptionalText(entry.description) ?? reasoningEffort,
      };
    })
    .filter((entry): entry is CodexRuntimeReasoningOption => entry !== null);
}

function createSyntheticConfiguredModel(model: string, reasoning: string | null): CodexRuntimeModel {
  return {
    id: model,
    model,
    displayName: model,
    description: "当前 Codex 配置使用的模型，没有出现在默认 picker 列表中。",
    hidden: false,
    supportedReasoningEfforts: [...DEFAULT_REASONING_OPTIONS],
    defaultReasoningEffort: reasoning,
    supportsPersonality: false,
    isDefault: false,
  };
}

function resolveCodexBinary(): string {
  const localBinary = fileURLToPath(
    new URL(`../../node_modules/.bin/${process.platform === "win32" ? "codex.cmd" : "codex"}`, import.meta.url),
  );

  if (existsSync(localBinary)) {
    return localBinary;
  }

  return process.platform === "win32" ? "codex.cmd" : "codex";
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
