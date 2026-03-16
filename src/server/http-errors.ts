import { SessionBusyError } from "../core/codex-session-store.js";
import type { TaskError } from "../types/index.js";

export function createTaskError(error: unknown, hasNormalizedRequest: boolean): TaskError {
  if (error instanceof SessionBusyError) {
    return {
      code: "SESSION_BUSY",
      message: error.message,
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

  return hasNormalizedRequest ? 500 : 400;
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
