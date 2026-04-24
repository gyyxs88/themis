import type { IncomingMessage, ServerResponse } from "node:http";
import {
  buildPlatformServiceAuthDeniedErrorResponse,
  buildPlatformServiceForbiddenErrorResponse,
  readPlatformServiceAuthorizationHeader,
} from "themis-contracts/managed-agent-platform-access";
import {
  WebAccessService,
  type PlatformServiceRole,
  type PlatformServiceTokenSummary,
  type WebAccessSessionReadResult,
} from "../core/web-access.js";
import { resolveRemoteIp } from "./http-audit.js";
import { toErrorMessage } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { clearSessionCookie, readCookie, setSessionCookie, WEB_SESSION_COOKIE } from "./http-cookies.js";
import { writeHtml, writeJson, writeRedirect } from "./http-responses.js";

interface WebAccessLoginPayload {
  token?: unknown;
}

export interface PlatformServiceAuthContext {
  tokenId: string;
  tokenLabel: string;
  ownerPrincipalId: string;
  serviceRole: PlatformServiceRole;
}

export interface WebAccessRouteOptions {
  appDisplayName?: string;
}

const PLATFORM_SERVICE_AUTH_CONTEXT = Symbol("themis.platform-service-auth-context");
const DEFAULT_WEB_ACCESS_APP_DISPLAY_NAME = "Themis Web";

export async function maybeHandleWebAccessRoute(
  request: IncomingMessage,
  response: ServerResponse,
  service: WebAccessService,
  options: WebAccessRouteOptions = {},
): Promise<boolean> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const method = request.method ?? "GET";
  const headOnly = method === "HEAD";
  const ui = resolveWebAccessRouteOptions(options);

  if ((method === "GET" || headOnly) && url.pathname === "/login") {
    const body = service.hasActiveToken()
      ? createLoginPageHtml(ui.appDisplayName)
      : createBootstrapHintHtml(ui.appDisplayName);
    writeHtml(response, 200, body, headOnly);
    return true;
  }

  if ((method === "GET" || headOnly) && url.pathname === "/api/web-auth/status") {
    const sessionResult = readSessionFromCookie(request, service);

    if (sessionResult.ok) {
      writeJson(response, 200, {
        authenticated: true,
        tokenLabel: sessionResult.session.token.label,
        expiresAt: sessionResult.session.expiresAt,
      }, headOnly);
      return true;
    }

    clearSessionCookie(response);
    writeJson(response, 200, { authenticated: false }, headOnly);
    return true;
  }

  if (method === "POST" && url.pathname === "/api/web-auth/login") {
    try {
      const payload = (await readJsonBody(request)) as WebAccessLoginPayload;
      const secret = normalizeOptionalText(payload.token);
      const remoteIp = resolveRemoteIp(request);

      if (!service.hasActiveToken()) {
        writeJson(response, 409, {
          error: {
            code: "WEB_ACCESS_NOT_CONFIGURED",
            message: "当前还没有可用的 Web 访问口令，请先运行 themis auth web add <label>。",
          },
        });
        return true;
      }

      const result = service.authenticate({
        secret: secret ?? "",
        ...(remoteIp ? { remoteIp } : {}),
      });

      if (!result.ok) {
        clearSessionCookie(response);
        writeJson(response, 401, {
          error: {
            code: "WEB_ACCESS_DENIED",
            message: `口令错误，无法登录 ${ui.appDisplayName}。`,
          },
        });
        return true;
      }

      setSessionCookie(response, result.session.sessionId, result.session.expiresAt);
      writeJson(response, 200, {
        ok: true,
        tokenLabel: result.session.token.label,
        expiresAt: result.session.expiresAt,
      });
      return true;
    } catch (error) {
      clearSessionCookie(response);
      writeJson(response, 400, {
        error: {
          code: "INVALID_REQUEST",
          message: toErrorMessage(error),
        },
      });
      return true;
    }
  }

  if (method === "POST" && url.pathname === "/api/web-auth/logout") {
    const sessionId = readCookie(request, WEB_SESSION_COOKIE);
    const remoteIp = resolveRemoteIp(request);

    if (sessionId) {
      service.revokeSession({
        sessionId,
        ...(remoteIp ? { remoteIp } : {}),
      });
    }

    clearSessionCookie(response);
    writeJson(response, 200, { ok: true });
    return true;
  }

  return false;
}

