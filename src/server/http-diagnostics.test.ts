import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

test("GET /api/diagnostics 会返回结构化 summary", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-diagnostics-"));
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
    const headers = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });
    const response = await fetch(`${baseUrl}/api/diagnostics`, {
      method: "GET",
      headers,
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      summary?: {
        auth?: unknown;
        provider?: unknown;
        context?: unknown;
        memory?: unknown;
        service?: unknown;
      };
    };
    assert.ok(payload.summary);
    assert.ok(payload.summary?.auth);
    assert.ok(payload.summary?.provider);
    assert.ok(payload.summary?.context);
    assert.ok(payload.summary?.memory);
    assert.ok(payload.summary?.service);
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
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
