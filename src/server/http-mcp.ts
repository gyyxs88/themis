import type { IncomingMessage, ServerResponse } from "node:http";
import type { CodexAuthRuntime } from "../core/codex-auth.js";
import { resolvePrincipalMcpOauthCallbackBaseUrl } from "../core/principal-mcp-service.js";
import type { RuntimeServiceHost } from "../core/runtime-service-host.js";
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

function normalizeMcpUpsertPayload(value: unknown): {
  channel: string;
  channelUserId: string;
  displayName?: string;
  serverName: string;
  transportType?: "stdio" | "streamable_http";
  command?: string;
  url?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  bearerTokenEnvVar?: string;
  enabled?: boolean;
} {
  if (!isRecord(value)) {
    throw new Error("MCP 配置请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const args = Array.isArray(value.args)
    ? value.args.filter((item): item is string => typeof item === "string")
    : undefined;
  const cwd = normalizeText(value.cwd) ?? undefined;
  const env = normalizeEnvRecord(value.env);
  const bearerTokenEnvVar = normalizeText(value.bearerTokenEnvVar) ?? undefined;
  const url = normalizeText(value.url) ?? undefined;
  const command = normalizeText(value.command) ?? undefined;
  const transportType = normalizeMcpTransportType(value.transportType) ?? (url ? "streamable_http" : "stdio");

  if (transportType === "streamable_http" && !url && !command) {
    throw new Error("MCP url 不能为空。");
  }

  if (transportType === "stdio" && !command) {
    throw new Error("MCP command 不能为空。");
  }

  return {
    ...identity,
    serverName: normalizeRequiredText(value.serverName, "MCP server 名称不能为空。"),
    transportType,
    ...(command ? { command } : {}),
    ...(url ? { url } : {}),
    ...(args ? { args } : {}),
    ...(cwd ? { cwd } : {}),
    ...(env ? { env } : {}),
    ...(bearerTokenEnvVar ? { bearerTokenEnvVar } : {}),
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
  };
}

function normalizeMcpServerNamePayload(value: unknown, errorMessage: string): {
  channel: string;
  channelUserId: string;
  displayName?: string;
  serverName: string;
} {
  if (!isRecord(value)) {
    throw new Error(errorMessage);
  }

  const identity = normalizeIdentityPayload(value);

  return {
    ...identity,
    serverName: normalizeRequiredText(value.serverName, "MCP server 名称不能为空。"),
  };
}

function normalizeMcpOauthStatusPayload(value: unknown): {
  channel: string;
  channelUserId: string;
  displayName?: string;
  serverName: string;
  refresh?: boolean;
} {
  if (!isRecord(value)) {
    throw new Error("MCP OAuth 状态请求缺少必要字段。");
  }

  const payload = normalizeMcpServerNamePayload(value, "MCP OAuth 状态请求缺少必要字段。");

  return {
    ...payload,
    ...(typeof value.refresh === "boolean" ? { refresh: value.refresh } : {}),
  };
}

function normalizeEnvRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const normalized: Record<string, string> = {};

  for (const [key, entry] of Object.entries(value)) {
    const trimmedKey = key.trim();

    if (!trimmedKey || typeof entry !== "string") {
      continue;
    }

    normalized[trimmedKey] = entry;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeMcpTransportType(value: unknown): "stdio" | "streamable_http" | undefined {
  const normalized = normalizeText(value);

  if (normalized === "stdio" || normalized === "streamable_http") {
    return normalized;
  }

  return undefined;
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

export async function handleMcpList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalMcpService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeIdentityPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);

    writeJson(response, 200, {
      identity,
      servers: runtime.getPrincipalMcpService().listPrincipalMcpServers(identity.principalId),
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handleMcpReload(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalMcpService" | "getWorkingDirectory">,
  authRuntime: CodexAuthRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeIdentityPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const result = await runtime.getPrincipalMcpService().reloadPrincipalMcpServers(identity.principalId, {
      workingDirectory: runtime.getWorkingDirectory(),
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

export async function handleMcpUpsert(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalMcpService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeMcpUpsertPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const server = runtime.getPrincipalMcpService().upsertPrincipalMcpServer({
      principalId: identity.principalId,
      serverName: payload.serverName,
      ...(payload.transportType ? { transportType: payload.transportType } : {}),
      ...(payload.command ? { command: payload.command } : {}),
      ...(payload.url ? { url: payload.url } : {}),
      ...(payload.args ? { args: payload.args } : {}),
      ...(payload.cwd ? { cwd: payload.cwd } : {}),
      ...(payload.env ? { env: payload.env } : {}),
      ...(payload.bearerTokenEnvVar ? { bearerTokenEnvVar: payload.bearerTokenEnvVar } : {}),
      ...(typeof payload.enabled === "boolean" ? { enabled: payload.enabled } : {}),
    });

    writeJson(response, 200, {
      identity,
      server,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handleMcpRemove(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalMcpService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(
    request,
    response,
    (value) => normalizeMcpServerNamePayload(value, "MCP 删除请求缺少必要字段。"),
  );

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const result = runtime.getPrincipalMcpService().removePrincipalMcpServer(
      identity.principalId,
      payload.serverName,
    );

    writeJson(response, 200, {
      identity,
      result,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handleMcpOauthLogin(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalMcpService" | "getWorkingDirectory">,
  authRuntime: CodexAuthRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(
    request,
    response,
    (value) => normalizeMcpServerNamePayload(value, "MCP OAuth 登录请求缺少必要字段。"),
  );

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const mcpOauthCallbackBaseUrl = resolvePrincipalMcpOauthCallbackBaseUrl();
    const result = await runtime.getPrincipalMcpService().startPrincipalMcpOauthLogin(
      identity.principalId,
      payload.serverName,
      {
        workingDirectory: runtime.getWorkingDirectory(),
        activeAuthAccount: authRuntime.getActiveAccount(),
        ...(mcpOauthCallbackBaseUrl ? { mcpOauthCallbackBaseUrl } : {}),
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

export async function handleMcpOauthCallback(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  runtime: Pick<RuntimeServiceHost, "getPrincipalMcpService">,
): Promise<void> {
  if (request.method !== "GET") {
    writeJson(response, 405, {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "MCP OAuth callback only supports GET.",
      },
    });
    return;
  }

  const bridgeId = url.pathname.slice("/api/mcp/oauth/callback/".length);
  let decodedBridgeId: string;

  try {
    decodedBridgeId = decodeURIComponent(bridgeId);
  } catch {
    response.writeHead(400, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Invalid OAuth callback.");
    return;
  }

  const result = await runtime.getPrincipalMcpService().handlePrincipalMcpOauthCallback(
    decodedBridgeId,
    url.search,
  );

  response.writeHead(result.statusCode, {
    "Content-Type": result.contentType,
  });
  response.end(result.body);
}

export async function handleMcpOauthStatus(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalMcpService" | "getWorkingDirectory">,
  authRuntime: CodexAuthRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeMcpOauthStatusPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const result = await runtime.getPrincipalMcpService().getPrincipalMcpOauthStatus(
      identity.principalId,
      payload.serverName,
      {
        workingDirectory: runtime.getWorkingDirectory(),
        activeAuthAccount: authRuntime.getActiveAccount(),
        ...(typeof payload.refresh === "boolean" ? { refresh: payload.refresh } : {}),
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

export async function handleMcpEnable(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalMcpService">,
): Promise<void> {
  return await handleMcpSetEnabled(request, response, runtime, true);
}

export async function handleMcpDisable(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalMcpService">,
): Promise<void> {
  return await handleMcpSetEnabled(request, response, runtime, false);
}

async function handleMcpSetEnabled(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalMcpService">,
  enabled: boolean,
): Promise<void> {
  const payload = await readAndNormalizePayload(
    request,
    response,
    (value) => normalizeMcpServerNamePayload(value, "MCP 开关请求缺少必要字段。"),
  );

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const server = runtime.getPrincipalMcpService().setPrincipalMcpServerEnabled(
      identity.principalId,
      payload.serverName,
      enabled,
    );

    writeJson(response, 200, {
      identity,
      server,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}