export function requireWebAccess(
  request: IncomingMessage,
  response: ServerResponse,
  service: WebAccessService,
  options: WebAccessRouteOptions = {},
): boolean {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const method = request.method ?? "GET";
  const ui = resolveWebAccessRouteOptions(options);

  if (isPublicWebAccessRoute(method, url.pathname)) {
    return true;
  }

  const platformAuth = authenticatePlatformServiceRequest(request, service, url.pathname);

  if (platformAuth.status === "authorized") {
    return true;
  }

  if (platformAuth.status === "denied") {
    clearSessionCookie(response);
    writeJson(response, platformAuth.httpStatus, {
      error: {
        code: platformAuth.code,
        message: platformAuth.message,
      },
    }, method === "HEAD");
    return false;
  }

  const sessionId = readCookie(request, WEB_SESSION_COOKIE);
  const remoteIp = resolveRemoteIp(request);
  const sessionResult = sessionId ? service.readSession(sessionId) : { ok: false, reason: "MISSING_SESSION" as const };

  if (sessionResult.ok) {
    return true;
  }

  service.recordDeniedAccess({
    reason: sessionResult.reason,
    ...(sessionId ? { sessionId } : {}),
    ...(remoteIp ? { remoteIp } : {}),
    details: {
      method,
      pathname: url.pathname,
    },
  });
  clearSessionCookie(response);

  if (url.pathname.startsWith("/api/")) {
    writeJson(response, 401, {
      error: {
        code: "WEB_ACCESS_REQUIRED",
        message: `请先登录 ${ui.appDisplayName}。`,
      },
    }, method === "HEAD");
    return false;
  }

  writeRedirect(response, "/login");
  return false;
}

export function getPlatformServiceAuthContext(request: IncomingMessage): PlatformServiceAuthContext | null {
  const context = (request as IncomingMessage & {
    [PLATFORM_SERVICE_AUTH_CONTEXT]?: PlatformServiceAuthContext;
  })[PLATFORM_SERVICE_AUTH_CONTEXT];

  return context ?? null;
}

function readSessionFromCookie(
  request: IncomingMessage,
  service: WebAccessService,
): WebAccessSessionReadResult {
  const sessionId = readCookie(request, WEB_SESSION_COOKIE);

  if (!sessionId) {
    return { ok: false, reason: "MISSING_SESSION" };
  }

  return service.readSession(sessionId);
}

