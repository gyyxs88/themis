import { SessionBusyError } from "../core/task-runtime-common.js";
import type { TaskError } from "../types/index.js";

export function createTaskError(error: unknown, hasNormalizedRequest: boolean): TaskError {
  if (error instanceof SessionBusyError) {
    return {
      code: "SESSION_BUSY",
      message: error.message,
      retryable: true,
    };
  }

  if (isAuthenticationError(error)) {
    return {
      code: "AUTH_REQUIRED",
      message: "Codex 当前没有可用认证。请先完成 ChatGPT 浏览器登录、设备码登录，或保存 API Key。",
      retryable: true,
    };
  }

  const timeoutMessage = resolveTaskTimeoutMessage(error);

  if (timeoutMessage) {
    return {
      code: "CORE_RUNTIME_ERROR",
      message: timeoutMessage,
      retryable: true,
    };
  }

  return {
    code: hasNormalizedRequest ? "CORE_RUNTIME_ERROR" : "INVALID_REQUEST",
    message: toErrorMessage(error),
  };
}

export function resolveErrorStatusCode(error: unknown, hasNormalizedRequest: boolean): number {
  if (error instanceof SessionBusyError) {
    return 409;
  }

  if (isAuthenticationError(error)) {
    return 401;
  }

  return hasNormalizedRequest ? 500 : 400;
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAuthenticationError(error: unknown): boolean {
  const message = toErrorMessage(error);

  return /not logged in/i.test(message)
    || /401 unauthorized/i.test(message)
    || /missing bearer or basic authentication/i.test(message);
}

function resolveTaskTimeoutMessage(error: unknown): string | null {
  const message = toErrorMessage(error);

  if (!message.startsWith("TASK_TIMEOUT:")) {
    return null;
  }

  const timeoutMs = Number.parseInt(message.slice("TASK_TIMEOUT:".length), 10);

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return "任务因超时被取消。";
  }

  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return `任务因超时被取消，超时时间约为 ${seconds} 秒。`;
}
