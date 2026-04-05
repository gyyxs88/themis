import type { TaskEvent, TaskRequest, TaskResult } from "./task.js";

export const RUNTIME_ENGINES = ["sdk", "app-server"] as const;

export type RuntimeEngine = (typeof RUNTIME_ENGINES)[number];

export interface TaskRuntimeRunHooks {
  onEvent?: (event: TaskEvent) => Promise<void> | void;
  signal?: AbortSignal;
  timeoutMs?: number;
  finalizeResult?: (request: TaskRequest, result: TaskResult) => Promise<TaskResult> | TaskResult;
}

export interface TaskRuntimeStartReviewRequest {
  sessionId: string;
  instructions: string;
}

export interface TaskRuntimeStartReviewResult {
  reviewThreadId: string;
  turnId: string;
}

export interface TaskRuntimeSteerTurnRequest {
  sessionId: string;
  message: string;
  turnId?: string;
}

export interface TaskRuntimeSteerTurnResult {
  turnId: string;
}

export interface TaskRuntimeForkThreadRequest {
  threadId: string;
}

export interface TaskRuntimeForkedThread {
  strategy: "native-thread-fork";
  sourceThreadId: string;
  threadId: string;
}

export interface TaskRuntimeReadThreadSnapshotRequest {
  threadId: string;
  includeTurns?: boolean;
}

export interface TaskRuntimeThreadSnapshotTurn {
  turnId: string;
  status?: string;
  summary?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskRuntimeThreadSnapshot {
  threadId: string;
  preview?: string;
  status?: string;
  cwd?: string;
  createdAt?: string;
  updatedAt?: string;
  turnCount: number;
  turns: TaskRuntimeThreadSnapshotTurn[];
}

export interface TaskRuntimeFacade {
  runTask: (request: TaskRequest, hooks?: TaskRuntimeRunHooks) => Promise<TaskResult>;
  getRuntimeStore: () => unknown;
  getIdentityLinkService: () => unknown;
  getPrincipalSkillsService: () => unknown;
  startReview?: (request: TaskRuntimeStartReviewRequest) => Promise<TaskRuntimeStartReviewResult>;
  steerTurn?: (request: TaskRuntimeSteerTurnRequest) => Promise<TaskRuntimeSteerTurnResult>;
  forkThread?: (request: TaskRuntimeForkThreadRequest) => Promise<TaskRuntimeForkedThread | null>;
  readThreadSnapshot?: (
    request: TaskRuntimeReadThreadSnapshotRequest,
  ) => Promise<TaskRuntimeThreadSnapshot | null>;
}

export interface TaskRuntimeRegistry {
  defaultRuntime: TaskRuntimeFacade;
  runtimes?: Partial<Record<RuntimeEngine, TaskRuntimeFacade>>;
}

export class InvalidTaskRuntimeSelectionError extends Error {}

export class UnsupportedPublicTaskRuntimeSelectionError extends InvalidTaskRuntimeSelectionError {}

export function parseRuntimeEngine(value: string | undefined | null): RuntimeEngine | null {
  if (value === "sdk" || value === "app-server") {
    return value;
  }
  return null;
}

export function resolveRuntimeEngine(
  configured: string | undefined | null,
  fallback: RuntimeEngine = "app-server",
): RuntimeEngine {
  return parseRuntimeEngine(configured) ?? fallback;
}

export function resolveTaskRuntime(
  registry: TaskRuntimeRegistry,
  requested: RuntimeEngine | undefined | null,
): TaskRuntimeFacade {
  if (!requested) {
    return registry.defaultRuntime;
  }
  return registry.runtimes?.[requested] ?? registry.defaultRuntime;
}

export function resolveRequestedTaskRuntime(
  registry: TaskRuntimeRegistry,
  requestedValue: string | undefined | null,
): TaskRuntimeFacade {
  if (requestedValue === undefined) {
    return registry.defaultRuntime;
  }

  const parsedEngine = parseRuntimeEngine(requestedValue);

  if (!parsedEngine) {
    throw new InvalidTaskRuntimeSelectionError(`Invalid runtimeEngine: ${String(requestedValue)}`);
  }

  const selectedRuntime = registry.runtimes?.[parsedEngine];

  if (!selectedRuntime) {
    throw new InvalidTaskRuntimeSelectionError(`Requested runtimeEngine is not enabled: ${parsedEngine}`);
  }

  return selectedRuntime;
}

export function resolvePublicTaskRuntime(
  registry: TaskRuntimeRegistry,
  requestedValue: string | undefined | null,
): TaskRuntimeFacade {
  if (requestedValue === undefined) {
    return registry.defaultRuntime;
  }

  const parsedEngine = parseRuntimeEngine(requestedValue);

  if (!parsedEngine) {
    throw new InvalidTaskRuntimeSelectionError(`Invalid runtimeEngine: ${String(requestedValue)}`);
  }

  if (parsedEngine !== "app-server") {
    throw new UnsupportedPublicTaskRuntimeSelectionError(
      `Requested runtimeEngine is no longer available for public task execution: ${parsedEngine}. ` +
      "Themis 现在只接受 app-server 作为公开任务执行入口；历史 sdk 会话兼容仅保留给恢复与 fork。",
    );
  }

  const selectedRuntime = registry.runtimes?.[parsedEngine];

  if (!selectedRuntime) {
    throw new InvalidTaskRuntimeSelectionError(`Requested runtimeEngine is not enabled: ${parsedEngine}`);
  }

  return selectedRuntime;
}
