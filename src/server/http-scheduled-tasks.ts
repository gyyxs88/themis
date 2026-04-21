import type { IncomingMessage, ServerResponse } from "node:http";
import type { RuntimeServiceHost } from "../core/runtime-service-host.js";
import type {
  ScheduledTaskAutomationOptions,
  ScheduledTaskRuntimeOptions,
} from "../types/index.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeRequiredText(value: unknown, errorMessage: string): string {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new Error(errorMessage);
  }

  return normalized;
}

function normalizeScheduledTaskIdentityPayload(value: unknown): {
  channel: string;
  channelUserId: string;
  displayName?: string;
} {
  if (!isRecord(value)) {
    throw new Error("身份请求缺少必要字段。");
  }

  const channel = normalizeText(value.channel);
  const channelUserId = normalizeText(value.channelUserId);
  const displayName = normalizeText(value.displayName);

  if (!channel || !channelUserId) {
    throw new Error("身份请求缺少必要字段。");
  }

  return {
    channel,
    channelUserId,
    ...(displayName ? { displayName } : {}),
  };
}

function normalizeScheduledTaskCreatePayload(value: unknown): {
  channel: string;
  channelUserId: string;
  displayName?: string;
  sessionId?: string;
  channelSessionKey?: string;
  goal: string;
  inputText?: string;
  options?: ScheduledTaskRuntimeOptions;
  automation?: ScheduledTaskAutomationOptions;
  timezone: string;
  scheduledAt: string;
} {
  if (!isRecord(value)) {
    throw new Error("定时任务创建请求缺少必要字段。");
  }

  const identity = normalizeScheduledTaskIdentityPayload(value);
  const sessionId = normalizeText(value.sessionId);
  const channelSessionKey = normalizeText(value.channelSessionKey);
  const options = isRecord(value.options) ? value.options as ScheduledTaskRuntimeOptions : undefined;
  const automation = isRecord(value.automation) ? value.automation as ScheduledTaskAutomationOptions : undefined;

  return {
    ...identity,
    ...(sessionId ? { sessionId } : {}),
    ...(channelSessionKey ? { channelSessionKey } : {}),
    goal: normalizeRequiredText(value.goal, "任务目标不能为空。"),
    ...(normalizeText(value.inputText) ? { inputText: normalizeText(value.inputText) as string } : {}),
    ...(options ? { options } : {}),
    ...(automation ? { automation } : {}),
    timezone: normalizeRequiredText(value.timezone, "时区不能为空。"),
    scheduledAt: normalizeRequiredText(value.scheduledAt, "执行时间不能为空。"),
  };
}

function normalizeScheduledTaskCancelPayload(value: unknown): {
  channel: string;
  channelUserId: string;
  displayName?: string;
  scheduledTaskId: string;
} {
  if (!isRecord(value)) {
    throw new Error("定时任务取消请求缺少必要字段。");
  }

  const identity = normalizeScheduledTaskIdentityPayload(value);

  return {
    ...identity,
    scheduledTaskId: normalizeRequiredText(value.scheduledTaskId, "定时任务 id 不能为空。"),
  };
}

async function readAndNormalizePayload<T>(
  request: IncomingMessage,
  response: ServerResponse,
  normalize: (value: unknown) => T,
): Promise<T | null> {
  try {
    return normalize(await readJsonBody(request));
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, false), {
      error: createTaskError(error, false),
    });
    return null;
  }
}

function writeRuntimeError(response: ServerResponse, error: unknown): void {
  writeJson(response, resolveErrorStatusCode(error, true), {
    error: createTaskError(error, true),
  });
}

export async function handleScheduledTaskCreate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getScheduledTasksService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeScheduledTaskCreatePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const task = runtime.getScheduledTasksService().createTask({
      principalId: identity.principalId,
      sourceChannel: payload.channel,
      channelUserId: payload.channelUserId,
      ...(payload.displayName ? { displayName: payload.displayName } : {}),
      ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
      ...(payload.channelSessionKey ? { channelSessionKey: payload.channelSessionKey } : {}),
      goal: payload.goal,
      ...(payload.inputText ? { inputText: payload.inputText } : {}),
      ...(payload.options ? { options: payload.options } : {}),
      ...(payload.automation ? { automation: payload.automation } : {}),
      timezone: payload.timezone,
      scheduledAt: payload.scheduledAt,
    });

    writeJson(response, 200, {
      identity,
      task,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handleScheduledTaskList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getScheduledTasksService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeScheduledTaskIdentityPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const tasks = runtime.getScheduledTasksService().listTasks(identity.principalId);

    writeJson(response, 200, {
      identity,
      tasks,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handleScheduledTaskCancel(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getScheduledTasksService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeScheduledTaskCancelPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const task = runtime.getScheduledTasksService().cancelTask({
      ownerPrincipalId: identity.principalId,
      scheduledTaskId: payload.scheduledTaskId,
    });

    writeJson(response, 200, {
      identity,
      task,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}
