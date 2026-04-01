import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { WebAccessService } from "../core/web-access.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

export interface WebSmokeResult {
  ok: boolean;
  baseUrl: string;
  sessionId: string | null;
  requestId: string | null;
  taskId: string | null;
  actionId: string | null;
  observedActionRequired: boolean;
  observedCompleted: boolean;
  historyCompleted: boolean;
  message: string;
}

export interface FeishuSmokeResult {
  ok: boolean;
  serviceReachable: boolean;
  feishuConfigReady: boolean;
  nextSteps: string[];
  docPath: string;
  message: string;
}

export interface AllSmokeResult {
  ok: boolean;
  web: WebSmokeResult;
  feishu: FeishuSmokeResult | null;
  message: string;
}

export interface RuntimeSmokeServiceOptions {
  workingDirectory: string;
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  clock?: () => number | Date;
  randomHex?: (bytes: number) => string;
  registryFactory?: (databaseFile: string) => SqliteCodexSessionRegistry;
}

interface SmokeStreamLine {
  kind?: string;
  title?: string;
  requestId?: string;
  taskId?: string;
  metadata?: {
    actionId?: string;
    actionType?: string;
    structuredOutput?: {
      status?: string;
    };
  };
  result?: {
    status?: string;
  };
}

const WEB_SMOKE_PROMPT = `你接下来要继续做当前仓库里的一个具体修改任务，但我现在先不告诉你“要改哪个文件”。

要求：
1. 不要猜文件名。
2. 不要直接给方案。
3. 如果缺少继续执行所必需的信息，必须通过系统补充输入请求向我提问，而不是直接结束任务。
4. 你现在只允许向我索要一个信息：要修改的文件路径。
5. 当我回复文件路径后，你只需确认“已收到路径”，然后结束本轮，不要继续分析代码，不要继续提出新的问题。`;

const FEISHU_DOC_PATH = "docs/feishu/themis-feishu-real-journey-smoke.md";

export class RuntimeSmokeService {
  private readonly workingDirectory: string;
  private readonly baseUrl: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => number;
  private readonly randomHex: (bytes: number) => string;
  private readonly registryFactory: (databaseFile: string) => SqliteCodexSessionRegistry;

