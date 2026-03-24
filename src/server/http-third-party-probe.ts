import type { IncomingMessage, ServerResponse } from "node:http";
import { InMemoryCommunicationRouter } from "../communication/router.js";
import { WebAdapter, type WebDeliveryMessage, type WebTaskPayload } from "../channels/index.js";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import {
  addOpenAICompatibleProvider,
  addOpenAICompatibleProviderModel,
  writeOpenAICompatibleProviderCodexTaskSupport,
} from "../core/openai-compatible-provider.js";
import { createTaskError } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

interface ThirdPartyProbePayload {
  providerId?: unknown;
  model?: unknown;
}

interface ThirdPartyCapabilityWritebackPayload {
  providerId?: unknown;
  model?: unknown;
  supportsCodexTasks?: unknown;
}

interface ThirdPartyProviderCreatePayload {
  id?: unknown;
  name?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  wireApi?: unknown;
  supportsWebsockets?: unknown;
}

interface ThirdPartyModelCreatePayload {
  providerId?: unknown;
  model?: unknown;
  displayName?: unknown;
  description?: unknown;
  defaultReasoningLevel?: unknown;
  contextWindow?: unknown;
  supportsCodexTasks?: unknown;
  imageInput?: unknown;
  setAsDefault?: unknown;
}

const PROBE_GOAL = "请先执行 shell 命令 `head -n 1 README.md`，然后只回复该命令的标准输出原文。不要猜测，不要解释。如果命令失败，请只回复失败原因。";

export async function handleThirdPartyProbe(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
  taskTimeoutMs: number,
): Promise<void> {
  const payload = ((await readJsonBody(request)) ?? {}) as ThirdPartyProbePayload;
  const model = normalizeOptionalText(payload.model);
  const providerId = normalizeOptionalText(payload.providerId);

  if (!model) {
    return writeJson(response, 400, {
      error: {
        code: "INVALID_REQUEST",
        message: "兼容性测试缺少 model。",
      },
    });
  }

  const runtimeConfig = await runtime.readRuntimeConfig();
  const providers = Array.isArray(runtimeConfig.thirdPartyProviders) ? runtimeConfig.thirdPartyProviders : [];
  const provider = providerId
    ? providers.find((entry) => entry.id === providerId) ?? null
    : providers[0] ?? null;

  if (!provider) {
    return writeJson(response, 400, {
      error: {
        code: "INVALID_REQUEST",
        message: "当前没有可用的第三方兼容接入配置。",
      },
    });
  }

  const deliveries: WebDeliveryMessage[] = [];
  const router = new InMemoryCommunicationRouter();
  const webAdapter = new WebAdapter({
    deliver: async (message) => {
      deliveries.push(message);
    },
  });

  router.registerAdapter(webAdapter);

  const normalizedRequest = router.normalizeRequest({
    source: "web",
    userId: "themis-probe",
    displayName: "Themis Probe",
    goal: PROBE_GOAL,
    options: {
      accessMode: "third-party",
          model,
          reasoning: "medium",
          ...(provider ? { thirdPartyProviderId: provider.id } : {}),
        },
      } satisfies WebTaskPayload);

  try {
    const result = await runtime.runTask(normalizedRequest, {
      timeoutMs: Math.min(taskTimeoutMs, 120000),
      allowUnsupportedThirdPartyModel: true,
      onEvent: async (event) => {
        await router.publishEvent(event);
      },
    });
    const observation = summarizeProbe(deliveries);
    const supported = result.status === "completed" && observation.commandExecuted;

    return writeJson(response, 200, {
      status: supported ? "supported" : "inconclusive",
      supported,
      providerId: provider.id,
      model,
      checkedAt: new Date().toISOString(),
      commandExecuted: observation.commandExecuted,
      observedCommand: observation.command,
      summary: supported ? "兼容性测试通过。" : "兼容性测试没有拿到足够证据。",
      detail: supported
        ? "已经观察到真实命令执行，并且模型顺利接收了工具结果后完成回答。这个模型可以用于 Themis 的 Codex 任务。"
        : "这次测试没有观察到完整的命令执行链路，不能证明它支持 Codex agent 任务。建议换一个模型再测，或继续做人工验证。",
      outputPreview: truncateText(result.output || result.summary),
    });
  } catch (error) {
    const taskError = createTaskError(error, true);
    const observation = summarizeProbe(deliveries);

    return writeJson(response, 200, {
      status: "unsupported",
      supported: false,
      providerId: provider.id,
      model,
      checkedAt: new Date().toISOString(),
      commandExecuted: observation.commandExecuted,
      observedCommand: observation.command,
      summary: "兼容性测试失败。",
      detail: buildFailureDetail(taskError.message, observation.commandExecuted),
      errorMessage: taskError.message,
    });
  }
}

