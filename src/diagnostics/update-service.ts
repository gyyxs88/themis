import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  ApplyThemisUpdateResult,
  RollbackThemisUpdateResult,
  ThemisLastUpdateRecord,
  ThemisUpdateProgressEvent,
  ThemisUpdateRestartPlan,
} from "./update-apply.js";
import {
  applyThemisUpdate,
  readThemisLastUpdateRecord,
  requestDetachedThemisUpdateRestart,
  resolveThemisUpdateRestartPlan,
  rollbackThemisUpdate,
} from "./update-apply.js";
import { checkThemisUpdates, formatShortCommitHash, type ThemisUpdateCheckResult } from "./update-check.js";

const UPDATE_OPERATION_RELATIVE_PATH = "infra/local/themis-update-operation.json";

export type ThemisManagedUpdateAction = "apply" | "rollback";

export interface ThemisManagedUpdateInitiator {
  channel: "web" | "feishu" | "cli";
  channelUserId: string;
  displayName?: string | null;
  chatId?: string | null;
}

export interface ThemisManagedUpdateResult {
  outcome: "updated" | "already_up_to_date" | "rolled_back";
  summary: string;
  branch: string;
  previousCommit: string;
  currentCommit: string;
  targetCommit: string | null;
  updateChannel: "branch" | "release" | null;
  appliedReleaseTag: string | null;
  rolledBackReleaseTag: string | null;
  buildMetadataUpdated: boolean;
  restartStatus: "requested" | "skipped" | "failed";
  serviceUnit: string | null;
  restartErrorMessage: string | null;
}

export interface ThemisManagedUpdateOperationState {
  action: ThemisManagedUpdateAction;
  status: "running" | "completed" | "failed";
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  initiatedBy: ThemisManagedUpdateInitiator;
  progressStep: ThemisUpdateProgressEvent["step"] | null;
  progressMessage: string | null;
  result: ThemisManagedUpdateResult | null;
  errorMessage: string | null;
}

export interface ThemisManagedUpdateOverview {
  check: ThemisUpdateCheckResult;
  operation: ThemisManagedUpdateOperationState | null;
  rollbackAnchor: {
    available: boolean;
    previousCommit: string | null;
    currentCommit: string | null;
    appliedReleaseTag: string | null;
    recordedAt: string | null;
  };
}

interface StartManagedUpdateProcessOptions {
  action: ThemisManagedUpdateAction;
  initiatedBy: ThemisManagedUpdateInitiator;
  serviceUnitOverride?: string | null;
  skipRestart?: boolean;
}

interface RunManagedUpdateWorkerOptions extends StartManagedUpdateProcessOptions {
  workingDirectory: string;
  env?: NodeJS.ProcessEnv;
  applyImpl?: (input: {
    workingDirectory: string;
    env?: NodeJS.ProcessEnv;
    serviceUnitOverride?: string | null;
    skipRestart?: boolean;
    onProgress?: (event: ThemisUpdateProgressEvent) => void;
  }) => Promise<ApplyThemisUpdateResult>;
  rollbackImpl?: (input: {
    workingDirectory: string;
    env?: NodeJS.ProcessEnv;
    serviceUnitOverride?: string | null;
    skipRestart?: boolean;
    onProgress?: (event: ThemisUpdateProgressEvent) => void;
  }) => Promise<RollbackThemisUpdateResult>;
  requestRestartImpl?: (
    plan: ThemisUpdateRestartPlan,
    input: {
      workingDirectory: string;
      env?: NodeJS.ProcessEnv;
    },
  ) => Promise<void>;
}

interface ThemisUpdateServiceOptions {
  workingDirectory: string;
  env?: NodeJS.ProcessEnv;
  cliPath?: string;
  spawnWorkerProcess?: (
    cliPath: string,
    args: string[],
    options: {
      workingDirectory: string;
      env: NodeJS.ProcessEnv;
    },
  ) => Promise<void>;
}

export class ThemisUpdateService {
  private readonly workingDirectory: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly cliPath: string;
  private readonly spawnWorkerProcess: NonNullable<ThemisUpdateServiceOptions["spawnWorkerProcess"]>;

