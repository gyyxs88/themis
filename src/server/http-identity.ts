import type { IncomingMessage, ServerResponse } from "node:http";
import type { RuntimeServiceHost } from "../core/runtime-service-host.js";
import { normalizePrincipalTaskSettings } from "../core/principal-task-settings.js";
import { appendWebAuditEvent, buildRemoteIpContext } from "./http-audit.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";

interface IdentityPayload {
  channel?: unknown;
  channelUserId?: unknown;
  displayName?: unknown;
}

export async function handleIdentityStatus(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalPersonaService" | "getPrincipalTaskSettings">,
): Promise<void> {
  try {
    const payload = normalizeIdentityPayload(await readJsonBody(request));
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);

    writeJson(response, 200, {
      identity,
      personaProfile: runtime.getPrincipalPersonaService().getPrincipalProfile(identity.principalId),
      taskSettings: runtime.getPrincipalTaskSettings(identity.principalId),
    });
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}

export async function handleIdentityLinkCodeCreate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService">,
): Promise<void> {
  try {
    const payload = normalizeIdentityPayload(await readJsonBody(request));
    const linkCode = runtime.getIdentityLinkService().issueLinkCode(payload);

    writeJson(response, 200, {
      linkCode,
    });
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}

export async function handleIdentityReset(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "resetPrincipalState" | "getRuntimeStore">,
): Promise<void> {
  try {
    const payload = normalizeIdentityPayload(await readJsonBody(request));
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const resetAt = new Date().toISOString();
    const reset = runtime.resetPrincipalState(identity.principalId, resetAt);

    appendWebAuditEvent(
      runtime.getRuntimeStore(),
      "web_access.principal_reset",
      "principal 重置",
      {
        principalId: identity.principalId,
        resetAt,
        channel: identity.channel,
        channelUserId: identity.channelUserId,
        ...(payload.displayName ? { displayName: payload.displayName } : {}),
      },
      buildRemoteIpContext(request),
    );

    writeJson(response, 200, {
      ok: true,
      identity,
      reset,
    });
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}

export async function handleIdentityPersonaUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalPersonaService">,
): Promise<void> {
  try {
    const payload = normalizeIdentityPersonaPayload(await readJsonBody(request));
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const personaProfile = runtime.getPrincipalPersonaService().savePrincipalAssistantPersona(
      identity.principalId,
      {
        ...(payload.assistantLanguageStyle ? { assistantLanguageStyle: payload.assistantLanguageStyle } : {}),
        ...(payload.assistantMbti ? { assistantMbti: payload.assistantMbti } : {}),
        ...(payload.assistantStyleNotes ? { assistantStyleNotes: payload.assistantStyleNotes } : {}),
        assistantSoul: payload.assistantSoul,
      },
      {
        ...(payload.displayName ? { displayName: payload.displayName } : {}),
      },
    );

    writeJson(response, 200, {
      ok: true,
      identity,
      personaProfile,
    });
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}

export async function handleIdentityTaskSettingsUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "savePrincipalTaskSettings" | "getRuntimeStore">,
): Promise<void> {
  try {
    const payload = normalizeIdentityTaskSettingsPayload(await readJsonBody(request));
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const taskSettings = runtime.savePrincipalTaskSettings(
      identity.principalId,
      normalizePrincipalTaskSettings(payload.settings),
    );

    appendWebAuditEvent(
      runtime.getRuntimeStore(),
      "web_access.identity_task_settings_updated",
      "principal 任务设置已更新",
      {
        principalId: identity.principalId,
        channel: identity.channel,
        channelUserId: identity.channelUserId,
        settings: taskSettings,
      },
      buildRemoteIpContext(request),
    );

    writeJson(response, 200, {
      ok: true,
      identity,
      taskSettings,
    });
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}

function normalizeIdentityPayload(value: unknown): {
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

function normalizeIdentityPersonaPayload(value: unknown): {
  channel: string;
  channelUserId: string;
  assistantLanguageStyle?: string;
  assistantMbti?: string;
  assistantStyleNotes?: string;
  assistantSoul: string;
  displayName?: string;
} {
  if (!isRecord(value)) {
    throw new Error("人格请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const assistantLanguageStyle = normalizeText(value.assistantLanguageStyle);
  const assistantMbti = normalizeText(value.assistantMbti);
  const assistantStyleNotes = normalizeText(value.assistantStyleNotes);
  const assistantSoul = typeof value.assistantSoul === "string" ? value.assistantSoul : "";

  return {
    ...identity,
    ...(assistantLanguageStyle ? { assistantLanguageStyle } : {}),
    ...(assistantMbti ? { assistantMbti } : {}),
    ...(assistantStyleNotes ? { assistantStyleNotes } : {}),
    assistantSoul,
  };
}

function normalizeIdentityTaskSettingsPayload(value: unknown): {
  channel: string;
  channelUserId: string;
  settings: unknown;
  displayName?: string;
} {
  if (!isRecord(value)) {
    throw new Error("配置请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);

  return {
    ...identity,
    settings: value.settings,
  };
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
