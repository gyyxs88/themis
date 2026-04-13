#!/usr/bin/env node

import { copyFileSync, existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  ensureAuthAccountCodexHome,
  resolveCodexAuthFilePath,
  resolveDefaultCodexHome,
  resolveManagedCodexHome,
} from "../core/auth-accounts.js";
import {
  RuntimeDiagnosticsService,
  type RuntimeDiagnosticFileStatus,
  type RuntimeMultimodalDiagnosticsSummary,
} from "../diagnostics/runtime-diagnostics.js";
import { summarizeReleaseReadiness, type ReleaseReadinessSummary } from "../diagnostics/release-readiness.js";
import {
  buildFeishuTroubleshootingPlaybook,
  describeFeishuTakeoverGuidance,
  type FeishuDiagnosticsSummary,
} from "../diagnostics/feishu-diagnostics.js";
import { WorkerFleetGovernanceService } from "../diagnostics/worker-fleet-governance.js";
import { WorkerFleetDiagnosticsService } from "../diagnostics/worker-fleet-diagnostics.js";
import { WorkerNodeDiagnosticsService } from "../diagnostics/worker-node-diagnostics.js";
import { applyThemisUpdate, rollbackThemisUpdate } from "../diagnostics/update-apply.js";
import {
  checkThemisUpdates,
  formatShortCommitHash,
  type ThemisUpdateCheckResult,
} from "../diagnostics/update-check.js";
import { runManagedThemisUpdateWorker } from "../diagnostics/update-service.js";
import { PlatformBackupService } from "../diagnostics/platform-backup.js";
import { RuntimeSmokeService, type RuntimeSmokeProgressEvent } from "../diagnostics/runtime-smoke.js";
import { McpInspector } from "../mcp/mcp-inspector.js";
import { runThemisMcpServer } from "../mcp/themis-mcp-server.js";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import { ManagedAgentPlatformWorkerClient } from "../core/managed-agent-platform-worker-client.js";
import { ManagedAgentWorkerDaemon } from "../core/managed-agent-worker-daemon.js";
import { PrincipalSkillsService } from "../core/principal-skills-service.js";
import { WebAccessService, type PlatformServiceRole } from "../core/web-access.js";
import { readOpenAICompatibleProviderConfigs } from "../core/openai-compatible-provider.js";
import {
  escapeEnvValue,
  loadProjectEnv,
  readProjectEnvFiles,
  resolvePrimaryProjectEnvFile,
  resolveProjectEnvExampleFile,
  setProjectEnvValue,
  unsetProjectEnvValue,
} from "../config/project-env.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import {
  buildProjectEnvExampleContent,
  findProjectConfigDefinition,
  listProjectConfigDefinitionsBySection,
  listProjectConfigSections,
} from "./config-schema.js";

const cwd = process.cwd();
const launcherPath = fileURLToPath(new URL("../../themis", import.meta.url));
const cliDatabasePath = resolve(cwd, "infra/local/themis.db");
const CLI_PRINCIPAL_ID = "principal-local-owner";
const DEFAULT_THEMIS_LAUNCHER_NAME = "themis";
const DEFAULT_PLATFORM_LAUNCHER_NAME = "themis-platform";
const DEFAULT_WORKER_NODE_LAUNCHER_NAME = "themis-worker-node";
const shellEnv = new Map<string, string>(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);

loadProjectEnv(cwd);

export type ThemisCliSurface = "themis" | "platform" | "worker-node";

export interface ThemisCliEntrypointOptions {
  surface?: ThemisCliSurface;
  launcherName?: string;
}

if (isDirectCliEntrypoint(import.meta.url)) {
  void runCli(process.argv.slice(2)).catch(reportCliFailure);
}

export async function runCli(
  args: string[],
  options: ThemisCliEntrypointOptions = {},
): Promise<void> {
  const surface = options.surface ?? "themis";
  const launcherName = resolveCliLauncherName(surface, options.launcherName);
  const [command, subcommand, ...rest] = args;

  if (!command) {
    if (surface === "themis" && input.isTTY && output.isTTY) {
      await runInteractiveShell();
      return;
    }

    if (surface === "themis") {
      await handleStatus();
      return;
    }

    printHelp(surface, launcherName);
    return;
  }

  if (surface === "platform") {
    await handlePlatformCli(command, subcommand, rest, launcherName);
    return;
  }

  if (surface === "worker-node") {
    await handleWorkerNodeCli(command, subcommand, rest, launcherName);
    return;
  }

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      printHelp("themis", launcherName);
      return;
    case "init":
      handleInit(rest);
      return;
    case "install":
      handleInstall([...(subcommand ? [subcommand] : []), ...rest]);
      return;
    case "status":
    case "check":
      await handleStatus();
      return;
    case "update":
      await handleUpdate(subcommand, rest);
      return;
    case "doctor":
      maybePrintCompatibilityAliasNotice("themis", command, subcommand);
      if (subcommand?.trim().toLowerCase() === "smoke") {
        process.exit(await handleDoctorSmoke(rest));
      }

      await handleDoctor(subcommand, rest);
      return;
    case "config":
      handleConfig(subcommand, rest);
      return;
    case "backup":
      await handleBackup(subcommand, rest);
      return;
    case "auth":
      maybePrintCompatibilityAliasNotice("themis", command, subcommand);
      await handleAuth(subcommand, rest);
      return;
    case "skill":
      await handleSkill(subcommand, rest);
      return;
    case "mcp-server":
      await handleMcpServer([...(subcommand ? [subcommand] : []), ...rest]);
      return;
    case "worker-node":
      maybePrintCompatibilityAliasNotice("themis", command, subcommand);
      await handleWorkerNode(subcommand, rest);
      return;
    case "worker-fleet":
      maybePrintCompatibilityAliasNotice("themis", command, subcommand);
      await handleWorkerFleet(subcommand, rest);
      return;
    default:
      throw new Error(`不支持的命令：${command}。可用命令：init / status / check / update / doctor / config / backup / auth / skill / mcp-server / worker-node / worker-fleet / help。`);
  }
}

