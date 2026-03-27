import type { IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { CodexAuthRuntime, type CodexAuthSnapshot } from "../core/codex-auth.js";
import type { CodexTaskRuntime } from "../core/codex-runtime.js";
import { readJsonBody } from "./http-request.js";
import { toErrorMessage } from "./http-errors.js";
import { writeJson } from "./http-responses.js";

interface AuthLoginPayload {
  method?: unknown;
  mode?: unknown;
  apiKey?: unknown;
  accountId?: unknown;
}

interface AuthAccountCreatePayload {
  accountId?: unknown;
  label?: unknown;
  activate?: unknown;
}

interface AuthAccountSelectPayload {
  accountId?: unknown;
}

interface BrowserLoginContext {
  supportedOnThisBrowser: boolean;
  localOrigin: string;
  sshTunnelCommand: string | null;
}

const DEFAULT_PRIVATE_ASSISTANT_PRINCIPAL_ID = "principal-local-owner";

export async function handleAuthStatus(
  request: IncomingMessage,
  response: ServerResponse,
  authRuntime: CodexAuthRuntime,
  headOnly = false,
): Promise<void> {
  try {
    const accountId = normalizeOptionalText(new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).searchParams.get("accountId") ?? undefined);
    const auth = await authRuntime.readSnapshot(accountId ?? undefined);
    writeJson(response, 200, { auth: enrichAuthSnapshot(authRuntime, auth, request) }, headOnly);
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
    const accountId = normalizeOptionalText(payload.accountId);

    if (method === "chatgpt") {
      const auth = mode === "device"
        ? await authRuntime.startChatgptDeviceLogin(accountId ?? undefined)
        : await authRuntime.startChatgptLogin(accountId ?? undefined);
      writeJson(response, 200, { auth: enrichAuthSnapshot(authRuntime, auth, request) });
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

      const auth = await authRuntime.loginWithApiKey(apiKey, accountId ?? undefined);
      writeJson(response, 200, { auth: enrichAuthSnapshot(authRuntime, auth, request) });
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
    const payload = (await readJsonBody(request).catch(() => ({}))) as AuthLoginPayload;
    const accountId = normalizeOptionalText(payload.accountId);
    const auth = await authRuntime.logout(accountId ?? undefined);
    writeJson(response, 200, { auth: enrichAuthSnapshot(authRuntime, auth, request) });
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
    const payload = (await readJsonBody(request).catch(() => ({}))) as AuthLoginPayload;
    const accountId = normalizeOptionalText(payload.accountId);
    const auth = await authRuntime.cancelPendingLogin(accountId ?? undefined);
    writeJson(response, 200, { auth: enrichAuthSnapshot(authRuntime, auth, request) });
  } catch (error) {
    writeJson(response, 500, {
      error: {
        code: "AUTH_LOGIN_CANCEL_ERROR",
        message: toErrorMessage(error),
      },
    });
  }
}

export async function handleAuthAccountCreate(
  request: IncomingMessage,
  response: ServerResponse,
  authRuntime: CodexAuthRuntime,
  runtime?: CodexTaskRuntime,
): Promise<void> {
  try {
    const payload = (await readJsonBody(request)) as AuthAccountCreatePayload;
    const label = normalizeOptionalText(payload.label);

    if (!label) {
      writeJson(response, 400, {
        error: {
          code: "INVALID_REQUEST",
          message: "缺少账号名称。",
        },
      });
      return;
    }

    const account = authRuntime.createAccount({
      label,
      ...(normalizeOptionalText(payload.accountId) ? { accountId: normalizeOptionalText(payload.accountId)! } : {}),
      activate: typeof payload.activate === "boolean" ? payload.activate : true,
    });
    await runtime?.getPrincipalSkillsService().syncAllSkillsToAuthAccount(
      DEFAULT_PRIVATE_ASSISTANT_PRINCIPAL_ID,
      account.accountId,
    );
    const auth = await authRuntime.readSnapshot(account.accountId);
    writeJson(response, 200, {
      account,
      auth: enrichAuthSnapshot(authRuntime, auth, request),
    });
  } catch (error) {
    writeJson(response, 500, {
      error: {
        code: "AUTH_ACCOUNT_CREATE_ERROR",
        message: toErrorMessage(error),
      },
    });
  }
}

export async function handleAuthAccountSelect(
  request: IncomingMessage,
  response: ServerResponse,
  authRuntime: CodexAuthRuntime,
): Promise<void> {
  try {
    const payload = (await readJsonBody(request)) as AuthAccountSelectPayload;
    const accountId = normalizeOptionalText(payload.accountId);

    if (!accountId) {
      writeJson(response, 400, {
        error: {
          code: "INVALID_REQUEST",
          message: "缺少 accountId。",
        },
      });
      return;
    }

    const account = authRuntime.setActiveAccount(accountId);
    const auth = await authRuntime.readSnapshot(account.accountId);
    writeJson(response, 200, {
      account,
      auth: enrichAuthSnapshot(authRuntime, auth, request),
    });
  } catch (error) {
    writeJson(response, 500, {
      error: {
        code: "AUTH_ACCOUNT_SELECT_ERROR",
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

function enrichAuthSnapshot(authRuntime: CodexAuthRuntime, auth: CodexAuthSnapshot, request: IncomingMessage): CodexAuthSnapshot & {
  browserLogin: BrowserLoginContext;
  accounts: ReturnType<CodexAuthRuntime["listAccounts"]>;
  activeAccountId: string | null;
  currentAccountId: string;
} {
  return {
    ...auth,
    accounts: authRuntime.listAccounts(),
    activeAccountId: authRuntime.getActiveAccount()?.accountId ?? null,
    currentAccountId: auth.accountId,
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
