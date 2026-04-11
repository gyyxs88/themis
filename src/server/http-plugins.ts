import type { IncomingMessage, ServerResponse } from "node:http";
import type { CodexAuthRuntime } from "../core/codex-auth.js";
import type { CodexTaskRuntime } from "../core/codex-runtime.js";
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

function normalizePluginListPayload(value: unknown): {
  channel: string;
  channelUserId: string;
  displayName?: string;
  cwd?: string;
  forceRemoteSync: boolean;
} {
  if (!isRecord(value)) {
    throw new Error("plugin 请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const cwd = normalizeText(value.cwd) ?? undefined;

  return {
    ...identity,
    ...(cwd ? { cwd } : {}),
    forceRemoteSync: value.forceRemoteSync === true,
  };
}

function normalizePluginReadPayload(value: unknown, errorMessage: string): {
  channel: string;
  channelUserId: string;
  displayName?: string;
  cwd?: string;
  forceRemoteSync: boolean;
  marketplacePath: string;
  pluginName: string;
} {
  if (!isRecord(value)) {
    throw new Error(errorMessage);
  }

  const payload = normalizePluginListPayload(value);

  return {
    ...payload,
    marketplacePath: normalizeRequiredText(value.marketplacePath, "plugin marketplacePath 不能为空。"),
    pluginName: normalizeRequiredText(value.pluginName, "plugin 名称不能为空。"),
  };
}

function normalizePluginUninstallPayload(value: unknown, errorMessage: string): {
  channel: string;
  channelUserId: string;
  displayName?: string;
  cwd?: string;
  forceRemoteSync: boolean;
  pluginId: string;
} {
  if (!isRecord(value)) {
    throw new Error(errorMessage);
  }

  const payload = normalizePluginListPayload(value);

  return {
    ...payload,
    pluginId: normalizeRequiredText(value.pluginId, "pluginId 不能为空。"),
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

export async function handlePluginsList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
  authRuntime: CodexAuthRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePluginListPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const result = await runtime.getPrincipalPluginsService().listPrincipalPlugins(identity.principalId, {
      ...(payload.cwd ? { cwd: payload.cwd } : {}),
      forceRemoteSync: payload.forceRemoteSync,
      activeAuthAccount: authRuntime.getActiveAccount(),
    });

    writeJson(response, 200, {
      identity,
      result,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePluginsRead(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
  authRuntime: CodexAuthRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(
    request,
    response,
    (value) => normalizePluginReadPayload(value, "plugin 详情请求缺少必要字段。"),
  );

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const result = await runtime.getPrincipalPluginsService().readPrincipalPlugin(identity.principalId, {
      marketplacePath: payload.marketplacePath,
      pluginName: payload.pluginName,
    }, {
      ...(payload.cwd ? { cwd: payload.cwd } : {}),
      forceRemoteSync: payload.forceRemoteSync,
      activeAuthAccount: authRuntime.getActiveAccount(),
    });

    writeJson(response, 200, {
      identity,
      result,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePluginsInstall(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
  authRuntime: CodexAuthRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(
    request,
    response,
    (value) => normalizePluginReadPayload(value, "plugin 安装请求缺少必要字段。"),
  );

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const result = await runtime.getPrincipalPluginsService().installPrincipalPlugin(identity.principalId, {
      marketplacePath: payload.marketplacePath,
      pluginName: payload.pluginName,
      forceRemoteSync: payload.forceRemoteSync,
    }, {
      ...(payload.cwd ? { cwd: payload.cwd } : {}),
      activeAuthAccount: authRuntime.getActiveAccount(),
    });

    writeJson(response, 200, {
      identity,
      result,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePluginsUninstall(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
  authRuntime: CodexAuthRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(
    request,
    response,
    (value) => normalizePluginUninstallPayload(value, "plugin 卸载请求缺少必要字段。"),
  );

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const result = await runtime.getPrincipalPluginsService().uninstallPrincipalPlugin(
      identity.principalId,
      payload.pluginId,
      {
        ...(payload.cwd ? { cwd: payload.cwd } : {}),
        activeAuthAccount: authRuntime.getActiveAccount(),
        forceRemoteSync: payload.forceRemoteSync,
      },
    );

    writeJson(response, 200, {
      identity,
      result,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePluginsSync(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
  authRuntime: CodexAuthRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePluginListPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const result = await runtime.getPrincipalPluginsService().syncPrincipalPlugins(identity.principalId, {
      ...(payload.cwd ? { cwd: payload.cwd } : {}),
      forceRemoteSync: payload.forceRemoteSync,
      activeAuthAccount: authRuntime.getActiveAccount(),
    });

    writeJson(response, 200, {
      identity,
      result,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}