export function reportCliFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Themis CLI 执行失败：${message}`);
  process.exitCode = 1;
}

function isDirectCliEntrypoint(metaUrl: string): boolean {
  const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
  return entryPath === fileURLToPath(metaUrl);
}

function resolveCliLauncherName(surface: ThemisCliSurface, launcherName: string | undefined): string {
  const normalizedLauncherName = typeof launcherName === "string" ? launcherName.trim() : "";

  if (normalizedLauncherName) {
    return normalizedLauncherName;
  }

  switch (surface) {
    case "platform":
      return DEFAULT_PLATFORM_LAUNCHER_NAME;
    case "worker-node":
      return DEFAULT_WORKER_NODE_LAUNCHER_NAME;
    default:
      return DEFAULT_THEMIS_LAUNCHER_NAME;
  }
}

async function handlePlatformCli(
  command: string,
  subcommand: string | undefined,
  rest: string[],
  launcherName: string,
): Promise<void> {
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      printHelp("platform", launcherName);
      return;
    case "backup":
      await handleBackup(subcommand, rest);
      return;
    case "auth":
      if (subcommand?.trim().toLowerCase() !== "platform") {
        throw new Error(`${launcherName} 当前只承载 auth platform。`);
      }

      await handleAuth(subcommand, rest);
      return;
    case "doctor":
      if (subcommand?.trim().toLowerCase() !== "worker-fleet") {
        throw new Error(`${launcherName} 当前只承载 doctor worker-fleet。`);
      }

      await handleDoctor(subcommand, rest);
      return;
    case "worker-fleet":
      await handleWorkerFleet(subcommand, rest);
      return;
    default:
      throw new Error(`${launcherName} 当前仅支持 backup / auth platform / doctor worker-fleet / worker-fleet / help。`);
  }
}

async function handleWorkerNodeCli(
  command: string,
  subcommand: string | undefined,
  rest: string[],
  launcherName: string,
): Promise<void> {
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      printHelp("worker-node", launcherName);
      return;
    case "doctor":
      if (subcommand?.trim().toLowerCase() !== "worker-node") {
        throw new Error(`${launcherName} 当前只承载 doctor worker-node。`);
      }

      await handleDoctor(subcommand, rest);
      return;
    case "worker-node":
      await handleWorkerNode(subcommand, rest);
      return;
    default:
      throw new Error(`${launcherName} 当前仅支持 doctor worker-node / worker-node / help。`);
  }
}

function maybePrintCompatibilityAliasNotice(
  surface: ThemisCliSurface,
  command: string,
  subcommand: string | undefined,
): void {
  if (surface !== "themis") {
    return;
  }

  const normalizedSubcommand = subcommand?.trim().toLowerCase();

  if (command === "auth" && normalizedSubcommand === "platform") {
    console.error("兼容入口提示：平台服务令牌命令已迁往 ./themis-platform；当前 ./themis auth platform 仅作为过渡别名保留。");
    return;
  }

  if (command === "worker-fleet" || (command === "doctor" && normalizedSubcommand === "worker-fleet")) {
    console.error("兼容入口提示：平台值班与 Worker Fleet 治理命令已迁往 ./themis-platform；当前 ./themis 入口仅作为过渡别名保留。");
    return;
  }

  if (command === "worker-node" || (command === "doctor" && normalizedSubcommand === "worker-node")) {
    console.error("兼容入口提示：Worker Node 命令已迁往 ./themis-worker-node；当前 ./themis 入口仅作为过渡别名保留。");
  }
}

function handleInit(args: string[]): void {
  const force = args.includes("--force");
  const envExamplePath = resolveProjectEnvExampleFile(cwd);
  const localEnvPath = resolvePrimaryProjectEnvFile(cwd);
  const templateContent = existsSync(envExamplePath)
    ? null
    : buildProjectEnvExampleContent();

  mkdirSync(resolve(cwd, "infra/local"), { recursive: true });
  mkdirSync(resolve(cwd, "temp"), { recursive: true });

  if (existsSync(localEnvPath) && !force) {
    console.log(`本地配置文件已存在：${localEnvPath}`);
  } else if (existsSync(envExamplePath)) {
    copyFileSync(envExamplePath, localEnvPath);
    console.log(`已从 .env.example 初始化本地配置：${localEnvPath}`);
  } else if (templateContent !== null) {
    setProjectEnvFileContent(localEnvPath, templateContent);
    console.log(`已生成本地配置模板：${localEnvPath}`);
  }

  console.log("");
  console.log("建议下一步：");
  console.log("1. 用编辑器打开 .env.local，或使用 `./themis config set <KEY> <VALUE>` 逐项写入。");
  console.log("2. 运行 `./themis status` 检查当前配置状态。");
  console.log("3. 运行 `npm run dev:web` 启动服务。");
  console.log("4. 启动后可在 Web 里继续完成 Codex 登录、账号管理和第三方 provider 配置。");
}

function handleInstall(args: string[]): void {
  const force = args.includes("--force");
  const explicitDir = readOptionValue(args, "--dir");
  const installDir = explicitDir ? resolve(explicitDir) : resolve(process.env.HOME ?? "~", ".local/bin");
  const targetPath = resolve(installDir, "themis");

  mkdirSync(installDir, { recursive: true });

  if (existsSync(targetPath)) {
    const stat = lstatSync(targetPath);

    if (stat.isSymbolicLink()) {
      const currentTarget = resolve(dirname(targetPath), readlinkSync(targetPath));

      if (currentTarget === resolve(launcherPath)) {
        console.log(`themis 已安装：${targetPath}`);
        printPathFollowup(installDir);
        return;
      }
    }

    if (!force) {
      throw new Error(`目标已存在：${targetPath}。如需覆盖，请重试并追加 --force。`);
    }

    rmSync(targetPath, { recursive: true, force: true });
  }

  symlinkSync(launcherPath, targetPath);
  console.log(`已安装 themis 到 ${targetPath}`);
  printPathFollowup(installDir);
}

async function handleStatus(): Promise<void> {
  const envFiles = readProjectEnvFiles(cwd);
  const localEnvPath = resolvePrimaryProjectEnvFile(cwd);
  const dbPath = resolve(cwd, "infra/local/themis.db");
  const dbExists = existsSync(dbPath);
  const codexHome = resolveDefaultCodexHome();
  const defaultAuthPath = resolveCodexAuthFilePath(codexHome);
  const hasDefaultAuth = existsSync(defaultAuthPath);
  const apiKey = resolveConfigValue("CODEX_API_KEY", envFiles);
  const feishuAppId = resolveConfigValue("FEISHU_APP_ID", envFiles);
  const feishuAppSecret = resolveConfigValue("FEISHU_APP_SECRET", envFiles);
  const feishuProgressFlushTimeout = resolveConfigValue("FEISHU_PROGRESS_FLUSH_TIMEOUT_MS", envFiles);
  const envProviderBaseUrl = resolveConfigValue("THEMIS_OPENAI_COMPAT_BASE_URL", envFiles);
  const envProviderApiKey = resolveConfigValue("THEMIS_OPENAI_COMPAT_API_KEY", envFiles);
  const envProviderModel = resolveConfigValue("THEMIS_OPENAI_COMPAT_MODEL", envFiles);
  const envProviderValues = [envProviderBaseUrl.value, envProviderApiKey.value, envProviderModel.value].filter(Boolean);
  const envProviderReady = envProviderValues.length === 3;
  const envProviderPartial = envProviderValues.length > 0 && !envProviderReady;
  const registry = dbExists
    ? new SqliteCodexSessionRegistry({ databaseFile: dbPath })
    : null;
  const authAccounts = registry ? registry.listAuthAccounts() : [];
  const accountsWithAuthFile = authAccounts.filter((account) => existsSync(resolveCodexAuthFilePath(account.codexHome)));
  const dbProviders = registry ? registry.listThirdPartyProviders() : [];
  let effectiveProviders: ReturnType<typeof readOpenAICompatibleProviderConfigs> = [];
  let providerReadError: string | null = null;

  try {
    effectiveProviders = registry ? readOpenAICompatibleProviderConfigs(cwd, registry) : [];
  } catch (error) {
    providerReadError = error instanceof Error ? error.message : String(error);
  }

  const updateCheck = await checkThemisUpdates({
    workingDirectory: cwd,
    env: process.env,
  });

  const authReady = Boolean(apiKey.value || hasDefaultAuth || accountsWithAuthFile.length);
  const feishuReady = Boolean(feishuAppId.value && feishuAppSecret.value);

  console.log("Themis 配置状态");
  console.log("");
  console.log("本地文件");
  console.log(`- .env.local：${existsSync(localEnvPath) ? localEnvPath : "未创建"}`);
  console.log(`- SQLite：${dbExists ? dbPath : "尚未生成"}`);
  console.log("");
  console.log("服务监听");
  console.log(`- THEMIS_HOST=${formatDisplayValue(resolveConfigValue("THEMIS_HOST", envFiles), false)}`);
  console.log(`- THEMIS_PORT=${formatDisplayValue(resolveConfigValue("THEMIS_PORT", envFiles), false)}`);
  console.log(`- THEMIS_TASK_TIMEOUT_MS=${formatDisplayValue(resolveConfigValue("THEMIS_TASK_TIMEOUT_MS", envFiles), false)}`);
  console.log("");
  console.log("Codex 认证");
  console.log(`- 默认 CODEX_HOME：${codexHome}`);
  console.log(`- 默认 auth.json：${hasDefaultAuth ? "已检测到" : "未检测到"} (${defaultAuthPath})`);
  console.log(`- CODEX_API_KEY：${formatDisplayValue(apiKey, true)}`);
  console.log(`- 已登记账号槽位：${authAccounts.length}`);
  console.log(`- 已检测到认证文件的账号槽位：${accountsWithAuthFile.length}`);
  console.log(`- 当前判断：${authReady ? "已具备基础认证材料，可直接启动后继续使用。" : "还没有检测到可用认证材料；启动后需在 Web 里登录或先配置 CODEX_API_KEY。"} `);
  console.log("");
  console.log("飞书渠道");
  console.log(`- FEISHU_APP_ID：${formatDisplayValue(feishuAppId, false)}`);
  console.log(`- FEISHU_APP_SECRET：${formatDisplayValue(feishuAppSecret, true)}`);
  console.log(`- FEISHU_PROGRESS_FLUSH_TIMEOUT_MS：${formatDisplayValue(feishuProgressFlushTimeout, false)}`);
  console.log(`- 当前判断：${feishuReady ? "已配置，可在启动后拉起飞书长连接服务。" : "未完整配置；不影响 Web 使用，但飞书 bot 不会启动。"} `);
  console.log("");
  console.log("第三方兼容 Provider");
  console.log(`- 环境变量引导：${envProviderReady ? "已完整配置" : envProviderPartial ? "部分已配置，尚未完整" : "未配置"}`);
  console.log(`- SQLite 供应商数量：${dbProviders.length}`);
  console.log(`- 当前可读供应商数量：${effectiveProviders.length}`);

  if (effectiveProviders.length) {
    console.log(`- 当前可用供应商：${effectiveProviders.map((provider) => `${provider.name}(${provider.defaultModel})`).join("，")}`);
  } else if (providerReadError) {
    console.log(`- 当前可用供应商：读取失败（${providerReadError}）`);
  } else {
    console.log("- 当前可用供应商：暂无");
  }

  printUpdateCheckSummary(updateCheck);
  console.log("");
  console.log("建议下一步");

  const nextSteps = [
    !existsSync(localEnvPath) ? "先运行 `./themis init` 生成本地配置模板。" : null,
    !authReady ? "启动后在 Web 完成 ChatGPT 浏览器登录、设备码登录，或先写入 CODEX_API_KEY。" : null,
    !feishuReady ? "如果需要飞书 bot，请补齐 FEISHU_APP_ID 和 FEISHU_APP_SECRET。" : null,
    !envProviderReady && !dbProviders.length ? "如果需要第三方模型，可在 Web 设置页添加供应商，或先写入 THEMIS_OPENAI_COMPAT_*。" : null,
    updateCheck.outcome === "update_available"
      ? updateCheck.updateChannel === "release"
        ? "检测到新的 GitHub 正式 release；正式实例可执行 `./themis update apply` 做受控升级。"
        : "检测到 GitHub 有新提交；正式实例可执行 `./themis update apply` 做受控升级，或继续手工走 git pull / npm ci / build / restart。"
      : null,
    updateCheck.outcome === "comparison_unavailable"
      ? "如果希望稳定比较版本，正式部署建议保留 git clone，或在启动环境写入 THEMIS_BUILD_COMMIT。"
      : null,
    "运行 `npm run dev:web` 启动服务。",
  ].filter((item): item is string => Boolean(item));

  for (const [index, step] of nextSteps.entries()) {
    console.log(`${index + 1}. ${step}`);
  }
}

async function handleUpdate(subcommand: string | undefined, args: string[]): Promise<void> {
  const selected = subcommand?.trim().toLowerCase();

  if (!selected || selected === "check") {
    if (args.length > 0) {
      throw new Error("用法：themis update [check]");
    }

    await handleUpdateCheck();
    return;
  }

  if (selected === "apply") {
    await handleUpdateApply(args);
    return;
  }

  if (selected === "rollback") {
    await handleUpdateRollback(args);
    return;
  }

  if (selected === "worker") {
    await handleUpdateWorker(args);
    return;
  }

  throw new Error("update 子命令仅支持 check / apply / rollback。");
}

async function handleUpdateCheck(): Promise<void> {
  const updateCheck = await checkThemisUpdates({
    workingDirectory: cwd,
    env: process.env,
  });

  console.log("Themis 更新检查");
  printUpdateCheckSummary(updateCheck);
  console.log("");
  console.log("建议下一步");

  const nextSteps = [
    updateCheck.outcome === "update_available"
      ? updateCheck.updateChannel === "release"
        ? "运行 `./themis update apply` 对齐到最新正式 release。"
        : "运行 `./themis update apply` 执行受控升级。"
      : null,
    updateCheck.outcome === "check_failed" && updateCheck.updateChannel === "release" && /\b404\b/.test(updateCheck.errorMessage ?? "")
      ? "先在 GitHub 发布第一条正式 release，或临时切回 `THEMIS_UPDATE_CHANNEL=branch`。"
      : null,
    updateCheck.outcome === "comparison_unavailable"
      ? "当前实例无法稳定比较远端版本；正式部署建议保留 git clone，或补齐 THEMIS_BUILD_COMMIT。"
      : null,
    updateCheck.outcome === "check_failed" && !(updateCheck.updateChannel === "release" && /\b404\b/.test(updateCheck.errorMessage ?? ""))
      ? "先排查网络、GitHub API 或更新源配置，再重试 `./themis update check`。"
      : null,
  ].filter((item): item is string => Boolean(item));

  if (nextSteps.length === 0) {
    console.log("1. 当前无需额外操作。");
    return;
  }

  for (const [index, step] of nextSteps.entries()) {
    console.log(`${index + 1}. ${step}`);
  }
}

async function handleUpdateApply(args: string[]): Promise<void> {
  const { skipRestart, serviceUnitOverride } = parseUpdateRuntimeOptions(
    args,
    "用法：themis update apply [--service <systemd-user-service>] [--no-restart]",
  );

  console.log("Themis 受控升级");

  const result = await applyThemisUpdate({
    workingDirectory: cwd,
    env: process.env,
    serviceUnitOverride,
    skipRestart,
    onProgress: (event) => {
      console.log(`- ${event.message}`);
    },
  });

  if (result.outcome === "already_up_to_date") {
    console.log("");
    console.log("结果");
    console.log(`- 更新渠道：${formatUpdateChannelLabel(result.updateChannel)}`);
    console.log(`- 当前提交：${formatShortCommitHash(result.currentCommit)}`);
    if (result.appliedReleaseTag) {
      console.log(`- 当前 release：${result.appliedReleaseTag}`);
    }
    console.log("- 状态：已经是最新版本，无需升级。");
    return;
  }

  console.log("");
  console.log("结果");
  console.log(`- 更新渠道：${formatUpdateChannelLabel(result.updateChannel)}`);
  console.log(`- 升级前提交：${formatShortCommitHash(result.previousCommit)}`);
  console.log(`- 升级后提交：${formatShortCommitHash(result.currentCommit)}`);
  console.log(`- 当前分支：${result.branch}`);
  if (result.appliedReleaseTag) {
    console.log(`- 对齐 release：${result.appliedReleaseTag}`);
  }
  console.log(`- .env.local 构建提交回写：${result.buildMetadataUpdated ? "已完成" : "已跳过"}`);
  console.log(`- systemd 自动重启：${result.restartedService ? `已重启 ${result.serviceUnit}` : skipRestart ? "按参数跳过" : "未执行"}`);
}

async function handleUpdateRollback(args: string[]): Promise<void> {
  const { skipRestart, serviceUnitOverride } = parseUpdateRuntimeOptions(
    args,
    "用法：themis update rollback [--service <systemd-user-service>] [--no-restart]",
  );

  console.log("Themis 受控回滚");

  const result = await rollbackThemisUpdate({
    workingDirectory: cwd,
    env: process.env,
    serviceUnitOverride,
    skipRestart,
    onProgress: (event) => {
      console.log(`- ${event.message}`);
    },
  });

  console.log("");
  console.log("结果");
  console.log(`- 回滚前提交：${formatShortCommitHash(result.previousCommit)}`);
  console.log(`- 回滚后提交：${formatShortCommitHash(result.currentCommit)}`);
  console.log(`- 当前分支：${result.branch}`);
  if (result.rolledBackReleaseTag) {
    console.log(`- 回退来源 release：${result.rolledBackReleaseTag}`);
  }
  console.log(`- .env.local 构建提交回写：${result.buildMetadataUpdated ? "已完成" : "已跳过"}`);
  console.log(`- systemd 自动重启：${result.restartedService ? `已重启 ${result.serviceUnit}` : skipRestart ? "按参数跳过" : "未执行"}`);
}

async function handleUpdateWorker(args: string[]): Promise<void> {
  const action = args[0]?.trim().toLowerCase();

  if (action !== "apply" && action !== "rollback") {
    throw new Error("用法：themis update worker <apply|rollback> [--channel <web|feishu|cli>] [--user <id>] [--name <displayName>] [--chat <chatId>] [--service <systemd-user-service>] [--no-restart]");
  }

  const { skipRestart, serviceUnitOverride } = parseUpdateRuntimeOptions(
    args.slice(1),
    "用法：themis update worker <apply|rollback> [--channel <web|feishu|cli>] [--user <id>] [--name <displayName>] [--chat <chatId>] [--service <systemd-user-service>] [--no-restart]",
    {
      passthroughValueOptions: ["--channel", "--user", "--name", "--chat"],
    },
  );
  const channel = readOptionValue(args.slice(1), "--channel")?.trim().toLowerCase();
  const normalizedChannel = channel === "web" || channel === "feishu" || channel === "cli" ? channel : "cli";

  await runManagedThemisUpdateWorker({
    action,
    workingDirectory: cwd,
    env: process.env,
    initiatedBy: {
      channel: normalizedChannel,
      channelUserId: readOptionValue(args.slice(1), "--user") ?? "codex",
      ...(readOptionValue(args.slice(1), "--name") ? { displayName: readOptionValue(args.slice(1), "--name") } : {}),
      ...(readOptionValue(args.slice(1), "--chat") ? { chatId: readOptionValue(args.slice(1), "--chat") } : {}),
    },
    serviceUnitOverride,
    skipRestart,
  });
}

function parseUpdateRuntimeOptions(
  args: string[],
  usage: string,
  options: {
    passthroughValueOptions?: string[];
  } = {},
): {
  skipRestart: boolean;
  serviceUnitOverride: string | null;
} {
  let skipRestart = false;
  let serviceUnitOverride: string | null = null;
  const passthroughValueOptions = new Set(options.passthroughValueOptions ?? []);

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === "--no-restart") {
      skipRestart = true;
      continue;
    }

    if (value === "--service") {
      const next = args[index + 1];
      if (!next?.trim()) {
        throw new Error(usage);
      }

      serviceUnitOverride = next.trim();
      index += 1;
      continue;
    }

    if (passthroughValueOptions.has(value ?? "")) {
      const next = args[index + 1];
      if (!next?.trim()) {
        throw new Error(usage);
      }

      index += 1;
      continue;
    }

    throw new Error(usage);
  }

  return {
    skipRestart,
    serviceUnitOverride,
  };
}

async function handleDoctor(subcommand: string | undefined, args: string[]): Promise<void> {
  const selected = subcommand?.trim().toLowerCase();

  if (selected === "smoke") {
    await handleDoctorSmoke(args);
    return;
  }

  if (selected === "worker-node") {
    await handleDoctorWorkerNode(args);
    return;
  }

  if (selected === "worker-fleet") {
    await handleDoctorWorkerFleet(args);
    return;
  }

  const sections = [subcommand, ...args].filter((item): item is string => Boolean(item && item.trim()));
  if (sections.length > 1) {
    throw new Error("用法：themis doctor [context|auth|provider|memory|service|mcp|feishu|worker-node|worker-fleet|release|smoke]");
  }

  const selectedSection = sections[0]?.trim().toLowerCase();
  if (selectedSection
    && !["context", "auth", "provider", "memory", "service", "mcp", "feishu", "worker-node", "worker-fleet", "release"]
      .includes(selectedSection)) {
    throw new Error("doctor 子命令仅支持 context / auth / provider / memory / service / mcp / feishu / worker-node / worker-fleet / release。");
  }

  const dbPath = resolve(cwd, "infra/local/themis.db");
  const runtimeStore = existsSync(dbPath)
    ? new SqliteCodexSessionRegistry({ databaseFile: dbPath })
    : null;
  const diagnostics = new RuntimeDiagnosticsService({
    workingDirectory: cwd,
    runtimeStore,
    sqliteFilePath: dbPath,
    mcpInspector: createCliMcpInspector(),
  });
  const summary = await diagnostics.readSummary();

  if (!selectedSection) {
    console.log("Themis 运行诊断");
    console.log("");
    console.log(`- 工作目录：${summary.workingDirectory}`);
    console.log(`- auth：${summary.auth.authFileExists ? "ok" : "missing"} (${summary.auth.authFilePath})`);
    console.log(`- provider：${summary.provider.activeMode} (${summary.provider.providerCount} 个)`);
    console.log(`- context：${countOk(summary.context.files)}/${summary.context.files.length} ok`);
    console.log(`- memory：${countOk(summary.memory.files)}/${summary.memory.files.length} ok`);
    console.log(`- feishu：${summary.feishu.diagnostics.primaryDiagnosis?.title ?? "<none>"}`);
    console.log(`- service/sqlite：${summary.service.sqlite.exists ? "ok" : "missing"} (${summary.service.sqlite.path})`);
    console.log(`- multimodal：${formatMultimodalOverview(summary.service.multimodal)}`);
    const abnormalMcpCount = summary.mcp.diagnostics.statusCounts.abnormalCount;
    console.log(`- mcp：${summary.mcp.servers.length} 个 server${summary.mcp.readError ? `（读取失败：${summary.mcp.readError}）` : abnormalMcpCount > 0 ? `（${abnormalMcpCount} 个异常）` : ""}`);

    console.log("异常热点");
    if (summary.overview.hotspots.length === 0) {
      console.log("- <none>");
    } else {
      for (const [index, hotspot] of summary.overview.hotspots.entries()) {
        console.log(`${index + 1}. [${hotspot.scope}] ${hotspot.title}：${hotspot.summary}`);
      }
    }

    console.log("建议先看");
    if (summary.overview.suggestedCommands.length === 0) {
      console.log("- <none>");
    } else {
      for (const [index, command] of summary.overview.suggestedCommands.entries()) {
        console.log(`${index + 1}. ${command}`);
      }
    }
    return;
  }

  switch (selectedSection) {
    case "context":
      console.log("Themis 诊断 - context");
      printFileStatuses(summary.context.files);
      return;
    case "auth":
      console.log("Themis 诊断 - auth");
      console.log(`defaultCodexHome：${summary.auth.defaultCodexHome}`);
      console.log(`authFile：${summary.auth.authFilePath}`);
      console.log(`authFileExists：${summary.auth.authFileExists ? "ok" : "missing"}`);
      if (summary.auth.snapshotAuthenticated !== null) {
        console.log(`snapshotAuthenticated：${summary.auth.snapshotAuthenticated ? "yes" : "no"}`);
      }
      if (summary.auth.snapshotError) {
        console.log(`snapshotError：${summary.auth.snapshotError}`);
      }
      return;
    case "provider":
      console.log("Themis 诊断 - provider");
      console.log(`activeMode：${summary.provider.activeMode}`);
      console.log(`providerCount：${summary.provider.providerCount}`);
      console.log(`providerIds：${summary.provider.providerIds.join(", ") || "<none>"}`);
      if (summary.provider.readError) {
        console.log(`readError：${summary.provider.readError}`);
      }
      return;
    case "memory":
      console.log("Themis 诊断 - memory");
      printFileStatuses(summary.memory.files);
      return;
    case "service":
      console.log("Themis 诊断 - service");
      console.log(`sqlite.path：${summary.service.sqlite.path}`);
      console.log(`sqlite.status：${summary.service.sqlite.exists ? "ok" : "missing"}`);
      console.log(`multimodal.status：${summary.service.multimodal.available ? "ok" : "unavailable"}`);
      console.log(`multimodal.recentTurnInputCount：${summary.service.multimodal.recentTurnInputCount}/${summary.service.multimodal.sampleWindowSize}`);
      console.log(
        `multimodal.assetCounts：image=${summary.service.multimodal.assetCounts.image}, document=${summary.service.multimodal.assetCounts.document}`,
      );
      console.log(
        `multimodal.degradationCounts：native=${summary.service.multimodal.degradationCounts.native}, lossless_textualization=${summary.service.multimodal.degradationCounts.losslessTextualization}, controlled_fallback=${summary.service.multimodal.degradationCounts.controlledFallback}, blocked=${summary.service.multimodal.degradationCounts.blocked}, unknown=${summary.service.multimodal.degradationCounts.unknown}`,
      );
      console.log(`multimodal.sourceChannels：${formatNamedCountList(summary.service.multimodal.sourceChannelCounts, "sourceChannel")}`);
      console.log(`multimodal.runtimeTargets：${formatNamedCountList(summary.service.multimodal.runtimeTargetCounts, "runtimeTarget")}`);
      console.log(`multimodal.warningCodes：${formatNamedCountList(summary.service.multimodal.warningCodeCounts, "code")}`);
      if (summary.service.multimodal.lastTurn) {
        console.log(`multimodal.lastTurn.requestId：${summary.service.multimodal.lastTurn.requestId}`);
        console.log(`multimodal.lastTurn.sourceChannel：${summary.service.multimodal.lastTurn.sourceChannel}`);
        console.log(`multimodal.lastTurn.sessionId：${summary.service.multimodal.lastTurn.sessionId ?? "<none>"}`);
        console.log(`multimodal.lastTurn.createdAt：${summary.service.multimodal.lastTurn.createdAt}`);
        console.log(
          `multimodal.lastTurn.compile：${summary.service.multimodal.lastTurn.runtimeTarget ?? "unknown"} / ${summary.service.multimodal.lastTurn.degradationLevel}`,
        );
        console.log(
          `multimodal.lastTurn.parts：${summary.service.multimodal.lastTurn.partTypes.join(", ") || "<none>"}`,
        );
        console.log(
          `multimodal.lastTurn.assets：${summary.service.multimodal.lastTurn.assetKinds.join(", ") || "<none>"}`,
        );
        console.log(
          `multimodal.lastTurn.warningCodes：${summary.service.multimodal.lastTurn.warningCodes.join(", ") || "<none>"}`,
        );
        console.log(
          `multimodal.lastTurn.warningMessages：${summary.service.multimodal.lastTurn.warningMessages.join(" / ") || "<none>"}`,
        );
        console.log(
          `multimodal.lastTurn.matrix.imageNative：${formatCapabilityNativeSupport(summary.service.multimodal.lastTurn.capabilityMatrix, "image")}`,
        );
        console.log(
          `multimodal.lastTurn.matrix.documentNative：${formatCapabilityNativeSupport(summary.service.multimodal.lastTurn.capabilityMatrix, "document")}`,
        );
        console.log(
          `multimodal.lastTurn.matrix.assetFacts：${formatCapabilityAssetFacts(summary.service.multimodal.lastTurn.capabilityMatrix)}`,
        );
      } else {
        console.log("multimodal.lastTurn：<none>");
      }
      if (summary.service.multimodal.lastBlockedTurn) {
        console.log(`multimodal.lastBlocked.requestId：${summary.service.multimodal.lastBlockedTurn.requestId}`);
        console.log(`multimodal.lastBlocked.sourceChannel：${summary.service.multimodal.lastBlockedTurn.sourceChannel}`);
        console.log(`multimodal.lastBlocked.sessionId：${summary.service.multimodal.lastBlockedTurn.sessionId ?? "<none>"}`);
        console.log(`multimodal.lastBlocked.createdAt：${summary.service.multimodal.lastBlockedTurn.createdAt}`);
        console.log(
          `multimodal.lastBlocked.compile：${summary.service.multimodal.lastBlockedTurn.runtimeTarget ?? "unknown"} / ${summary.service.multimodal.lastBlockedTurn.degradationLevel}`,
        );
        console.log(
          `multimodal.lastBlocked.warningCodes：${summary.service.multimodal.lastBlockedTurn.warningCodes.join(", ") || "<none>"}`,
        );
        console.log(
          `multimodal.lastBlocked.warningMessages：${summary.service.multimodal.lastBlockedTurn.warningMessages.join(" / ") || "<none>"}`,
        );
        console.log(
          `multimodal.lastBlocked.matrix.imageNative：${formatCapabilityNativeSupport(summary.service.multimodal.lastBlockedTurn.capabilityMatrix, "image")}`,
        );
        console.log(
          `multimodal.lastBlocked.matrix.documentNative：${formatCapabilityNativeSupport(summary.service.multimodal.lastBlockedTurn.capabilityMatrix, "document")}`,
        );
        console.log(
          `multimodal.lastBlocked.matrix.assetFacts：${formatCapabilityAssetFacts(summary.service.multimodal.lastBlockedTurn.capabilityMatrix)}`,
        );
      } else {
        console.log("multimodal.lastBlocked：<none>");
      }
      return;
    case "mcp":
      console.log("Themis 诊断 - mcp");
      console.log("说明：这里展示的是当前 Codex app-server 可见的 MCP server，不等于 Themis 原生能力清单。");
      console.log(`serverCount：${summary.mcp.servers.length}`);
      console.log(`healthyCount：${summary.mcp.diagnostics.statusCounts.healthyCount}`);
      console.log(`abnormalCount：${summary.mcp.diagnostics.statusCounts.abnormalCount}`);
      console.log(`unknownCount：${summary.mcp.diagnostics.statusCounts.unknownCount}`);
      for (const diagnosis of summary.mcp.diagnostics.serverDiagnoses) {
        console.log(`${diagnosis.server.name}(${diagnosis.server.id})：${diagnosis.server.status}`);
        console.log(`  分类：${diagnosis.classification}`);
        const details = formatMcpServerDetails(diagnosis.server);
        if (details) {
          console.log(`  细节：${details}`);
        }
        console.log(`  摘要：${diagnosis.summary}`);
        if (diagnosis.recommendedActions.length > 0) {
          console.log("  建议动作：");
          for (const [index, step] of diagnosis.recommendedActions.entries()) {
            console.log(`  ${index + 1}. ${step}`);
          }
        }
      }
      if (summary.mcp.readError) {
        console.log(`readError：${summary.mcp.readError}`);
      }
      console.log("问题判断");
      console.log(`主诊断：${summary.mcp.diagnostics.primaryDiagnosis?.title ?? "<none>"}`);
      console.log(`诊断摘要：${summary.mcp.diagnostics.primaryDiagnosis?.summary ?? "<none>"}`);
      console.log("建议动作：");
      for (const [index, step] of summary.mcp.diagnostics.recommendedNextSteps.entries()) {
        console.log(`${index + 1}. ${step}`);
      }
      return;
    case "feishu":
      printFeishuDiagnosticsSummary(summary.feishu);
      return;
    case "release": {
      const smokeService = new RuntimeSmokeService({
        workingDirectory: cwd,
        env: process.env,
      });
      const releaseStartedAt = Date.now();
      console.log("Themis 发布就绪检查 - 进行中");
      console.log("1/3 运行诊断基线：已读取。");
      console.log("2/3 真实 Web smoke：开始（会串行验证图片 native 与文档 fallback，可能耗时 1-3 分钟）...");
      const webSmokeStartedAt = Date.now();
      const web = await smokeService.runWebSmoke({
        onProgress: createSmokeProgressPrinter("   - "),
      });
      console.log(`2/3 真实 Web smoke：${web.ok ? "完成" : "失败"}（耗时 ${formatElapsedDuration(Date.now() - webSmokeStartedAt)}）`);
      let feishu = null;

      if (web.ok) {
        console.log("3/3 飞书 smoke 前置检查：开始...");
        const feishuSmokeStartedAt = Date.now();
        feishu = await smokeService.runFeishuSmoke({
          onProgress: createSmokeProgressPrinter("   - "),
        });
        console.log(
          `3/3 飞书 smoke 前置检查：${feishu.ok ? "完成" : "失败"}（耗时 ${formatElapsedDuration(Date.now() - feishuSmokeStartedAt)}）`,
        );
      } else {
        console.log("3/3 飞书 smoke 前置检查：已跳过（Web smoke 未通过）。");
      }

      console.log(`阶段执行总耗时：${formatElapsedDuration(Date.now() - releaseStartedAt)}`);
      console.log("");
      const smoke = {
        ok: web.ok && feishu?.ok === true,
        web,
        feishu,
        message: web.ok
          ? (feishu?.ok ? "Web smoke 与 Feishu smoke 前置检查都已通过。" : (feishu?.message ?? "飞书 smoke 前置检查未通过。"))
          : web.message,
      };
      const releaseSummary = summarizeReleaseReadiness({
        workingDirectory: cwd,
        diagnostics: summary,
        smoke,
      });
      printReleaseReadinessSummary(releaseSummary);
      process.exitCode = releaseSummary.ok ? 0 : 1;
      return;
    }
    default:
      return;
  }
}

async function handleDoctorWorkerNode(args: string[]): Promise<void> {
  const valueOptions = ["--platform", "--owner-principal", "--token", "--workspace", "--credential", "--provider"];
  const unknownArgs = collectUnknownOptions(args, valueOptions, []);

  if (unknownArgs.length > 0) {
    throw new Error(`doctor worker-node 不支持这些参数：${unknownArgs.join(", ")}`);
  }

  const dbPath = resolve(cwd, "infra/local/themis.db");
  const runtimeStore = existsSync(dbPath)
    ? new SqliteCodexSessionRegistry({ databaseFile: dbPath })
    : null;
  const workspaceCapabilities = readOptionValues(args, "--workspace");
  const credentialCapabilities = readOptionValues(args, "--credential");
  const providerCapabilities = readOptionValues(args, "--provider");
  const diagnostics = new WorkerNodeDiagnosticsService({
    workingDirectory: cwd,
    runtimeStore,
    sqliteFilePath: dbPath,
  });
  const summary = await diagnostics.readSummary({
    workspaceCapabilities: workspaceCapabilities.length > 0 ? workspaceCapabilities : [cwd],
    credentialCapabilities,
    providerCapabilities,
    platformBaseUrl: readOptionValue(args, "--platform"),
    ownerPrincipalId: readOptionValue(args, "--owner-principal"),
    webAccessToken: readOptionValue(args, "--token"),
  });

  console.log("Themis 诊断 - worker-node");
  console.log(`sqlite.path：${summary.sqlite.path}`);
  console.log(`sqlite.status：${summary.sqlite.exists ? "ok" : "missing"}`);
  console.log(`workspaceCount：${summary.workspaces.length}`);
  for (const workspace of summary.workspaces) {
    console.log(`workspace[${workspace.inputPath}]：${workspace.status}`);
    if (workspace.inputPath !== workspace.resolvedPath) {
      console.log(`  resolvedPath：${workspace.resolvedPath}`);
    }
  }
  console.log(`credentialCount：${summary.credentials.length}`);
  if (summary.credentials.length === 0) {
    console.log("credential：<none>");
  } else {
    for (const credential of summary.credentials) {
      console.log(
        `credential[${credential.credentialId}]：${credential.status}${credential.codexHome ? ` (active=${credential.isActive ? "yes" : "no"}, codexHome=${credential.codexHome})` : ""}`,
      );
    }
  }
  console.log(`providerCount：${summary.providers.length}`);
  if (summary.providers.length === 0) {
    console.log("provider：<none>");
  } else {
    for (const provider of summary.providers) {
      console.log(
        `provider[${provider.providerId}]：${provider.status}${provider.source ? ` (source=${provider.source}, defaultModel=${provider.defaultModel ?? "<none>"})` : ""}`,
      );
      if (provider.message) {
        console.log(`  message：${provider.message}`);
      }
    }
  }
  console.log(`platform.status：${summary.platform.status}`);
  console.log(`platform.baseUrl：${summary.platform.baseUrl ?? "<none>"}`);
  console.log(`platform.nodeCount：${summary.platform.nodeCount ?? "<none>"}`);
  console.log(`platform.message：${summary.platform.message ?? "<none>"}`);
  console.log("问题判断");
  console.log(`主诊断：${summary.primaryDiagnosis.title}`);
  console.log(`诊断摘要：${summary.primaryDiagnosis.summary}`);
  console.log("建议动作：");
  for (const [index, step] of summary.recommendedNextSteps.entries()) {
    console.log(`${index + 1}. ${step}`);
  }
}

async function handleDoctorWorkerFleet(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "用法：themis doctor worker-fleet --platform <baseUrl> --owner-principal <principalId> --token <platformToken> [--organization <organizationId>] [--json] [--fail-on <error|warning>]",
    );
    console.log("说明：批量读取平台节点列表与 detail，输出当前 Worker Node 集群的值守摘要与建议动作。");
    return;
  }

  const valueOptions = ["--platform", "--owner-principal", "--token", "--organization", "--fail-on"];
  const flagOptions = ["--json"];
  const unknownArgs = collectUnknownOptions(args, valueOptions, flagOptions);

  if (unknownArgs.length > 0) {
    throw new Error(`doctor worker-fleet 不支持这些参数：${unknownArgs.join(", ")}`);
  }

  const platformBaseUrl = readOptionValue(args, "--platform");
  const ownerPrincipalId = readOptionValue(args, "--owner-principal");
  const webAccessToken = readOptionValue(args, "--token");

  if (!platformBaseUrl || !ownerPrincipalId || !webAccessToken) {
    throw new Error(
      "用法：themis doctor worker-fleet --platform <baseUrl> --owner-principal <principalId> --token <platformToken> [--organization <organizationId>] [--json] [--fail-on <error|warning>]",
    );
  }

  const failOnRaw = readOptionValue(args, "--fail-on");
  const failOn = normalizeDoctorFailOn(failOnRaw);

  if (failOnRaw && !failOn) {
    throw new Error("doctor worker-fleet --fail-on 仅支持 error / warning。");
  }

  const diagnostics = new WorkerFleetDiagnosticsService();
  const summary = await diagnostics.readSummary({
    platformBaseUrl,
    ownerPrincipalId,
    webAccessToken,
    organizationId: readOptionValue(args, "--organization"),
  });

  if (args.includes("--json")) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("Themis 诊断 - worker-fleet");
    console.log(`platform.baseUrl：${summary.platformBaseUrl}`);
    console.log(`platform.organizationId：${summary.organizationId ?? "<none>"}`);
    console.log(`nodeCount：${summary.nodeCount}`);
    console.log(`status.online：${summary.counts.online}`);
    console.log(`status.draining：${summary.counts.draining}`);
    console.log(`status.offline：${summary.counts.offline}`);
    console.log(`heartbeat.stale：${summary.counts.stale}`);
    console.log(`heartbeat.expired：${summary.counts.expired}`);
    console.log(`attention.errorCount：${summary.counts.errorCount}`);
    console.log(`attention.warningCount：${summary.counts.warningCount}`);

    for (const node of summary.nodes) {
      console.log(`node[${node.node.displayName}|${node.node.nodeId}]：${node.node.status}`);
      console.log(`  slots：${node.node.slotAvailable}/${node.node.slotCapacity}`);
      console.log(
        `  heartbeat：${node.heartbeatFreshness} (age=${formatOptionalSeconds(node.heartbeatAgeSeconds)}, ttl=${node.node.heartbeatTtlSeconds}s, remaining=${formatOptionalSeconds(node.heartbeatRemainingSeconds)})`,
      );
      console.log(
        `  leases：active=${node.leaseSummary?.activeCount ?? "<unknown>"}, revoked=${node.leaseSummary?.revokedCount ?? "<unknown>"}, total=${node.leaseSummary?.totalCount ?? "<unknown>"}`,
      );
      if (node.detailError) {
        console.log(`  detailError：${node.detailError}`);
      }
      if (node.attention) {
        console.log(`  attention：${node.attention.severity} - ${node.attention.summary}`);
        console.log(`  nextStep：${node.attention.recommendedAction}`);
      }
    }

    console.log("问题判断");
    console.log(`主诊断：${summary.primaryDiagnosis.title}`);
    console.log(`诊断摘要：${summary.primaryDiagnosis.summary}`);
    console.log("建议动作：");
    for (const [index, step] of summary.recommendedNextSteps.entries()) {
      console.log(`${index + 1}. ${step}`);
    }
  }

  if (shouldFailWorkerFleetDoctor(summary, failOn)) {
    process.exitCode = 1;
  }
}

async function handleMcpServer(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("用法：themis mcp-server [--channel <channel>] [--user <channelUserId>] [--name <displayName>] [--session <sessionId>] [--channel-session-key <key>]");
    console.log("说明：通过 stdio 启动 Themis MCP server，暴露定时任务工具给 Codex 调用。");
    return;
  }

  const unknownArgs = args.filter((value, index) => {
    if (!value.startsWith("-")) {
      return index === 0;
    }

    if (["--channel", "--user", "--name", "--session", "--channel-session-key"].includes(value)) {
      return false;
    }

    const previous = args[index - 1];
    return !["--channel", "--user", "--name", "--session", "--channel-session-key"].includes(previous ?? "");
  });

  if (unknownArgs.length > 0) {
    throw new Error(`mcp-server 不支持这些参数：${unknownArgs.join(", ")}`);
  }

  await runThemisMcpServer({
    workingDirectory: cwd,
    identity: {
      channel: readOptionValue(args, "--channel") ?? "cli",
      channelUserId: readOptionValue(args, "--user") ?? "codex",
      ...(readOptionValue(args, "--name") ? { displayName: readOptionValue(args, "--name") as string } : {}),
    },
    ...(readOptionValue(args, "--session") ? { sessionId: readOptionValue(args, "--session") as string } : {}),
    ...(readOptionValue(args, "--channel-session-key") ? { channelSessionKey: readOptionValue(args, "--channel-session-key") as string } : {}),
  });
}

async function handleWorkerNode(subcommand: string | undefined, args: string[]): Promise<void> {
  const action = subcommand?.trim().toLowerCase();

  if (action !== "run") {
    throw new Error(
      "用法：themis worker-node run --platform <baseUrl> --owner-principal <principalId> --token <platformToken> --name <displayName> [--node-id <nodeId>] [--organization <organizationId>] [--workspace <path>] [--credential <id>] [--provider <id>] [--label <label>] [--slot-capacity <n>] [--slot-available <n>] [--heartbeat-ttl-seconds <n>] [--poll-interval-ms <n>] [--heartbeat-interval-ms <n>] [--once]",
    );
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "用法：themis worker-node run --platform <baseUrl> --owner-principal <principalId> --token <platformToken> --name <displayName> [--node-id <nodeId>] [--organization <organizationId>] [--workspace <path>] [--credential <id>] [--provider <id>] [--label <label>] [--slot-capacity <n>] [--slot-available <n>] [--heartbeat-ttl-seconds <n>] [--poll-interval-ms <n>] [--heartbeat-interval-ms <n>] [--once]",
    );
    console.log("说明：以轻量 Worker Node 形态连接平台，执行 register -> heartbeat -> pull -> execute -> report 最小闭环。");
    return;
  }

  const valueOptions = [
    "--platform",
    "--owner-principal",
    "--token",
    "--name",
    "--node-id",
    "--organization",
    "--workspace",
    "--credential",
    "--provider",
    "--label",
    "--slot-capacity",
    "--slot-available",
    "--heartbeat-ttl-seconds",
    "--poll-interval-ms",
    "--heartbeat-interval-ms",
  ];
  const flagOptions = ["--once"];
  const unknownArgs = collectUnknownOptions(args, valueOptions, flagOptions);

  if (unknownArgs.length > 0) {
    throw new Error(`worker-node run 不支持这些参数：${unknownArgs.join(", ")}`);
  }

  const platformBaseUrl = readOptionValue(args, "--platform");
  const ownerPrincipalId = readOptionValue(args, "--owner-principal");
  const webAccessToken = readOptionValue(args, "--token");
  const displayName = readOptionValue(args, "--name");

  if (!platformBaseUrl || !ownerPrincipalId || !webAccessToken || !displayName) {
    throw new Error(
      "用法：themis worker-node run --platform <baseUrl> --owner-principal <principalId> --token <platformToken> --name <displayName> [--node-id <nodeId>] [--organization <organizationId>] [--workspace <path>] [--credential <id>] [--provider <id>] [--label <label>] [--slot-capacity <n>] [--slot-available <n>] [--heartbeat-ttl-seconds <n>] [--poll-interval-ms <n>] [--heartbeat-interval-ms <n>] [--once]",
    );
  }

  const slotCapacity = readOptionPositiveInteger(args, "--slot-capacity") ?? 1;
  const slotAvailable = readOptionPositiveInteger(args, "--slot-available") ?? slotCapacity;
  const heartbeatTtlSeconds = readOptionPositiveInteger(args, "--heartbeat-ttl-seconds") ?? 30;
  const pollIntervalMs = readOptionPositiveInteger(args, "--poll-interval-ms") ?? 5_000;
  const heartbeatIntervalMs = readOptionPositiveInteger(args, "--heartbeat-interval-ms") ?? 10_000;
  const workspaceCapabilities = readOptionValues(args, "--workspace");
  const credentialCapabilities = readOptionValues(args, "--credential");
  const providerCapabilities = readOptionValues(args, "--provider");
  const labels = readOptionValues(args, "--label");
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: cliDatabasePath,
  });
  ensureWorkerNodeCredentialAccounts(runtimeStore, cwd, credentialCapabilities);
  const runtime = new AppServerTaskRuntime({
    workingDirectory: cwd,
    runtimeStore,
  });
  const client = new ManagedAgentPlatformWorkerClient({
    baseUrl: platformBaseUrl,
    ownerPrincipalId,
    webAccessToken,
  });
  const daemon = new ManagedAgentWorkerDaemon({
    client,
    runtime,
    node: {
      ...(readOptionValue(args, "--node-id") ? { nodeId: readOptionValue(args, "--node-id") as string } : {}),
      ...(readOptionValue(args, "--organization") ? { organizationId: readOptionValue(args, "--organization") as string } : {}),
      displayName,
      slotCapacity,
      slotAvailable,
      labels,
      workspaceCapabilities: workspaceCapabilities.length > 0 ? workspaceCapabilities : [cwd],
      credentialCapabilities,
      providerCapabilities,
      heartbeatTtlSeconds,
    },
    pollIntervalMs,
    heartbeatIntervalMs,
    log: (message) => {
      console.log(message);
    },
  });

  if (args.includes("--once")) {
    const result = await daemon.runOnce();
    console.log(`Worker Node：${result.nodeId}`);
    console.log(`结果：${result.result}`);
    if (result.executedRunId) {
      console.log(`runId：${result.executedRunId}`);
    }
    return;
  }

  const controller = new AbortController();
  const stop = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(`Worker Node 已启动：${displayName}`);

  try {
    await daemon.runLoop(controller.signal);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

async function handleWorkerFleet(subcommand: string | undefined, args: string[]): Promise<void> {
  const action = subcommand?.trim().toLowerCase();

  if (action !== "drain" && action !== "offline" && action !== "reclaim") {
    throw new Error(
      "用法：themis worker-fleet <drain|offline|reclaim> --platform <baseUrl> --owner-principal <principalId> --token <platformToken> --node <nodeId> [--node <nodeId> ...] [--failure-code <code>] [--failure-message <message>] --yes",
    );
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "用法：themis worker-fleet <drain|offline|reclaim> --platform <baseUrl> --owner-principal <principalId> --token <platformToken> --node <nodeId> [--node <nodeId> ...] [--failure-code <code>] [--failure-message <message>] --yes",
    );
    console.log("说明：面向值班的 Worker Node 平台治理入口；支持对多个 nodeId 顺序执行 drain / offline / reclaim。");
    return;
  }

  const valueOptions = ["--platform", "--owner-principal", "--token", "--node", "--failure-code", "--failure-message"];
  const flagOptions = ["--yes"];
  const unknownArgs = collectUnknownOptions(args, valueOptions, flagOptions);

  if (unknownArgs.length > 0) {
    throw new Error(`worker-fleet ${action} 不支持这些参数：${unknownArgs.join(", ")}`);
  }

  const platformBaseUrl = readOptionValue(args, "--platform");
  const ownerPrincipalId = readOptionValue(args, "--owner-principal");
  const webAccessToken = readOptionValue(args, "--token");
  const nodeIds = readOptionValues(args, "--node");

  if (!platformBaseUrl || !ownerPrincipalId || !webAccessToken || nodeIds.length === 0) {
    throw new Error(
      "用法：themis worker-fleet <drain|offline|reclaim> --platform <baseUrl> --owner-principal <principalId> --token <platformToken> --node <nodeId> [--node <nodeId> ...] [--failure-code <code>] [--failure-message <message>] --yes",
    );
  }

  if (!args.includes("--yes")) {
    throw new Error(`worker-fleet ${action} 是治理动作，必须显式追加 --yes。`);
  }

  if ((action === "drain" || action === "offline") && (readOptionValue(args, "--failure-code") || readOptionValue(args, "--failure-message"))) {
    throw new Error(`worker-fleet ${action} 不支持 --failure-code / --failure-message；它们只适用于 reclaim。`);
  }

  const service = new WorkerFleetGovernanceService();
  const summary = await service.execute({
    platformBaseUrl,
    ownerPrincipalId,
    webAccessToken,
    action,
    nodeIds,
    ...(action === "reclaim" && readOptionValue(args, "--failure-code")
      ? { failureCode: readOptionValue(args, "--failure-code") }
      : {}),
    ...(action === "reclaim" && readOptionValue(args, "--failure-message")
      ? { failureMessage: readOptionValue(args, "--failure-message") }
      : {}),
  });

  console.log(`Themis Worker Fleet 治理 - ${summary.action}`);
  console.log(`platform.baseUrl：${summary.platformBaseUrl}`);
  console.log(`requestedNodeCount：${summary.requestedNodeIds.length}`);
  console.log(`requestedNodeIds：${summary.requestedNodeIds.join(", ")}`);
  console.log(`result.successCount：${summary.successCount}`);
  console.log(`result.failureCount：${summary.failureCount}`);

  for (const result of summary.results) {
    console.log(`node[${result.nodeId}]：${result.outcome}`);
    if (result.node) {
      console.log(`  status：${result.node.status}`);
      console.log(`  slots：${result.node.slotAvailable}/${result.node.slotCapacity}`);
    }
    if (result.reclaim) {
      console.log(`  reclaimed.activeLeaseCount：${result.reclaim.summary.activeLeaseCount}`);
      console.log(`  reclaimed.reclaimedRunCount：${result.reclaim.summary.reclaimedRunCount}`);
      console.log(`  reclaimed.requeuedWorkItemCount：${result.reclaim.summary.requeuedWorkItemCount}`);
      console.log(`  reclaimed.preservedWaitingCount：${result.reclaim.summary.preservedWaitingCount}`);
      console.log(`  reclaimed.revokedLeaseOnlyCount：${result.reclaim.summary.revokedLeaseOnlyCount}`);
    }
    if (result.errorMessage) {
      console.log(`  error：${result.errorMessage}`);
    }
  }

  if (summary.failureCount > 0) {
    process.exitCode = 1;
  }
}

async function handleDoctorSmoke(args: string[]): Promise<number> {
  if (args.length !== 1) {
    throw new Error("用法：themis doctor smoke <web|feishu|all>");
  }

  const target = args[0]?.trim().toLowerCase();

  if (!target || !["web", "feishu", "all"].includes(target)) {
    throw new Error("doctor smoke 子命令仅支持 web / feishu / all。");
  }

  const smokeService = new RuntimeSmokeService({
    workingDirectory: cwd,
    env: process.env,
  });

  switch (target) {
    case "web": {
      console.log("Themis smoke - web - 进行中");
      const web = await smokeService.runWebSmoke({
        onProgress: createSmokeProgressPrinter("- "),
      });
      console.log("");
      printWebSmokeResult(web);
      return web.ok ? 0 : 1;
    }
    case "feishu": {
      const feishu = await smokeService.runFeishuSmoke();
      printFeishuSmokeResult(feishu);
      return feishu.ok ? 0 : 1;
    }
    case "all": {
      console.log("Themis smoke - all - 进行中");
      const all = await smokeService.runAllSmoke({
        onProgress: createSmokeProgressPrinter("- "),
      });
      console.log("");
      printWebSmokeResult(all.web);

      if (all.feishu) {
        console.log("");
        printFeishuSmokeResult(all.feishu);
      } else if (!all.web.ok) {
        console.log("");
        console.log("Feishu smoke 已跳过：Web smoke 未通过，先修复 Web 链路后再继续。");
      }

      return all.ok ? 0 : 1;
    }
    default:
      throw new Error("doctor smoke 子命令仅支持 web / feishu / all。");
  }
}

function handleConfig(subcommand: string | undefined, args: string[]): void {
  switch (subcommand) {
    case "list":
      handleConfigList(args);
      return;
    case "set":
      handleConfigSet(args);
      return;
    case "unset":
      handleConfigUnset(args);
      return;
    default:
      throw new Error("config 子命令仅支持 list / set / unset。");
  }
}

async function handleBackup(subcommand: string | undefined, args: string[]): Promise<void> {
  switch (subcommand) {
    case "create":
      await handleBackupCreate(args);
      return;
    case "restore":
      await handleBackupRestore(args);
      return;
    default:
      throw new Error("backup 子命令仅支持 create / restore。");
  }
}

async function handleBackupCreate(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("用法：themis backup create [--database <sqlitePath>] [--output <backupPath>]");
    console.log("说明：对当前 Themis SQLite 数据库做一致性备份，默认输出到 infra/backups/。");
    return;
  }

  const valueOptions = ["--database", "--output"];
  const unknownArgs = collectUnknownOptions(args, valueOptions, []);

  if (unknownArgs.length > 0) {
    throw new Error(`backup create 不支持这些参数：${unknownArgs.join(", ")}`);
  }

  const service = new PlatformBackupService();
  const result = await service.createBackup({
    sourcePath: readOptionValue(args, "--database") ?? cliDatabasePath,
    ...(readOptionValue(args, "--output") ? { outputPath: readOptionValue(args, "--output")! } : {}),
  });

  console.log("Themis SQLite 备份已创建");
  console.log(`- sourcePath：${result.sourcePath}`);
  console.log(`- outputPath：${result.outputPath}`);
  console.log(`- createdAt：${result.createdAt}`);
  console.log(`- sizeBytes：${result.sizeBytes}`);
}

async function handleBackupRestore(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("用法：themis backup restore --input <backupPath> [--database <sqlitePath>] --yes");
    console.log("说明：先自动备份当前库，再把指定快照恢复到目标 SQLite；执行前应先停掉常驻服务。");
    return;
  }

  const valueOptions = ["--input", "--database"];
  const flagOptions = ["--yes"];
  const unknownArgs = collectUnknownOptions(args, valueOptions, flagOptions);

  if (unknownArgs.length > 0) {
    throw new Error(`backup restore 不支持这些参数：${unknownArgs.join(", ")}`);
  }

  const inputPath = readOptionValue(args, "--input");

  if (!inputPath || !args.includes("--yes")) {
    throw new Error("用法：themis backup restore --input <backupPath> [--database <sqlitePath>] --yes");
  }

  const service = new PlatformBackupService();
  const result = await service.restoreBackup({
    inputPath,
    targetPath: readOptionValue(args, "--database") ?? cliDatabasePath,
  });

  console.log("Themis SQLite 已从备份恢复");
  console.log(`- inputPath：${result.inputPath}`);
  console.log(`- targetPath：${result.targetPath}`);
  console.log(`- restoredAt：${result.restoredAt}`);
  console.log(`- sizeBytes：${result.sizeBytes}`);
  if (result.previousBackupPath) {
    console.log(`- previousBackupPath：${result.previousBackupPath}`);
  }
}

async function handleAuth(subcommand: string | undefined, args: string[]): Promise<void> {
  switch (subcommand) {
    case "web":
      await handleAuthWeb(args);
      return;
    case "platform":
      await handleAuthPlatform(args);
      return;
    default:
      throw new Error("auth 子命令仅支持 web / platform。");
  }
}

async function handleAuthWeb(args: string[]): Promise<void> {
  const [action, ...rest] = args;

  switch (action) {
    case "list":
      if (rest.length > 0) {
        throw new Error("用法：themis auth web list");
      }

      handleAuthWebList();
      return;
    case "add":
      if (rest.length !== 1) {
        throw new Error("用法：themis auth web add <label>");
      }

      await handleAuthWebAdd(rest[0]!);
      return;
    case "remove":
      if (rest.length !== 1) {
        throw new Error("用法：themis auth web remove <label>");
      }

      handleAuthWebRemove(rest[0]!);
      return;
    case "rename":
      if (rest.length !== 2) {
        throw new Error("用法：themis auth web rename <old-label> <new-label>");
      }

      handleAuthWebRename(rest[0]!, rest[1]!);
      return;
    default:
      throw new Error("auth web 子命令仅支持 list / add / remove / rename。");
  }
}

async function handleAuthPlatform(args: string[]): Promise<void> {
  const [action, ...rest] = args;
  const valueOptions = ["--role", "--owner-principal"];
  const unknownOptions = collectUnknownOptions(rest, valueOptions, []).filter((arg) => arg.startsWith("-"));

  if (unknownOptions.length > 0) {
    throw new Error(`未知参数：${unknownOptions.join(", ")}`);
  }

  switch (action) {
    case "list": {
      const positionals = collectPositionalArgs(rest, valueOptions, []);

      if (positionals.length > 0 || readOptionValue(rest, "--role") || readOptionValue(rest, "--owner-principal")) {
        throw new Error("用法：themis auth platform list");
      }

      handleAuthPlatformList();
      return;
    }
    case "add": {
      const positionals = collectPositionalArgs(rest, valueOptions, []);
      const role = normalizePlatformServiceRole(readOptionValue(rest, "--role"));
      const ownerPrincipalId = readOptionValue(rest, "--owner-principal");

      if (positionals.length !== 1 || !role || !ownerPrincipalId) {
        throw new Error(
          "用法：themis auth platform add <label> --role <gateway|worker> --owner-principal <principalId>",
        );
      }

      await handleAuthPlatformAdd(positionals[0]!, role, ownerPrincipalId);
      return;
    }
    case "remove": {
      const positionals = collectPositionalArgs(rest, valueOptions, []);

      if (positionals.length !== 1 || readOptionValue(rest, "--role") || readOptionValue(rest, "--owner-principal")) {
        throw new Error("用法：themis auth platform remove <label>");
      }

      handleAuthPlatformRemove(positionals[0]!);
      return;
    }
    case "rename": {
      const positionals = collectPositionalArgs(rest, valueOptions, []);

      if (positionals.length !== 2 || readOptionValue(rest, "--role") || readOptionValue(rest, "--owner-principal")) {
        throw new Error("用法：themis auth platform rename <old-label> <new-label>");
      }

      handleAuthPlatformRename(positionals[0]!, positionals[1]!);
      return;
    }
    default:
      throw new Error("auth platform 子命令仅支持 list / add / remove / rename。");
  }
}

function handleConfigList(args: string[]): void {
  const showSecrets = args.includes("--show-secrets");
  const envFiles = readProjectEnvFiles(cwd);

  console.log("Themis 可配置项");
  console.log("");

  for (const section of listProjectConfigSections()) {
    console.log(section);

    for (const definition of listProjectConfigDefinitionsBySection(section)) {
      const resolved = resolveConfigValue(definition.key, envFiles);
      const display = definition.secret && !showSecrets
        ? maskSecretValue(resolved.value)
        : (resolved.value || "未配置");
      const source = resolved.sourceLabel;
      console.log(`- ${definition.key} = ${display} (${source})`);
      console.log(`  ${definition.description}`);

      if (definition.note) {
        console.log(`  说明：${definition.note}`);
      }
    }

    console.log("");
  }

  console.log("提示：真实 shell 环境变量优先级高于 .env / .env.local。");
}

function handleConfigSet(args: string[]): void {
  const [key, ...valueParts] = args;
  const localEnvPath = resolvePrimaryProjectEnvFile(cwd);

  if (!key || !valueParts.length) {
    throw new Error("用法：npm run themis -- config set <KEY> <VALUE>");
  }

  const definition = findProjectConfigDefinition(key);

  if (!definition) {
    throw new Error(`未知配置键：${key}。先执行 \`npm run themis -- config list\` 查看支持项。`);
  }

  const value = valueParts.join(" ").trim();
  setProjectEnvValue(localEnvPath, definition.key, value);
  console.log(`已写入 ${definition.key}=${definition.secret ? maskSecretValue(value) : escapeEnvValue(value)} 到 ${localEnvPath}`);
}

