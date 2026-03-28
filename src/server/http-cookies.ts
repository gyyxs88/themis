import type { IncomingMessage, ServerResponse } from "node:http";

export const WEB_SESSION_COOKIE = "themis_web_session";

export function readCookie(request: IncomingMessage, name: string): string | null {
  const rawCookie = request.headers.cookie;

  if (!rawCookie) {
    return null;
  }

  for (const part of rawCookie.split(";")) {
    const [rawName, ...rawValueParts] = part.trim().split("=");

    if (rawName !== name) {
      continue;
    }

    const value = rawValueParts.join("=");

    if (!value) {
      return null;
    }

    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

export function setSessionCookie(
  response: ServerResponse,
  sessionId: string,
  expiresAt: string,
): void {
  appendSetCookie(
    response,
    `${WEB_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`,
  );
}

export function clearSessionCookie(response: ServerResponse): void {
  appendSetCookie(
    response,
    `${WEB_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(0).toUTCString()}`,
  );
}

function appendSetCookie(response: ServerResponse, cookie: string): void {
  const existing = response.getHeader("Set-Cookie");

  if (!existing) {
    response.setHeader("Set-Cookie", cookie);
    return;
  }

  if (Array.isArray(existing)) {
    response.setHeader("Set-Cookie", [...existing, cookie]);
    return;
  }

  response.setHeader("Set-Cookie", [String(existing), cookie]);
}
