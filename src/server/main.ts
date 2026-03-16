import { createThemisHttpServer, resolveListenAddresses } from "./http-server.js";

const host = process.env.THEMIS_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.THEMIS_PORT ?? "3100", 10);
const taskTimeoutMs = Number.parseInt(process.env.THEMIS_TASK_TIMEOUT_MS ?? "300000", 10);
const server = createThemisHttpServer({ host, port, taskTimeoutMs });

server.listen(port, host, () => {
  console.log("[themis] LAN web UI is ready.");
  console.log(`[themis] Bound to ${host}:${port}`);
  console.log(`[themis] Task timeout ${Math.max(1, Math.round(taskTimeoutMs / 1000))}s`);
  console.log(`[themis] If LAN access times out, verify your firewall allows TCP port ${port} (for example: sudo ufw allow ${port}/tcp).`);

  for (const address of resolveListenAddresses(host, port)) {
    console.log(`[themis] Open ${address}`);
  }

  console.log("[themis] POST /api/tasks/stream to stream a request into Codex.");
});