function handleConfigUnset(args: string[]): void {
  const [key] = args;
  const localEnvPath = resolvePrimaryProjectEnvFile(cwd);

  if (!key) {
    throw new Error("用法：npm run themis -- config unset <KEY>");
  }

  const definition = findProjectConfigDefinition(key);

  if (!definition) {
    throw new Error(`未知配置键：${key}。先执行 \`npm run themis -- config list\` 查看支持项。`);
  }

  const removed = unsetProjectEnvValue(localEnvPath, definition.key);
  console.log(removed ? `已从 ${localEnvPath} 移除 ${definition.key}` : `${definition.key} 当前不在 ${localEnvPath} 中`);
}

async function handleSkill(subcommand: string | undefined, args: string[]): Promise<void> {
  switch (subcommand) {
    case "list":
      handleSkillList(args);
      return;
    case "curated":
      await handleSkillCurated(args);
      return;
    case "install":
      await handleSkillInstall(args);
      return;
    case "remove":
      handleSkillRemove(args);
      return;
    case "sync":
      await handleSkillSync(args);
      return;
    default:
      throw new Error("skill 子命令仅支持 list / curated / install / remove / sync。");
  }
}

function printHelp(surface: ThemisCliSurface = "themis", launcherName = DEFAULT_THEMIS_LAUNCHER_NAME): void {
  if (surface === "platform") {
    console.log("Themis Platform CLI");
    console.log("");
    console.log("可用命令：");
    console.log(`- ./${launcherName} help`);
    console.log(`- ./${launcherName} backup create [--database <sqlitePath>] [--output <backupPath>]`);
    console.log(`- ./${launcherName} backup restore --input <backupPath> [--database <sqlitePath>] --yes`);
    console.log(`- ./${launcherName} auth platform list`);
    console.log(`- ./${launcherName} auth platform add <label> --role <gateway|worker> --owner-principal <principalId>`);
    console.log(`- ./${launcherName} auth platform remove <label>`);
    console.log(`- ./${launcherName} auth platform rename <old-label> <new-label>`);
    console.log(`- ./${launcherName} doctor worker-fleet --platform <baseUrl> --owner-principal <principalId> --token <platformToken>`);
    console.log(`- ./${launcherName} worker-fleet <drain|offline|reclaim> --platform <baseUrl> --owner-principal <principalId> --token <platformToken> --node <nodeId> [--node <nodeId> ...] --yes`);
    console.log("");
    console.log("当前这是拆仓过渡期的独立平台 CLI 入口；主 Themis 上的同类命令仅保留兼容别名。");
    return;
  }

  if (surface === "worker-node") {
    console.log("Themis Worker Node CLI");
    console.log("");
    console.log("可用命令：");
    console.log(`- ./${launcherName} help`);
    console.log(`- ./${launcherName} doctor worker-node --platform <baseUrl> --owner-principal <principalId> --token <platformToken> --workspace <path>`);
    console.log(`- ./${launcherName} worker-node run --platform <baseUrl> --owner-principal <principalId> --token <platformToken> --name <displayName> [--once]`);
    console.log("");
    console.log("当前这是拆仓过渡期的独立 Worker Node CLI 入口；主 Themis 上的同类命令仅保留兼容别名。");
    return;
  }

  console.log("Themis 项目级 CLI");
  console.log("");
  console.log("可用命令：");
  console.log(`- ./${launcherName}              # 进入交互模式`);
  console.log(`- ./${launcherName} install      # 安装到用户目录，无需 sudo`);
  console.log(`- ./${launcherName} init`);
  console.log(`- ./${launcherName} status`);
  console.log(`- ./${launcherName} check`);
  console.log(`- ./${launcherName} update`);
  console.log(`- ./${launcherName} update check`);
  console.log(`- ./${launcherName} update apply [--service <systemd-user-service>] [--no-restart]`);
  console.log(`- ./${launcherName} update rollback [--service <systemd-user-service>] [--no-restart]`);
  console.log(`- ./${launcherName} doctor`);
  console.log(`- ./${launcherName} doctor <context|auth|provider|memory|service|mcp|feishu|worker-node|worker-fleet|release>`);
  console.log(`- ./${launcherName} doctor smoke <web|feishu|all>`);
  console.log(`- ./${launcherName} config list [--show-secrets]`);
  console.log(`- ./${launcherName} config set <KEY> <VALUE>`);
  console.log(`- ./${launcherName} config unset <KEY>`);
  console.log(`- ./${launcherName} backup create [--database <sqlitePath>] [--output <backupPath>]`);
  console.log(`- ./${launcherName} backup restore --input <backupPath> [--database <sqlitePath>] --yes`);
  console.log(`- ./${launcherName} auth web list`);
  console.log(`- ./${launcherName} auth web add <label>`);
  console.log(`- ./${launcherName} auth web remove <label>`);
  console.log(`- ./${launcherName} auth web rename <old-label> <new-label>`);
  console.log(`- ./${launcherName} auth platform list`);
  console.log(`- ./${launcherName} auth platform add <label> --role <gateway|worker> --owner-principal <principalId>`);
  console.log(`- ./${launcherName} auth platform remove <label>`);
  console.log(`- ./${launcherName} auth platform rename <old-label> <new-label>`);
  console.log(`- ./${launcherName} skill list`);
  console.log(`- ./${launcherName} skill curated list`);
  console.log(`- ./${launcherName} skill install local <ABSOLUTE_PATH>`);
  console.log(`- ./${launcherName} skill install url <GITHUB_URL> [REF]`);
  console.log(`- ./${launcherName} skill install repo <REPO> <PATH> [REF]`);
  console.log(`- ./${launcherName} skill install curated <SKILL_NAME>`);
  console.log(`- ./${launcherName} skill remove <SKILL_NAME>`);
  console.log(`- ./${launcherName} skill sync <SKILL_NAME> [--force]`);
  console.log(`- ./${launcherName} mcp-server [--channel <channel>] [--user <channelUserId>] [--name <displayName>] [--session <sessionId>] [--channel-session-key <key>]`);
  console.log(`- ./${launcherName} worker-node run --platform <baseUrl> --owner-principal <principalId> --token <platformToken> --name <displayName> [--once]`);
  console.log(`- ./${launcherName} worker-fleet <drain|offline|reclaim> --platform <baseUrl> --owner-principal <principalId> --token <platformToken> --node <nodeId> [--node <nodeId> ...] --yes`);
  console.log("");
  console.log(`兼容入口提示：平台和值班命令正在迁往 ./${DEFAULT_PLATFORM_LAUNCHER_NAME}，Worker Node 命令正在迁往 ./${DEFAULT_WORKER_NODE_LAUNCHER_NAME}。`);
  console.log("如果希望像 codex/openclaw 一样直接输入 `themis`，建议执行 `./themis install`。");
}

