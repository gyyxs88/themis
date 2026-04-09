import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileTaskInputForRuntime } from "../core/runtime-input-compiler.js";
import { WebAccessService } from "../core/web-access.js";
import { readFeishuDiagnosticsSnapshot } from "./feishu-diagnostics.js";
import { buildFeishuSmokeNextSteps } from "./feishu-verification-guide.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { RuntimeInputCapabilities, TaskInputEnvelope } from "../types/index.js";
import { resolveThemisBaseUrl } from "./themis-base-url.js";

export interface WebSmokeSharedBoundaryResult {
  ok: boolean;
  imagePathBlockedVerified: boolean;
  imagePathWarningCodes: string[];
  documentPathBlockedVerified: boolean;
  documentPathWarningCodes: string[];
  textNativeBlockedVerified: boolean;
  textNativeWarningCodes: string[];
  imageNativeBlockedVerified: boolean;
  imageNativeWarningCodes: string[];
  documentMimeNativeVerified: boolean;
  documentMimeNativeWarningCodes: string[];
  documentMimeFallbackVerified: boolean;
  documentMimeWarningCodes: string[];
}

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
  imageCompileWarningCodes: string[];
  imageCompileMatrixVerified: boolean;
  imageCompileMatrixImageNative: string | null;
  imageCompileMatrixAssetHandling: string[];
  documentCompileVerified: boolean;
  documentCompileDegradationLevel: string | null;
  documentCompileWarningCodes: string[];
  documentCompileMatrixVerified: boolean;
  documentCompileMatrixDocumentNative: string | null;
  documentCompileMatrixAssetHandling: string[];
  sharedBoundary: WebSmokeSharedBoundaryResult;
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

export interface RuntimeSmokeProgressEvent {
  scope: "web" | "feishu";
  step: string;
  message: string;
}

