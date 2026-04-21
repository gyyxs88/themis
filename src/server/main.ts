import { FeishuChannelService } from "../channels/index.js";
import { loadProjectEnv } from "../config/project-env.js";
import { AppServerActionBridge } from "../core/app-server-action-bridge.js";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import { CodexAuthRuntime } from "../core/codex-auth.js";
import { createManagedAgentControlPlaneStoreFromEnv } from "../core/managed-agent-control-plane-bootstrap.js";
import { ManagedAgentExecutionService } from "../core/managed-agent-execution-service.js";
import { ScheduledTaskExecutionService } from "../core/scheduled-task-execution-service.js";
import { ThemisUpdateService } from "../diagnostics/update-service.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer, resolveListenAddresses } from "./http-server.js";
import { resolveMainPlatformGatewayFacade } from "./main-platform-gateway.js";
import { resolvePlatformMeetingRoomGateway } from "../core/platform-meeting-room-gateway.js";

const DEFAULT_PRIVATE_ASSISTANT_PRINCIPAL_ID = "principal-local-owner";

loadProjectEnv();

const host = process.env.THEMIS_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.THEMIS_PORT ?? "3100", 10);
const taskTimeoutMs = Number.parseInt(process.env.THEMIS_TASK_TIMEOUT_MS ?? "300000", 10);
const agentSchedulerIntervalMs = Number.parseInt(process.env.THEMIS_AGENT_SCHEDULER_INTERVAL_MS ?? "5000", 10);
const scheduledTaskSchedulerIntervalMs = Number.parseInt(process.env.THEMIS_SCHEDULED_TASK_SCHEDULER_INTERVAL_MS ?? "5000", 10);
const workingDirectory = process.cwd();
const runtimeStore = new SqliteCodexSessionRegistry();
const managedAgentControlPlaneStore = createManagedAgentControlPlaneStoreFromEnv({
  workingDirectory,
  runtimeStore,
});
const actionBridge = new AppServerActionBridge();
const appServerRuntime = new AppServerTaskRuntime({
  workingDirectory,
  runtimeStore,
  actionBridge,
  managedAgentControlPlaneStore,
});
const managedAgentExecutionService = new ManagedAgentExecutionService({
  registry: appServerRuntime.getManagedAgentControlPlaneStore().executionStateStore,
  runtime: appServerRuntime,
  schedulerService: appServerRuntime.getManagedAgentSchedulerService(),
  coordinationService: appServerRuntime.getManagedAgentCoordinationService(),
});
let feishuService: FeishuChannelService | null = null;
const scheduledTaskExecutionService = new ScheduledTaskExecutionService({
  registry: appServerRuntime.getRuntimeStore(),
  runtime: appServerRuntime,
  onExecutionFinished: async (notification) => {
    if (notification.task.sourceChannel !== "feishu" || !feishuService) {
      return;
    }

    await feishuService.notifyScheduledTaskResult({
      task: notification.task,
      run: notification.run,
      outcome: notification.outcome.result,
      ...(notification.outcome.failureMessage ? { failureMessage: notification.outcome.failureMessage } : {}),
    });
  },
});
const sharedRuntimes = {
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
  registry: appServerRuntime.getRuntimeStore(),
  onManagedAccountReady: async (account) => {
    try {
      await appServerRuntime.getPrincipalSkillsService().syncAllSkillsToAuthAccount(
        DEFAULT_PRIVATE_ASSISTANT_PRINCIPAL_ID,
        account.accountId,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[themis/auth] 自动补同步 skills 失败：${message}`);
    }
  },
});
const updateService = new ThemisUpdateService({
  workingDirectory: appServerRuntime.getWorkingDirectory(),
});
const platformControlPlaneFacade = resolveMainPlatformGatewayFacade();
const platformMeetingRoomGateway = resolvePlatformMeetingRoomGateway();
feishuService = new FeishuChannelService({
  runtime: appServerRuntime,
  runtimeRegistry: feishuRuntimeRegistry,
  actionBridge,
  authRuntime,
  updateService,
  taskTimeoutMs,
});
const server = createThemisHttpServer({
  host,
  port,
  runtime: appServerRuntime,
  runtimeRegistry: httpRuntimeRegistry,
  authRuntime,
  taskTimeoutMs,
  actionBridge,
  managedAgentExecutionService,
  feishuService,
  updateService,
  ...(platformControlPlaneFacade ? { platformControlPlaneFacade } : {}),
  ...(platformMeetingRoomGateway ? { platformMeetingRoomGateway } : {}),
});

let agentSchedulerTickRunning = false;
let scheduledTaskSchedulerTickRunning = false;

const runManagedAgentSchedulerTick = async (): Promise<void> => {
  if (agentSchedulerTickRunning) {
    return;
  }

  agentSchedulerTickRunning = true;

  try {
    const tick = await managedAgentExecutionService.runNext({
      schedulerId: "scheduler-main",
    });

    if (tick.reclaimedLeases.length > 0) {
      console.warn(`[themis/agents] 自动回收了 ${tick.reclaimedLeases.length} 条失联节点 execution lease`);
    }

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

const runScheduledTaskSchedulerTick = async (): Promise<void> => {
  if (scheduledTaskSchedulerTickRunning) {
    return;
  }

  scheduledTaskSchedulerTickRunning = true;

  try {
    const tick = await scheduledTaskExecutionService.runNext({
      schedulerId: "scheduler-scheduled-main",
    });

    if (tick.execution?.result === "failed") {
      console.error(`[themis/scheduled] 执行失败：${tick.execution.failureMessage ?? "unknown error"}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[themis/scheduled] scheduler tick 失败：${message}`);
  } finally {
    scheduledTaskSchedulerTickRunning = false;
  }
};

if (Number.isFinite(agentSchedulerIntervalMs) && agentSchedulerIntervalMs > 0) {
  const timer = setInterval(() => {
    void runManagedAgentSchedulerTick();
  }, agentSchedulerIntervalMs);
  timer.unref?.();
  void runManagedAgentSchedulerTick();
}

if (Number.isFinite(scheduledTaskSchedulerIntervalMs) && scheduledTaskSchedulerIntervalMs > 0) {
  const timer = setInterval(() => {
    void runScheduledTaskSchedulerTick();
  }, scheduledTaskSchedulerIntervalMs);
  timer.unref?.();
  void runScheduledTaskSchedulerTick();
}

server.listen(port, host, () => {
  console.log("[themis] LAN web UI is ready.");
  console.log(`[themis] Bound to ${host}:${port}`);
  console.log(`[themis] Task timeout ${Math.max(1, Math.round(taskTimeoutMs / 1000))}s`);
  console.log(`[themis] Managed-agent scheduler interval ${Math.max(1, Math.round(agentSchedulerIntervalMs / 1000))}s`);
  console.log(`[themis] Scheduled-task scheduler interval ${Math.max(1, Math.round(scheduledTaskSchedulerIntervalMs / 1000))}s`);
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
