import assert from "node:assert/strict";
import { WebAccessService } from "../core/web-access.js";
import type { SqliteCodexSessionRegistry } from "../storage/index.js";

interface AuthenticatedWebHeadersOptions {
  baseUrl: string;
  runtimeStore: SqliteCodexSessionRegistry;
}

export async function createAuthenticatedWebHeaders(
  options: AuthenticatedWebHeadersOptions,
): Promise<Record<string, string>> {
  const service = new WebAccessService({ registry: options.runtimeStore });
  const secret = "test-secret";

  service.createToken({
    label: "test-owner",
    secret,
    remoteIp: "127.0.0.1",
  });

  const response = await fetch(`${options.baseUrl}/api/web-auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: secret,
    }),
  });

  assert.equal(response.status, 200);

  const setCookieHeader = response.headers.get("set-cookie");
  assert.ok(setCookieHeader);

  return {
    Cookie: extractCookie(setCookieHeader, "themis_web_session"),
  };
}

function extractCookie(setCookieHeader: string, name: string): string {
  const prefix = `${name}=`;

  for (const part of setCookieHeader.split(/, (?=[^;]+=)/)) {
    const cookie = part.split(";", 1)[0]?.trim();

    if (cookie?.startsWith(prefix)) {
      return cookie;
    }
  }

  throw new Error(`Missing cookie ${name}.`);
}