  constructor(options: ThemisUpdateServiceOptions) {
    this.workingDirectory = options.workingDirectory;
    this.env = options.env ?? process.env;
    this.cliPath = options.cliPath ?? resolve(this.workingDirectory, "themis");
    this.spawnWorkerProcess = options.spawnWorkerProcess ?? spawnDetachedWorkerProcess;
  }

  async readOverview(): Promise<ThemisManagedUpdateOverview> {
    const rollbackAnchor = readThemisLastUpdateRecord(this.workingDirectory);

    return {
      check: await checkThemisUpdates({
        workingDirectory: this.workingDirectory,
        env: this.env,
      }),
      operation: readThemisManagedUpdateOperation(this.workingDirectory),
      rollbackAnchor: {
        available: Boolean(rollbackAnchor),
        previousCommit: rollbackAnchor?.previousCommit ?? null,
        currentCommit: rollbackAnchor?.currentCommit ?? null,
        appliedReleaseTag: rollbackAnchor?.appliedReleaseTag ?? null,
        recordedAt: rollbackAnchor?.recordedAt ?? null,
      },
    };
  }

  async startApply(input: Omit<StartManagedUpdateProcessOptions, "action">): Promise<ThemisManagedUpdateOperationState> {
    return this.startOperation({
      action: "apply",
      ...input,
    });
  }

  async startRollback(input: Omit<StartManagedUpdateProcessOptions, "action">): Promise<ThemisManagedUpdateOperationState> {
    return this.startOperation({
      action: "rollback",
      ...input,
    });
  }

  private async startOperation(input: StartManagedUpdateProcessOptions): Promise<ThemisManagedUpdateOperationState> {
    const current = readThemisManagedUpdateOperation(this.workingDirectory);

    if (current?.status === "running") {
      throw new Error("已有后台升级流程在运行；请稍后刷新状态，或等待当前流程结束。");
    }

    const startedAt = new Date().toISOString();
    const operation: ThemisManagedUpdateOperationState = {
      action: input.action,
      status: "running",
      startedAt,
      updatedAt: startedAt,
      finishedAt: null,
      initiatedBy: normalizeInitiator(input.initiatedBy),
      progressStep: "preflight",
      progressMessage: input.action === "apply"
        ? "已受理后台升级请求，正在准备执行。"
        : "已受理后台回滚请求，正在准备执行。",
      result: null,
      errorMessage: null,
    };

    writeThemisManagedUpdateOperation(this.workingDirectory, operation);

    const args = [
      "update",
      "worker",
      input.action,
      "--channel",
      operation.initiatedBy.channel,
      "--user",
      operation.initiatedBy.channelUserId,
    ];

    if (operation.initiatedBy.displayName) {
      args.push("--name", operation.initiatedBy.displayName);
    }

    if (operation.initiatedBy.chatId) {
      args.push("--chat", operation.initiatedBy.chatId);
    }

    if (input.serviceUnitOverride?.trim()) {
      args.push("--service", input.serviceUnitOverride.trim());
    }

    if (input.skipRestart) {
      args.push("--no-restart");
    }

    try {
      await this.spawnWorkerProcess(this.cliPath, args, {
        workingDirectory: this.workingDirectory,
        env: this.env,
      });
      return operation;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = {
        ...operation,
        status: "failed" as const,
        updatedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        progressMessage: "后台升级 worker 启动失败。",
        errorMessage: message,
      };
      writeThemisManagedUpdateOperation(this.workingDirectory, failed);
      throw new Error(`启动后台更新流程失败：${message}`);
    }
  }
}

