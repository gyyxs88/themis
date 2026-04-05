#!/usr/bin/env node

import { copyFileSync, existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { resolveCodexAuthFilePath, resolveDefaultCodexHome } from "../core/auth-accounts.js";
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
import { RuntimeSmokeService } from "../diagnostics/runtime-smoke.js";
import { McpInspector } from "../mcp/mcp-inspector.js";
import { PrincipalSkillsService } from "../core/principal-skills-service.js";
import { WebAccessService } from "../core/web-access.js";
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
const shellEnv = new Map<string, string>(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);

loadProjectEnv(cwd);

void main(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Themis CLI 执行失败：${message}`);
  process.exitCode = 1;
});

async function main(args: string[]): Promise<void> {
  const [command, subcommand, ...rest] = args;

  if (!command) {
    if (input.isTTY && output.isTTY) {
      await runInteractiveShell();
      return;
    }

    await handleStatus();
    return;
  }

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      printHelp();
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
    case "doctor":
      if (subcommand?.trim().toLowerCase() === "smoke") {
        process.exit(await handleDoctorSmoke(rest));
      }

      await handleDoctor(subcommand, rest);
      return;
    case "config":
      handleConfig(subcommand, rest);
      return;
    case "auth":
      await handleAuth(subcommand, rest);
      return;
    case "skill":
      await handleSkill(subcommand, rest);
      return;
    default:
      throw new Error(`不支持的命令：${command}。可用命令：init / status / check / doctor / config / auth / skill / help。`);
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

  console.log("");
  console.log("建议下一步");

  const nextSteps = [
    !existsSync(localEnvPath) ? "先运行 `./themis init` 生成本地配置模板。" : null,
    !authReady ? "启动后在 Web 完成 ChatGPT 浏览器登录、设备码登录，或先写入 CODEX_API_KEY。" : null,
    !feishuReady ? "如果需要飞书 bot，请补齐 FEISHU_APP_ID 和 FEISHU_APP_SECRET。" : null,
    !envProviderReady && !dbProviders.length ? "如果需要第三方模型，可在 Web 设置页添加供应商，或先写入 THEMIS_OPENAI_COMPAT_*。" : null,
    "运行 `npm run dev:web` 启动服务。",
  ].filter((item): item is string => Boolean(item));

  for (const [index, step] of nextSteps.entries()) {
    console.log(`${index + 1}. ${step}`);
  }
}

async function handleDoctor(subcommand: string | undefined, args: string[]): Promise<void> {
  const selected = subcommand?.trim().toLowerCase();

  if (selected === "smoke") {
    await handleDoctorSmoke(args);
    return;
  }

  const sections = [subcommand, ...args].filter((item): item is string => Boolean(item && item.trim()));
  if (sections.length > 1) {
    throw new Error("用法：themis doctor [context|auth|provider|memory|service|mcp|feishu|release|smoke]");
  }

  const selectedSection = sections[0]?.trim().toLowerCase();
  if (selectedSection && !["context", "auth", "provider", "memory", "service", "mcp", "feishu", "release"].includes(selectedSection)) {
    throw new Error("doctor 子命令仅支持 context / auth / provider / memory / service / mcp / feishu / release。");
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
      const smoke = await smokeService.runAllSmoke();
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
      const web = await smokeService.runWebSmoke();
      printWebSmokeResult(web);
      return web.ok ? 0 : 1;
    }
    case "feishu": {
      const feishu = await smokeService.runFeishuSmoke();
      printFeishuSmokeResult(feishu);
      return feishu.ok ? 0 : 1;
    }
    case "all": {
      const all = await smokeService.runAllSmoke();
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

async function handleAuth(subcommand: string | undefined, args: string[]): Promise<void> {
  switch (subcommand) {
    case "web":
      await handleAuthWeb(args);
      return;
    default:
      throw new Error("auth 子命令仅支持 web。");
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

function printHelp(): void {
  console.log("Themis 项目级 CLI");
  console.log("");
  console.log("可用命令：");
  console.log("- ./themis              # 进入交互模式");
  console.log("- ./themis install      # 安装到用户目录，无需 sudo");
  console.log("- ./themis init");
  console.log("- ./themis status");
  console.log("- ./themis check");
  console.log("- ./themis doctor");
  console.log("- ./themis doctor <context|auth|provider|memory|service|mcp|feishu|release>");
  console.log("- ./themis doctor smoke <web|feishu|all>");
  console.log("- ./themis config list [--show-secrets]");
  console.log("- ./themis config set <KEY> <VALUE>");
  console.log("- ./themis config unset <KEY>");
  console.log("- ./themis auth web list");
  console.log("- ./themis auth web add <label>");
  console.log("- ./themis auth web remove <label>");
  console.log("- ./themis auth web rename <old-label> <new-label>");
  console.log("- ./themis skill list");
  console.log("- ./themis skill curated list");
  console.log("- ./themis skill install local <ABSOLUTE_PATH>");
  console.log("- ./themis skill install url <GITHUB_URL> [REF]");
  console.log("- ./themis skill install repo <REPO> <PATH> [REF]");
  console.log("- ./themis skill install curated <SKILL_NAME>");
  console.log("- ./themis skill remove <SKILL_NAME>");
  console.log("- ./themis skill sync <SKILL_NAME> [--force]");
  console.log("");
  console.log("如果希望像 codex/openclaw 一样直接输入 `themis`，建议执行 `./themis install`。");
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
  const tokens = service.listTokens();

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
  const token = service.listTokens().find((item) => item.label === oldLabel && !item.revokedAt);

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
      console.log("7. 查看帮助");
      console.log("0. 退出");

      const choice = (await rl.question("选择一个操作 [1-7，默认 1]：")).trim() || "1";

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
