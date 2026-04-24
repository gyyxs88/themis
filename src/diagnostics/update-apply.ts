import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolvePrimaryProjectEnvFile, setProjectEnvValue } from "../config/project-env.js";
import { resolveThemisUpdateTarget, type ThemisUpdateChannel } from "./update-check.js";

const DEFAULT_UPDATE_REPO = "gyyxs88/themis";
export const DEFAULT_THEMIS_UPDATE_SYSTEMD_SERVICE = "themis-prod.service";
const DEFAULT_UPDATE_SYSTEMD_SERVICE = DEFAULT_THEMIS_UPDATE_SYSTEMD_SERVICE;
const UPDATE_LOCK_RELATIVE_PATH = "infra/local/themis-update.lock";
const LAST_UPDATE_RECORD_RELATIVE_PATH = "infra/local/themis-last-update.json";

export interface ThemisUpdateProgressEvent {
  step:
    | "preflight"
    | "fetch"
    | "pull"
    | "install"
    | "build"
    | "write_build_metadata"
    | "record"
    | "restart"
    | "done";
  message: string;
}

export interface ApplyThemisUpdateOptions {
  workingDirectory: string;
  env?: NodeJS.ProcessEnv;
  serviceUnitOverride?: string | null;
  skipRestart?: boolean;
  onProgress?: (event: ThemisUpdateProgressEvent) => void;
}

export interface ApplyThemisUpdateResult {
  outcome: "updated" | "already_up_to_date";
  updateChannel: ThemisUpdateChannel;
  previousCommit: string;
  currentCommit: string;
  targetCommit: string;
  branch: string;
  restartedService: boolean;
  serviceUnit: string | null;
  buildMetadataUpdated: boolean;
  appliedReleaseTag: string | null;
}

export interface RollbackThemisUpdateOptions {
  workingDirectory: string;
  env?: NodeJS.ProcessEnv;
  serviceUnitOverride?: string | null;
  skipRestart?: boolean;
  onProgress?: (event: ThemisUpdateProgressEvent) => void;
}

export interface RollbackThemisUpdateResult {
  previousCommit: string;
  currentCommit: string;
  branch: string;
  restartedService: boolean;
  serviceUnit: string | null;
  buildMetadataUpdated: boolean;
  rolledBackReleaseTag: string | null;
}

interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface ThemisLastUpdateRecord {
  previousCommit: string;
  currentCommit: string;
  branch: string;
  updateChannel: ThemisUpdateChannel;
  appliedReleaseTag: string | null;
  recordedAt: string;
}

export interface ThemisUpdateRestartPlan {
  mode: "restart" | "skip" | "missing_default";
  serviceUnit: string | null;
  message: string;
}

