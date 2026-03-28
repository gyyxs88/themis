import type { IncomingMessage, ServerResponse } from "node:http";
import { WebAccessService, type WebAccessSessionReadResult } from "../core/web-access.js";
import { toErrorMessage } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { clearSessionCookie, readCookie, setSessionCookie, WEB_SESSION_COOKIE } from "./http-cookies.js";
import { writeHtml, writeJson, writeRedirect } from "./http-responses.js";

interface WebAccessLoginPayload {
  token?: unknown;
}

export async function maybeHandleWebAccessRoute(
  request: IncomingMessage,
  response: ServerResponse,
  service: WebAccessService,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const method = request.method ?? "GET";
  const headOnly = method === "HEAD";

  if ((method === "GET" || headOnly) && url.pathname === "/login") {
    const body = service.hasActiveToken() ? createLoginPageHtml() : createBootstrapHintHtml();
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
            message: "口令错误，无法登录 Themis Web。",
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
): boolean {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const method = request.method ?? "GET";

  if (isPublicWebAccessRoute(method, url.pathname)) {
    return true;
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
        message: "请先登录 Themis Web。",
      },
    }, method === "HEAD");
    return false;
  }

  writeRedirect(response, "/login");
  return false;
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

function isPublicWebAccessRoute(method: string, pathname: string): boolean {
  if ((method === "GET" || method === "HEAD") && (pathname === "/login" || pathname === "/api/web-auth/status")) {
    return true;
  }

  if (method === "POST" && (pathname === "/api/web-auth/login" || pathname === "/api/web-auth/logout")) {
    return true;
  }

  return false;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function resolveRemoteIp(request: IncomingMessage): string | undefined {
  const forwarded = request.headers["x-forwarded-for"];

  if (typeof forwarded === "string") {
    const value = forwarded.split(",")[0]?.trim();

    if (value) {
      return value;
    }
  }

  if (Array.isArray(forwarded)) {
    const value = forwarded[0]?.split(",")[0]?.trim();

    if (value) {
      return value;
    }
  }

  return request.socket.remoteAddress ?? undefined;
}

function createBootstrapHintHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Themis Web 初始化</title>
  </head>
  <body>
    <main>
      <h1>Themis Web 还未初始化访问口令</h1>
      <p>当前还没有任何 active token。</p>
      <p>请先在服务端执行 themis auth web add &lt;label&gt;，然后再回来登录。</p>
    </main>
  </body>
</html>`;
}

function createLoginPageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Themis Web 登录</title>
  </head>
  <body>
    <main>
      <h1>Themis Web 登录</h1>
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