export async function handleThirdPartyCapabilityWriteback(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = ((await readJsonBody(request)) ?? {}) as ThirdPartyCapabilityWritebackPayload;
  const model = normalizeOptionalText(payload.model);
  const providerId = normalizeOptionalText(payload.providerId);

  if (!providerId || !model || typeof payload.supportsCodexTasks !== "boolean") {
    return writeJson(response, 400, {
      error: {
        code: "INVALID_REQUEST",
        message: "写回模型能力时缺少 providerId、model 或 supportsCodexTasks。",
      },
    });
  }

  try {
    const nextConfig = writeOpenAICompatibleProviderCodexTaskSupport(
      process.cwd(),
      providerId,
      model,
      payload.supportsCodexTasks,
      runtime.getRuntimeStore(),
    );
    runtime.reloadProviderConfig();

    return writeJson(response, 200, {
      providerId,
      model,
      supportsCodexTasks: nextConfig.models.find((entry) => entry.model === model)?.profile?.capabilities.supportsCodexTasks
        ?? payload.supportsCodexTasks,
      message: payload.supportsCodexTasks
        ? "已经把当前模型标记为支持 Codex 任务。"
        : "已经把当前模型标记为不支持 Codex 任务。",
    });
  } catch (error) {
    const taskError = createTaskError(error, false);

    return writeJson(response, 400, {
      error: taskError,
    });
  }
}

export async function handleThirdPartyProviderCreate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = ((await readJsonBody(request)) ?? {}) as ThirdPartyProviderCreatePayload;

  try {
    const providerInput = {
      name: normalizeOptionalText(payload.name),
      baseUrl: normalizeOptionalText(payload.baseUrl),
      apiKey: normalizeOptionalText(payload.apiKey),
      wireApi: normalizeWireApi(payload.wireApi) ?? "responses",
      supportsWebsockets: normalizeBoolean(payload.supportsWebsockets) ?? false,
      ...(normalizeOptionalText(payload.id) ? { id: normalizeOptionalText(payload.id) } : {}),
    };
    const provider = addOpenAICompatibleProvider(process.cwd(), providerInput, runtime.getRuntimeStore());
    runtime.reloadProviderConfig();

    return writeJson(response, 200, {
      providerId: provider.id,
      providerName: provider.name,
      message: `已经添加第三方供应商 ${provider.name}。`,
    });
  } catch (error) {
    const taskError = createTaskError(error, false);

    return writeJson(response, 400, {
      error: taskError,
    });
  }
}

export async function handleThirdPartyModelCreate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = ((await readJsonBody(request)) ?? {}) as ThirdPartyModelCreatePayload;

  try {
    const modelInput = {
      providerId: normalizeOptionalText(payload.providerId),
      model: normalizeOptionalText(payload.model),
      contextWindow: normalizeInteger(payload.contextWindow),
      setAsDefault: normalizeBoolean(payload.setAsDefault) ?? false,
      capabilities: {
        ...(typeof payload.supportsCodexTasks === "boolean" ? { supportsCodexTasks: payload.supportsCodexTasks } : {}),
        ...(typeof payload.imageInput === "boolean" ? { imageInput: payload.imageInput } : {}),
      },
      ...(normalizeOptionalText(payload.displayName) ? { displayName: normalizeOptionalText(payload.displayName) } : {}),
      ...(normalizeOptionalText(payload.description) ? { description: normalizeOptionalText(payload.description) } : {}),
      ...(normalizeOptionalText(payload.defaultReasoningLevel)
        ? { defaultReasoningLevel: normalizeOptionalText(payload.defaultReasoningLevel) }
        : {}),
    };
    const provider = addOpenAICompatibleProviderModel(process.cwd(), modelInput, runtime.getRuntimeStore());
    runtime.reloadProviderConfig();

    return writeJson(response, 200, {
      providerId: provider.id,
      model: normalizeOptionalText(payload.model),
      message: `已经给 ${provider.name} 添加模型 ${normalizeOptionalText(payload.model)}。`,
    });
  } catch (error) {
    const taskError = createTaskError(error, false);

    return writeJson(response, 400, {
      error: taskError,
    });
  }
}

function summarizeProbe(deliveries: WebDeliveryMessage[]): {
  commandExecuted: boolean;
  command: string;
} {
  const commandEvent = deliveries.find((message) => message.metadata?.itemType === "command_execution");

  return {
    commandExecuted: Boolean(commandEvent),
    command: commandEvent?.text ?? "",
  };
}

function buildFailureDetail(errorMessage: string, commandExecuted: boolean): string {
  if (commandExecuted) {
    return `已经看到模型发起真实命令执行，但在工具结果回写后的继续生成阶段失败了。通常这说明它能聊天，却不兼容 Codex 这种多步 agent 工作流。原始错误：${truncateText(errorMessage, 220)}`;
  }

  return `还没进入稳定的命令执行链路就失败了，当前不能把它当成可用的 Codex 任务模型。原始错误：${truncateText(errorMessage, 220)}`;
}

function truncateText(value: string, maxLength = 160): string {
  const normalized = value.trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function normalizeOptionalText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return null;
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeWireApi(value: unknown): "responses" | "chat" | null {
  const normalized = normalizeOptionalText(value).toLowerCase();

  if (normalized === "responses" || normalized === "chat") {
    return normalized;
  }

  return null;
}
