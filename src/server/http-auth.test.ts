import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexAuthRuntime } from "../core/codex-auth.js";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  baseUrl: string;
  runtimeStore: SqliteCodexSessionRegistry;
  authRuntime: CodexAuthRuntime;
}

async function withHttpServer(
  run: (context: TestServerContext) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-auth-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const authRuntime = new CodexAuthRuntime({
    workingDirectory: root,
    registry: runtimeStore,
  });
  const server = createThemisHttpServer({ runtime, authRuntime });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run({
      baseUrl,
      runtimeStore,
      authRuntime,
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
}

test("/api/auth/account/select 会写默认账号切换审计", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, authRuntime }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const firstAccount = authRuntime.createAccount({
      label: "first-account",
      activate: true,
    });
    const secondAccount = authRuntime.createAccount({
      label: "second-account",
      activate: false,
    });

    assert.equal(firstAccount.accountId !== secondAccount.accountId, true);

    const response = await fetch(`${baseUrl}/api/auth/account/select`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accountId: secondAccount.accountId,
      }),
    });

    assert.equal(response.status, 200);

    const payload = await response.json() as {
      account?: {
        accountId?: string;
      };
    };
    assert.equal(payload.account?.accountId, secondAccount.accountId);

    const audit = runtimeStore
      .listWebAuditEvents()
      .find((event) => event.eventType === "web_access.auth_account_selected");

    assert.ok(audit);
    assert.equal(audit?.remoteIp, "127.0.0.1");
    assert.equal(JSON.parse(audit?.payloadJson ?? "{}").accountId, secondAccount.accountId);
    assert.equal(JSON.parse(audit?.payloadJson ?? "{}").previousAccountId, firstAccount.accountId);
  });
});

test("/api/auth/accounts 创建并激活新账号时会写默认账号切换审计", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, authRuntime }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const previousAccount = authRuntime.createAccount({
      label: "existing-account",
      activate: true,
    });

    const response = await fetch(`${baseUrl}/api/auth/accounts`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        label: "new-active-account",
      }),
    });

    assert.equal(response.status, 200);

    const payload = await response.json() as {
      account?: {
        accountId?: string;
      };
    };
    assert.ok(payload.account?.accountId);
    assert.notEqual(payload.account?.accountId, previousAccount.accountId);

    const audit = runtimeStore
      .listWebAuditEvents()
      .find((event) => event.eventType === "web_access.auth_account_selected");

    assert.ok(audit);
    assert.equal(audit?.remoteIp, "127.0.0.1");
    assert.equal(JSON.parse(audit?.payloadJson ?? "{}").accountId, payload.account?.accountId);
    assert.equal(JSON.parse(audit?.payloadJson ?? "{}").previousAccountId, previousAccount.accountId);
  });
});

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
