import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WebAccessService } from "../core/web-access.js";
import { readFeishuDiagnosticsSnapshot } from "./feishu-diagnostics.js";
import { buildFeishuSmokeNextSteps } from "./feishu-verification-guide.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskInputEnvelope } from "../types/index.js";

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
  imageCompileVerified: boolean;
  imageCompileDegradationLevel: string | null;
  documentCompileVerified: boolean;
  documentCompileDegradationLevel: string | null;
  message: string;
}

export interface FeishuSmokeResult {
  ok: boolean;
  serviceReachable: boolean;
  statusCode: number | null;
  diagnosisId: string;
  diagnosisSummary: string;
  feishuConfigReady: boolean;
  sessionBindingCount: number;
  attachmentDraftCount: number;
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

interface SmokeHistoryTurnDetail {
  requestId?: string;
  status?: string;
  input?: {
    compileSummary?: {
      runtimeTarget?: string;
      degradationLevel?: string;
      warnings?: Array<{
        code?: string;
        message?: string;
        assetId?: string;
      }>;
    };
  };
}

interface WebActionRequiredSmokeTaskResult {
  actionId: string;
  observedActionRequired: boolean;
  observedCompleted: boolean;
  historyCompleted: boolean;
  historyDetail: {
    turns?: SmokeHistoryTurnDetail[];
  };
}

class WebActionRequiredSmokeTaskError extends Error {
  readonly state: {
    actionId: string | null;
    observedActionRequired: boolean;
    observedCompleted: boolean;
    historyCompleted: boolean;
  };

  constructor(
    message: string,
    state: {
      actionId: string | null;
      observedActionRequired: boolean;
      observedCompleted: boolean;
      historyCompleted: boolean;
    },
  ) {
    super(message);
    this.name = "WebActionRequiredSmokeTaskError";
    this.state = state;
  }
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
    const documentSessionId = `runtime-smoke-web-doc-session-${startedAt.toString(36)}-${this.randomHex(3)}`;
    const documentRequestId = `runtime-smoke-web-doc-request-${startedAt.toString(36)}-${this.randomHex(3)}`;
    const documentTaskId = `runtime-smoke-web-doc-task-${startedAt.toString(36)}-${this.randomHex(3)}`;
    let actionId: string | null = null;
    let observedActionRequired = false;
    let observedCompleted = false;
    let historyCompleted = false;
    let imageCompileVerified = false;
    let imageCompileDegradationLevel: string | null = null;
    let documentCompileVerified = false;
    let documentCompileDegradationLevel: string | null = null;
    const assetBundle = createWebSmokeInputAssetBundle(this.workingDirectory, startedAt, this.randomHex);