export async function applyThemisUpdate(input: ApplyThemisUpdateOptions): Promise<ApplyThemisUpdateResult> {
  return withUpdateLock(input.workingDirectory, async () => {
    const env = input.env ?? process.env;
    const emit = (event: ThemisUpdateProgressEvent): void => {
      input.onProgress?.(event);
    };
    const updateSourceRepo = normalizeRepoSlug(env.THEMIS_UPDATE_REPO);
    const updateChannel = normalizeUpdateChannel(env.THEMIS_UPDATE_CHANNEL);
    const defaultBranch = normalizeOptionalText(env.THEMIS_UPDATE_DEFAULT_BRANCH) ?? "main";

    emit({
      step: "preflight",
      message: "检查当前仓库是否满足受控升级前提。",
    });

    ensureCommandExists("git", input.workingDirectory, env, "当前环境没有可用的 git，无法执行受控升级。");
    ensureCommandExists("npm", input.workingDirectory, env, "当前环境没有可用的 npm，无法执行受控升级。");

    if (!existsSync(resolve(input.workingDirectory, "package-lock.json"))) {
      throw new Error("当前仓库缺少 package-lock.json，第一版受控升级仅支持 npm ci 的正式实例。");
    }

    readRequiredCommandOutput(
      "git",
      ["rev-parse", "--git-dir"],
      input.workingDirectory,
      env,
      "当前目录不是 git 仓库，无法执行受控升级。",
    );

    const currentBranch = readRequiredCommandOutput(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      input.workingDirectory,
      env,
      "无法读取当前分支。",
    );

    if (currentBranch === "HEAD") {
      throw new Error("当前仓库处于 detached HEAD，第一版受控升级仅支持默认分支上的正式实例。");
    }

    if (currentBranch !== defaultBranch) {
      throw new Error(`当前分支是 ${currentBranch}，不是更新源默认分支 ${defaultBranch}，第一版受控升级已拒绝继续。`);
    }

    const currentCommit = readRequiredCommandOutput(
      "git",
      ["rev-parse", "HEAD"],
      input.workingDirectory,
      env,
      "无法读取当前提交。",
    );
    const originUrl = readRequiredCommandOutput(
      "git",
      ["remote", "get-url", "origin"],
      input.workingDirectory,
      env,
      "当前仓库缺少 origin remote，无法执行受控升级。",
    );
    const originRepo = normalizeRepoSlug(originUrl);

    if (originRepo !== updateSourceRepo) {
      throw new Error(`当前 origin 指向 ${originRepo}，与更新源 ${updateSourceRepo} 不一致，第一版受控升级已拒绝继续。`);
    }

    const dirtyWorktree = readOptionalCommandOutput(
      "git",
      ["status", "--porcelain"],
      input.workingDirectory,
      env,
    );

    if (dirtyWorktree) {
      throw new Error("当前工作区有未提交改动，第一版受控升级不会自动覆盖本地修改。");
    }

    let targetCommit: string;
    let latestReleaseTag: string | null = null;

    if (updateChannel === "release") {
      let target;

      try {
        target = await resolveThemisUpdateTarget({
          workingDirectory: input.workingDirectory,
          env,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/\b404\b/.test(message)) {
          throw new Error("当前更新源还没有正式 release；release 渠道暂时无法升级。");
        }

        throw error;
      }

      latestReleaseTag = target.latestReleaseTag;
      if (!latestReleaseTag) {
        throw new Error("当前 release 渠道没有拿到可升级的 release tag。");
      }

      emit({
        step: "fetch",
        message: `从 origin 拉取 release tag ${latestReleaseTag}。`,
      });
      runCommandOrThrow(
        "git",
        ["fetch", "origin", "tag", latestReleaseTag],
        input.workingDirectory,
        env,
        `git fetch origin tag ${latestReleaseTag}`,
      );

      targetCommit = readRequiredCommandOutput(
        "git",
        ["rev-parse", `${latestReleaseTag}^{commit}`],
        input.workingDirectory,
        env,
        `无法读取 release tag ${latestReleaseTag} 对应的提交。`,
      );
    } else {
      emit({
        step: "fetch",
        message: `从 origin 拉取 ${defaultBranch} 的最新提交。`,
      });
      runCommandOrThrow(
        "git",
        ["fetch", "origin", defaultBranch],
        input.workingDirectory,
        env,
        `git fetch origin ${defaultBranch}`,
      );

      const remoteRef = `origin/${defaultBranch}`;
      targetCommit = readRequiredCommandOutput(
        "git",
        ["rev-parse", remoteRef],
        input.workingDirectory,
        env,
        `无法读取 ${remoteRef} 的提交。`,
      );
    }

    if (targetCommit === currentCommit) {
      emit({
        step: "done",
        message: updateChannel === "release"
          ? "当前已经是 GitHub 最新正式 release，无需升级。"
          : "当前已经是 origin 默认分支的最新提交，无需升级。",
      });

      return {
        outcome: "already_up_to_date",
        updateChannel,
        previousCommit: currentCommit,
        currentCommit,
        targetCommit,
        branch: currentBranch,
        restartedService: false,
        serviceUnit: null,
        buildMetadataUpdated: false,
        appliedReleaseTag: latestReleaseTag,
      };
    }

    const localBehindRemote = commandSucceeds(
      "git",
      ["merge-base", "--is-ancestor", currentCommit, targetCommit],
      input.workingDirectory,
      env,
    );
    const remoteBehindLocal = commandSucceeds(
      "git",
      ["merge-base", "--is-ancestor", targetCommit, currentCommit],
      input.workingDirectory,
      env,
    );

    if (!localBehindRemote && remoteBehindLocal) {
      throw new Error(updateChannel === "release"
        ? "当前实例比 GitHub 最新正式 release 更新，当前版本不会自动回退到 release 轨道。"
        : "当前实例比 origin 默认分支更新，第一版受控升级不会自动回退本地提交。");
    }

    if (!localBehindRemote && !remoteBehindLocal) {
      throw new Error(updateChannel === "release"
        ? "当前实例与 GitHub 最新正式 release 对应提交已经分叉，第一版受控升级仅支持 ff-only 快进更新。"
        : "当前实例与 origin 默认分支已经分叉，第一版受控升级仅支持 ff-only 快进更新。");
    }

    if (updateChannel === "release") {
      emit({
        step: "pull",
        message: `执行 git merge --ff-only ${latestReleaseTag} 对齐到最新正式 release。`,
      });
      runCommandOrThrow(
        "git",
        ["merge", "--ff-only", targetCommit],
        input.workingDirectory,
        env,
        `git merge --ff-only ${targetCommit}`,
      );
    } else {
      emit({
        step: "pull",
        message: `执行 git pull --ff-only origin ${defaultBranch}。`,
      });
      runCommandOrThrow(
        "git",
        ["pull", "--ff-only", "origin", defaultBranch],
        input.workingDirectory,
        env,
        `git pull --ff-only origin ${defaultBranch}`,
      );
    }

    emit({
      step: "install",
      message: "执行 npm ci 安装依赖。",
    });
    runCommandOrThrow(
      "npm",
      ["ci", "--include=dev"],
      input.workingDirectory,
      env,
      "npm ci --include=dev",
    );

    emit({
      step: "build",
      message: "执行 npm run build 编译产物。",
    });
    runCommandOrThrow(
      "npm",
      ["run", "build"],
      input.workingDirectory,
      env,
      "npm run build",
    );

    const newCommit = readRequiredCommandOutput(
      "git",
      ["rev-parse", "HEAD"],
      input.workingDirectory,
      env,
      "升级后无法再次读取当前提交。",
    );

    let buildMetadataUpdated = false;
    const localEnvPath = resolvePrimaryProjectEnvFile(input.workingDirectory);

    if (existsSync(localEnvPath)) {
      emit({
        step: "write_build_metadata",
        message: "回写 .env.local 里的构建提交标记。",
      });
      setProjectEnvValue(localEnvPath, "THEMIS_BUILD_COMMIT", newCommit);
      setProjectEnvValue(localEnvPath, "THEMIS_BUILD_BRANCH", currentBranch);
      buildMetadataUpdated = true;
    } else {
      emit({
        step: "write_build_metadata",
        message: "未检测到 .env.local，已跳过构建提交标记回写。",
      });
    }

    emit({
      step: "record",
      message: "记录最近一次成功升级的回退锚点。",
    });
    writeLastUpdateRecord(input.workingDirectory, {
      previousCommit: currentCommit,
      currentCommit: newCommit,
      branch: currentBranch,
      updateChannel,
      appliedReleaseTag: latestReleaseTag,
      recordedAt: new Date().toISOString(),
    });

    const restartPlan = resolveThemisUpdateRestartPlan({
      workingDirectory: input.workingDirectory,
      env,
      ...(input.serviceUnitOverride !== undefined ? { serviceUnitOverride: input.serviceUnitOverride } : {}),
      ...(input.skipRestart !== undefined ? { skipRestart: input.skipRestart } : {}),
    });

    emit({
      step: "restart",
      message: restartPlan.message,
    });

    const restartedService = executeThemisUpdateRestartPlanNow(
      restartPlan,
      input.workingDirectory,
      env,
    );
    const restartedServiceUnit = restartedService ? restartPlan.serviceUnit : null;

    emit({
      step: "done",
      message: `升级完成：${currentCommit.slice(0, 7)} -> ${newCommit.slice(0, 7)}。`,
    });

    return {
      outcome: "updated",
      updateChannel,
      previousCommit: currentCommit,
      currentCommit: newCommit,
      targetCommit,
      branch: currentBranch,
      restartedService,
      serviceUnit: restartedServiceUnit,
      buildMetadataUpdated,
      appliedReleaseTag: latestReleaseTag,
    };
  });
}

export async function rollbackThemisUpdate(input: RollbackThemisUpdateOptions): Promise<RollbackThemisUpdateResult> {
  return withUpdateLock(input.workingDirectory, async () => {
    const env = input.env ?? process.env;
    const emit = (event: ThemisUpdateProgressEvent): void => {
      input.onProgress?.(event);
    };
    const defaultBranch = normalizeOptionalText(env.THEMIS_UPDATE_DEFAULT_BRANCH) ?? "main";
    const lastUpdate = readThemisLastUpdateRecord(input.workingDirectory);

    if (!lastUpdate) {
      throw new Error("当前没有可回退的升级记录；请先成功执行一次 `./themis update apply`。");
    }

    emit({
      step: "preflight",
      message: "检查当前仓库是否满足回滚前提。",
    });

    ensureCommandExists("git", input.workingDirectory, env, "当前环境没有可用的 git，无法执行回滚。");
    ensureCommandExists("npm", input.workingDirectory, env, "当前环境没有可用的 npm，无法执行回滚。");

    if (!existsSync(resolve(input.workingDirectory, "package-lock.json"))) {
      throw new Error("当前仓库缺少 package-lock.json，当前版本回滚仅支持 npm ci 的正式实例。");
    }

    readRequiredCommandOutput(
      "git",
      ["rev-parse", "--git-dir"],
      input.workingDirectory,
      env,
      "当前目录不是 git 仓库，无法执行回滚。",
    );

    const currentBranch = readRequiredCommandOutput(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      input.workingDirectory,
      env,
      "无法读取当前分支。",
    );

    if (currentBranch === "HEAD") {
      throw new Error("当前仓库处于 detached HEAD，当前版本回滚仅支持默认分支上的正式实例。");
    }

    if (currentBranch !== defaultBranch) {
      throw new Error(`当前分支是 ${currentBranch}，不是更新源默认分支 ${defaultBranch}，当前版本回滚已拒绝继续。`);
    }

    const currentCommit = readRequiredCommandOutput(
      "git",
      ["rev-parse", "HEAD"],
      input.workingDirectory,
      env,
      "无法读取当前提交。",
    );

    if (currentCommit !== lastUpdate.currentCommit) {
      throw new Error(`当前提交是 ${currentCommit.slice(0, 7)}，与最近一次升级记录 ${lastUpdate.currentCommit.slice(0, 7)} 不一致，已拒绝回滚。`);
    }

    const dirtyWorktree = readOptionalCommandOutput(
      "git",
      ["status", "--porcelain"],
      input.workingDirectory,
      env,
    );

    if (dirtyWorktree) {
      throw new Error("当前工作区有未提交改动，回滚不会自动覆盖本地修改。");
    }

    readRequiredCommandOutput(
      "git",
      ["rev-parse", `${lastUpdate.previousCommit}^{commit}`],
      input.workingDirectory,
      env,
      `无法读取回滚目标提交 ${lastUpdate.previousCommit}。`,
    );

    emit({
      step: "pull",
      message: `执行 git reset --hard ${lastUpdate.previousCommit.slice(0, 7)} 回退到最近一次升级前提交。`,
    });
    runCommandOrThrow(
      "git",
      ["reset", "--hard", lastUpdate.previousCommit],
      input.workingDirectory,
      env,
      `git reset --hard ${lastUpdate.previousCommit}`,
    );

    emit({
      step: "install",
      message: "执行 npm ci 安装依赖。",
    });
    runCommandOrThrow(
      "npm",
      ["ci", "--include=dev"],
      input.workingDirectory,
      env,
      "npm ci --include=dev",
    );

    emit({
      step: "build",
      message: "执行 npm run build 编译产物。",
    });
    runCommandOrThrow(
      "npm",
      ["run", "build"],
      input.workingDirectory,
      env,
      "npm run build",
    );

    let buildMetadataUpdated = false;
    const localEnvPath = resolvePrimaryProjectEnvFile(input.workingDirectory);

    if (existsSync(localEnvPath)) {
      emit({
        step: "write_build_metadata",
        message: "回写 .env.local 里的构建提交标记。",
      });
      setProjectEnvValue(localEnvPath, "THEMIS_BUILD_COMMIT", lastUpdate.previousCommit);
      setProjectEnvValue(localEnvPath, "THEMIS_BUILD_BRANCH", currentBranch);
      buildMetadataUpdated = true;
    } else {
      emit({
        step: "write_build_metadata",
        message: "未检测到 .env.local，已跳过构建提交标记回写。",
      });
    }

    const restartPlan = resolveThemisUpdateRestartPlan({
      workingDirectory: input.workingDirectory,
      env,
      ...(input.serviceUnitOverride !== undefined ? { serviceUnitOverride: input.serviceUnitOverride } : {}),
      ...(input.skipRestart !== undefined ? { skipRestart: input.skipRestart } : {}),
    });

    emit({
      step: "restart",
      message: restartPlan.message,
    });

    const restartedService = executeThemisUpdateRestartPlanNow(
      restartPlan,
      input.workingDirectory,
      env,
    );
    const restartedServiceUnit = restartedService ? restartPlan.serviceUnit : null;

    emit({
      step: "record",
      message: "清理最近一次升级记录，避免重复回退到同一条记录。",
    });
    clearLastUpdateRecord(input.workingDirectory);

    emit({
      step: "done",
      message: `回滚完成：${currentCommit.slice(0, 7)} -> ${lastUpdate.previousCommit.slice(0, 7)}。`,
    });

    return {
      previousCommit: currentCommit,
      currentCommit: lastUpdate.previousCommit,
      branch: currentBranch,
      restartedService,
      serviceUnit: restartedServiceUnit,
      buildMetadataUpdated,
      rolledBackReleaseTag: lastUpdate.appliedReleaseTag,
    };
  });
}

async function withUpdateLock<T>(workingDirectory: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = resolve(workingDirectory, UPDATE_LOCK_RELATIVE_PATH);
  mkdirSync(dirname(lockPath), { recursive: true });

  try {
    writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx", encoding: "utf8" });
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new Error(`已有其他更新流程在运行，请先确认并移除锁文件后再试：${lockPath}`);
    }

    throw error;
  }

  try {
    return await fn();
  } finally {
    rmSync(lockPath, { force: true });
  }
}

