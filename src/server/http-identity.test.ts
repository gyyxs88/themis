import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  baseUrl: string;
  runtimeStore: SqliteCodexSessionRegistry;
}

async function withHttpServer(
  run: (context: TestServerContext) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-identity-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new AppServerTaskRuntime({
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
      baseUrl,
      runtimeStore,
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
}

test("/api/identity/reset 和 /api/identity/task-settings 会写入 web 审计", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const identityPayload = {
      channel: "web",
      channelUserId: "user-identity-audit",
      displayName: "Owner",
    };

    const resetResponse = await fetch(`${baseUrl}/api/identity/reset`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(identityPayload),
    });

    assert.equal(resetResponse.status, 200);
    const resetPayload = await resetResponse.json() as {
      identity?: {
        principalId?: string;
      };
    };
    assert.ok(resetPayload.identity?.principalId);

    const taskSettingsResponse = await fetch(`${baseUrl}/api/identity/task-settings`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...identityPayload,
        settings: {
          sandboxMode: "workspace-write",
        },
      }),
    });

    assert.equal(taskSettingsResponse.status, 200);

    const events = runtimeStore.listWebAuditEvents();
    const resetAudit = events.find((event) => event.eventType === "web_access.principal_reset");
    const taskSettingsAudit = events.find((event) => event.eventType === "web_access.identity_task_settings_updated");

    assert.ok(resetAudit);
    assert.ok(taskSettingsAudit);
    assert.equal(resetAudit?.remoteIp, "127.0.0.1");
    assert.equal(taskSettingsAudit?.remoteIp, "127.0.0.1");
    assert.equal(JSON.parse(resetAudit?.payloadJson ?? "{}").principalId, resetPayload.identity?.principalId);
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
