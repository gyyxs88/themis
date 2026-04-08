import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { WebAccessService } from "../core/web-access.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";

interface TestServerContext {
  server: Server;
  baseUrl: string;
  root: string;
  runtimeStore: SqliteCodexSessionRegistry;
}

async function withHttpServer(
  run: (context: TestServerContext) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-web-access-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const server = createThemisHttpServer({ runtime });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run({
      server: listeningServer,
      baseUrl,
      root,
      runtimeStore,
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
}

test("未配置任何 active token 时 GET /login 返回初始化提示页", async () => {
  await withHttpServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/login`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    assert.match(await response.text(), /themis auth web add/);
  });
});

test("HTTP Web 登录 cookie 与受保护 API 拦截主链路", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const service = new WebAccessService({ registry: runtimeStore });
    service.createToken({
      label: "owner-lan",
      secret: "test-secret",
      remoteIp: "127.0.0.1",
    });

    const unauthorizedResponse = await fetch(`${baseUrl}/api/runtime/config`);
    assert.equal(unauthorizedResponse.status, 401);
    assert.deepEqual(await unauthorizedResponse.json(), {
      error: {
        code: "WEB_ACCESS_REQUIRED",
        message: "请先登录 Themis Web。",
      },
    });

    const loginPageResponse = await fetch(`${baseUrl}/login`);
    assert.equal(loginPageResponse.status, 200);
    assert.match(await loginPageResponse.text(), /Themis Web 登录/);

    const loginResponse = await fetch(`${baseUrl}/api/web-auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: "test-secret",
      }),
    });

    assert.equal(loginResponse.status, 200);
    const setCookieHeader = loginResponse.headers.get("set-cookie");
    assert.ok(setCookieHeader);
    assert.match(setCookieHeader, /themis_web_session=/);

    const loginPayload = await loginResponse.json() as {
      ok?: boolean;
      tokenLabel?: string;
      expiresAt?: string;
    };
    assert.equal(loginPayload.ok, true);
    assert.equal(loginPayload.tokenLabel, "owner-lan");
    assert.ok(loginPayload.expiresAt);

    const sessionCookie = extractCookie(setCookieHeader, "themis_web_session");
    assert.ok(sessionCookie);

    const authorizedResponse = await fetch(`${baseUrl}/api/runtime/config`, {
      headers: {
        Cookie: sessionCookie,
      },
    });
    assert.equal(authorizedResponse.status, 200);

    service.revokeTokenByLabel({
      label: "owner-lan",
      remoteIp: "127.0.0.1",
    });

    const revokedResponse = await fetch(`${baseUrl}/api/runtime/config`, {
      headers: {
        Cookie: sessionCookie,
      },
    });
    assert.equal(revokedResponse.status, 401);
    assert.deepEqual(await revokedResponse.json(), {
      error: {
        code: "WEB_ACCESS_REQUIRED",
        message: "请先登录 Themis Web。",
      },
    });
  });
});

test("飞书卡片回调路由会在 Web 鉴权前处理", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-feishu-card-action-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const service = new WebAccessService({ registry: runtimeStore });
  service.createToken({
    label: "owner-lan",
    secret: "test-secret",
    remoteIp: "127.0.0.1",
  });
  const routeHits: string[] = [];
  const server = createThemisHttpServer({
    runtime,
    feishuService: {
      async handleCardActionWebhook(_request: unknown, response: {
        statusCode: number;
        setHeader(name: string, value: string): void;
        end(body: string): void;
      }, url: URL) {
        routeHits.push(url.pathname);
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ ok: true }));
        return true;
      },
    },
  } as never);
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const callbackResponse = await fetch(`${baseUrl}/api/feishu/card-action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        schema: "2.0",
      }),
    });

    assert.equal(callbackResponse.status, 200);
    assert.deepEqual(await callbackResponse.json(), { ok: true });
    assert.deepEqual(routeHits, ["/api/feishu/card-action"]);
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
});

test("Web 登录审计只使用 socket 来源 IP，不信任伪造的 X-Forwarded-For", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const service = new WebAccessService({ registry: runtimeStore });
    service.createToken({
      label: "owner-lan",
      secret: "test-secret",
      remoteIp: "127.0.0.1",
    });

    const loginResponse = await fetch(`${baseUrl}/api/web-auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.88",
      },
      body: JSON.stringify({
        token: "test-secret",
      }),
    });

    assert.equal(loginResponse.status, 200);

    const loginAudit = runtimeStore
      .listWebAuditEvents()
      .find((event) => event.eventType === "web_access.login_succeeded");

    assert.ok(loginAudit);
    assert.equal(loginAudit?.remoteIp, "127.0.0.1");
  });
});

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

function listenServer(server: Server): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