function ensureCommandExists(
  command: string,
  workingDirectory: string,
  env: NodeJS.ProcessEnv,
  errorMessage: string,
): void {
  if (!commandSucceeds(command, ["--version"], workingDirectory, env)) {
    throw new Error(errorMessage);
  }
}

function readRequiredCommandOutput(
  command: string,
  args: string[],
  workingDirectory: string,
  env: NodeJS.ProcessEnv,
  errorMessage: string,
): string {
  const output = readOptionalCommandOutput(command, args, workingDirectory, env);

  if (!output) {
    throw new Error(errorMessage);
  }

  return output;
}

function readOptionalCommandOutput(
  command: string,
  args: string[],
  workingDirectory: string,
  env: NodeJS.ProcessEnv,
): string | null {
  const result = runCommand(command, args, workingDirectory, env, true);

  if (result.status !== 0) {
    return null;
  }

  return normalizeOptionalText(result.stdout);
}

function commandSucceeds(
  command: string,
  args: string[],
  workingDirectory: string,
  env: NodeJS.ProcessEnv,
): boolean {
  return runCommand(command, args, workingDirectory, env, true).status === 0;
}

function runCommandOrThrow(
  command: string,
  args: string[],
  workingDirectory: string,
  env: NodeJS.ProcessEnv,
  displayName: string,
): void {
  const result = runCommand(command, args, workingDirectory, env, false);

  if (result.status === 0) {
    return;
  }

  const detail = normalizeOptionalText(result.stderr);
  throw new Error(`${displayName} 执行失败（exit ${result.status}）${detail ? `：${detail}` : ""}`);
}

