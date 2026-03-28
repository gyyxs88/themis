import type { IncomingMessage, ServerResponse } from "node:http";
import { AppServerActionBridge } from "../core/app-server-action-bridge.js";
import type { TaskActionSubmitRequest } from "../types/index.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

export async function handleTaskActionSubmit(
  request: IncomingMessage,
  response: ServerResponse,
  actionBridge: AppServerActionBridge,
): Promise<void> {
  let payload: TaskActionSubmitRequest;

  try {
    payload = (await readJsonBody(request)) as TaskActionSubmitRequest;
  } catch (error) {
    if (error instanceof SyntaxError) {
      writeJson(response, 400, {
        error: {
          code: "INVALID_REQUEST",
          message: "请求体不是合法的 JSON。",
        },
      });
      return;
    }

    throw error;
  }

  const action = actionBridge.findBySubmission(payload.taskId, payload.requestId, payload.actionId);

  if (!action) {
    writeJson(response, 404, {
      error: {
        code: "INVALID_REQUEST",
        message: "未找到匹配的等待中 action。",
      },
    });
    return;
  }

  if (!actionBridge.resolve(payload)) {
    writeJson(response, 404, {
      error: {
        code: "INVALID_REQUEST",
        message: "未找到匹配的等待中 action。",
      },
    });
    return;
  }

  writeJson(response, 200, { ok: true });
}
