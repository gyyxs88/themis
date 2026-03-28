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
  const previousEnv = {
    baseUrl: process.env.THEMIS_OPENAI_COMPAT_BASE_URL,
    apiKey: process.env.THEMIS_OPENAI_COMPAT_API_KEY,
    model: process.env.THEMIS_OPENAI_COMPAT_MODEL,
  };
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const server = createThemisHttpServer({
    runtime,
    createMcpInspector: () => ({
      list: async () => ({
        servers: [
          { id: "context7", name: "Context 7", status: "healthy" },
        ],
      }),
      probe: async () => ({
        servers: [
          { id: "context7", name: "Context 7", status: "healthy" },
        ],
      }),
      reload: async () => ({
        servers: [
          { id: "context7", name: "Context 7", status: "healthy" },
        ],
      }),
    }),
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    process.env.THEMIS_OPENAI_COMPAT_BASE_URL = "https://example.com/v1";
    process.env.THEMIS_OPENAI_COMPAT_API_KEY = "sk-test";
    process.env.THEMIS_OPENAI_COMPAT_MODEL = "gpt-5.4";
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
        workingDirectory?: string;
        auth?: unknown;
        provider?: {
          activeMode?: string;
          providerCount?: number;
        };
        context?: unknown;
        memory?: unknown;
        service?: unknown;
        mcp?: {
          servers?: Array<{
            id?: string;
          }>;
        };
      };
    };
    assert.ok(payload.summary);
    assert.ok(payload.summary?.auth);
    assert.ok(payload.summary?.provider);
    assert.ok(payload.summary?.context);
    assert.ok(payload.summary?.memory);
    assert.ok(payload.summary?.service);
    assert.ok(payload.summary?.mcp);
    assert.equal(payload.summary?.workingDirectory, root);
    assert.equal(payload.summary?.provider?.activeMode, "third-party");
    assert.equal(payload.summary?.provider?.providerCount, 1);
    assert.equal(payload.summary?.mcp?.servers?.[0]?.id, "context7");
  } finally {
    restoreEnv("THEMIS_OPENAI_COMPAT_BASE_URL", previousEnv.baseUrl);
    restoreEnv("THEMIS_OPENAI_COMPAT_API_KEY", previousEnv.apiKey);
    restoreEnv("THEMIS_OPENAI_COMPAT_MODEL", previousEnv.model);
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
});

test("GET /api/diagnostics/mcp 与 POST /api/diagnostics/mcp/probe/reload 可用", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-diagnostics-mcp-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const server = createThemisHttpServer({
    runtime,
    createMcpInspector: () => ({
      list: async () => ({
        servers: [
          { id: "context7", name: "Context 7", status: "healthy" },
        ],
      }),
      probe: async () => ({
        servers: [
          { id: "context7", name: "Context 7", status: "healthy" },
        ],
      }),
      reload: async () => ({
        servers: [
          { id: "context7", name: "Context 7", status: "healthy" },
        ],
      }),
    }),
  });
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
    const mcpResponse = await fetch(`${baseUrl}/api/diagnostics/mcp`, {
      method: "GET",
      headers,
    });
    assert.equal(mcpResponse.status, 200);
    const mcpPayload = await mcpResponse.json() as {
      summary?: {
        servers?: Array<{
          id?: string;
          name?: string;
          status?: string;
        }>;
      };
    };
    assert.ok(Array.isArray(mcpPayload.summary?.servers));
    assert.equal(mcpPayload.summary?.servers?.[0]?.id, "context7");

    const probeResponse = await fetch(`${baseUrl}/api/diagnostics/mcp/probe`, {
      method: "POST",
      headers,
    });
    assert.equal(probeResponse.status, 200);
    const probePayload = await probeResponse.json() as {
      summary?: {
        servers?: Array<{
          id?: string;
        }>;
      };
    };
    assert.ok(Array.isArray(probePayload.summary?.servers));
    assert.equal(probePayload.summary?.servers?.[0]?.id, "context7");

    const reloadResponse = await fetch(`${baseUrl}/api/diagnostics/mcp/reload`, {
      method: "POST",
      headers,
    });
    assert.equal(reloadResponse.status, 200);
    const reloadPayload = await reloadResponse.json() as {
      summary?: {
        servers?: Array<{
          id?: string;
        }>;
      };
    };
    assert.ok(Array.isArray(reloadPayload.summary?.servers));
    assert.equal(reloadPayload.summary?.servers?.[0]?.id, "context7");
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

function restoreEnv(key: string, value: string | undefined): void {
  if (typeof value === "string") {
    process.env[key] = value;
    return;
  }

  delete process.env[key];
}
