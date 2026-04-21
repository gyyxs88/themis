import type { IncomingMessage, ServerResponse } from "node:http";
import { appendWebAuditEvent, buildRemoteIpContext } from "./http-audit.js";
import type { RuntimeServiceHost } from "../core/runtime-service-host.js";
import type { ThemisManagedUpdateOverview, ThemisUpdateService } from "../diagnostics/update-service.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

interface UpdateMutationPayload {
  confirm: boolean;
}

export async function handleUpdatesOverview(
  response: ServerResponse,
  updateService: Pick<ThemisUpdateService, "readOverview">,
  headOnly = false,
): Promise<void> {
  try {
    const overview = await updateService.readOverview();
    writeJson(response, 200, overview, headOnly);
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    }, headOnly);
  }
}

export async function handleUpdateApplyHttp(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getRuntimeStore">,
  updateService: Pick<ThemisUpdateService, "startApply">,
): Promise<void> {
  await handleManagedUpdateMutation(
    request,
    response,
    runtime,
    updateService,
    "apply",
  );
}

export async function handleUpdateRollbackHttp(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getRuntimeStore">,
  updateService: Pick<ThemisUpdateService, "startRollback">,
): Promise<void> {
  await handleManagedUpdateMutation(
    request,
    response,
    runtime,
    updateService,
    "rollback",
  );
}

async function handleManagedUpdateMutation(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getRuntimeStore">,
  updateService: Pick<ThemisUpdateService, "startApply"> | Pick<ThemisUpdateService, "startRollback">,
  action: "apply" | "rollback",
): Promise<void> {
  try {
    const payload = normalizeUpdateMutationPayload(await readJsonBody(request));
    if (!payload.confirm) {
      writeJson(response, 400, {
        error: createTaskError(
          new Error(action === "apply"
            ? "后台升级请求缺少确认标记；请确认后再试。"
            : "后台回滚请求缺少确认标记；请确认后再试。"),
          false,
        ),
      });
      return;
    }

    const operation = action === "apply"
      ? await (updateService as Pick<ThemisUpdateService, "startApply">).startApply({
        initiatedBy: {
          channel: "web",
          channelUserId: "themis-web-owner",
          displayName: "Themis Web",
        },
      })
      : await (updateService as Pick<ThemisUpdateService, "startRollback">).startRollback({
        initiatedBy: {
          channel: "web",
          channelUserId: "themis-web-owner",
          displayName: "Themis Web",
        },
      });

    appendWebAuditEvent(
      runtime.getRuntimeStore(),
      action === "apply" ? "web_access.update_apply_requested" : "web_access.update_rollback_requested",
      action === "apply" ? "Web 请求后台升级" : "Web 请求后台回滚",
      {
        action,
        startedAt: operation.startedAt,
        progressStep: operation.progressStep,
        progressMessage: operation.progressMessage,
      },
      buildRemoteIpContext(request),
    );

    writeJson(response, 202, {
      ok: true,
      operation,
    });
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}

function normalizeUpdateMutationPayload(value: unknown): UpdateMutationPayload {
  return {
    confirm: Boolean(value && typeof value === "object" && "confirm" in value && (value as { confirm?: unknown }).confirm === true),
  };
}
