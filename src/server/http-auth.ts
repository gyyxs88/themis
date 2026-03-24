import type { IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { CodexAuthRuntime, type CodexAuthSnapshot } from "../core/codex-auth.js";
import { readJsonBody } from "./http-request.js";
import { toErrorMessage } from "./http-errors.js";
import { writeJson } from "./http-responses.js";

interface AuthLoginPayload {
  method?: unknown;
  mode?: unknown;
  apiKey?: unknown;
}

interface BrowserLoginContext {
  supportedOnThisBrowser: boolean;
  localOrigin: string;
  sshTunnelCommand: string | null;
}

export async function handleAuthStatus(
  request: IncomingMessage,
  response: ServerResponse,
  authRuntime: CodexAuthRuntime,
  headOnly = false,
): Promise<void> {
  try {
    const auth = await authRuntime.readSnapshot();
    writeJson(response, 200, { auth: enrichAuthSnapshot(auth, request) }, headOnly);
  } catch (error) {
    writeJson(
      response,
      500,
      {
        error: {
          code: "AUTH_STATUS_ERROR",
          message: toErrorMessage(error),
        },
      },
      headOnly,
    );
  }
}

export async function handleAuthLogin(
  request: IncomingMessage,
  response: ServerResponse,
  authRuntime: CodexAuthRuntime,
): Promise<void> {
  try {
    const payload = (await readJsonBody(request)) as AuthLoginPayload;
    const method = normalizeOptionalText(payload.method);
    const mode = normalizeOptionalText(payload.mode);

    if (method === "chatgpt") {
      const auth = mode === "device"
        ? await authRuntime.startChatgptDeviceLogin()
        : await authRuntime.startChatgptLogin();
      writeJson(response, 200, { auth: enrichAuthSnapshot(auth, request) });
      return;
    }

    if (method === "apiKey") {
      const apiKey = normalizeOptionalText(payload.apiKey);

      if (!apiKey) {
        writeJson(response, 400, {
          error: {
            code: "INVALID_REQUEST",
            message: "缺少 API Key。",
          },
        });
        return;
      }

      const auth = await authRuntime.loginWithApiKey(apiKey);
      writeJson(response, 200, { auth: enrichAuthSnapshot(auth, request) });
      return;
    }

    writeJson(response, 400, {
      error: {
        code: "INVALID_REQUEST",
        message: "不支持的登录方式。",
      },
    });
  } catch (error) {
    writeJson(response, 500, {
      error: {
        code: "AUTH_LOGIN_ERROR",
        message: toErrorMessage(error),
      },
    });
  }
}

export async function handleAuthLogout(
  request: IncomingMessage,
  response: ServerResponse,
  authRuntime: CodexAuthRuntime,
): Promise<void> {
  try {
    const auth = await authRuntime.logout();
    writeJson(response, 200, { auth: enrichAuthSnapshot(auth, request) });
  } catch (error) {
    writeJson(response, 500, {
      error: {
        code: "AUTH_LOGOUT_ERROR",
        message: toErrorMessage(error),
      },
    });
  }
}

export async function handleAuthLoginCancel(
  request: IncomingMessage,
  response: ServerResponse,
  authRuntime: CodexAuthRuntime,
): Promise<void> {
  try {
    const auth = await authRuntime.cancelPendingLogin();
    writeJson(response, 200, { auth: enrichAuthSnapshot(auth, request) });
  } catch (error) {
    writeJson(response, 500, {
      error: {
        code: "AUTH_LOGIN_CANCEL_ERROR",
        message: toErrorMessage(error),
      },
    });
  }
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text ? text : null;
}

function enrichAuthSnapshot(auth: CodexAuthSnapshot, request: IncomingMessage): CodexAuthSnapshot & {
  browserLogin: BrowserLoginContext;
} {
  return {
    ...auth,
    browserLogin: resolveBrowserLoginContext(request),
  };
}

function resolveBrowserLoginContext(request: IncomingMessage): BrowserLoginContext {
  const localOrigin = resolveLocalOrigin(request);
  const host = resolveRequestHostname(request);
  const supportedOnThisBrowser = isSameMachineClient(request);

  return {
    supportedOnThisBrowser,
    localOrigin,
    sshTunnelCommand: supportedOnThisBrowser || !host || isLoopbackHostname(host)
      ? null
      : `ssh -L 1455:127.0.0.1:1455 <ssh-user>@${host}`,
  };
}

function resolveLocalOrigin(request: IncomingMessage): string {
  const hostHeader = request.headers.host?.trim() ?? "";

  if (!hostHeader) {
    return "http://localhost";
  }

  try {
    const url = new URL(`http://${hostHeader}`);
    return `${url.protocol}//localhost${url.port ? `:${url.port}` : ""}`;
  } catch {
    return "http://localhost";
  }
}

function resolveRequestHostname(request: IncomingMessage): string | null {
  const hostHeader = request.headers.host?.trim() ?? "";

  if (!hostHeader) {
    return null;
  }

  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

function isSameMachineClient(request: IncomingMessage): boolean {
  const remoteAddress = normalizeIpAddress(request.socket.remoteAddress);

  if (!remoteAddress) {
    return false;
  }

  const localAddresses = new Set<string>([
    "127.0.0.1",
    "::1",
  ]);

  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      const normalized = normalizeIpAddress(entry.address);

      if (normalized) {
        localAddresses.add(normalized);
      }
    }
  }

  return localAddresses.has(remoteAddress);
}

function normalizeIpAddress(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const withoutZone = trimmed.replace(/%.+$/, "");

  if (withoutZone.startsWith("::ffff:")) {
    return withoutZone.slice("::ffff:".length);
  }

  return withoutZone;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "[::1]";
}