function formatOptionalSeconds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "<unknown>";
  }

  return `${value}s`;
}

function normalizeDoctorFailOn(value: string | null): "error" | "warning" | null {
  if (value === "error" || value === "warning") {
    return value;
  }

  return null;
}

function shouldFailWorkerFleetDoctor(
  summary: {
    counts: {
      errorCount: number;
      warningCount: number;
    };
  },
  failOn: "error" | "warning" | null,
): boolean {
  if (failOn === "error") {
    return summary.counts.errorCount > 0;
  }

  if (failOn === "warning") {
    return summary.counts.errorCount > 0 || summary.counts.warningCount > 0;
  }

  return false;
}

function printReleaseReadinessSummary(summary: ReleaseReadinessSummary): void {
  console.log("Themis 发布就绪检查");
  console.log(`ok：${summary.ok ? "yes" : "no"}`);
  console.log(`generatedAt：${summary.generatedAt}`);
  console.log(`workingDirectory：${summary.workingDirectory}`);
  console.log(`acceptanceMatrix.automatedCommandCount：${summary.acceptanceMatrix.automatedCommands.length}`);
  console.log(`acceptanceMatrix.feishuScenarioCount：${summary.acceptanceMatrix.feishuScenarioCount}`);
  console.log(`acceptanceMatrix.rerunSequenceCount：${summary.acceptanceMatrix.rerunSequence.length}`);
  console.log(`acceptanceMatrix.manualDocs：${summary.acceptanceMatrix.manualDocs.join(", ")}`);

  console.log("文档状态");
  for (const document of summary.documentation) {
    console.log(`${document.path}：${document.status}`);
  }

  console.log("检查项");
  for (const [index, check] of summary.checks.entries()) {
    console.log(`${index + 1}. ${check.title}：${check.status}`);
    console.log(`摘要：${check.summary}`);
    console.log(`下一步：${check.nextStep}`);
  }

  console.log("建议下一步");
  for (const [index, step] of summary.nextSteps.entries()) {
    console.log(`${index + 1}. ${step}`);
  }
}