  constructor(options: RuntimeSmokeServiceOptions) {
    this.workingDirectory = options.workingDirectory;
    this.env = options.env ?? process.env;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? this.env.THEMIS_BASE_URL ?? "http://127.0.0.1:3100");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.clock = () => normalizeClockMillis(options.clock ?? (() => Date.now()));
    this.randomHex = options.randomHex ?? ((bytes) => randomBytes(bytes).toString("hex"));
    this.registryFactory = options.registryFactory ?? ((databaseFile) => new SqliteCodexSessionRegistry({ databaseFile }));
  }

  async runWebSmoke(): Promise<WebSmokeResult> {
    const startedAt = this.clock();
    const databaseFile = join(this.workingDirectory, "infra/local/themis.db");
    const registry = this.registryFactory(databaseFile);
    const webAccess = new WebAccessService({ registry });
    const tokenLabel = `runtime-smoke-web-${startedAt.toString(36)}-${this.randomHex(4)}`;
    const tokenSecret = this.randomHex(12);
    const sessionId = `runtime-smoke-web-session-${startedAt.toString(36)}-${this.randomHex(3)}`;
    const requestId = `runtime-smoke-web-request-${startedAt.toString(36)}-${this.randomHex(3)}`;
    const taskId = `runtime-smoke-web-task-${startedAt.toString(36)}-${this.randomHex(3)}`;
    let actionId: string | null = null;
    let observedActionRequired = false;
    let observedCompleted = false;
    let historyCompleted = false;

    try {
      webAccess.createToken({
        label: tokenLabel,
        secret: tokenSecret,
        remoteIp: "127.0.0.1",
      });

      const cookie = await loginAndReadCookie(this.baseUrl, tokenSecret, this.fetchImpl);
      const streamResponse = await this.fetchImpl(`${this.baseUrl}/api/tasks/stream`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId,
          taskId,
          sessionId,
          goal: WEB_SMOKE_PROMPT,
          options: {
            runtimeEngine: "app-server",
          },
        }),
      });

      if (streamResponse.status !== 200 || !streamResponse.body) {
        return this.failureResult(
          sessionId,
          requestId,
          taskId,
          actionId,
          observedActionRequired,
          observedCompleted,
          historyCompleted,
          `Web smoke 请求未进入 200/stream：status=${streamResponse.status}`,
        );
      }

      const reader = createNdjsonStreamReader(streamResponse.body);
      let partialLines: SmokeStreamLine[];

      try {
        partialLines = await withTimeout(
          reader.readUntil((lines) => lines.some((line) => line.kind === "event" && line.title === "task.action_required")),
          120_000,
          "真实 Web task 没有进入 task.action_required",
        );
      } catch {
        return this.failureResult(
          sessionId,
          requestId,
          taskId,
          actionId,
          false,
          false,
          false,
          "真实 Web task 没有进入 task.action_required。",
        );
      }
      const actionRequiredLine = partialLines.find(
        (line) => line.kind === "event" && line.title === "task.action_required",
      ) as SmokeStreamLine | undefined;

      if (!actionRequiredLine) {
        return this.failureResult(
          sessionId,
          requestId,
          taskId,
          actionId,
          false,
          false,
          false,
          "真实 Web task 没有进入 task.action_required。",
        );
      }

      observedActionRequired = true;
      actionId = readActionId(actionRequiredLine);

      if (!actionId) {
        return this.failureResult(
          sessionId,
          requestId,
          taskId,
          actionId,
          observedActionRequired,
          false,
          false,
          "真实 Web task 已进入 task.action_required，但事件里缺少 actionId。",
        );
      }

      const actionSubmitResponse = await this.fetchImpl(`${this.baseUrl}/api/tasks/actions`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskId: actionRequiredLine.taskId ?? taskId,
          requestId: actionRequiredLine.requestId ?? requestId,
          actionId,
          inputText: "src/core/app-server-task-runtime.ts",
        }),
      });

      if (actionSubmitResponse.status !== 200) {
        return this.failureResult(
          sessionId,
          requestId,
          taskId,
          actionId,
          observedActionRequired,
          false,
          false,
          `真实 Web task 提交 action 失败：status=${actionSubmitResponse.status}`,
        );
      }

      const remainingLines = await withTimeout(
        reader.readAll(),
        120_000,
        "真实 Web task 在提交补充输入后没有正常收口",
      );
      const ndjson = [...partialLines, ...remainingLines];
      const resultLine = ndjson.find((line) => line.kind === "result") as SmokeStreamLine | undefined;
      const doneLine = [...ndjson].reverse().find((line) => line.kind === "done") as SmokeStreamLine | undefined;
      observedCompleted = isCompletedResultLine(resultLine) || doneLine?.result?.status === "completed";

      if (!observedCompleted) {
        return this.failureResult(
          sessionId,
          requestId,
          taskId,
          actionId,
          observedActionRequired,
          observedCompleted,
          false,
          "真实 Web task 的 stream 没有收口为 completed。",
        );
      }

      const historyDetail = await waitForHistoryTurnStatus(
        this.baseUrl,
        cookie,
        sessionId,
        "completed",
        this.fetchImpl,
        120_000,
      );
      historyCompleted = historyDetail.turns?.some((turn) => turn.status === "completed") ?? false;

      if (!historyCompleted) {
        return this.failureResult(
          sessionId,
          requestId,
          taskId,
          actionId,
          observedActionRequired,
          observedCompleted,
          historyCompleted,
          "真实 Web task 的 history/detail 没有收口为 completed。",
        );
      }

      return {
        ok: true,
        baseUrl: this.baseUrl,
        sessionId,
        requestId,
        taskId,
        actionId,
        observedActionRequired,
        observedCompleted,
        historyCompleted,
        message: "Web smoke 成功：真实链路已进入 task.action_required，并在 action 提交后收口为 completed。",
      };
    } catch (error) {
      return this.failureResult(
        sessionId,
        requestId,
        taskId,
        actionId,
        observedActionRequired,
        observedCompleted,
        historyCompleted,
        toErrorMessage(error),
      );
    } finally {
      try {
        webAccess.revokeTokenByLabel({
          label: tokenLabel,
          remoteIp: "127.0.0.1",
        });
      } catch {
        // 临时 token 清理失败不覆盖 smoke 主结果。
      }
    }
  }

  async runFeishuSmoke(): Promise<FeishuSmokeResult> {
    const feishuAppId = normalizeText(this.env.FEISHU_APP_ID);
    const feishuAppSecret = normalizeText(this.env.FEISHU_APP_SECRET);
    const feishuConfigReady = Boolean(feishuAppId && feishuAppSecret);
    const serviceReachable = await isServiceReachable(this.baseUrl, this.fetchImpl);
    const nextSteps = [
      "先在真实飞书里执行 `/msgupdate`，确认机器人基础消息更新能力。",
      "再在 Web 新会话里执行 `/smoke user-input`，确认 A 路径可接力。",
      "最后在 Web 新会话里执行 `/smoke mixed`，确认 B 路径可接力。",
    ];

    if (!feishuConfigReady) {
      return {
        ok: false,
        serviceReachable,
        feishuConfigReady,
        nextSteps,
        docPath: FEISHU_DOC_PATH,
        message: "FEISHU_APP_ID / FEISHU_APP_SECRET 未配置，先补齐再做飞书 smoke 手工接力。",
      };
    }

    if (!serviceReachable) {
      return {
        ok: false,
        serviceReachable,
        feishuConfigReady,
        nextSteps,
        docPath: FEISHU_DOC_PATH,
        message: `Themis 服务当前不可达，先确认 ${this.baseUrl} 可访问后再做飞书 smoke。`,
      };
    }

    return {
      ok: true,
      serviceReachable,
      feishuConfigReady,
      nextSteps,
      docPath: FEISHU_DOC_PATH,
      message: "Feishu smoke 前置检查通过，后续请按手工接力步骤继续。",
    };
  }

  async runAllSmoke(): Promise<AllSmokeResult> {
    const web = await this.runWebSmoke();

    if (!web.ok) {
      return {
        ok: false,
        web,
        feishu: null,
        message: web.message,
      };
    }

    const feishu = await this.runFeishuSmoke();

    return {
      ok: feishu.ok,
      web,
      feishu,
      message: feishu.ok ? "Web smoke 与 Feishu smoke 前置检查都已通过。" : feishu.message,
    };
  }

  private failureResult(
    sessionId: string | null,
    requestId: string | null,
    taskId: string | null,
    actionId: string | null,
    observedActionRequired: boolean,
    observedCompleted: boolean,
    historyCompleted: boolean,
    message: string,
  ): WebSmokeResult {
    return {
      ok: false,
      baseUrl: this.baseUrl,
      sessionId,
      requestId,
      taskId,
      actionId,
      observedActionRequired,
      observedCompleted,
      historyCompleted,
      message,
    };
  }
}