function runCommand(
  command: string,
  args: string[],
  workingDirectory: string,
  env: NodeJS.ProcessEnv,
  captureOutput: boolean,
): CommandResult {
  const result = spawnSync(command, args, {
    cwd: workingDirectory,
    env,
    encoding: "utf8",
    stdio: captureOutput ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "pipe"],
  });

  if (result.error) {
    throw new Error(`${command} ${args.join(" ")} 执行失败：${result.error.message}`);
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function probeUserSystemdService(
  serviceUnit: string,
  workingDirectory: string,
  env: NodeJS.ProcessEnv,
): {
  exists: boolean;
  reason: string | null;
} {
  let result: CommandResult;

  try {
    result = runCommand(
      "systemctl",
      ["--user", "show", "--property", "LoadState", "--value", serviceUnit],
      workingDirectory,
      env,
      true,
    );
  } catch (error) {
    return {
      exists: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const loadState = normalizeOptionalText(result.stdout);
  const detail = normalizeOptionalText(result.stderr);

  if (result.status !== 0) {
    return {
      exists: false,
      reason: detail,
    };
  }

  if (!loadState || loadState === "not-found") {
    return {
      exists: false,
      reason: null,
    };
  }

  return {
    exists: true,
    reason: null,
  };
}

export function readThemisLastUpdateRecord(workingDirectory: string): ThemisLastUpdateRecord | null {
  const filePath = resolve(workingDirectory, LAST_UPDATE_RECORD_RELATIVE_PATH);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<ThemisLastUpdateRecord>;
    if (
      typeof parsed.previousCommit !== "string"
      || typeof parsed.currentCommit !== "string"
      || typeof parsed.branch !== "string"
      || (parsed.updateChannel !== "branch" && parsed.updateChannel !== "release")
    ) {
      return null;
    }

    return {
      previousCommit: parsed.previousCommit,
      currentCommit: parsed.currentCommit,
      branch: parsed.branch,
      updateChannel: parsed.updateChannel,
      appliedReleaseTag: normalizeOptionalText(parsed.appliedReleaseTag) ?? null,
      recordedAt: typeof parsed.recordedAt === "string" ? parsed.recordedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeLastUpdateRecord(workingDirectory: string, record: ThemisLastUpdateRecord): void {
  const filePath = resolve(workingDirectory, LAST_UPDATE_RECORD_RELATIVE_PATH);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function clearLastUpdateRecord(workingDirectory: string): void {
  const filePath = resolve(workingDirectory, LAST_UPDATE_RECORD_RELATIVE_PATH);
  rmSync(filePath, { force: true });
}

export function resolveThemisUpdateRestartPlan(input: {
  workingDirectory: string;
  env?: NodeJS.ProcessEnv;
  serviceUnitOverride?: string | null;
  skipRestart?: boolean;
}): ThemisUpdateRestartPlan {
  const env = input.env ?? process.env;

  if (input.skipRestart) {
    return {
      mode: "skip",
      serviceUnit: null,
      message: "已按参数要求跳过服务重启。",
    };
  }

  const explicitServiceUnit = normalizeOptionalText(input.serviceUnitOverride)
    ?? normalizeOptionalText(env.THEMIS_UPDATE_SYSTEMD_SERVICE);
  const serviceUnit = explicitServiceUnit ?? DEFAULT_UPDATE_SYSTEMD_SERVICE;
  const serviceProbe = probeUserSystemdService(serviceUnit, input.workingDirectory, env);

  if (serviceProbe.exists) {
    return {
      mode: "restart",
      serviceUnit,
      message: `重启 systemd --user 服务 ${serviceUnit}。`,
    };
  }

  if (explicitServiceUnit) {
    throw new Error(`未检测到可重启的 systemd --user 服务 ${serviceUnit}。${serviceProbe.reason ? ` ${serviceProbe.reason}` : ""}`.trim());
  }

  return {
    mode: "missing_default",
    serviceUnit: null,
    message: `未检测到默认 systemd --user 服务 ${serviceUnit}，已跳过自动重启。`,
  };
}

function executeThemisUpdateRestartPlanNow(
  plan: ThemisUpdateRestartPlan,
  workingDirectory: string,
  env: NodeJS.ProcessEnv,
): boolean {
  if (plan.mode !== "restart" || !plan.serviceUnit) {
    return false;
  }

  runCommandOrThrow(
    "systemctl",
    ["--user", "restart", plan.serviceUnit],
    workingDirectory,
    env,
    `systemctl --user restart ${plan.serviceUnit}`,
  );
  return true;
}

export async function requestDetachedThemisUpdateRestart(
  plan: ThemisUpdateRestartPlan,
  input: {
    workingDirectory: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  if (plan.mode !== "restart" || !plan.serviceUnit) {
    return;
  }

  const env = input.env ?? process.env;

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      "systemctl",
      ["--user", "restart", plan.serviceUnit as string],
      {
        cwd: input.workingDirectory,
        env,
        detached: true,
        stdio: "ignore",
      },
    );

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}

function normalizeRepoSlug(value: string | undefined): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return DEFAULT_UPDATE_REPO;
  }

  const httpsMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
  if (httpsMatch?.[1]) {
    return httpsMatch[1];
  }

  const sshMatch = normalized.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (sshMatch?.[1]) {
    return sshMatch[1];
  }

  if (/^[^/\s]+\/[^/\s]+$/.test(normalized)) {
    return normalized.replace(/\.git$/i, "");
  }

  throw new Error("更新源必须是 owner/repo、GitHub URL 或 git@github.com:owner/repo.git。");
}

function normalizeUpdateChannel(value: string | undefined): ThemisUpdateChannel {
  const normalized = normalizeOptionalText(value);

  if (!normalized || normalized === "branch") {
    return "branch";
  }

  if (normalized === "release") {
    return "release";
  }

  throw new Error("THEMIS_UPDATE_CHANNEL 仅支持 branch / release。");
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function isAlreadyExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "EEXIST");
}
