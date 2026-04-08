import { FeishuChannelService } from "../channels/index.js";
import { loadProjectEnv } from "../config/project-env.js";
import { AppServerActionBridge } from "../core/app-server-action-bridge.js";
import {
  CodexAuthRuntime,
  CodexTaskRuntime,
  ManagedAgentExecutionService,
} from "../core/index.js";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import { createThemisHttpServer, resolveListenAddresses } from "./http-server.js";

const DEFAULT_PRIVATE_ASSISTANT_PRINCIPAL_ID = "principal-local-owner";

loadProjectEnv();

const host = process.env.THEMIS_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.THEMIS_PORT ?? "3100", 10);
const taskTimeoutMs = Number.parseInt(process.env.THEMIS_TASK_TIMEOUT_MS ?? "300000", 10);
const agentSchedulerIntervalMs = Number.parseInt(process.env.THEMIS_AGENT_SCHEDULER_INTERVAL_MS ?? "5000", 10);
const runtime = new CodexTaskRuntime();
const actionBridge = new AppServerActionBridge();
const appServerRuntime = new AppServerTaskRuntime({
  workingDirectory: runtime.getWorkingDirectory(),
  runtimeStore: runtime.getRuntimeStore(),
  actionBridge,
});
const managedAgentExecutionService = new ManagedAgentExecutionService({
  registry: runtime.getRuntimeStore(),
  runtime: appServerRuntime,
  schedulerService: appServerRuntime.getManagedAgentSchedulerService(),
  coordinationService: appServerRuntime.getManagedAgentCoordinationService(),
});
const sharedRuntimes = {
  sdk: runtime,
  "app-server": appServerRuntime,
};
const feishuRuntimeRegistry = {
  defaultRuntime: appServerRuntime,
  runtimes: sharedRuntimes,
};
const httpRuntimeRegistry = {
  defaultRuntime: appServerRuntime,
  runtimes: {
    ...sharedRuntimes,
  },
};
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
  runtimeRegistry: feishuRuntimeRegistry,
  actionBridge,
  authRuntime,
  taskTimeoutMs,
});
const server = createThemisHttpServer({
  host,
  port,
  runtime,
  runtimeRegistry: httpRuntimeRegistry,
  authRuntime,
  taskTimeoutMs,
  actionBridge,
  managedAgentExecutionService,
  feishuService,
});

let agentSchedulerTickRunning = false;

const runManagedAgentSchedulerTick = async (): Promise<void> => {
  if (agentSchedulerTickRunning) {
    return;
  }

  agentSchedulerTickRunning = true;

  try {
    const tick = await managedAgentExecutionService.runNext({
      schedulerId: "scheduler-main",
    });

    if (tick.execution?.result === "failed") {
      console.error(`[themis/agents] 执行失败：${tick.execution.failureMessage ?? "unknown error"}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[themis/agents] scheduler tick 失败：${message}`);
  } finally {
    agentSchedulerTickRunning = false;
  }
};

if (Number.isFinite(agentSchedulerIntervalMs) && agentSchedulerIntervalMs > 0) {
  const timer = setInterval(() => {
    void runManagedAgentSchedulerTick();
  }, agentSchedulerIntervalMs);
  timer.unref?.();
  void runManagedAgentSchedulerTick();
}

server.listen(port, host, () => {
  console.log("[themis] LAN web UI is ready.");
  console.log(`[themis] Bound to ${host}:${port}`);
  console.log(`[themis] Task timeout ${Math.max(1, Math.round(taskTimeoutMs / 1000))}s`);
  console.log(`[themis] Managed-agent scheduler interval ${Math.max(1, Math.round(agentSchedulerIntervalMs / 1000))}s`);
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