async function loginAndReadCookie(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const response = await fetchImpl(`${baseUrl}/api/web-auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token,
    }),
  });

  if (response.status !== 200) {
    throw new Error(`Web 登录失败：status=${response.status}`);
  }

  const setCookie = response.headers.get("set-cookie");

  if (!setCookie) {
    throw new Error("Web 登录响应缺少 set-cookie。");
  }

  return extractCookie(setCookie, "themis_web_session");
}

function extractCookie(setCookieHeader: string, name: string): string {
  const prefix = `${name}=`;

  for (const part of setCookieHeader.split(/, (?=[^;]+=)/)) {
    const cookie = part.split(";", 1)[0]?.trim();

    if (cookie?.startsWith(prefix)) {
      return cookie;
    }
  }

  throw new Error(`Missing cookie ${name}.`);
}

async function isServiceReachable(baseUrl: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(`${baseUrl}/api/health`, {
      method: "HEAD",
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHistoryTurnStatus(
  baseUrl: string,
  cookie: string,
  sessionId: string,
  expectedStatus: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{
  turns?: Array<{
    status?: string;
  }>;
}> {
  const startedAt = Date.now();

  while (true) {
    const response = await fetchImpl(`${baseUrl}/api/history/sessions/${encodeURIComponent(sessionId)}`, {
      headers: {
        Cookie: cookie,
      },
    });

    if (response.status !== 200) {
      throw new Error(`history detail status=${response.status}`);
    }

    const payload = await response.json() as {
      turns?: Array<{
        status?: string;
      }>;
    };

    if (payload.turns?.some((turn) => turn.status === expectedStatus)) {
      return payload;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`history turn did not reach status ${expectedStatus}`);
    }

    await sleep(500);
  }
}

function createNdjsonStreamReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const lines: SmokeStreamLine[] = [];

  async function drainUntil(
    predicate: (lines: SmokeStreamLine[]) => boolean,
    stopAtEnd: boolean,
  ): Promise<SmokeStreamLine[]> {
    while (true) {
      if (predicate(lines)) {
        return [...lines];
      }

      const { value, done } = await reader.read();

      if (done) {
        const trailing = buffer.trim();

        if (trailing) {
          lines.push(JSON.parse(trailing) as SmokeStreamLine);
          buffer = "";

          if (predicate(lines)) {
            return [...lines];
          }
        }

        if (stopAtEnd) {
          return [...lines];
        }

        throw new Error("NDJSON stream ended before predicate matched.");
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        const trimmed = chunk.trim();

        if (!trimmed) {
          continue;
        }

        lines.push(JSON.parse(trimmed) as SmokeStreamLine);
      }

      if (predicate(lines)) {
        return [...lines];
      }
    }
  }

  return {
    readUntil: async (predicate: (lines: SmokeStreamLine[]) => boolean) => await drainUntil(predicate, false),
    readAll: async () => {
      const consumedBefore = lines.length;
      const all = await drainUntil(() => false, true);
      return all.slice(consumedBefore);
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function isCompletedResultLine(line: SmokeStreamLine | undefined): boolean {
  return line?.metadata?.structuredOutput?.status === "completed";
}

function readActionId(line: SmokeStreamLine): string | null {
  const actionId = normalizeText(line.metadata?.actionId);
  return actionId ?? null;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function normalizeText(value: string | undefined | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeClockMillis(clock: () => number | Date): number {
  const value = clock();

  if (typeof value === "number") {
    return value;
  }

  return value.getTime();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