function authenticatePlatformServiceRequest(
  request: IncomingMessage,
  service: WebAccessService,
  pathname: string,
): {
  status: "not_applicable" | "authorized" | "denied";
  httpStatus: number;
  code: string;
  message: string;
} {
  if (!pathname.startsWith("/api/platform/")) {
    return {
      status: "not_applicable",
      httpStatus: 0,
      code: "",
      message: "",
    };
  }

  const secret = readPlatformServiceAuthorizationHeader(request.headers.authorization);

  if (!secret) {
    return {
      status: "not_applicable",
      httpStatus: 0,
      code: "",
      message: "",
    };
  }

  const remoteIp = resolveRemoteIp(request);
  const auth = service.authenticatePlatformServiceToken({
    secret,
    ...(remoteIp ? { remoteIp } : {}),
  });

  if (!auth.ok) {
    const deniedError = buildPlatformServiceAuthDeniedErrorResponse().error;
    return {
      status: "denied",
      httpStatus: 401,
      code: deniedError.code,
      message: deniedError.message,
    };
  }

  if (!isPlatformPathAllowedForRole(pathname, auth.token.serviceRole)) {
    const forbiddenError = buildPlatformServiceForbiddenErrorResponse().error;
    service.recordDeniedAccess({
      reason: forbiddenError.code,
      tokenId: auth.token.tokenId,
      tokenLabel: auth.token.label,
      ...(remoteIp ? { remoteIp } : {}),
      details: {
        pathname,
        serviceRole: auth.token.serviceRole,
        ownerPrincipalId: auth.token.ownerPrincipalId,
      },
    });
    return {
      status: "denied",
      httpStatus: 403,
      code: forbiddenError.code,
      message: forbiddenError.message,
    };
  }

  (request as IncomingMessage & {
    [PLATFORM_SERVICE_AUTH_CONTEXT]?: PlatformServiceAuthContext;
  })[PLATFORM_SERVICE_AUTH_CONTEXT] = {
    tokenId: auth.token.tokenId,
    tokenLabel: auth.token.label,
    ownerPrincipalId: auth.token.ownerPrincipalId,
    serviceRole: auth.token.serviceRole,
  };

  return {
    status: "authorized",
    httpStatus: 200,
    code: "OK",
    message: "",
  };
}

function isPublicWebAccessRoute(method: string, pathname: string): boolean {
  if ((method === "GET" || method === "HEAD") && (pathname === "/login" || pathname === "/api/web-auth/status")) {
    return true;
  }

  if (method === "POST" && (pathname === "/api/web-auth/login" || pathname === "/api/web-auth/logout")) {
    return true;
  }

  return false;
}

function isPlatformPathAllowedForRole(pathname: string, role: PlatformServiceRole): boolean {
  if (role === "gateway") {
    return pathname.startsWith("/api/platform/agents/")
      || pathname.startsWith("/api/platform/projects/")
      || pathname.startsWith("/api/platform/work-items/")
      || pathname.startsWith("/api/platform/runs/")
      || isGatewayNodeManagementPath(pathname);
  }

  return pathname.startsWith("/api/platform/nodes/")
    || pathname.startsWith("/api/platform/worker/");
}

function isGatewayNodeManagementPath(pathname: string): boolean {
  return pathname === "/api/platform/nodes/list"
    || pathname === "/api/platform/nodes/detail"
    || pathname === "/api/platform/nodes/drain"
    || pathname === "/api/platform/nodes/offline"
    || pathname === "/api/platform/nodes/reclaim";
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function resolveWebAccessRouteOptions(options: WebAccessRouteOptions): { appDisplayName: string } {
  return {
    appDisplayName: options.appDisplayName?.trim() || DEFAULT_WEB_ACCESS_APP_DISPLAY_NAME,
  };
}

function createBootstrapHintHtml(appDisplayName: string): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appDisplayName} 初始化</title>
  </head>
  <body>
    <main>
      <h1>${appDisplayName} 还未初始化访问口令</h1>
      <p>当前还没有任何 active token。</p>
      <p>请先在服务端执行 themis auth web add &lt;label&gt;，然后再回来登录。</p>
    </main>
  </body>
</html>`;
}

function createLoginPageHtml(appDisplayName: string): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appDisplayName} 登录</title>
  </head>
  <body>
    <main>
      <h1>${appDisplayName} 登录</h1>
      <form id="login-form">
        <label for="token-input">访问口令</label>
        <input id="token-input" name="token" type="password" autocomplete="current-password" required />
        <button type="submit">登录</button>
      </form>
      <p id="message" role="status"></p>
    </main>
    <script>
      const form = document.getElementById("login-form");
      const message = document.getElementById("message");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const token = String(formData.get("token") || "");
        message.textContent = "登录中...";
        const response = await fetch("/api/web-auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok) {
          window.location.href = "/";
          return;
        }
        message.textContent = payload?.error?.message || "登录失败，请重试。";
      });
    </script>
  </body>
</html>`;
}
