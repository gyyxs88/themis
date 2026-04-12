import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { WorkerFleetDiagnosticsService } from "./worker-fleet-diagnostics.js";

test("WorkerFleetDiagnosticsService 会汇总节点 attention 与推荐动作", async () => {
  let server: ReturnType<typeof createServer> | null = null;

  try {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "POST" && url.pathname === "/api/web-auth/login") {
        res.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": "themis_web_session=session-worker-fleet; Path=/; HttpOnly",
        });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/platform/nodes/list") {
        res.writeHead(200, {
          "content-type": "application/json",
        });
        res.end(JSON.stringify({
          ok: true,
          nodes: [
            {
              nodeId: "node-online",
              organizationId: "org-1",
              displayName: "worker-node-a",
              status: "online",
              slotCapacity: 1,
              slotAvailable: 1,
              labels: [],
              workspaceCapabilities: ["/workspace/a"],
              credentialCapabilities: ["default"],
              providerCapabilities: [],
              heartbeatTtlSeconds: 30,
              lastHeartbeatAt: "2026-04-12T11:59:55.000Z",
              createdAt: "2026-04-12T11:00:00.000Z",
              updatedAt: "2026-04-12T11:59:55.000Z",
            },
            {
              nodeId: "node-offline",
              organizationId: "org-1",
              displayName: "worker-node-b",
              status: "offline",
              slotCapacity: 1,
              slotAvailable: 0,
              labels: [],
              workspaceCapabilities: ["/workspace/b"],
              credentialCapabilities: ["default"],
              providerCapabilities: [],
              heartbeatTtlSeconds: 30,
              lastHeartbeatAt: "2026-04-12T11:57:00.000Z",
              createdAt: "2026-04-12T11:00:00.000Z",
              updatedAt: "2026-04-12T11:57:00.000Z",
            },
          ],
        }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/platform/nodes/detail") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          const payload = JSON.parse(body || "{}") as { nodeId?: string };
          res.writeHead(200, {
            "content-type": "application/json",
          });

          if (payload.nodeId === "node-online") {
            res.end(JSON.stringify({
              ok: true,
              organization: {
                organizationId: "org-1",
                ownerPrincipalId: "principal-owner",
                displayName: "团队",
                slug: "team",
                createdAt: "2026-04-12T11:00:00.000Z",
                updatedAt: "2026-04-12T11:00:00.000Z",
              },
              node: {
                nodeId: "node-online",
                organizationId: "org-1",
                displayName: "worker-node-a",
                status: "online",
                slotCapacity: 1,
                slotAvailable: 1,
                labels: [],
                workspaceCapabilities: ["/workspace/a"],
                credentialCapabilities: ["default"],
                providerCapabilities: [],
                heartbeatTtlSeconds: 30,
                lastHeartbeatAt: "2026-04-12T11:59:55.000Z",
                createdAt: "2026-04-12T11:00:00.000Z",
                updatedAt: "2026-04-12T11:59:55.000Z",
              },
              leaseSummary: {
                totalCount: 0,
                activeCount: 0,
                expiredCount: 0,
                releasedCount: 0,
                revokedCount: 0,
              },
              activeExecutionLeases: [],
              recentExecutionLeases: [],
            }));
            return;
          }

          res.end(JSON.stringify({
            ok: true,
            organization: {
              organizationId: "org-1",
              ownerPrincipalId: "principal-owner",
              displayName: "团队",
              slug: "team",
              createdAt: "2026-04-12T11:00:00.000Z",
              updatedAt: "2026-04-12T11:00:00.000Z",
            },
            node: {
              nodeId: "node-offline",
              organizationId: "org-1",
              displayName: "worker-node-b",
              status: "offline",
              slotCapacity: 1,
              slotAvailable: 0,
              labels: [],
              workspaceCapabilities: ["/workspace/b"],
              credentialCapabilities: ["default"],
              providerCapabilities: [],
              heartbeatTtlSeconds: 30,
              lastHeartbeatAt: "2026-04-12T11:57:00.000Z",
              createdAt: "2026-04-12T11:00:00.000Z",
              updatedAt: "2026-04-12T11:57:00.000Z",
            },
            leaseSummary: {
              totalCount: 1,
              activeCount: 1,
              expiredCount: 0,
              releasedCount: 0,
              revokedCount: 0,
            },
            activeExecutionLeases: [],
            recentExecutionLeases: [],
          }));
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("test server failed to bind");
    }

    const service = new WorkerFleetDiagnosticsService();
    const summary = await service.readSummary({
      platformBaseUrl: `http://127.0.0.1:${address.port}`,
      ownerPrincipalId: "principal-owner",
      webAccessToken: "secret-token",
      now: "2026-04-12T12:00:00.000Z",
    });

    assert.equal(summary.nodeCount, 2);
    assert.equal(summary.counts.online, 1);
    assert.equal(summary.counts.offline, 1);
    assert.equal(summary.counts.errorCount, 1);
    assert.equal(summary.primaryDiagnosis.id, "worker_fleet_attention_error");
    assert.equal(summary.nodes[0]?.node.nodeId, "node-online");
    assert.equal(summary.nodes[0]?.heartbeatFreshness, "fresh");
    assert.equal(summary.nodes[1]?.node.nodeId, "node-offline");
    assert.equal(summary.nodes[1]?.heartbeatFreshness, "expired");
    assert.equal(summary.nodes[1]?.attention?.code, "offline_active_lease");
    assert.ok(summary.recommendedNextSteps.some((step) => step.includes("nodes/reclaim")));
  } finally {
    server?.closeAllConnections?.();
    server?.closeIdleConnections?.();
    server?.unref();
    server?.close();
  }
});
