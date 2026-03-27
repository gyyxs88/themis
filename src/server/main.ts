import { FeishuChannelService } from "../channels/index.js";
import { loadProjectEnv } from "../config/project-env.js";
import { CodexAuthRuntime, CodexTaskRuntime } from "../core/index.js";
import { createThemisHttpServer, resolveListenAddresses } from "./http-server.js";

const DEFAULT_PRIVATE_ASSISTANT_PRINCIPAL_ID = "principal-local-owner";

loadProjectEnv();

const host = process.env.THEMIS_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.THEMIS_PORT ?? "3100", 10);
const taskTimeoutMs = Number.parseInt(process.env.THEMIS_TASK_TIMEOUT_MS ?? "300000", 10);
const runtime = new CodexTaskRuntime();
const authRuntime = new CodexAuthRuntime({
  registry: runtime.getRuntimeStore(),
  onManagedAccountReady: async (account) => {
    try {
      await runtime.getPrincipalSkillsService().syncAllSkillsToAuthAccount(
        DEFAULT_PRIVATE_ASSISTANT_PRINCIPAL_ID,
        account.accountId,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[themis/auth] 自动补同步 skills 失败：${message}`);
    }
  },
});
const feishuService = new FeishuChannelService({
  runtime,
  authRuntime,
  taskTimeoutMs,
});
const server = createThemisHttpServer({
  host,
  port,
  runtime,
  authRuntime,
  taskTimeoutMs,
});

server.listen(port, host, () => {
  console.log("[themis] LAN web UI is ready.");
  console.log(`[themis] Bound to ${host}:${port}`);
  console.log(`[themis] Task timeout ${Math.max(1, Math.round(taskTimeoutMs / 1000))}s`);
  console.log(`[themis] If LAN access times out, verify your firewall allows TCP port ${port} (for example: sudo ufw allow ${port}/tcp).`);

  for (const address of resolveListenAddresses(host, port)) {
    console.log(`[themis] Open ${address}`);
  }

  console.log("[themis] POST /api/tasks/stream to stream a request into Codex.");

  void feishuService.start().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[themis/feishu] 飞书长连接启动失败：${message}`);
  });
});
