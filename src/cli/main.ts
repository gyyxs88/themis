#!/usr/bin/env node

import { copyFileSync, existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { resolveCodexAuthFilePath, resolveDefaultCodexHome } from "../core/auth-accounts.js";
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
    case "doctor":
    case "check":
      await handleStatus();
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
      throw new Error(`不支持的命令：${command}。可用命令：init / status / config / auth / skill / help。`);
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
