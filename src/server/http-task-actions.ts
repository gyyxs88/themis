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
  const payload = (await readJsonBody(request)) as TaskActionSubmitRequest;
  const action = actionBridge.find(payload.actionId);

  if (!action) {
    writeJson(response, 404, {
      error: {
        code: "INVALID_REQUEST",
        message: "未找到匹配的等待中 action。",
      },
    });
    return;
  }

  actionBridge.resolve(payload.actionId, payload as unknown as Record<string, unknown>);
  writeJson(response, 200, { ok: true });
}
