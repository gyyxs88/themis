import type { ManagedAgentControlPlaneFacadeLike } from "./managed-agent-control-plane-facade.js";
import type { ManagedAgentWorkItemDetailView } from "./managed-agent-coordination-service.js";
import { ScheduledTasksService } from "./scheduled-tasks-service.js";
import type { StoredScheduledTaskRecord } from "../types/index.js";

const TERMINAL_WORK_ITEM_STATUSES = new Set(["completed", "failed", "cancelled"]);

export interface ManagedAgentScheduledFollowupServiceOptions {
  scheduledTasksService: ScheduledTasksService;
  controlPlaneFacade: Pick<ManagedAgentControlPlaneFacadeLike, "getWorkItemDetailView">;
  onFollowupResolved?: (notification: ManagedAgentScheduledFollowupResolvedNotification) => Promise<void> | void;
  logger?: Pick<Console, "warn">;
}

export interface ManagedAgentScheduledFollowupResolvedNotification {
  task: StoredScheduledTaskRecord;
  workItemDetail: ManagedAgentWorkItemDetailView;
  outcome: "completed" | "failed" | "cancelled";
}

export interface ScanManagedAgentScheduledFollowupsResult {
  scannedTasks: number;
  cancelledTasks: StoredScheduledTaskRecord[];
}

export class ManagedAgentScheduledFollowupService {
  private readonly scheduledTasksService: ScheduledTasksService;
  private readonly controlPlaneFacade: Pick<ManagedAgentControlPlaneFacadeLike, "getWorkItemDetailView">;
  private readonly onFollowupResolved:
    | ((notification: ManagedAgentScheduledFollowupResolvedNotification) => Promise<void> | void)
    | null;
  private readonly logger: Pick<Console, "warn">;

  constructor(options: ManagedAgentScheduledFollowupServiceOptions) {
    this.scheduledTasksService = options.scheduledTasksService;
    this.controlPlaneFacade = options.controlPlaneFacade;
    this.onFollowupResolved = options.onFollowupResolved ?? null;
    this.logger = options.logger ?? console;
  }

  async scan(now = new Date().toISOString()): Promise<ScanManagedAgentScheduledFollowupsResult> {
    const tasks = this.scheduledTasksService.listWatchedTasks("scheduled");

    if (tasks.length === 0) {
      return {
        scannedTasks: 0,
        cancelledTasks: [],
      };
    }

    const tasksByWatchedWorkItem = new Map<string, StoredScheduledTaskRecord[]>();

    for (const task of tasks) {
      const watchedWorkItemId = task.watch?.workItemId?.trim();

      if (!watchedWorkItemId) {
        continue;
      }

      const key = `${task.principalId}:${watchedWorkItemId}`;
      const bucket = tasksByWatchedWorkItem.get(key) ?? [];
      bucket.push(task);
      tasksByWatchedWorkItem.set(key, bucket);
    }

    const cancelledTasks: StoredScheduledTaskRecord[] = [];

    for (const watchedTasks of tasksByWatchedWorkItem.values()) {
      const firstTask = watchedTasks[0];
      const watchedWorkItemId = firstTask?.watch?.workItemId;

      if (!firstTask || !watchedWorkItemId) {
        continue;
      }

      let detail: ManagedAgentWorkItemDetailView | null = null;

      try {
        detail = await this.controlPlaneFacade.getWorkItemDetailView(firstTask.principalId, watchedWorkItemId);
      } catch (error) {
        this.logger.warn(
          `[themis/followup] 查询 watched work item 失败：task=${firstTask.scheduledTaskId} workItem=${watchedWorkItemId} error=${toErrorMessage(error)}`,
        );
        continue;
      }

      if (!detail || !TERMINAL_WORK_ITEM_STATUSES.has(detail.workItem.status)) {
        continue;
      }

      const outcome = detail.workItem.status as ManagedAgentScheduledFollowupResolvedNotification["outcome"];

      for (const task of watchedTasks) {
        try {
          const cancelledTask = this.scheduledTasksService.cancelTask({
            ownerPrincipalId: task.principalId,
            scheduledTaskId: task.scheduledTaskId,
            now,
          });
          cancelledTasks.push(cancelledTask);

          if (this.onFollowupResolved) {
            await this.onFollowupResolved({
              task: cancelledTask,
              workItemDetail: detail,
              outcome,
            });
          }
        } catch (error) {
          const message = toErrorMessage(error);

          if (
            message === "定时任务不存在。"
            || message === "当前只支持取消未开始执行的定时任务。"
          ) {
            continue;
          }

          throw error;
        }
      }
    }

    return {
      scannedTasks: tasks.length,
      cancelledTasks,
    };
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