function printFileStatuses(files: RuntimeDiagnosticFileStatus[]): void {
  for (const file of files) {
    console.log(`${file.path}：${file.status}`);
  }
}

function formatMultimodalOverview(summary: RuntimeMultimodalDiagnosticsSummary): string {
  if (!summary.available) {
    return "unavailable";
  }

  if (summary.recentTurnInputCount === 0) {
    return "最近没有已持久化的 turn input";
  }

  return [
    `${summary.recentTurnInputCount} 条最近输入`,
    `native ${summary.degradationCounts.native}`,
    `fallback ${summary.degradationCounts.controlledFallback}`,
    `blocked ${summary.degradationCounts.blocked}`,
  ].join(" / ");
}

function formatNamedCountList<T extends { count: number }>(
  items: T[],
  key: Exclude<keyof T, "count">,
): string {
  if (items.length === 0) {
    return "<none>";
  }

  return items
    .map((item) => `${String(item[key])}=${item.count}`)
    .join(", ");
}

type MultimodalCapabilityMatrix = NonNullable<RuntimeMultimodalDiagnosticsSummary["lastTurn"]>["capabilityMatrix"];

function formatCapabilityNativeSupport(
  matrix: MultimodalCapabilityMatrix | null,
  kind: "image" | "document",
): string {
  if (!matrix) {
    return "<none>";
  }

  const capabilityKey = kind === "image" ? "nativeImageInput" : "nativeDocumentInput";
  return [
    `model=${formatNullableBooleanFlag(matrix.modelCapabilities?.[capabilityKey] ?? null)}`,
    `transport=${formatNullableBooleanFlag(matrix.transportCapabilities?.[capabilityKey] ?? null)}`,
    `effective=${formatNullableBooleanFlag(matrix.effectiveCapabilities[capabilityKey])}`,
  ].join(" ");
}

function formatCapabilityAssetFacts(
  matrix: MultimodalCapabilityMatrix | null,
): string {
  if (!matrix || matrix.assetFacts.length === 0) {
    return "<none>";
  }

  return matrix.assetFacts.map((fact) => {
    const parts = [
      `${fact.assetId}[${fact.kind}]`,
      `localPath=${fact.localPathStatus}`,
      `handling=${fact.handling}`,
      `native(model=${formatNullableBooleanFlag(fact.modelNativeSupport)}, transport=${formatNullableBooleanFlag(fact.transportNativeSupport)}, effective=${formatNullableBooleanFlag(fact.effectiveNativeSupport)})`,
    ];

    if (fact.kind === "document") {
      parts.push(
        `mime(model=${formatNullableBooleanFlag(fact.modelMimeTypeSupported)}, transport=${formatNullableBooleanFlag(fact.transportMimeTypeSupported)}, effective=${formatNullableBooleanFlag(fact.effectiveMimeTypeSupported)})`,
      );
    }

    return parts.join(" ");
  }).join(" | ");
}

