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
  runtime: AppServerTaskRuntime;
  runtimeStore: SqliteCodexSessionRegistry;
}

function buildIdentityPayload(channelUserId: string): {
  channel: string;
  channelUserId: string;
  displayName: string;
} {
  return {
    channel: "web",
    channelUserId,
    displayName: "Owner",
  };
}

async function withHttpServer(run: (context: TestServerContext) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-operations-assets-"));
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

  try {
    await run({
      baseUrl: `http://127.0.0.1:${address.port}`,
      runtime,
      runtimeStore,
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
}

async function postJson(
  baseUrl: string,
  pathname: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

test("POST /api/operations/assets/create|list|update 会维护当前 principal 的资产台账", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

    const createResponse = await postJson(baseUrl, "/api/operations/assets/create", {
      ...buildIdentityPayload("owner-assets-http"),
      asset: {
        kind: "site",
        name: "Themis 官网",
        status: "active",
        ownerPrincipalId: "principal-owner",
        summary: "主站入口",
        tags: ["官网", "landing"],
        refs: [{
          kind: "domain",
          value: "themis.example.com",
        }],
      },
    }, authHeaders);

    assert.equal(createResponse.status, 200);
    const created = await createResponse.json() as {
      identity?: { principalId?: string };
      asset?: { assetId?: string; name?: string; refs?: Array<{ value?: string }> };
    };
    assert.ok(created.asset?.assetId);
    assert.equal(created.asset?.name, "Themis 官网");
    assert.equal(created.asset?.refs?.[0]?.value, "themis.example.com");

    const listResponse = await postJson(baseUrl, "/api/operations/assets/list", {
      ...buildIdentityPayload("owner-assets-http"),
      status: "active",
    }, authHeaders);

    assert.equal(listResponse.status, 200);
    const listed = await listResponse.json() as {
      assets?: Array<{
        assetId?: string;
        principalId?: string;
        kind?: string;
        name?: string;
        status?: string;
        ownerPrincipalId?: string;
        summary?: string;
        tags?: string[];
        refs?: Array<{ kind?: string; value?: string }>;
      }>;
    };
    assert.equal(listed.assets?.length, 1);
    assert.equal(listed.assets?.[0]?.assetId, created.asset?.assetId);
    assert.equal(listed.assets?.[0]?.kind, "site");
    assert.equal(listed.assets?.[0]?.name, "Themis 官网");
    assert.equal(listed.assets?.[0]?.status, "active");
    assert.equal(listed.assets?.[0]?.ownerPrincipalId, "principal-owner");
    assert.deepEqual(listed.assets?.[0]?.tags, ["官网", "landing"]);
    assert.deepEqual(listed.assets?.[0]?.refs, [{
      kind: "domain",
      value: "themis.example.com",
    }]);

    const updateResponse = await postJson(baseUrl, "/api/operations/assets/update", {
      ...buildIdentityPayload("owner-assets-http"),
      asset: {
        assetId: created.asset?.assetId,
        kind: "site",
        name: "Themis 官网",
        status: "watch",
        ownerPrincipalId: "",
        summary: "",
        tags: ["官网", "待迁移"],
        refs: [{
          kind: "domain",
          value: "themis.example.com",
        }, {
          kind: "repo",
          value: "github.com/demo/themis-site",
        }],
      },
    }, authHeaders);

    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json() as {
      asset?: {
        status?: string;
        ownerPrincipalId?: string;
        summary?: string;
        refs?: Array<{ kind?: string }>;
      };
    };
    assert.equal(updated.asset?.status, "watch");
    assert.equal(updated.asset?.ownerPrincipalId, undefined);
    assert.equal(updated.asset?.summary, undefined);
    assert.deepEqual(
      updated.asset?.refs?.map((ref) => ref.kind),
      ["domain", "repo"],
    );
  });
});

test("POST /api/operations/assets/update 在缺少 assetId 时返回客户端错误", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

    const response = await postJson(baseUrl, "/api/operations/assets/update", {
      ...buildIdentityPayload("owner-assets-http-missing-id"),
      asset: {
        kind: "domain",
        name: "themis.example.com",
        status: "active",
      },
    }, authHeaders);

    assert.equal(response.status, 400);
    const payload = await response.json() as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    assert.equal(payload.error?.code, "INVALID_REQUEST");
    assert.equal(payload.error?.message, "资产更新请求缺少 assetId。");
  });
});

async function listenServer(server: Server): Promise<Server> {
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
