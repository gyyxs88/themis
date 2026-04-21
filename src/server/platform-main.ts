import { loadProjectEnv } from "../config/project-env.js";
import { AppServerActionBridge } from "../core/app-server-action-bridge.js";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import { CodexAuthRuntime } from "../core/codex-auth.js";
import {
  createManagedAgentControlPlaneFacadeAsyncAdapter,
} from "../core/managed-agent-control-plane-facade.js";
import { createManagedAgentControlPlaneRuntimeFromEnv } from "../core/managed-agent-control-plane-bootstrap.js";
import { ManagedAgentExecutionService } from "../core/managed-agent-execution-service.js";
import { ManagedAgentSchedulerService } from "../core/managed-agent-scheduler-service.js";
import { ThemisUpdateService } from "../diagnostics/update-service.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer, resolveListenAddresses } from "./http-server.js";

const DEFAULT_PRIVATE_ASSISTANT_PRINCIPAL_ID = "principal-local-owner";

loadProjectEnv();

const host = process.env.THEMIS_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.THEMIS_PORT ?? "3100", 10);
const taskTimeoutMs = Number.parseInt(process.env.THEMIS_TASK_TIMEOUT_MS ?? "300000", 10);
const agentSchedulerIntervalMs = Number.parseInt(process.env.THEMIS_AGENT_SCHEDULER_INTERVAL_MS ?? "5000", 10);
const workingDirectory = process.cwd();
const runtimeStore = new SqliteCodexSessionRegistry();
const managedAgentControlPlaneRuntime = await createManagedAgentControlPlaneRuntimeFromEnv({
  workingDirectory,
  runtimeStore,
});
const actionBridge = new AppServerActionBridge();
const appServerRuntime = new AppServerTaskRuntime({
  workingDirectory,
  runtimeStore,
  actionBridge,
  managedAgentControlPlaneStore: managedAgentControlPlaneRuntime.controlPlaneStore,
});
const platformSchedulerService = new ManagedAgentSchedulerService({
  registry: appServerRuntime.getManagedAgentControlPlaneStore().schedulerStore,
  defaultSchedulerId: "scheduler-platform-main",
  allowNodelessClaims: false,
});
const managedAgentExecutionService = new ManagedAgentExecutionService({
  registry: appServerRuntime.getManagedAgentControlPlaneStore().executionStateStore,
  runtime: appServerRuntime,
  schedulerService: platformSchedulerService,
  coordinationService: appServerRuntime.getManagedAgentCoordinationService(),
});
const platformControlPlaneFacade = managedAgentControlPlaneRuntime.mirror
  ? createManagedAgentControlPlaneFacadeAsyncAdapter(
      appServerRuntime.getManagedAgentControlPlaneFacade(),
      {
        runMutation: async (mutation) => await managedAgentControlPlaneRuntime.mirror!.runMirroredMutation(mutation),
      },
    )
  : appServerRuntime.getManagedAgentControlPlaneFacadeAsync();
const platformWorkItemCancellationService = managedAgentControlPlaneRuntime.mirror
  ? {
      cancelWorkItem: async (input: Parameters<ManagedAgentExecutionService["cancelWorkItem"]>[0]) =>
        await managedAgentControlPlaneRuntime.mirror!.runMirroredMutation(
          async () => await managedAgentExecutionService.cancelWorkItem(input),
        ),
    }
  : managedAgentExecutionService;
const sharedRuntimes = {
  "app-server": appServerRuntime,
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
      console.error(`[themis/platform/auth] 自动补同步 skills 失败：${message}`);
    }
  },
});
const updateService = new ThemisUpdateService({
  workingDirectory: appServerRuntime.getWorkingDirectory(),
});
const server = createThemisHttpServer({
  host,
  port,
  surface: "platform",
  runtime: appServerRuntime,
  runtimeRegistry: {
    defaultRuntime: appServerRuntime,
    runtimes: {
      ...sharedRuntimes,
    },
  },
  authRuntime,
  taskTimeoutMs,
  actionBridge,
  managedAgentExecutionService,
  platformManagedAgentExecutionService: platformWorkItemCancellationService,
  platformControlPlaneFacade,
  updateService,
});

let agentSchedulerTickRunning = false;

const runManagedAgentSchedulerTick = async (): Promise<void> => {
  if (agentSchedulerTickRunning) {
    return;
  }

  agentSchedulerTickRunning = true;

  try {
    const tick = await managedAgentExecutionService.runNext({
      schedulerId: "scheduler-platform-main",
    });

    if (tick.reclaimedLeases.length > 0) {
      console.warn(`[themis/platform] 自动回收了 ${tick.reclaimedLeases.length} 条失联节点 execution lease`);
    }

    if (tick.execution?.result === "failed") {
      console.error(`[themis/platform] 执行失败：${tick.execution.failureMessage ?? "unknown error"}`);
    }

    const didMutateControlPlane = tick.reclaimedLeases.length > 0 || tick.claimed !== null || tick.execution !== null;
    if (didMutateControlPlane && managedAgentControlPlaneRuntime.mirror) {
      managedAgentControlPlaneRuntime.mirror.markLocalDirty();

      try {
        await managedAgentControlPlaneRuntime.mirror.flushLocalSnapshotToSharedStore({ force: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[themis/platform] scheduler tick 后回刷 MySQL 失败：${message}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[themis/platform] scheduler tick 失败：${message}`);
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
  console.log("[themis/platform] Shared control plane platform is ready.");
  console.log(`[themis/platform] Bound to ${host}:${port}`);
  console.log(`[themis/platform] Task timeout ${Math.max(1, Math.round(taskTimeoutMs / 1000))}s`);
  console.log(
    `[themis/platform] Managed-agent scheduler interval ${Math.max(1, Math.round(agentSchedulerIntervalMs / 1000))}s`,
  );
  console.log(
    `[themis/platform] Control plane driver ${managedAgentControlPlaneRuntime.driver}`
    + (
      managedAgentControlPlaneRuntime.sharedDatabaseFile
        ? ` | local cache ${managedAgentControlPlaneRuntime.sharedDatabaseFile}`
        : ""
    ),
  );

  if (managedAgentControlPlaneRuntime.bootstrapResult) {
    console.log(
      `[themis/platform] Mirror bootstrap source ${managedAgentControlPlaneRuntime.bootstrapResult.source}`
      + ` (localHasData=${managedAgentControlPlaneRuntime.bootstrapResult.localHasData ? "yes" : "no"},`
      + ` sharedHasData=${managedAgentControlPlaneRuntime.bootstrapResult.sharedHasData ? "yes" : "no"})`,
    );
  }

  for (const address of resolveListenAddresses(host, port)) {
    console.log(`[themis/platform] Open ${address}`);
  }
});