function formatNullableBooleanFlag(value: boolean | null): string {
  if (value === null) {
    return "<unknown>";
  }

  return value ? "yes" : "no";
}

function formatElapsedDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds}秒`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (seconds === 0) {
    return `${minutes}分`;
  }

  return `${minutes}分${seconds}秒`;
}

function createSmokeProgressPrinter(prefix: string): (event: RuntimeSmokeProgressEvent) => void {
  return (event) => {
    console.log(`${prefix}${event.message}`);
  };
}

function printWebSmokeResult(result: Awaited<ReturnType<RuntimeSmokeService["runWebSmoke"]>>): void {
  console.log("Themis smoke - web");
  console.log(`ok：${result.ok ? "yes" : "no"}`);
  console.log(`baseUrl：${result.baseUrl}`);
  console.log(`sessionId：${result.sessionId ?? "<none>"}`);
  console.log(`requestId：${result.requestId ?? "<none>"}`);
  console.log(`taskId：${result.taskId ?? "<none>"}`);
  console.log(`actionId：${result.actionId ?? "<none>"}`);
  console.log(`observedActionRequired：${result.observedActionRequired ? "yes" : "no"}`);
  console.log(`observedCompleted：${result.observedCompleted ? "yes" : "no"}`);
  console.log(`historyCompleted：${result.historyCompleted ? "yes" : "no"}`);
  console.log(`imageCompileVerified：${result.imageCompileVerified ? "yes" : "no"}`);
  console.log(`imageCompileDegradationLevel：${result.imageCompileDegradationLevel ?? "<none>"}`);
  console.log(`imageCompileWarningCodes：${result.imageCompileWarningCodes.join(", ") || "<none>"}`);
  console.log(`imageCompileMatrixVerified：${result.imageCompileMatrixVerified ? "yes" : "no"}`);
  console.log(`imageCompileMatrixImageNative：${result.imageCompileMatrixImageNative ?? "<none>"}`);
  console.log(`imageCompileMatrixAssetHandling：${result.imageCompileMatrixAssetHandling.join(", ") || "<none>"}`);
  console.log(`documentCompileVerified：${result.documentCompileVerified ? "yes" : "no"}`);
  console.log(`documentCompileDegradationLevel：${result.documentCompileDegradationLevel ?? "<none>"}`);
  console.log(`documentCompileWarningCodes：${result.documentCompileWarningCodes.join(", ") || "<none>"}`);
  console.log(`documentCompileMatrixVerified：${result.documentCompileMatrixVerified ? "yes" : "no"}`);
  console.log(`documentCompileMatrixDocumentNative：${result.documentCompileMatrixDocumentNative ?? "<none>"}`);
  console.log(`documentCompileMatrixAssetHandling：${result.documentCompileMatrixAssetHandling.join(", ") || "<none>"}`);
  console.log(`sharedBoundaryVerified：${result.sharedBoundary.ok ? "yes" : "no"}`);
  console.log(`sharedBoundaryImagePathBlocked：${result.sharedBoundary.imagePathBlockedVerified ? "yes" : "no"}`);
  console.log(`sharedBoundaryImagePathWarningCodes：${result.sharedBoundary.imagePathWarningCodes.join(", ") || "<none>"}`);
  console.log(`sharedBoundaryDocumentPathBlocked：${result.sharedBoundary.documentPathBlockedVerified ? "yes" : "no"}`);
  console.log(`sharedBoundaryDocumentPathWarningCodes：${result.sharedBoundary.documentPathWarningCodes.join(", ") || "<none>"}`);
  console.log(`sharedBoundaryTextNativeBlocked：${result.sharedBoundary.textNativeBlockedVerified ? "yes" : "no"}`);
  console.log(`sharedBoundaryTextNativeWarningCodes：${result.sharedBoundary.textNativeWarningCodes.join(", ") || "<none>"}`);
  console.log(`sharedBoundaryImageNativeBlocked：${result.sharedBoundary.imageNativeBlockedVerified ? "yes" : "no"}`);
  console.log(`sharedBoundaryImageNativeWarningCodes：${result.sharedBoundary.imageNativeWarningCodes.join(", ") || "<none>"}`);
  console.log(`sharedBoundaryDocumentMimeNative：${result.sharedBoundary.documentMimeNativeVerified ? "yes" : "no"}`);
  console.log(`sharedBoundaryDocumentMimeNativeWarningCodes：${result.sharedBoundary.documentMimeNativeWarningCodes.join(", ") || "<none>"}`);
  console.log(`sharedBoundaryDocumentMimeFallback：${result.sharedBoundary.documentMimeFallbackVerified ? "yes" : "no"}`);
  console.log(`sharedBoundaryDocumentMimeWarningCodes：${result.sharedBoundary.documentMimeWarningCodes.join(", ") || "<none>"}`);
  console.log(`message：${result.message}`);
}

function printFeishuSmokeResult(result: Awaited<ReturnType<RuntimeSmokeService["runFeishuSmoke"]>>): void {
  console.log("Themis smoke - feishu");
  console.log(`ok：${result.ok ? "yes" : "no"}`);
  console.log(`serviceReachable：${result.serviceReachable ? "yes" : "no"}`);
  console.log(`statusCode：${result.statusCode ?? "null"}`);
  console.log(`diagnosisId：${result.diagnosisId}`);
  console.log(`diagnosisSummary：${result.diagnosisSummary}`);
  console.log(`feishuConfigReady：${result.feishuConfigReady ? "yes" : "no"}`);
  console.log(`sessionBindingCount：${result.sessionBindingCount}`);
  console.log(`attachmentDraftCount：${result.attachmentDraftCount}`);
  console.log(`docPath：${result.docPath}`);
  console.log(`message：${result.message}`);
  console.log("nextSteps：");

  for (const [index, step] of result.nextSteps.entries()) {
    console.log(`${index + 1}. ${step}`);
  }
}

function printFeishuDiagnosticsSummary(summary: FeishuDiagnosticsSummary): void {
  console.log("Themis 诊断 - feishu");
  console.log(`appIdConfigured：${summary.env.appIdConfigured ? "yes" : "no"}`);
  console.log(`appSecretConfigured：${summary.env.appSecretConfigured ? "yes" : "no"}`);
  console.log(`useEnvProxy：${summary.env.useEnvProxy ? "yes" : "no"}`);
  console.log(`progressFlushTimeoutMs：${summary.env.progressFlushTimeoutMs ?? "null"}`);
  console.log(`serviceReachable：${summary.service.serviceReachable ? "yes" : "no"}`);
  console.log(`statusCode：${summary.service.statusCode ?? "null"}`);
  console.log(`sessionStore：${summary.state.sessionStore.status}`);
  console.log(`attachmentDraftStore：${summary.state.attachmentDraftStore.status}`);
  console.log(`sessionBindingCount：${summary.state.sessionBindingCount}`);
  console.log(`attachmentDraftCount：${summary.state.attachmentDraftCount}`);
  console.log(`smokeDoc：${summary.docs.smokeDocExists ? "yes" : "no"}`);
  console.log(`diagnosticsStore：${summary.diagnostics.store.status}`);

  const primaryDiagnosis = summary.diagnostics.primaryDiagnosis;
  console.log("问题判断");
  console.log(`主诊断：${primaryDiagnosis?.title ?? "<none>"}`);
  console.log(`诊断摘要：${primaryDiagnosis?.summary ?? "<none>"}`);
  console.log("建议动作：");

  for (const [index, step] of summary.diagnostics.recommendedNextSteps.entries()) {
    console.log(`${index + 1}. ${step}`);
  }

  if (summary.diagnostics.secondaryDiagnoses.length > 0) {
    console.log("次诊断：");

    for (const [index, diagnosis] of summary.diagnostics.secondaryDiagnoses.entries()) {
      console.log(`${index + 1}. ${diagnosis.title}：${diagnosis.summary}`);
    }
  }

  const currentConversation = summary.diagnostics.currentConversation;
  console.log("当前会话摘要");
  console.log(`sessionId：${currentConversation?.activeSessionId ?? "<none>"}`);
  console.log(`principalId：${currentConversation?.principalId ?? "<none>"}`);
  console.log(`threadId：${currentConversation?.threadId ?? "<none>"}`);
  console.log(`threadStatus：${currentConversation?.threadStatus ?? "<none>"}`);
  console.log(`pendingActionCount：${currentConversation?.pendingActionCount ?? 0}`);
  console.log(`multimodal.sampleCount：${currentConversation?.multimodalSampleCount ?? 0}`);
  console.log(
    `multimodal.warningCodes：${formatNamedCountList(currentConversation?.multimodalWarningCodeCounts ?? [], "code")}`,
  );
  console.log(`lastMultimodal.requestId：${currentConversation?.lastMultimodalInput?.requestId ?? "<none>"}`);
  console.log(
    `lastMultimodal.compile：${currentConversation?.lastMultimodalInput
      ? `${currentConversation.lastMultimodalInput.runtimeTarget ?? "<unknown>"} / ${currentConversation.lastMultimodalInput.degradationLevel ?? "<unknown>"}`
      : "<none>"}`,
  );
  console.log(
    `lastMultimodal.warningCodes：${currentConversation?.lastMultimodalInput?.warningCodes.join(", ") || "<none>"}`,
  );
  console.log(
    `lastMultimodal.warningMessages：${currentConversation?.lastMultimodalInput?.warningMessages.join(" / ") || "<none>"}`,
  );
  console.log(
    `lastMultimodal.assetKinds：${currentConversation?.lastMultimodalInput?.assetKinds.join(", ") || "<none>"}`,
  );
  console.log(`lastMultimodal.assetCount：${currentConversation?.lastMultimodalInput?.assetCount ?? 0}`);
  console.log(
    `lastMultimodal.matrix.imageNative：${formatCapabilityNativeSupport(currentConversation?.lastMultimodalInput?.capabilityMatrix ?? null, "image")}`,
  );
  console.log(
    `lastMultimodal.matrix.documentNative：${formatCapabilityNativeSupport(currentConversation?.lastMultimodalInput?.capabilityMatrix ?? null, "document")}`,
  );
  console.log(
    `lastMultimodal.matrix.assetFacts：${formatCapabilityAssetFacts(currentConversation?.lastMultimodalInput?.capabilityMatrix ?? null)}`,
  );
  console.log(`lastBlockedMultimodal.requestId：${currentConversation?.lastBlockedMultimodalInput?.requestId ?? "<none>"}`);
  console.log(
    `lastBlockedMultimodal.compile：${currentConversation?.lastBlockedMultimodalInput
      ? `${currentConversation.lastBlockedMultimodalInput.runtimeTarget ?? "<unknown>"} / ${currentConversation.lastBlockedMultimodalInput.degradationLevel ?? "<unknown>"}`
      : "<none>"}`,
  );
  console.log(
    `lastBlockedMultimodal.warningCodes：${currentConversation?.lastBlockedMultimodalInput?.warningCodes.join(", ") || "<none>"}`,
  );
  console.log(
    `lastBlockedMultimodal.warningMessages：${currentConversation?.lastBlockedMultimodalInput?.warningMessages.join(" / ") || "<none>"}`,
  );
  console.log(
    `lastBlockedMultimodal.matrix.imageNative：${formatCapabilityNativeSupport(currentConversation?.lastBlockedMultimodalInput?.capabilityMatrix ?? null, "image")}`,
  );
  console.log(
    `lastBlockedMultimodal.matrix.documentNative：${formatCapabilityNativeSupport(currentConversation?.lastBlockedMultimodalInput?.capabilityMatrix ?? null, "document")}`,
  );
  console.log(
    `lastBlockedMultimodal.matrix.assetFacts：${formatCapabilityAssetFacts(currentConversation?.lastBlockedMultimodalInput?.capabilityMatrix ?? null)}`,
  );
  const takeoverGuidance = describeFeishuTakeoverGuidance(currentConversation);
  console.log("当前接管判断");
  console.log(`takeoverState：${takeoverGuidance.state}`);
  console.log(`takeoverHint：${takeoverGuidance.hint}`);
  const playbook = buildFeishuTroubleshootingPlaybook({
    primaryDiagnosisId: primaryDiagnosis?.id ?? null,
    currentConversation,
    lastIgnoredMessage: summary.diagnostics.lastIgnoredMessage,
  });
  console.log("排障剧本");

  for (const [index, step] of playbook.entries()) {
    console.log(`${index + 1}. ${step}`);
  }

  console.log("最近窗口统计");
  console.log(`recentWindow.duplicateIgnoredCount：${summary.diagnostics.recentWindowStats.duplicateIgnoredCount}`);
  console.log(`recentWindow.staleIgnoredCount：${summary.diagnostics.recentWindowStats.staleIgnoredCount}`);
  console.log(`recentWindow.approvalSubmittedCount：${summary.diagnostics.recentWindowStats.approvalSubmittedCount}`);
  console.log(`recentWindow.replySubmittedCount：${summary.diagnostics.recentWindowStats.replySubmittedCount}`);
  console.log(`recentWindow.takeoverSubmittedCount：${summary.diagnostics.recentWindowStats.takeoverSubmittedCount}`);
  console.log(`recentWindow.pendingInputNotFoundCount：${summary.diagnostics.recentWindowStats.pendingInputNotFoundCount}`);
  console.log(`recentWindow.pendingInputAmbiguousCount：${summary.diagnostics.recentWindowStats.pendingInputAmbiguousCount}`);

  console.log("最近一次 action 尝试");
  if (summary.diagnostics.lastActionAttempt) {
    console.log(`lastActionAttempt.type：${summary.diagnostics.lastActionAttempt.type}`);
    console.log(`lastActionAttempt.requestId：${summary.diagnostics.lastActionAttempt.requestId ?? "<none>"}`);
    console.log(`lastActionAttempt.actionId：${summary.diagnostics.lastActionAttempt.actionId ?? "<none>"}`);
    console.log(`lastActionAttempt.sessionId：${summary.diagnostics.lastActionAttempt.sessionId ?? "<none>"}`);
    console.log(`lastActionAttempt.principalId：${summary.diagnostics.lastActionAttempt.principalId ?? "<none>"}`);
    console.log(`lastActionAttempt.createdAt：${summary.diagnostics.lastActionAttempt.createdAt}`);
    console.log(`lastActionAttempt.summary：${summary.diagnostics.lastActionAttempt.summary}`);
  } else {
    console.log("- <none>");
  }

  console.log("最近一次被忽略消息");
  if (summary.diagnostics.lastIgnoredMessage) {
    console.log(`lastIgnoredMessage.type：${summary.diagnostics.lastIgnoredMessage.type}`);
    console.log(`lastIgnoredMessage.messageId：${summary.diagnostics.lastIgnoredMessage.messageId ?? "<none>"}`);
    console.log(`lastIgnoredMessage.createdAt：${summary.diagnostics.lastIgnoredMessage.createdAt}`);
    console.log(`lastIgnoredMessage.summary：${summary.diagnostics.lastIgnoredMessage.summary}`);
  } else {
    console.log("- <none>");
  }

  console.log("当前会话快照");
  console.log(`lastMessageId：${currentConversation?.lastMessageId ?? "<none>"}`);
  console.log(`lastEventType：${currentConversation?.lastEventType ?? "<none>"}`);

  for (const action of currentConversation?.pendingActions ?? []) {
    console.log(
      `- actionId：${action.actionId} actionType：${action.actionType} requestId：${action.requestId} taskId：${action.taskId} sourceChannel：${action.sourceChannel}`,
    );
  }

  console.log("最近 5 条事件轨迹");
  if (summary.diagnostics.recentEvents.length === 0) {
    console.log("- <none>");
    return;
  }

  for (const event of summary.diagnostics.recentEvents) {
    console.log(
      `- ${event.createdAt} ${event.type} sessionId：${event.sessionId ?? "<none>"} principalId：${event.principalId ?? "<none>"} messageId：${event.messageId ?? "<none>"} actionId：${event.actionId ?? "<none>"} requestId：${event.requestId ?? "<none>"} summary：${event.summary}`,
    );
  }
}

function countOk(files: RuntimeDiagnosticFileStatus[]): number {
  return files.filter((file) => file.status === "ok").length;
}

function createCliMcpInspector(): Pick<McpInspector, "list" | "probe" | "reload"> {
  const fixture = process.env.THEMIS_MCP_INSPECTOR_FIXTURE?.trim();

  if (!fixture) {
    return new McpInspector({
      workingDirectory: cwd,
    });
  }

  const parsed = JSON.parse(fixture) as {
    servers?: Array<{
      id?: string;
      name?: string;
      status?: string;
      transport?: string;
      command?: string;
      args?: string[];
      cwd?: string;
      enabled?: boolean;
      auth?: string;
      error?: string;
      message?: string;
    }>;
  };
  const summary = {
    servers: Array.isArray(parsed.servers)
      ? parsed.servers.map((server, index) => ({
        id: typeof server.id === "string" && server.id.trim() ? server.id : `fixture-${index + 1}`,
        name: typeof server.name === "string" && server.name.trim() ? server.name : `fixture-${index + 1}`,
        status: typeof server.status === "string" && server.status.trim() ? server.status : "unknown",
        args: Array.isArray(server.args)
          ? server.args.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          : [],
        ...(typeof server.transport === "string" && server.transport.trim() ? { transport: server.transport } : {}),
        ...(typeof server.command === "string" && server.command.trim() ? { command: server.command } : {}),
        ...(typeof server.cwd === "string" && server.cwd.trim() ? { cwd: server.cwd } : {}),
        ...(typeof server.enabled === "boolean" ? { enabled: server.enabled } : {}),
        ...(typeof server.auth === "string" && server.auth.trim() ? { auth: server.auth } : {}),
        ...(typeof server.error === "string" && server.error.trim() ? { error: server.error } : {}),
        ...(typeof server.message === "string" && server.message.trim() ? { message: server.message } : {}),
      }))
      : [],
  };

  return {
    list: async () => summary,
    probe: async () => summary,
    reload: async () => summary,
  };
}

function formatMcpServerDetails(server: {
  transport?: string;
  command?: string;
  auth?: string;
  error?: string;
  message?: string;
}): string | null {
  const parts = [
    server.transport ? `transport=${server.transport}` : null,
    server.command ? `command=${server.command}` : null,
    server.auth ? `auth=${server.auth}` : null,
    server.error ? `error=${server.error}` : null,
    server.message ? `message=${server.message}` : null,
  ].filter((item): item is string => Boolean(item));

  return parts.length > 0 ? parts.join(", ") : null;
}

function resolveConfigValue(
  key: string,
  envFiles: ReturnType<typeof readProjectEnvFiles>,
): {
  value: string | null;
  sourceLabel: string;
} {
  const shellValue = normalizeOptionalText(shellEnv.get(key));

  if (shellValue) {
    return {
      value: shellValue,
      sourceLabel: "环境变量",
    };
  }

  for (let index = envFiles.length - 1; index >= 0; index -= 1) {
    const snapshot = envFiles[index]!;
    const fileValue = normalizeOptionalText(snapshot?.values.get(key));

    if (fileValue) {
      return {
        value: fileValue,
        sourceLabel: snapshot.filePath.endsWith(".env.local") ? ".env.local" : ".env",
      };
    }
  }

  const definition = findProjectConfigDefinition(key);

  if (definition?.defaultValue) {
    return {
      value: definition.defaultValue,
      sourceLabel: "默认值",
    };
  }

  return {
    value: null,
    sourceLabel: "未配置",
  };
}

function formatDisplayValue(
  resolved: ReturnType<typeof resolveConfigValue>,
  secret: boolean,
): string {
  const value = secret ? maskSecretValue(resolved.value) : (resolved.value || "未配置");
  return `${value} (${resolved.sourceLabel})`;
}

function printUpdateCheckSummary(updateCheck: ThemisUpdateCheckResult): void {
  console.log("");
  console.log("版本更新");
  console.log(`- package.json 版本：${updateCheck.packageVersion ?? "未知"}`);
  console.log(`- 更新渠道：${formatUpdateChannelLabel(updateCheck.updateChannel)}`);
  console.log(
    `- 当前提交：${formatShortCommitHash(updateCheck.currentCommit)} (${formatCurrentCommitSource(updateCheck.currentCommitSource)})`,
  );
  console.log(`- 当前分支：${updateCheck.currentBranch ?? "未知"}`);
  console.log(`- 更新源：${updateCheck.updateSourceRepo}`);
  console.log(`- 更新源默认分支：${updateCheck.updateSourceDefaultBranch ?? "未知"}`);

  if (updateCheck.updateChannel === "release" && updateCheck.latestReleaseTag) {
    const releaseSummary = [
      updateCheck.latestReleaseTag,
      updateCheck.latestReleaseName,
      updateCheck.latestReleasePublishedAt ? `published ${updateCheck.latestReleasePublishedAt}` : null,
    ].filter((item): item is string => Boolean(item)).join(" / ");
    console.log(`- GitHub 最新 release：${releaseSummary}`);
    if (updateCheck.latestReleaseUrl) {
      console.log(`- release 地址：${updateCheck.latestReleaseUrl}`);
    }
    console.log(
      `- release 对应提交：${formatShortCommitHash(updateCheck.latestCommit)}${updateCheck.latestCommitDate ? ` (${updateCheck.latestCommitDate})` : ""}`,
    );
    if (updateCheck.latestCommitUrl) {
      console.log(`- 提交地址：${updateCheck.latestCommitUrl}`);
    }
  } else if (updateCheck.updateChannel === "release") {
    console.log("- GitHub 最新 release：未检测到");
  } else {
    console.log(
      `- GitHub 最新提交：${formatShortCommitHash(updateCheck.latestCommit)}${updateCheck.latestCommitDate ? ` (${updateCheck.latestCommitDate})` : ""}`,
    );
    if (updateCheck.latestCommitUrl) {
      console.log(`- 最新提交地址：${updateCheck.latestCommitUrl}`);
    }
  }

  console.log(`- 判断：${updateCheck.summary}`);
  if (updateCheck.comparisonStatus) {
    console.log(`- 对比结果：${updateCheck.comparisonStatus}`);
  }
  if (updateCheck.errorMessage) {
    console.log(`- 检查详情：${updateCheck.errorMessage}`);
  }
}

function formatUpdateChannelLabel(channel: ThemisUpdateCheckResult["updateChannel"]): string {
  return channel === "release" ? "GitHub latest release" : "GitHub 默认分支";
}

function formatCurrentCommitSource(source: "git" | "env" | "unknown"): string {
  switch (source) {
    case "git":
      return "git HEAD";
    case "env":
      return "THEMIS_BUILD_COMMIT";
    default:
      return "未知来源";
  }
}

function maskSecretValue(value: string | null): string {
  if (!value) {
    return "未配置";
  }

  if (value.length <= 4) {
    return "****";
  }

  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeCliAbsolutePath(value: string): string {
  const normalized = value.trim();

  if (!normalized || !isAbsolute(normalized)) {
    throw new Error("技能来源路径必须是服务器本机绝对路径。");
  }

  return normalized;
}

function setProjectEnvFileContent(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function createCliWebAccessService(): WebAccessService {
  return new WebAccessService({
    registry: new SqliteCodexSessionRegistry({
      databaseFile: cliDatabasePath,
    }),
  });
}

function handleAuthWebList(): void {
  const service = createCliWebAccessService();
  const tokens = service.listWebTokens();

  console.log("Themis Web 访问口令");
  console.log("");

  if (tokens.length === 0) {
    console.log("暂无 Web 访问口令。");
    return;
  }

  for (const token of tokens) {
    console.log(`- label：${token.label}`);
    console.log(`  状态：${token.revokedAt ? "revoked" : "active"}`);
    console.log(`  最近使用：${token.lastUsedAt ?? "未使用"}`);
    console.log("");
  }
}

async function handleAuthWebAdd(label: string): Promise<void> {
  const service = createCliWebAccessService();
  const secret = await readHiddenLinePair(`请输入 ${label} 的 Web 口令：`, "请再次输入 Web 口令：");
  const created = service.createToken({
    label,
    secret,
    remoteIp: "cli",
  });

  console.log(`已添加 Web 访问口令：${created.label}`);
  console.log(`- tokenId：${created.tokenId}`);
}

function handleAuthWebRemove(label: string): void {
  const service = createCliWebAccessService();
  const revoked = service.revokeTokenByLabel({
    label,
    remoteIp: "cli",
  });

  console.log(`已移除 Web 访问口令：${revoked.label}`);
  console.log(`- tokenId：${revoked.tokenId}`);
  console.log(`- 状态：${revoked.revokedAt ? "revoked" : "active"}`);
}

function handleAuthWebRename(oldLabel: string, newLabel: string): void {
  const service = createCliWebAccessService();
  const token = service.listWebTokens().find((item) => item.label === oldLabel && !item.revokedAt);

  if (!token) {
    throw new Error(`未找到处于 active 状态的 Web 访问口令：${oldLabel}`);
  }

  const renamed = service.renameToken({
    tokenId: token.tokenId,
    label: newLabel,
    remoteIp: "cli",
  });

  console.log(`已重命名 Web 访问口令：${oldLabel} -> ${renamed.label}`);
  console.log(`- tokenId：${renamed.tokenId}`);
}

function handleAuthPlatformList(): void {
  const service = createCliWebAccessService();
  const tokens = service.listPlatformServiceTokens();

  console.log("Themis 平台服务令牌");
  console.log("");

  if (tokens.length === 0) {
    console.log("暂无平台服务令牌。");
    return;
  }

  for (const token of tokens) {
    console.log(`- label：${token.label}`);
    console.log(`  状态：${token.revokedAt ? "revoked" : "active"}`);
    console.log(`  role：${token.serviceRole}`);
    console.log(`  ownerPrincipalId：${token.ownerPrincipalId}`);
    console.log(`  最近使用：${token.lastUsedAt ?? "未使用"}`);
    console.log("");
  }
}

async function handleAuthPlatformAdd(
  label: string,
  role: PlatformServiceRole,
  ownerPrincipalId: string,
): Promise<void> {
  const service = createCliWebAccessService();
  const secret = await readHiddenLinePair(`请输入 ${label} 的平台服务令牌：`, "请再次输入平台服务令牌：");
  const created = service.createPlatformServiceToken({
    label,
    secret,
    ownerPrincipalId,
    serviceRole: role,
    remoteIp: "cli",
  });

  console.log(`已添加平台服务令牌：${created.label}`);
  console.log(`- tokenId：${created.tokenId}`);
  console.log(`- role：${created.serviceRole}`);
  console.log(`- ownerPrincipalId：${created.ownerPrincipalId}`);
}

function handleAuthPlatformRemove(label: string): void {
  const service = createCliWebAccessService();
  const revoked = service.revokePlatformServiceTokenByLabel({
    label,
    remoteIp: "cli",
  });

  console.log(`已移除平台服务令牌：${revoked.label}`);
  console.log(`- tokenId：${revoked.tokenId}`);
  console.log(`- role：${revoked.serviceRole}`);
  console.log(`- ownerPrincipalId：${revoked.ownerPrincipalId}`);
  console.log(`- 状态：${revoked.revokedAt ? "revoked" : "active"}`);
}

function handleAuthPlatformRename(oldLabel: string, newLabel: string): void {
  const service = createCliWebAccessService();
  const token = service.listPlatformServiceTokens().find((item) => item.label === oldLabel && !item.revokedAt);

  if (!token) {
    throw new Error(`未找到处于 active 状态的平台服务令牌：${oldLabel}`);
  }

  const renamed = service.renameToken({
    tokenId: token.tokenId,
    label: newLabel,
    remoteIp: "cli",
  });

  console.log(`已重命名平台服务令牌：${oldLabel} -> ${renamed.label}`);
  console.log(`- tokenId：${renamed.tokenId}`);
  console.log(`- role：${renamed.serviceRole ?? "unknown"}`);
  console.log(`- ownerPrincipalId：${renamed.ownerPrincipalId ?? "unknown"}`);
}

async function readHiddenLinePair(firstPrompt: string, secondPrompt: string): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    return parseNonTtyHiddenLinePair(await readInputText());
  }

  const first = await readHiddenLineFromTty(firstPrompt);
  const second = await readHiddenLineFromTty(secondPrompt);

  if (!first.trim() || !second.trim()) {
    throw new Error("口令不能为空。");
  }

  if (first !== second) {
    throw new Error("两次输入的口令不一致。");
  }

  return first;
}

async function readInputText(): Promise<string> {
  let content = "";

  for await (const chunk of input) {
    content += chunk.toString();
  }

  return content;
}

function parseNonTtyHiddenLinePair(text: string): string {
  const lines = text.split(/\r?\n/);
  const [first = "", second = "", ...rest] = lines;

  if (!first.trim() || !second.trim()) {
    throw new Error("口令不能为空。");
  }

  if (first !== second) {
    throw new Error("两次输入的口令不一致。");
  }

  if (rest.some((line) => line.trim().length > 0)) {
    throw new Error("stdin 只允许恰好两行口令输入，不能包含额外内容。");
  }

  return first;
}

function normalizePlatformServiceRole(value: string | null): PlatformServiceRole | null {
  if (value === "gateway" || value === "worker") {
    return value;
  }

  return null;
}

async function readHiddenLineFromTty(prompt: string): Promise<string> {
  if (typeof input.setRawMode !== "function") {
    throw new Error("当前终端不支持隐藏输入。");
  }

  const wasRaw = input.isRaw === true;
  const restoreRawMode = (): void => {
    if (!wasRaw && input.isTTY) {
      input.setRawMode(false);
    }
  };

  input.resume();

  if (!wasRaw) {
    input.setRawMode(true);
  }

  output.write(prompt);

  try {
    return await new Promise<string>((resolve, reject) => {
      let value = "";
      let settled = false;

      const cleanup = (): void => {
        input.off("data", onData);
        input.off("error", onError);
        input.off("end", onEnd);
        input.off("close", onClose);
      };

      const finish = (result: string): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        restoreRawMode();
        output.write("\n");
        resolve(result);
      };

      const fail = (message: string, error?: Error): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        restoreRawMode();
        output.write("\n");
        reject(error ?? new Error(message));
      };

      const onData = (chunk: Buffer | string): void => {
        const text = chunk.toString("utf8");

        for (const char of text) {
          if (char === "\r" || char === "\n") {
            finish(value);
            return;
          }

          if (char === "\u0003") {
            fail("输入已取消：收到中断信号。");
            return;
          }

          if (char === "\u0004") {
            fail("输入已取消：收到 EOF。");
            return;
          }

          if (char === "\u007f" || char === "\b") {
            value = value.slice(0, -1);
            continue;
          }

          value += char;
        }
      };

      const onError = (error: Error): void => {
        fail("输入已取消：读取失败。", error);
      };

      const onEnd = (): void => {
        fail("输入已取消：收到 EOF。");
      };

      const onClose = (): void => {
        fail("输入已取消：输入流已关闭。");
      };

      input.on("data", onData);
      input.once("error", onError);
      input.once("end", onEnd);
      input.once("close", onClose);
    });
  } finally {
    restoreRawMode();
  }
}

function createCliSkillRegistry(): SqliteCodexSessionRegistry {
  return new SqliteCodexSessionRegistry({
    databaseFile: cliDatabasePath,
  });
}

function createCliPrincipalSkillsService(): {
  registry: SqliteCodexSessionRegistry;
  service: PrincipalSkillsService;
} {
  const registry = createCliSkillRegistry();
  return {
    registry,
    service: new PrincipalSkillsService({
      workingDirectory: cwd,
      registry,
    }),
  };
}

function ensureCliPrincipalRecord(registry: SqliteCodexSessionRegistry, principalId: string): void {
  if (registry.getPrincipal(principalId)) {
    return;
  }

  const now = new Date().toISOString();
  registry.savePrincipal({
    principalId,
    createdAt: now,
    updatedAt: now,
  });
}

function cliSkillRegistryExists(): boolean {
  return existsSync(cliDatabasePath);
}

function handleSkillList(args: string[]): void {
  if (args.length > 0) {
    throw new Error("用法：themis skill list");
  }

  if (!cliSkillRegistryExists()) {
    printSkillList([]);
    return;
  }

  const { service } = createCliPrincipalSkillsService();
  printSkillList(service.listPrincipalSkills(CLI_PRINCIPAL_ID));
}

async function handleSkillCurated(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  if (subcommand !== "list" || rest.length > 0) {
    throw new Error("用法：themis skill curated list");
  }

  const { service } = createCliPrincipalSkillsService();
  const curated = await service.listCuratedSkills(CLI_PRINCIPAL_ID);

  console.log(`当前 principal：${CLI_PRINCIPAL_ID}`);
  console.log("可安装的 curated skills");
  console.log("");

  if (curated.length === 0) {
    console.log("暂无 curated skill 可用。");
    return;
  }

  for (const [index, item] of curated.entries()) {
    const status = item.installed ? "已安装" : "未安装";
    console.log(`${index + 1}. ${item.name} [${status}]`);
  }
}

async function handleSkillInstall(args: string[]): Promise<void> {
  const [mode, ...rest] = args;

  switch (mode) {
    case "local": {
      const [inputPath, ...extra] = rest;

      if (!inputPath || extra.length > 0) {
        throw new Error("用法：themis skill install local <ABSOLUTE_PATH>");
      }

      const absolutePath = normalizeCliAbsolutePath(inputPath);
      const { registry, service } = createCliPrincipalSkillsService();
      ensureCliPrincipalRecord(registry, CLI_PRINCIPAL_ID);
      const result = await service.installFromLocalPath({
        principalId: CLI_PRINCIPAL_ID,
        absolutePath,
      });

      printSkillInstallResult("本地目录", result.skill.skillName, result);
      return;
    }
    case "url": {
      const [url, ref, ...extra] = rest;

      if (!url || extra.length > 0) {
        throw new Error("用法：themis skill install url <GITHUB_URL> [REF]");
      }

      const { registry, service } = createCliPrincipalSkillsService();
      ensureCliPrincipalRecord(registry, CLI_PRINCIPAL_ID);
      const result = await service.installFromGithub({
        principalId: CLI_PRINCIPAL_ID,
        url,
        ...(ref ? { ref } : {}),
      });

      printSkillInstallResult("GitHub URL", result.skill.skillName, result);
      return;
    }
    case "repo": {
      const [repo, path, ref, ...extra] = rest;

      if (!repo || !path || extra.length > 0) {
        throw new Error("用法：themis skill install repo <REPO> <PATH> [REF]");
      }

      const { registry, service } = createCliPrincipalSkillsService();
      ensureCliPrincipalRecord(registry, CLI_PRINCIPAL_ID);
      const result = await service.installFromGithub({
        principalId: CLI_PRINCIPAL_ID,
        repo,
        path,
        ...(ref ? { ref } : {}),
      });

      printSkillInstallResult("GitHub 仓库路径", result.skill.skillName, result);
      return;
    }
    case "curated": {
      const [skillName, ...extra] = rest;

      if (!skillName || extra.length > 0) {
        throw new Error("用法：themis skill install curated <SKILL_NAME>");
      }

      const { registry, service } = createCliPrincipalSkillsService();
      ensureCliPrincipalRecord(registry, CLI_PRINCIPAL_ID);
      const result = await service.installFromCurated({
        principalId: CLI_PRINCIPAL_ID,
        skillName,
      });

      printSkillInstallResult("OpenAI curated", result.skill.skillName, result);
      return;
    }
    default:
      throw new Error("skill install 仅支持 local / url / repo / curated。");
  }
}

function handleSkillRemove(args: string[]): void {
  const [skillName, ...extra] = args;

  if (!skillName || extra.length > 0) {
    throw new Error("用法：themis skill remove <SKILL_NAME>");
  }

  if (!cliSkillRegistryExists()) {
    throw new Error(`找不到 skill：${skillName}`);
  }

  const { service } = createCliPrincipalSkillsService();
  const result = service.removeSkill(CLI_PRINCIPAL_ID, skillName);

  console.log(`已移除 skill：${result.skillName}`);
  console.log(`- 受管目录已删除：${result.removedManagedPath ? "是" : "否"}`);
  console.log(`- 已清理账号同步链接：${result.removedMaterializations}`);
}

async function handleSkillSync(args: string[]): Promise<void> {
  const force = args.includes("--force");
  const positionals = args.filter((arg) => arg !== "--force");
  const [skillName, ...extra] = positionals;

  if (!skillName || extra.length > 0 || args.length !== positionals.length + (force ? 1 : 0)) {
    throw new Error("用法：themis skill sync <SKILL_NAME> [--force]");
  }

  if (!cliSkillRegistryExists()) {
    throw new Error(`找不到 skill：${skillName}`);
  }

  const { service } = createCliPrincipalSkillsService();
  const result = await service.syncSkill(CLI_PRINCIPAL_ID, skillName, { force });

  printSkillSyncResult(result);
}

function printSkillList(skills: ReturnType<PrincipalSkillsService["listPrincipalSkills"]>): void {
  console.log(`当前 principal：${CLI_PRINCIPAL_ID}`);
  console.log("已安装 skills");
  console.log("");

  if (skills.length === 0) {
    console.log("暂无已安装 skill。");
    return;
  }

  for (const [index, skill] of skills.entries()) {
    console.log(`${index + 1}. ${skill.skillName}`);
    console.log(`   状态：${skill.installStatus}`);
    console.log(`   来源：${describeSkillSource(skill.sourceType, skill.sourceRefJson)}`);
    console.log(`   说明：${skill.description}`);
    console.log(`   受管目录：${skill.managedPath}`);
    console.log(
      `   已同步：${skill.summary.syncedCount}/${skill.summary.totalAccounts}，`
      + `冲突 ${skill.summary.conflictCount}，失败 ${skill.summary.failedCount}`,
    );

    if (skill.lastError) {
      console.log(`   最近错误：${skill.lastError}`);
    }

    for (const materialization of skill.materializations) {
      if (materialization.state === "synced") {
        continue;
      }

      const detail = materialization.lastError ? `：${materialization.lastError}` : "";
      console.log(`   账号槽位 ${materialization.targetId} [${materialization.state}]${detail}`);
    }
  }
}

function printSkillInstallResult(
  sourceLabel: string,
  skillName: string,
  result: Awaited<ReturnType<PrincipalSkillsService["installFromGithub"]>>,
): void {
  console.log(`已安装 skill：${skillName}`);
  console.log(`- 来源：${sourceLabel}`);
  console.log(`- 受管目录：${result.skill.managedPath}`);
  console.log(`- 安装状态：${result.skill.installStatus}`);
  console.log(
    `- 同步结果：${result.summary.syncedCount}/${result.summary.totalAccounts} 成功，`
    + `冲突 ${result.summary.conflictCount}，失败 ${result.summary.failedCount}`,
  );
}

function printSkillSyncResult(result: Awaited<ReturnType<PrincipalSkillsService["syncSkill"]>>): void {
  console.log(`已重同步 skill：${result.skill.skillName}`);
  console.log(`- 安装状态：${result.skill.installStatus}`);
  console.log(
    `- 同步结果：${result.summary.syncedCount}/${result.summary.totalAccounts} 成功，`
    + `冲突 ${result.summary.conflictCount}，失败 ${result.summary.failedCount}`,
  );

  if (result.skill.lastError) {
    console.log(`- 最近错误：${result.skill.lastError}`);
  }
}

function describeSkillSource(sourceType: string, sourceRefJson: string): string {
  const sourceRef = parseSkillSourceRef(sourceRefJson);

  switch (sourceType) {
    case "local-path":
      return sourceRef?.absolutePath && typeof sourceRef.absolutePath === "string"
        ? `本地路径：${sourceRef.absolutePath}`
        : `本地路径：${sourceRefJson}`;
    case "github-url":
      return describeGithubUrlSource(sourceRef);
    case "github-repo-path":
      return describeGithubRepoPathSource(sourceRef);
    case "curated":
      return describeCuratedSource(sourceRef);
    default:
      return `${sourceType}：${sourceRefJson}`;
  }
}

function describeGithubUrlSource(sourceRef: Record<string, unknown> | null): string {
  if (!sourceRef?.url || typeof sourceRef.url !== "string") {
    return "GitHub URL：未知";
  }

  const ref = typeof sourceRef.ref === "string" && sourceRef.ref.trim() ? `，ref：${sourceRef.ref}` : "";
  return `GitHub URL：${sourceRef.url}${ref}`;
}

function describeGithubRepoPathSource(sourceRef: Record<string, unknown> | null): string {
  if (!sourceRef?.repo || !sourceRef.path || typeof sourceRef.repo !== "string" || typeof sourceRef.path !== "string") {
    return "GitHub 仓库路径：未知";
  }

  const ref = typeof sourceRef.ref === "string" && sourceRef.ref.trim() ? `，ref：${sourceRef.ref}` : "";
  return `GitHub 仓库：${sourceRef.repo} / ${sourceRef.path}${ref}`;
}

function describeCuratedSource(sourceRef: Record<string, unknown> | null): string {
  if (!sourceRef?.repo || !sourceRef.path || typeof sourceRef.repo !== "string" || typeof sourceRef.path !== "string") {
    return "curated：未知";
  }

  return `curated：${sourceRef.repo} / ${sourceRef.path}`;
}

function parseSkillSourceRef(sourceRefJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(sourceRefJson);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function runInteractiveShell(): Promise<void> {
  const rl = createInterface({ input, output });

  try {
    while (true) {
      console.log("");
      console.log("Themis CLI");
      console.log("1. 检查当前配置状态");
      console.log("2. 初始化本地配置文件");
      console.log("3. 列出可配置项");
      console.log("4. 写入一个配置项");
      console.log("5. 移除一个配置项");
      console.log("6. 安装 themis 到用户目录");
      console.log("7. 检查 GitHub 更新");
      console.log("8. 查看帮助");
      console.log("0. 退出");

      const choice = (await rl.question("选择一个操作 [1-8，默认 1]：")).trim() || "1";

      switch (choice) {
        case "1":
          await handleStatus();
          break;
        case "2":
          handleInit([]);
          break;
        case "3":
          handleConfigList([]);
          break;
        case "4":
          await runInteractiveConfigSet(rl);
          break;
        case "5":
          await runInteractiveConfigUnset(rl);
          break;
        case "6":
          handleInstall([]);
          break;
        case "7":
          await handleUpdateCheck();
          break;
        case "8":
          printHelp();
          break;
        case "0":
        case "q":
        case "quit":
        case "exit":
          return;
        default:
          console.log(`未识别的选项：${choice}`);
      }
    }
  } finally {
    rl.close();
  }
}

async function runInteractiveConfigSet(rl: ReturnType<typeof createInterface>): Promise<void> {
  const key = (await rl.question("请输入配置键：")).trim();

  if (!key) {
    console.log("已取消，配置键不能为空。");
    return;
  }

  const definition = findProjectConfigDefinition(key);

  if (!definition) {
    console.log(`未知配置键：${key}`);
    console.log("先执行“列出可配置项”，或运行 `./themis config list` 查看支持项。");
    return;
  }

  const value = await rl.question(`请输入 ${definition.key} 的值：`);

  if (!value.trim()) {
    console.log("已取消，值不能为空。");
    return;
  }

  handleConfigSet([definition.key, value]);
}

async function runInteractiveConfigUnset(rl: ReturnType<typeof createInterface>): Promise<void> {
  const key = (await rl.question("请输入要移除的配置键：")).trim();

  if (!key) {
    console.log("已取消，配置键不能为空。");
    return;
  }

  handleConfigUnset([key]);
}

function printPathFollowup(installDir: string): void {
  if (isDirectoryOnPath(installDir)) {
    console.log("当前 PATH 已包含该目录，重新打开一个 shell 后可以直接输入 `themis`。");
    return;
  }

  console.log(`当前 PATH 还不包含 ${installDir}`);
  console.log("把下面这行加到 ~/.bashrc 后，重新打开终端即可直接输入 `themis`：");
  console.log(`export PATH="${installDir}:$PATH"`);
}

function isDirectoryOnPath(targetDir: string): boolean {
  const currentPath = process.env.PATH ?? "";
  return currentPath
    .split(":")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) => resolve(entry) === targetDir);
}

function readOptionValue(args: string[], key: string): string | null {
  const index = args.indexOf(key);

  if (index < 0) {
    return null;
  }

  const value = args[index + 1];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOptionValues(args: string[], key: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== key) {
      continue;
    }

    const value = args[index + 1];

    if (typeof value === "string" && value.trim()) {
      values.push(value.trim());
    }
  }

  return [...new Set(values)];
}

function collectPositionalArgs(args: string[], valueOptions: string[], flagOptions: string[]): string[] {
  const valueOptionSet = new Set(valueOptions);
  const flagOptionSet = new Set(flagOptions);
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (!value) {
      continue;
    }

    if (valueOptionSet.has(value)) {
      index += 1;
      continue;
    }

    if (flagOptionSet.has(value)) {
      continue;
    }

    if (!value.startsWith("-")) {
      positionals.push(value);
    }
  }

  return positionals;
}

function ensureWorkerNodeCredentialAccounts(
  runtimeStore: SqliteCodexSessionRegistry,
  workingDirectory: string,
  credentialIds: string[],
): void {
  const uniqueCredentialIds = [...new Set(credentialIds.map((value) => value.trim()).filter(Boolean))];

  if (uniqueCredentialIds.length === 0) {
    return;
  }

  const shouldBootstrapActive = runtimeStore.listAuthAccounts().length === 0;
  const bootstrappedActiveId = shouldBootstrapActive
    ? (uniqueCredentialIds.includes("default") ? "default" : (uniqueCredentialIds[0] ?? null))
    : null;
  const now = new Date().toISOString();

  for (const credentialId of uniqueCredentialIds) {
    if (runtimeStore.getAuthAccount(credentialId)) {
      continue;
    }

    const codexHome = credentialId === "default"
      ? resolveDefaultCodexHome()
      : resolveManagedCodexHome(workingDirectory, credentialId);

    if (credentialId !== "default") {
      ensureAuthAccountCodexHome(workingDirectory, codexHome);
    }

    runtimeStore.saveAuthAccount({
      accountId: credentialId,
      label: credentialId === "default" ? "默认账号" : `Worker Node 凭据 ${credentialId}`,
      codexHome,
      isActive: bootstrappedActiveId === credentialId,
      createdAt: now,
      updatedAt: now,
    });
  }
}

function readOptionPositiveInteger(args: string[], key: string): number | null {
  const value = readOptionValue(args, key);

  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} 必须是正整数。`);
  }

  return parsed;
}

function collectUnknownOptions(args: string[], valueOptions: string[], flagOptions: string[]): string[] {
  const valueOptionSet = new Set(valueOptions);
  const flagOptionSet = new Set(flagOptions);
  const unknown: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (!value?.startsWith("-")) {
      unknown.push(value ?? "");
      continue;
    }

    if (flagOptionSet.has(value)) {
      continue;
    }

    if (valueOptionSet.has(value)) {
      index += 1;
      continue;
    }

    unknown.push(value);
  }

  return unknown.filter(Boolean);
}