export async function runManagedThemisUpdateWorker(
  input: RunManagedUpdateWorkerOptions,
): Promise<ThemisManagedUpdateOperationState> {
  const env = input.env ?? process.env;
  const applyImpl = input.applyImpl ?? applyThemisUpdate;
  const rollbackImpl = input.rollbackImpl ?? rollbackThemisUpdate;
  const requestRestartImpl = input.requestRestartImpl ?? requestDetachedThemisUpdateRestart;
  const startedAt = new Date().toISOString();
  const initiatedBy = normalizeInitiator(input.initiatedBy);

  const baseState: ThemisManagedUpdateOperationState = {
    action: input.action,
    status: "running",
    startedAt,
    updatedAt: startedAt,
    finishedAt: null,
    initiatedBy,
    progressStep: "preflight",
    progressMessage: input.action === "apply"
      ? "后台升级 worker 已启动。"
      : "后台回滚 worker 已启动。",
    result: null,
    errorMessage: null,
  };
  writeThemisManagedUpdateOperation(input.workingDirectory, baseState);

    const writeProgress = (event: ThemisUpdateProgressEvent): void => {
    writeThemisManagedUpdateOperation(input.workingDirectory, {
      ...readThemisManagedUpdateOperation(input.workingDirectory) ?? baseState,
      action: input.action,
      status: "running",
      startedAt,
      updatedAt: new Date().toISOString(),
      finishedAt: null,
      initiatedBy,
      progressStep: event.step,
      progressMessage: event.message,
      result: null,
      errorMessage: null,
    });
  };

    try {
      const restartPlan = resolveThemisUpdateRestartPlan({
        workingDirectory: input.workingDirectory,
        env,
        ...(input.serviceUnitOverride !== undefined ? { serviceUnitOverride: input.serviceUnitOverride } : {}),
        ...(input.skipRestart !== undefined ? { skipRestart: input.skipRestart } : {}),
      });

      if (input.action === "apply") {
        const result = await applyImpl({
          workingDirectory: input.workingDirectory,
          env,
          skipRestart: true,
          onProgress: writeProgress,
          ...(input.serviceUnitOverride !== undefined ? { serviceUnitOverride: input.serviceUnitOverride } : {}),
        });
      const completed = buildCompletedOperationStateFromApply({
        baseState,
        result,
        restartPlan,
      });
      writeThemisManagedUpdateOperation(input.workingDirectory, completed);
      return await finalizeManagedUpdateRestart({
        workingDirectory: input.workingDirectory,
        env,
        state: completed,
        restartPlan,
        requestRestartImpl,
      });
    }

    const result = await rollbackImpl({
      workingDirectory: input.workingDirectory,
      env,
      skipRestart: true,
      onProgress: writeProgress,
      ...(input.serviceUnitOverride !== undefined ? { serviceUnitOverride: input.serviceUnitOverride } : {}),
    });
    const completed = buildCompletedOperationStateFromRollback({
      baseState,
      result,
      restartPlan,
    });
    writeThemisManagedUpdateOperation(input.workingDirectory, completed);
    return await finalizeManagedUpdateRestart({
      workingDirectory: input.workingDirectory,
      env,
      state: completed,
      restartPlan,
      requestRestartImpl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed: ThemisManagedUpdateOperationState = {
      ...(readThemisManagedUpdateOperation(input.workingDirectory) ?? baseState),
      action: input.action,
      status: "failed",
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      initiatedBy,
      errorMessage: message,
      progressMessage: input.action === "apply"
        ? "后台升级失败。"
        : "后台回滚失败。",
      result: null,
    };
    writeThemisManagedUpdateOperation(input.workingDirectory, failed);
    return failed;
  }
}

export function readThemisManagedUpdateOperation(
  workingDirectory: string,
): ThemisManagedUpdateOperationState | null {
  const filePath = resolve(workingDirectory, UPDATE_OPERATION_RELATIVE_PATH);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<ThemisManagedUpdateOperationState>;
    const action = parsed.action === "rollback" ? "rollback" : parsed.action === "apply" ? "apply" : null;
    const status = parsed.status === "running" || parsed.status === "completed" || parsed.status === "failed"
      ? parsed.status
      : null;
    const initiatedBy = normalizeOptionalInitiator(parsed.initiatedBy);

    if (!action || !status || !initiatedBy || typeof parsed.startedAt !== "string" || typeof parsed.updatedAt !== "string") {
      return null;
    }

    return {
      action,
      status,
      startedAt: parsed.startedAt,
      updatedAt: parsed.updatedAt,
      finishedAt: typeof parsed.finishedAt === "string" ? parsed.finishedAt : null,
      initiatedBy,
      progressStep: normalizeProgressStep(parsed.progressStep),
      progressMessage: typeof parsed.progressMessage === "string" ? parsed.progressMessage : null,
      result: normalizeManagedUpdateResult(parsed.result),
      errorMessage: typeof parsed.errorMessage === "string" ? parsed.errorMessage : null,
    };
  } catch {
    return null;
  }
}

function writeThemisManagedUpdateOperation(
  workingDirectory: string,
  operation: ThemisManagedUpdateOperationState,
): void {
  const filePath = resolve(workingDirectory, UPDATE_OPERATION_RELATIVE_PATH);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(operation, null, 2)}\n`, "utf8");
}

async function finalizeManagedUpdateRestart(input: {
  workingDirectory: string;
  env: NodeJS.ProcessEnv;
  state: ThemisManagedUpdateOperationState;
  restartPlan: ThemisUpdateRestartPlan;
  requestRestartImpl: NonNullable<RunManagedUpdateWorkerOptions["requestRestartImpl"]>;
}): Promise<ThemisManagedUpdateOperationState> {
  if (input.restartPlan.mode !== "restart") {
    return input.state;
  }

  try {
    await input.requestRestartImpl(input.restartPlan, {
      workingDirectory: input.workingDirectory,
      env: input.env,
    });
    return input.state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const nextState: ThemisManagedUpdateOperationState = {
      ...input.state,
      updatedAt: new Date().toISOString(),
      progressStep: "restart",
      progressMessage: `版本切换已完成，但请求重启 ${input.restartPlan.serviceUnit} 失败。`,
      result: input.state.result
        ? {
          ...input.state.result,
          summary: `版本切换已完成，但请求重启 ${input.restartPlan.serviceUnit} 失败：${message}`,
          restartStatus: "failed",
          restartErrorMessage: message,
        }
        : null,
    };
    writeThemisManagedUpdateOperation(input.workingDirectory, nextState);
    return nextState;
  }
}

function buildCompletedOperationStateFromApply(input: {
  baseState: ThemisManagedUpdateOperationState;
  result: ApplyThemisUpdateResult;
  restartPlan: ThemisUpdateRestartPlan;
}): ThemisManagedUpdateOperationState {
  const finishedAt = new Date().toISOString();
  const summary = input.result.outcome === "already_up_to_date"
    ? input.result.appliedReleaseTag
      ? `当前已经是最新正式 release（${input.result.appliedReleaseTag}）。`
      : "当前已经是最新版本，无需升级。"
    : `升级完成：${formatShortCommitHash(input.result.previousCommit)} -> ${formatShortCommitHash(input.result.currentCommit)}。`;

  return {
    ...input.baseState,
    status: "completed",
    updatedAt: finishedAt,
    finishedAt,
    progressStep: "done",
    progressMessage: appendRestartPlanSummary(summary, input.restartPlan),
    result: {
      outcome: input.result.outcome,
      summary: appendRestartPlanSummary(summary, input.restartPlan),
      branch: input.result.branch,
      previousCommit: input.result.previousCommit,
      currentCommit: input.result.currentCommit,
      targetCommit: input.result.targetCommit,
      updateChannel: input.result.updateChannel,
      appliedReleaseTag: input.result.appliedReleaseTag,
      rolledBackReleaseTag: null,
      buildMetadataUpdated: input.result.buildMetadataUpdated,
      restartStatus: mapRestartPlanToResultStatus(input.restartPlan),
      serviceUnit: input.restartPlan.serviceUnit,
      restartErrorMessage: null,
    },
    errorMessage: null,
  };
}

function buildCompletedOperationStateFromRollback(input: {
  baseState: ThemisManagedUpdateOperationState;
  result: RollbackThemisUpdateResult;
  restartPlan: ThemisUpdateRestartPlan;
}): ThemisManagedUpdateOperationState {
  const finishedAt = new Date().toISOString();
  const summary = `回滚完成：${formatShortCommitHash(input.result.previousCommit)} -> ${formatShortCommitHash(input.result.currentCommit)}。`;

  return {
    ...input.baseState,
    status: "completed",
    updatedAt: finishedAt,
    finishedAt,
    progressStep: "done",
    progressMessage: appendRestartPlanSummary(summary, input.restartPlan),
    result: {
      outcome: "rolled_back",
      summary: appendRestartPlanSummary(summary, input.restartPlan),
      branch: input.result.branch,
      previousCommit: input.result.previousCommit,
      currentCommit: input.result.currentCommit,
      targetCommit: null,
      updateChannel: null,
      appliedReleaseTag: null,
      rolledBackReleaseTag: input.result.rolledBackReleaseTag,
      buildMetadataUpdated: input.result.buildMetadataUpdated,
      restartStatus: mapRestartPlanToResultStatus(input.restartPlan),
      serviceUnit: input.restartPlan.serviceUnit,
      restartErrorMessage: null,
    },
    errorMessage: null,
  };
}

function appendRestartPlanSummary(summary: string, restartPlan: ThemisUpdateRestartPlan): string {
  if (restartPlan.mode === "restart" && restartPlan.serviceUnit) {
    return `${summary} 已请求重启 ${restartPlan.serviceUnit}。`;
  }

  if (restartPlan.mode === "missing_default") {
    return `${summary} 当前未检测到默认 systemd 服务，未自动重启。`;
  }

  if (restartPlan.mode === "skip") {
    return `${summary} 已按请求跳过自动重启。`;
  }

  return summary;
}

function mapRestartPlanToResultStatus(
  restartPlan: ThemisUpdateRestartPlan,
): ThemisManagedUpdateResult["restartStatus"] {
  return restartPlan.mode === "restart" ? "requested" : "skipped";
}

function normalizeManagedUpdateResult(value: unknown): ThemisManagedUpdateResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const outcome = value.outcome === "updated" || value.outcome === "already_up_to_date" || value.outcome === "rolled_back"
    ? value.outcome
    : null;
  const restartStatus = value.restartStatus === "requested" || value.restartStatus === "skipped" || value.restartStatus === "failed"
    ? value.restartStatus
    : null;
  const updateChannel = value.updateChannel === "branch" || value.updateChannel === "release"
    ? value.updateChannel
    : value.updateChannel === null
      ? null
      : null;

  if (
    !outcome
    || !restartStatus
    || typeof value.summary !== "string"
    || typeof value.branch !== "string"
    || typeof value.previousCommit !== "string"
    || typeof value.currentCommit !== "string"
  ) {
    return null;
  }

  return {
    outcome,
    summary: value.summary,
    branch: value.branch,
    previousCommit: value.previousCommit,
    currentCommit: value.currentCommit,
    targetCommit: typeof value.targetCommit === "string" ? value.targetCommit : null,
    updateChannel,
    appliedReleaseTag: typeof value.appliedReleaseTag === "string" ? value.appliedReleaseTag : null,
    rolledBackReleaseTag: typeof value.rolledBackReleaseTag === "string" ? value.rolledBackReleaseTag : null,
    buildMetadataUpdated: value.buildMetadataUpdated === true,
    restartStatus,
    serviceUnit: typeof value.serviceUnit === "string" ? value.serviceUnit : null,
    restartErrorMessage: typeof value.restartErrorMessage === "string" ? value.restartErrorMessage : null,
  };
}

function normalizeOptionalInitiator(value: unknown): ThemisManagedUpdateInitiator | null {
  if (!isRecord(value)) {
    return null;
  }

  const channel = value.channel === "web" || value.channel === "feishu" || value.channel === "cli"
    ? value.channel
    : null;
  const channelUserId = normalizeText(value.channelUserId);

  if (!channel || !channelUserId) {
    return null;
  }

  return {
    channel,
    channelUserId,
    displayName: normalizeText(value.displayName) ?? null,
    chatId: normalizeText(value.chatId) ?? null,
  };
}

function normalizeInitiator(input: ThemisManagedUpdateInitiator): ThemisManagedUpdateInitiator {
  return {
    channel: input.channel,
    channelUserId: input.channelUserId.trim(),
    displayName: normalizeText(input.displayName) ?? null,
    chatId: normalizeText(input.chatId) ?? null,
  };
}

function normalizeProgressStep(value: unknown): ThemisUpdateProgressEvent["step"] | null {
  return value === "preflight"
    || value === "fetch"
    || value === "pull"
    || value === "install"
    || value === "build"
    || value === "write_build_metadata"
    || value === "record"
    || value === "restart"
    || value === "done"
    ? value
    : null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function spawnDetachedWorkerProcess(
  cliPath: string,
  args: string[],
  options: {
    workingDirectory: string;
    env: NodeJS.ProcessEnv;
  },
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cliPath, args, {
      cwd: options.workingDirectory,
      env: options.env,
      detached: true,
      stdio: "ignore",
    });

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}