    try {
      webAccess.createToken({
        label: tokenLabel,
        secret: tokenSecret,
        remoteIp: "127.0.0.1",
      });

      const cookie = await loginAndReadCookie(this.baseUrl, tokenSecret, this.fetchImpl);
      const imageSmoke = await this.runWebActionRequiredSmokeTask({
        cookie,
        sessionId,
        requestId,
        taskId,
        inputEnvelope: createWebSmokeImageEnvelope(assetBundle.imagePath, startedAt),
      });
      actionId = imageSmoke.actionId;
      observedActionRequired = imageSmoke.observedActionRequired;
      observedCompleted = imageSmoke.observedCompleted;
      historyCompleted = imageSmoke.historyCompleted;

      const imageCompileSummary = readTurnCompileSummary(imageSmoke.historyDetail, requestId);
      imageCompileDegradationLevel = imageCompileSummary?.degradationLevel ?? null;
      imageCompileVerified = imageCompileSummary?.runtimeTarget === "app-server"
        && imageCompileSummary.degradationLevel === "native";

      if (!imageCompileVerified) {
        return this.failureResult(
          sessionId,
          requestId,
          taskId,
          actionId,
          observedActionRequired,
          observedCompleted,
          historyCompleted,
          imageCompileVerified,
          imageCompileDegradationLevel,
          documentCompileVerified,
          documentCompileDegradationLevel,
          "真实 Web 图片 smoke 已收口，但 history/detail 没有写出 app-server native compile summary。",
        );
      }

      const documentSmoke = await this.runWebActionRequiredSmokeTask({
        cookie,
        sessionId: documentSessionId,
        requestId: documentRequestId,
        taskId: documentTaskId,
        inputEnvelope: createWebSmokeDocumentEnvelope(assetBundle.documentPath, startedAt),
      });
      const documentCompileSummary = readTurnCompileSummary(documentSmoke.historyDetail, documentRequestId);
      documentCompileDegradationLevel = documentCompileSummary?.degradationLevel ?? null;
      documentCompileVerified = documentCompileSummary?.runtimeTarget === "app-server"
        && documentCompileSummary.degradationLevel === "controlled_fallback";

      if (!documentCompileVerified) {
        return this.failureResult(
          sessionId,
          requestId,
          taskId,
          actionId,
          observedActionRequired,
          observedCompleted,
          historyCompleted,
          imageCompileVerified,
          imageCompileDegradationLevel,
          documentCompileVerified,
          documentCompileDegradationLevel,
          "真实 Web 文档 smoke 已收口，但 history/detail 没有写出 app-server controlled_fallback compile summary。",
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
        imageCompileVerified,
        imageCompileDegradationLevel,
        documentCompileVerified,
        documentCompileDegradationLevel,
        message: "Web smoke 成功：真实图片 native smoke 与文档 fallback smoke 都已完成，history/detail compile summary 也符合预期。",
      };
    } catch (error) {
      if (error instanceof WebActionRequiredSmokeTaskError) {
        actionId = error.state.actionId;
        observedActionRequired = error.state.observedActionRequired;
        observedCompleted = error.state.observedCompleted;
        historyCompleted = error.state.historyCompleted;
      }

      return this.failureResult(
        sessionId,
        requestId,
        taskId,
        actionId,
        observedActionRequired,
        observedCompleted,
        historyCompleted,
        imageCompileVerified,
        imageCompileDegradationLevel,
        documentCompileVerified,
        documentCompileDegradationLevel,
        toErrorMessage(error),
      );
    } finally {
      assetBundle.cleanup();
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
    const snapshotEnv: NodeJS.ProcessEnv = {
      FEISHU_APP_ID: this.env.FEISHU_APP_ID,
      FEISHU_APP_SECRET: this.env.FEISHU_APP_SECRET,
    };
    const snapshot = await readFeishuDiagnosticsSnapshot({
      workingDirectory: this.workingDirectory,
      env: snapshotEnv,
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
    });
    const primaryDiagnosis = snapshot.diagnostics.primaryDiagnosis ?? {
      id: "healthy",
      severity: "info",
      title: "当前未发现明显阻塞",
      summary: "飞书配置、服务可达性和最近窗口摘要看起来正常，继续按固定复跑顺序验证即可。",
    };
    const feishuConfigReady = snapshot.env.appIdConfigured && snapshot.env.appSecretConfigured;
    const nextSteps = buildFeishuSmokeNextSteps();

    if (!feishuConfigReady) {
      return {
        ok: false,
        serviceReachable: snapshot.service.serviceReachable,
        statusCode: snapshot.service.statusCode,
        diagnosisId: primaryDiagnosis.id,
        diagnosisSummary: primaryDiagnosis.summary,
        feishuConfigReady,
        sessionBindingCount: snapshot.state.sessionBindingCount,
        attachmentDraftCount: snapshot.state.attachmentDraftCount,
        nextSteps,
        docPath: FEISHU_DOC_PATH,
        message: "FEISHU_APP_ID / FEISHU_APP_SECRET 未配置，先补齐再做飞书 smoke 手工接力。",
      };
    }

    if (!snapshot.service.serviceReachable) {
      return {
        ok: false,
        serviceReachable: snapshot.service.serviceReachable,
        statusCode: snapshot.service.statusCode,
        diagnosisId: primaryDiagnosis.id,
        diagnosisSummary: primaryDiagnosis.summary,
        feishuConfigReady,
        sessionBindingCount: snapshot.state.sessionBindingCount,
        attachmentDraftCount: snapshot.state.attachmentDraftCount,
        nextSteps,
        docPath: FEISHU_DOC_PATH,
        message: `Themis 服务当前不可达，先确认 ${this.baseUrl} 可访问后再做飞书 smoke。`,
      };
    }

    return {
      ok: true,
      serviceReachable: snapshot.service.serviceReachable,
      statusCode: snapshot.service.statusCode,
      diagnosisId: primaryDiagnosis.id,
      diagnosisSummary: primaryDiagnosis.summary,
      feishuConfigReady,
      sessionBindingCount: snapshot.state.sessionBindingCount,
      attachmentDraftCount: snapshot.state.attachmentDraftCount,
      nextSteps,
      docPath: FEISHU_DOC_PATH,
      message: `Feishu smoke 前置检查通过，主诊断：${primaryDiagnosis.title}。`,
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
    imageCompileVerified: boolean,
    imageCompileDegradationLevel: string | null,
    documentCompileVerified: boolean,
    documentCompileDegradationLevel: string | null,
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
      imageCompileVerified,
      imageCompileDegradationLevel,
      documentCompileVerified,
      documentCompileDegradationLevel,
      message,
    };
  }

  private async runWebActionRequiredSmokeTask(input: {
    cookie: string;
    sessionId: string;
    requestId: string;
    taskId: string;
    inputEnvelope?: TaskInputEnvelope;
  }): Promise<WebActionRequiredSmokeTaskResult> {
    let actionId: string | null = null;
    let observedActionRequired = false;
    let observedCompleted = false;
    let historyCompleted = false;
    const streamResponse = await this.fetchImpl(`${this.baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        Cookie: input.cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: input.requestId,
        taskId: input.taskId,
        sessionId: input.sessionId,
        goal: WEB_SMOKE_PROMPT,
        ...(input.inputEnvelope ? { inputEnvelope: input.inputEnvelope } : {}),
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    if (streamResponse.status !== 200 || !streamResponse.body) {
      throw new Error(`Web smoke 请求未进入 200/stream：status=${streamResponse.status}`);
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
      throw new WebActionRequiredSmokeTaskError("真实 Web task 没有进入 task.action_required。", {
        actionId,
        observedActionRequired,
        observedCompleted,
        historyCompleted,
      });
    }
    const actionRequiredLine = partialLines.find(
      (line) => line.kind === "event" && line.title === "task.action_required",
    );

    if (!actionRequiredLine) {
      throw new WebActionRequiredSmokeTaskError("真实 Web task 没有进入 task.action_required。", {
        actionId,
        observedActionRequired,
        observedCompleted,
        historyCompleted,
      });
    }

    observedActionRequired = true;
    actionId = readActionId(actionRequiredLine);

    if (!actionId) {
      throw new WebActionRequiredSmokeTaskError("真实 Web task 已进入 task.action_required，但事件里缺少 actionId。", {
        actionId,
        observedActionRequired,
        observedCompleted,
        historyCompleted,
      });
    }

    const actionSubmitResponse = await this.fetchImpl(`${this.baseUrl}/api/tasks/actions`, {
      method: "POST",
      headers: {
        Cookie: input.cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskId: actionRequiredLine.taskId ?? input.taskId,
        requestId: actionRequiredLine.requestId ?? input.requestId,
        actionId,
        inputText: "src/core/app-server-task-runtime.ts",
      }),
    });

    if (actionSubmitResponse.status !== 200) {
      throw new WebActionRequiredSmokeTaskError(`真实 Web task 提交 action 失败：status=${actionSubmitResponse.status}`, {
        actionId,
        observedActionRequired,
        observedCompleted,
        historyCompleted,
      });
    }

    let remainingLines: SmokeStreamLine[];

    try {
      remainingLines = await withTimeout(
        reader.readAll(),
        120_000,
        "真实 Web task 在提交补充输入后没有正常收口",
      );
    } catch (error) {
      throw new WebActionRequiredSmokeTaskError(toErrorMessage(error), {
        actionId,
        observedActionRequired,
        observedCompleted,
        historyCompleted,
      });
    }
    const ndjson = [...partialLines, ...remainingLines];
    const resultLine = ndjson.find((line) => line.kind === "result");
    const doneLine = [...ndjson].reverse().find((line) => line.kind === "done");
    observedCompleted = isCompletedResultLine(resultLine) || doneLine?.result?.status === "completed";

    if (!observedCompleted) {
      throw new WebActionRequiredSmokeTaskError("真实 Web task 的 stream 没有收口为 completed。", {
        actionId,
        observedActionRequired,
        observedCompleted,
        historyCompleted,
      });
    }

    let historyDetail: {
      turns?: SmokeHistoryTurnDetail[];
    };

    try {
      historyDetail = await waitForHistoryTurnStatus(
        this.baseUrl,
        input.cookie,
        input.sessionId,
        "completed",
        this.fetchImpl,
        120_000,
      );
    } catch (error) {
      throw new WebActionRequiredSmokeTaskError(toErrorMessage(error), {
        actionId,
        observedActionRequired,
        observedCompleted,
        historyCompleted,
      });
    }
    historyCompleted = historyDetail.turns?.some((turn) => turn.status === "completed") ?? false;

    if (!historyCompleted) {
      throw new WebActionRequiredSmokeTaskError("真实 Web task 的 history/detail 没有收口为 completed。", {
        actionId,
        observedActionRequired,
        observedCompleted,
        historyCompleted,
      });
    }

    return {
      actionId,
      observedActionRequired: true,
      observedCompleted,
      historyCompleted,
      historyDetail,
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

async function waitForHistoryTurnStatus(
  baseUrl: string,
  cookie: string,
  sessionId: string,
  expectedStatus: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{
  turns?: SmokeHistoryTurnDetail[];
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
      turns?: SmokeHistoryTurnDetail[];
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

function createWebSmokeInputAssetBundle(
  workingDirectory: string,
  startedAt: number,
  randomHex: (bytes: number) => string,
): {
  imagePath: string;
  documentPath: string;
  cleanup: () => void;
} {
  const root = join(
    workingDirectory,
    "temp",
    "runtime-smoke-input-assets",
    `${startedAt.toString(36)}-${randomHex(3)}`,
  );
  mkdirSync(root, { recursive: true });
  const imagePath = join(root, "smoke-image.png");
  const documentPath = join(root, "smoke-brief.md");
  writeFileSync(
    imagePath,
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRX0AAAAASUVORK5CYII=", "base64"),
  );
  writeFileSync(documentPath, "# Smoke Brief\n\nThis file verifies app-server document fallback.\n", "utf8");

  return {
    imagePath,
    documentPath,
    cleanup: () => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // smoke 清理失败不覆盖主结果。
      }
    },
  };
}

function createWebSmokeImageEnvelope(imagePath: string, startedAt: number): TaskInputEnvelope {
  const createdAt = new Date(startedAt).toISOString();

  return {
    envelopeId: `runtime-smoke-image-envelope-${startedAt.toString(36)}`,
    sourceChannel: "web",
    parts: [
      {
        partId: "part-image-1",
        type: "image",
        role: "user",
        order: 1,
        assetId: "asset-image-1",
      },
    ],
    assets: [
      {
        assetId: "asset-image-1",
        kind: "image",
        mimeType: "image/png",
        localPath: imagePath,
        sourceChannel: "web",
        ingestionStatus: "ready",
      },
    ],
    createdAt,
  };
}

function createWebSmokeDocumentEnvelope(documentPath: string, startedAt: number): TaskInputEnvelope {
  const createdAt = new Date(startedAt + 1_000).toISOString();

  return {
    envelopeId: `runtime-smoke-document-envelope-${startedAt.toString(36)}`,
    sourceChannel: "web",
    parts: [
      {
        partId: "part-document-1",
        type: "document",
        role: "user",
        order: 1,
        assetId: "asset-document-1",
      },
    ],
    assets: [
      {
        assetId: "asset-document-1",
        kind: "document",
        name: "smoke-brief.md",
        mimeType: "text/markdown",
        localPath: documentPath,
        sourceChannel: "web",
        ingestionStatus: "ready",
      },
    ],
    createdAt,
  };
}

function readTurnCompileSummary(
  historyDetail: { turns?: SmokeHistoryTurnDetail[] },
  requestId: string,
): {
  runtimeTarget: string | null;
  degradationLevel: string | null;
} | null {
  const turn = historyDetail.turns?.find((item) => item.requestId === requestId);
  const compileSummary = turn?.input?.compileSummary;

  if (!compileSummary) {
    return null;
  }

  return {
    runtimeTarget: normalizeText(compileSummary.runtimeTarget),
    degradationLevel: normalizeText(compileSummary.degradationLevel),
  };
}