export interface RuntimeSmokeRunOptions {
  onProgress?: (event: RuntimeSmokeProgressEvent) => void;
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
      capabilityMatrix?: {
        transportCapabilities?: {
          nativeImageInput?: boolean;
          nativeDocumentInput?: boolean;
        };
        effectiveCapabilities?: {
          nativeImageInput?: boolean;
          nativeDocumentInput?: boolean;
        };
        assetFacts?: Array<{
          kind?: string;
          handling?: string;
        }>;
      };
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
const WEB_SMOKE_USER_ID = "themis-probe";

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
    this.baseUrl = normalizeBaseUrl(resolveThemisBaseUrl(this.env, options.baseUrl));
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.clock = () => normalizeClockMillis(options.clock ?? (() => Date.now()));
    this.randomHex = options.randomHex ?? ((bytes) => randomBytes(bytes).toString("hex"));
    this.registryFactory = options.registryFactory ?? ((databaseFile) => new SqliteCodexSessionRegistry({ databaseFile }));
  }

  async runWebSmoke(runOptions: RuntimeSmokeRunOptions = {}): Promise<WebSmokeResult> {
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
    let imageCompileWarningCodes: string[] = [];
    let imageCompileMatrixVerified = false;
    let imageCompileMatrixImageNative: string | null = null;
    let imageCompileMatrixAssetHandling: string[] = [];
    let documentCompileVerified = false;
    let documentCompileDegradationLevel: string | null = null;
    let documentCompileWarningCodes: string[] = [];
    let documentCompileMatrixVerified = false;
    let documentCompileMatrixDocumentNative: string | null = null;
    let documentCompileMatrixAssetHandling: string[] = [];
    let sharedBoundary = createEmptyWebSmokeSharedBoundaryResult();
    const assetBundle = createWebSmokeInputAssetBundle(this.workingDirectory, startedAt, this.randomHex);

    try {
      emitSmokeProgress(runOptions, {
        scope: "web",
        step: "login.start",
        message: "Web 登录：创建临时访问令牌并登录...",
      });
      webAccess.createToken({
        label: tokenLabel,
        secret: tokenSecret,
        remoteIp: "127.0.0.1",
      });

      const cookie = await loginAndReadCookie(this.baseUrl, tokenSecret, this.fetchImpl);
      emitSmokeProgress(runOptions, {
        scope: "web",
        step: "login.done",
        message: "Web 登录：已获取会话 cookie。",
      });
      emitSmokeProgress(runOptions, {
        scope: "web",
        step: "image.start",
        message: "图片 native smoke：开始真实任务链路验证...",
      });
      const imageSmoke = await this.runWebActionRequiredSmokeTask({
        cookie,
        sessionId,
        requestId,
        taskId,
        inputEnvelope: createWebSmokeImageEnvelope(assetBundle.imagePath, startedAt),
        progressLabel: "图片 native smoke",
        progressStepPrefix: "image",
        onProgress: runOptions.onProgress,
      });
      actionId = imageSmoke.actionId;
      observedActionRequired = imageSmoke.observedActionRequired;
      observedCompleted = imageSmoke.observedCompleted;
      historyCompleted = imageSmoke.historyCompleted;

      const imageCompileSummary = readTurnCompileSummary(imageSmoke.historyDetail, requestId);
      imageCompileDegradationLevel = imageCompileSummary?.degradationLevel ?? null;
      imageCompileWarningCodes = imageCompileSummary?.warningCodes ?? [];
      imageCompileMatrixImageNative = formatSmokeCapabilityNativeSupport(imageCompileSummary?.capabilityMatrix ?? null, "image");
      imageCompileMatrixAssetHandling = readSmokeCapabilityAssetHandling(imageCompileSummary?.capabilityMatrix ?? null, "image");
      imageCompileVerified = imageCompileSummary?.runtimeTarget === "app-server"
        && imageCompileSummary.degradationLevel === "native";
      imageCompileMatrixVerified = imageCompileSummary?.capabilityMatrix?.transportCapabilities?.nativeImageInput === true
        && imageCompileSummary.capabilityMatrix.effectiveCapabilities?.nativeImageInput === true
        && imageCompileMatrixAssetHandling.includes("native");

      if (!imageCompileVerified) {
        emitSmokeProgress(runOptions, {
          scope: "web",
          step: "failed",
          message: "Web smoke 失败：图片 native compile summary 校验未通过。",
        });
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
          imageCompileWarningCodes,
          imageCompileMatrixVerified,
          imageCompileMatrixImageNative,
          imageCompileMatrixAssetHandling,
          documentCompileVerified,
          documentCompileDegradationLevel,
          documentCompileWarningCodes,
          documentCompileMatrixVerified,
          documentCompileMatrixDocumentNative,
          documentCompileMatrixAssetHandling,
          sharedBoundary,
          "真实 Web 图片 smoke 已收口，但 history/detail 没有写出 app-server native compile summary。",
        );
      }

      if (!imageCompileMatrixVerified) {
        emitSmokeProgress(runOptions, {
          scope: "web",
          step: "failed",
          message: "Web smoke 失败：图片 native 能力矩阵校验未通过。",
        });
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
          imageCompileWarningCodes,
          imageCompileMatrixVerified,
          imageCompileMatrixImageNative,
          imageCompileMatrixAssetHandling,
          documentCompileVerified,
          documentCompileDegradationLevel,
          documentCompileWarningCodes,
          documentCompileMatrixVerified,
          documentCompileMatrixDocumentNative,
          documentCompileMatrixAssetHandling,
          sharedBoundary,
          "真实 Web 图片 smoke 已收口，但 history/detail 没有写出 transport/effective 都支持且 asset handling=native 的能力矩阵事实。",
        );
      }

      emitSmokeProgress(runOptions, {
        scope: "web",
        step: "image.verified",
        message: "图片 native smoke：compile summary 与能力矩阵校验通过。",
      });
      emitSmokeProgress(runOptions, {
        scope: "web",
        step: "document.start",
        message: "文档 fallback smoke：开始真实任务链路验证...",
      });
      const documentSmoke = await this.runWebActionRequiredSmokeTask({
        cookie,
        sessionId: documentSessionId,
        requestId: documentRequestId,
        taskId: documentTaskId,
        inputEnvelope: createWebSmokeDocumentEnvelope(assetBundle.documentPath, startedAt),
        progressLabel: "文档 fallback smoke",
        progressStepPrefix: "document",
        onProgress: runOptions.onProgress,
      });
      const documentCompileSummary = readTurnCompileSummary(documentSmoke.historyDetail, documentRequestId);
      documentCompileDegradationLevel = documentCompileSummary?.degradationLevel ?? null;
      documentCompileWarningCodes = documentCompileSummary?.warningCodes ?? [];
      documentCompileMatrixDocumentNative = formatSmokeCapabilityNativeSupport(documentCompileSummary?.capabilityMatrix ?? null, "document");
      documentCompileMatrixAssetHandling = readSmokeCapabilityAssetHandling(documentCompileSummary?.capabilityMatrix ?? null, "document");
      documentCompileVerified = documentCompileSummary?.runtimeTarget === "app-server"
        && documentCompileSummary.degradationLevel === "controlled_fallback"
        && documentCompileWarningCodes.includes("DOCUMENT_NATIVE_INPUT_FALLBACK");
      documentCompileMatrixVerified = documentCompileSummary?.capabilityMatrix?.transportCapabilities?.nativeDocumentInput === false
        && documentCompileSummary.capabilityMatrix.effectiveCapabilities?.nativeDocumentInput === false
        && documentCompileMatrixAssetHandling.includes("path_fallback");

      if (!documentCompileVerified) {
        emitSmokeProgress(runOptions, {
          scope: "web",
          step: "failed",
          message: "Web smoke 失败：文档 fallback compile summary 校验未通过。",
        });
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
          imageCompileWarningCodes,
          imageCompileMatrixVerified,
          imageCompileMatrixImageNative,
          imageCompileMatrixAssetHandling,
          documentCompileVerified,
          documentCompileDegradationLevel,
          documentCompileWarningCodes,
          documentCompileMatrixVerified,
          documentCompileMatrixDocumentNative,
          documentCompileMatrixAssetHandling,
          sharedBoundary,
          "真实 Web 文档 smoke 已收口，但 history/detail 没有写出带 DOCUMENT_NATIVE_INPUT_FALLBACK 的 app-server controlled_fallback compile summary。",
        );
      }

      if (!documentCompileMatrixVerified) {
        emitSmokeProgress(runOptions, {
          scope: "web",
          step: "failed",
          message: "Web smoke 失败：文档 fallback 能力矩阵校验未通过。",
        });
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
          imageCompileWarningCodes,
          imageCompileMatrixVerified,
          imageCompileMatrixImageNative,
          imageCompileMatrixAssetHandling,
          documentCompileVerified,
          documentCompileDegradationLevel,
          documentCompileWarningCodes,
          documentCompileMatrixVerified,
          documentCompileMatrixDocumentNative,
          documentCompileMatrixAssetHandling,
          sharedBoundary,
          "真实 Web 文档 smoke 已收口，但 history/detail 没有写出 document transport gap 与 path_fallback 的能力矩阵事实。",
        );
      }

      emitSmokeProgress(runOptions, {
        scope: "web",
        step: "document.verified",
        message: "文档 fallback smoke：compile summary 与能力矩阵校验通过。",
      });
      emitSmokeProgress(runOptions, {
        scope: "web",
        step: "shared_boundary.start",
        message: "共享边界 smoke：开始本地 compile 边界校验...",
      });
      sharedBoundary = runWebSmokeSharedBoundaryChecks(assetBundle, startedAt);
      const sharedBoundaryFailure = describeWebSmokeSharedBoundaryFailure(sharedBoundary);

      if (sharedBoundaryFailure) {
        emitSmokeProgress(runOptions, {
          scope: "web",
          step: "failed",
          message: `Web smoke 失败：${sharedBoundaryFailure}`,
        });
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
          imageCompileWarningCodes,
          imageCompileMatrixVerified,
          imageCompileMatrixImageNative,
          imageCompileMatrixAssetHandling,
          documentCompileVerified,
          documentCompileDegradationLevel,
          documentCompileWarningCodes,
          documentCompileMatrixVerified,
          documentCompileMatrixDocumentNative,
          documentCompileMatrixAssetHandling,
          sharedBoundary,
          sharedBoundaryFailure,
        );
      }

      emitSmokeProgress(runOptions, {
        scope: "web",
        step: "shared_boundary.verified",
        message: "共享边界 smoke：边界校验通过。",
      });
      emitSmokeProgress(runOptions, {
        scope: "web",
        step: "completed",
        message: "Web smoke：全部检查通过。",
      });
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
        imageCompileWarningCodes,
        imageCompileMatrixVerified,
        imageCompileMatrixImageNative,
        imageCompileMatrixAssetHandling,
        documentCompileVerified,
        documentCompileDegradationLevel,
        documentCompileWarningCodes,
        documentCompileMatrixVerified,
        documentCompileMatrixDocumentNative,
        documentCompileMatrixAssetHandling,
        sharedBoundary,
        message: "Web smoke 成功：真实图片 native smoke、文档 fallback smoke，以及共享附件异常 / MIME 边界 compile smoke 都符合预期。",
      };
    } catch (error) {
      if (error instanceof WebActionRequiredSmokeTaskError) {
        actionId = error.state.actionId;
        observedActionRequired = error.state.observedActionRequired;
        observedCompleted = error.state.observedCompleted;
        historyCompleted = error.state.historyCompleted;
      }

      emitSmokeProgress(runOptions, {
        scope: "web",
        step: "failed",
        message: `Web smoke 失败：${toErrorMessage(error)}`,
      });
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
        imageCompileWarningCodes,
        imageCompileMatrixVerified,
        imageCompileMatrixImageNative,
        imageCompileMatrixAssetHandling,
        documentCompileVerified,
        documentCompileDegradationLevel,
        documentCompileWarningCodes,
        documentCompileMatrixVerified,
        documentCompileMatrixDocumentNative,
        documentCompileMatrixAssetHandling,
        sharedBoundary,
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

  async runFeishuSmoke(runOptions: RuntimeSmokeRunOptions = {}): Promise<FeishuSmokeResult> {
    emitSmokeProgress(runOptions, {
      scope: "feishu",
      step: "start",
      message: "飞书 smoke：读取前置诊断快照...",
    });
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
      emitSmokeProgress(runOptions, {
        scope: "feishu",
        step: "failed",
        message: "飞书 smoke：前置检查失败，缺少 FEISHU_APP_ID / FEISHU_APP_SECRET。",
      });
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
      emitSmokeProgress(runOptions, {
        scope: "feishu",
        step: "failed",
        message: `飞书 smoke：前置检查失败，${this.baseUrl} 当前不可达。`,
      });
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

    emitSmokeProgress(runOptions, {
      scope: "feishu",
      step: "completed",
      message: "飞书 smoke：前置检查通过。",
    });
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

  async runAllSmoke(runOptions: RuntimeSmokeRunOptions = {}): Promise<AllSmokeResult> {
    const web = await this.runWebSmoke(runOptions);

    if (!web.ok) {
      return {
        ok: false,
        web,
        feishu: null,
        message: web.message,
      };
    }

    const feishu = await this.runFeishuSmoke(runOptions);

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
    imageCompileWarningCodes: string[],
    imageCompileMatrixVerified: boolean,
    imageCompileMatrixImageNative: string | null,
    imageCompileMatrixAssetHandling: string[],
    documentCompileVerified: boolean,
    documentCompileDegradationLevel: string | null,
    documentCompileWarningCodes: string[],
    documentCompileMatrixVerified: boolean,
    documentCompileMatrixDocumentNative: string | null,
    documentCompileMatrixAssetHandling: string[],
    sharedBoundary: WebSmokeSharedBoundaryResult,
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
      imageCompileWarningCodes,
      imageCompileMatrixVerified,
      imageCompileMatrixImageNative,
      imageCompileMatrixAssetHandling,
      documentCompileVerified,
      documentCompileDegradationLevel,
      documentCompileWarningCodes,
      documentCompileMatrixVerified,
      documentCompileMatrixDocumentNative,
      documentCompileMatrixAssetHandling,
      sharedBoundary,
      message,
    };
  }

  private async runWebActionRequiredSmokeTask(input: {
    cookie: string;
    sessionId: string;
    requestId: string;
    taskId: string;
    inputEnvelope?: TaskInputEnvelope;
    progressLabel: string;
    progressStepPrefix: string;
    onProgress: ((event: RuntimeSmokeProgressEvent) => void) | undefined;
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
        userId: WEB_SMOKE_USER_ID,
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

    emitSmokeProgressHandler(input.onProgress, {
      scope: "web",
      step: `${input.progressStepPrefix}.await_action_required`,
      message: `${input.progressLabel}：等待 task.action_required...`,
    });

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

    emitSmokeProgressHandler(input.onProgress, {
      scope: "web",
      step: `${input.progressStepPrefix}.action_required`,
      message: `${input.progressLabel}：已收到 actionId=${actionId}，提交补充输入...`,
    });
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

    emitSmokeProgressHandler(input.onProgress, {
      scope: "web",
      step: `${input.progressStepPrefix}.action_submitted`,
      message: `${input.progressLabel}：补充输入已提交，等待 stream completed...`,
    });
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

    emitSmokeProgressHandler(input.onProgress, {
      scope: "web",
      step: `${input.progressStepPrefix}.stream_completed`,
      message: `${input.progressLabel}：stream 已 completed，等待 history/detail completed...`,
    });
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

    emitSmokeProgressHandler(input.onProgress, {
      scope: "web",
      step: `${input.progressStepPrefix}.history_completed`,
      message: `${input.progressLabel}：history/detail 已 completed。`,
    });
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

function emitSmokeProgress(
  options: RuntimeSmokeRunOptions,
  event: RuntimeSmokeProgressEvent,
): void {
  options.onProgress?.(event);
}

function emitSmokeProgressHandler(
  onProgress: RuntimeSmokeRunOptions["onProgress"],
  event: RuntimeSmokeProgressEvent,
): void {
  onProgress?.(event);
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

function createWebSmokeTextEnvelope(text: string, startedAt: number): TaskInputEnvelope {
  const createdAt = new Date(startedAt).toISOString();

  return {
    envelopeId: `runtime-smoke-text-envelope-${startedAt.toString(36)}`,
    sourceChannel: "web",
    parts: [
      {
        partId: "part-text-1",
        type: "text",
        role: "user",
        order: 1,
        text,
      },
    ],
    assets: [],
    createdAt,
  };
}

function createWebSmokeDocumentEnvelope(documentPath: string, startedAt: number): TaskInputEnvelope {
  return createWebSmokeDocumentEnvelopeWithAsset(documentPath, startedAt, {
    name: "smoke-brief.md",
    mimeType: "text/markdown",
  });
}

function createWebSmokeDocumentEnvelopeWithAsset(
  documentPath: string,
  startedAt: number,
  asset: {
    name: string;
    mimeType: string;
  },
): TaskInputEnvelope {
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
        name: asset.name,
        mimeType: asset.mimeType,
        localPath: documentPath,
        sourceChannel: "web",
        ingestionStatus: "ready",
      },
    ],
    createdAt,
  };
}

function createEmptyWebSmokeSharedBoundaryResult(): WebSmokeSharedBoundaryResult {
  return {
    ok: false,
    imagePathBlockedVerified: false,
    imagePathWarningCodes: [],
    documentPathBlockedVerified: false,
    documentPathWarningCodes: [],
    textNativeBlockedVerified: false,
    textNativeWarningCodes: [],
    imageNativeBlockedVerified: false,
    imageNativeWarningCodes: [],
    documentMimeNativeVerified: false,
    documentMimeNativeWarningCodes: [],
    documentMimeFallbackVerified: false,
    documentMimeWarningCodes: [],
  };
}

function runWebSmokeSharedBoundaryChecks(
  assetBundle: {
    imagePath: string;
    documentPath: string;
  },
  startedAt: number,
): WebSmokeSharedBoundaryResult {
  const imagePathCompiled = compileTaskInputForRuntime({
    envelope: createWebSmokeImageEnvelope(`${assetBundle.imagePath}.missing`, startedAt + 2_000),
    target: {
      runtimeId: "shared-boundary-image-path",
      capabilities: createWebSmokeAppServerCapabilities(),
    },
  });
  const imagePathWarningCodes = readCompiledWarningCodes(imagePathCompiled.compileWarnings);
  const imagePathFact = imagePathCompiled.capabilityMatrix.assetFacts.find((fact) => fact.kind === "image");
  const imagePathBlockedVerified = imagePathCompiled.degradationLevel === "blocked"
    && imagePathWarningCodes.includes("IMAGE_PATH_UNAVAILABLE")
    && imagePathFact?.localPathStatus === "unavailable"
    && imagePathFact.handling === "blocked";

  const documentPathCompiled = compileTaskInputForRuntime({
    envelope: createWebSmokeDocumentEnvelope(`${assetBundle.documentPath}.missing`, startedAt + 3_000),
    target: {
      runtimeId: "shared-boundary-document-path",
      capabilities: createWebSmokeAppServerCapabilities(),
    },
  });
  const documentPathWarningCodes = readCompiledWarningCodes(documentPathCompiled.compileWarnings);
  const documentPathFact = documentPathCompiled.capabilityMatrix.assetFacts.find((fact) => fact.kind === "document");
  const documentPathBlockedVerified = documentPathCompiled.degradationLevel === "blocked"
    && documentPathWarningCodes.includes("DOCUMENT_PATH_UNAVAILABLE")
    && documentPathFact?.localPathStatus === "unavailable"
    && documentPathFact.handling === "blocked";

  const textNativeCompiled = compileTaskInputForRuntime({
    envelope: createWebSmokeTextEnvelope("请保留这段文本输入", startedAt + 4_000),
    target: {
      runtimeId: "shared-boundary-text-native",
      capabilities: createTextNativeBoundaryCapabilities(),
      modelCapabilities: createTextNativeBoundaryCapabilities(),
      transportCapabilities: createTextNativeBoundaryCapabilities(),
    },
  });
  const textNativeWarningCodes = readCompiledWarningCodes(textNativeCompiled.compileWarnings);
  const textNativeBlockedVerified = textNativeCompiled.degradationLevel === "blocked"
    && textNativeWarningCodes.includes("TEXT_NATIVE_INPUT_REQUIRED")
    && textNativeCompiled.capabilityMatrix.effectiveCapabilities.nativeTextInput === false;

  const imageNativeCompiled = compileTaskInputForRuntime({
    envelope: createWebSmokeImageEnvelope(assetBundle.imagePath, startedAt + 5_000),
    target: {
      runtimeId: "shared-boundary-image-native",
      capabilities: createImageNativeBoundaryCapabilities(),
      modelCapabilities: createImageNativeBoundaryCapabilities(),
      transportCapabilities: createImageNativeBoundaryCapabilities(),
    },
  });
  const imageNativeWarningCodes = readCompiledWarningCodes(imageNativeCompiled.compileWarnings);
  const imageNativeFact = imageNativeCompiled.capabilityMatrix.assetFacts.find((fact) => fact.kind === "image");
  const imageNativeBlockedVerified = imageNativeCompiled.degradationLevel === "blocked"
    && imageNativeWarningCodes.includes("IMAGE_NATIVE_INPUT_REQUIRED")
    && imageNativeFact?.localPathStatus === "ready"
    && imageNativeFact.handling === "blocked"
    && imageNativeFact.effectiveNativeSupport === false;

  const documentMimeNativeCompiled = compileTaskInputForRuntime({
    envelope: createWebSmokeDocumentEnvelopeWithAsset(assetBundle.documentPath, startedAt + 6_000, {
      name: "smoke-brief-param.md",
      mimeType: "text/markdown; charset=utf-8",
    }),
    target: {
      runtimeId: "shared-boundary-document-mime-native",
      capabilities: createWildcardNativeDocumentMimeBoundaryCapabilities(),
      modelCapabilities: createWildcardNativeDocumentMimeBoundaryCapabilities(),
      transportCapabilities: createWildcardNativeDocumentMimeBoundaryCapabilities(),
    },
  });
  const documentMimeNativeWarningCodes = readCompiledWarningCodes(documentMimeNativeCompiled.compileWarnings);
  const documentMimeNativeFact = documentMimeNativeCompiled.capabilityMatrix.assetFacts.find((fact) => fact.kind === "document");
  const documentMimeNativeVerified = documentMimeNativeCompiled.degradationLevel === "native"
    && documentMimeNativeWarningCodes.length === 0
    && documentMimeNativeFact?.localPathStatus === "ready"
    && documentMimeNativeFact.handling === "native"
    && documentMimeNativeFact.effectiveNativeSupport === true
    && documentMimeNativeFact.effectiveMimeTypeSupported === true;

  const documentMimeCompiled = compileTaskInputForRuntime({
    envelope: createWebSmokeDocumentEnvelopeWithAsset(assetBundle.documentPath, startedAt + 7_000, {
      name: "smoke-sheet.xls",
      mimeType: "application/vnd.ms-excel",
    }),
    target: {
      runtimeId: "shared-boundary-document-mime",
      capabilities: createNativeDocumentMimeBoundaryCapabilities(),
      modelCapabilities: createNativeDocumentMimeBoundaryCapabilities(),
      transportCapabilities: createNativeDocumentMimeBoundaryCapabilities(),
    },
  });
  const documentMimeWarningCodes = readCompiledWarningCodes(documentMimeCompiled.compileWarnings);
  const documentMimeFact = documentMimeCompiled.capabilityMatrix.assetFacts.find((fact) => fact.kind === "document");
  const documentMimeFallbackVerified = documentMimeCompiled.degradationLevel === "controlled_fallback"
    && documentMimeWarningCodes.includes("DOCUMENT_MIME_TYPE_FALLBACK")
    && documentMimeFact?.localPathStatus === "ready"
    && documentMimeFact.handling === "path_fallback"
    && documentMimeFact.effectiveNativeSupport === false
    && documentMimeFact.effectiveMimeTypeSupported === false;

  return {
    ok: imagePathBlockedVerified
      && documentPathBlockedVerified
      && textNativeBlockedVerified
      && imageNativeBlockedVerified
      && documentMimeNativeVerified
      && documentMimeFallbackVerified,
    imagePathBlockedVerified,
    imagePathWarningCodes,
    documentPathBlockedVerified,
    documentPathWarningCodes,
    textNativeBlockedVerified,
    textNativeWarningCodes,
    imageNativeBlockedVerified,
    imageNativeWarningCodes,
    documentMimeNativeVerified,
    documentMimeNativeWarningCodes,
    documentMimeFallbackVerified,
    documentMimeWarningCodes,
  };
}

function createWebSmokeAppServerCapabilities(): RuntimeInputCapabilities {
  return {
    nativeTextInput: true,
    nativeImageInput: true,
    nativeDocumentInput: false,
    supportedDocumentMimeTypes: [],
    supportsPdfTextExtraction: true,
    supportsDocumentPageRasterization: false,
  };
}

function createNativeDocumentMimeBoundaryCapabilities(): RuntimeInputCapabilities {
  return {
    nativeTextInput: true,
    nativeImageInput: true,
    nativeDocumentInput: true,
    supportedDocumentMimeTypes: ["application/pdf"],
    supportsPdfTextExtraction: true,
    supportsDocumentPageRasterization: true,
  };
}

function createWildcardNativeDocumentMimeBoundaryCapabilities(): RuntimeInputCapabilities {
  return {
    nativeTextInput: true,
    nativeImageInput: true,
    nativeDocumentInput: true,
    supportedDocumentMimeTypes: ["text/*"],
    supportsPdfTextExtraction: true,
    supportsDocumentPageRasterization: true,
  };
}

function createTextNativeBoundaryCapabilities(): RuntimeInputCapabilities {
  return {
    nativeTextInput: false,
    nativeImageInput: true,
    nativeDocumentInput: false,
    supportedDocumentMimeTypes: [],
    supportsPdfTextExtraction: true,
    supportsDocumentPageRasterization: false,
  };
}

function createImageNativeBoundaryCapabilities(): RuntimeInputCapabilities {
  return {
    nativeTextInput: true,
    nativeImageInput: false,
    nativeDocumentInput: false,
    supportedDocumentMimeTypes: [],
    supportsPdfTextExtraction: true,
    supportsDocumentPageRasterization: false,
  };
}

function readCompiledWarningCodes(
  warnings: Array<{
    code?: string | null;
  }>,
): string[] {
  return Array.from(new Set(
    warnings
      .map((warning) => normalizeText(warning.code))
      .filter((code): code is string => code !== null),
  ));
}

function describeWebSmokeSharedBoundaryFailure(result: WebSmokeSharedBoundaryResult): string | null {
  if (!result.imagePathBlockedVerified) {
    return "共享多模态边界 smoke 失败：图片缺少本地路径时没有稳定写出 IMAGE_PATH_UNAVAILABLE blocked 事实。";
  }

  if (!result.documentPathBlockedVerified) {
    return "共享多模态边界 smoke 失败：文档缺少本地路径时没有稳定写出 DOCUMENT_PATH_UNAVAILABLE blocked 事实。";
  }

  if (!result.textNativeBlockedVerified) {
    return "共享多模态边界 smoke 失败：文本原生输入不可用时没有稳定写出 TEXT_NATIVE_INPUT_REQUIRED blocked 事实。";
  }

  if (!result.imageNativeBlockedVerified) {
    return "共享多模态边界 smoke 失败：图片原生输入不可用时没有稳定写出 IMAGE_NATIVE_INPUT_REQUIRED blocked 事实。";
  }

  if (!result.documentMimeNativeVerified) {
    return "共享多模态边界 smoke 失败：带参数文档 MIME 在 wildcard 支持下没有稳定命中 native document 事实。";
  }

  if (!result.documentMimeFallbackVerified) {
    return "共享多模态边界 smoke 失败：文档 MIME 不受支持时没有稳定写出 DOCUMENT_MIME_TYPE_FALLBACK controlled_fallback 事实。";
  }

  return null;
}

function readTurnCompileSummary(
  historyDetail: { turns?: SmokeHistoryTurnDetail[] },
  requestId: string,
): {
  runtimeTarget: string | null;
  degradationLevel: string | null;
  warningCodes: string[];
  capabilityMatrix: NonNullable<NonNullable<NonNullable<SmokeHistoryTurnDetail["input"]>["compileSummary"]>["capabilityMatrix"]> | null;
} | null {
  const turn = historyDetail.turns?.find((item) => item.requestId === requestId);
  const compileSummary = turn?.input?.compileSummary;

  if (!compileSummary) {
    return null;
  }

  return {
    runtimeTarget: normalizeText(compileSummary.runtimeTarget),
    degradationLevel: normalizeText(compileSummary.degradationLevel),
    warningCodes: Array.from(new Set(
      (compileSummary.warnings ?? [])
        .map((warning) => normalizeText(warning.code))
        .filter((code): code is string => code !== null),
    )),
    capabilityMatrix: compileSummary.capabilityMatrix ?? null,
  };
}

function formatSmokeCapabilityNativeSupport(
  matrix: NonNullable<ReturnType<typeof readTurnCompileSummary>>["capabilityMatrix"] | null,
  kind: "image" | "document",
): string | null {
  if (!matrix) {
    return null;
  }

  const capabilityKey = kind === "image" ? "nativeImageInput" : "nativeDocumentInput";
  return [
    `transport=${formatSmokeBooleanFlag(matrix.transportCapabilities?.[capabilityKey])}`,
    `effective=${formatSmokeBooleanFlag(matrix.effectiveCapabilities?.[capabilityKey])}`,
  ].join(" ");
}

function readSmokeCapabilityAssetHandling(
  matrix: NonNullable<ReturnType<typeof readTurnCompileSummary>>["capabilityMatrix"] | null,
  kind: "image" | "document",
): string[] {
  if (!matrix?.assetFacts?.length) {
    return [];
  }

  return Array.from(new Set(
    matrix.assetFacts
      .filter((fact) => fact.kind === kind)
      .map((fact) => normalizeText(fact.handling))
      .filter((handling): handling is string => handling !== null),
  ));
}

function formatSmokeBooleanFlag(value: boolean | undefined): string {
  if (value === undefined) {
    return "<unknown>";
  }

  return value ? "yes" : "no";
}
