import type { TaskEvent, TaskRequest, TaskResult } from "./task.js";

export const RUNTIME_ENGINES = ["sdk", "app-server"] as const;

export type RuntimeEngine = (typeof RUNTIME_ENGINES)[number];

export interface TaskRuntimeRunHooks {
  onEvent?: (event: TaskEvent) => Promise<void> | void;
  signal?: AbortSignal;
  timeoutMs?: number;
  finalizeResult?: (request: TaskRequest, result: TaskResult) => Promise<TaskResult> | TaskResult;
}

export interface TaskRuntimeFacade {
  runTask: (request: TaskRequest, hooks?: TaskRuntimeRunHooks) => Promise<TaskResult>;
  getRuntimeStore: () => unknown;
  getIdentityLinkService: () => unknown;
  getPrincipalSkillsService: () => unknown;
}

export interface TaskRuntimeRegistry {
  defaultRuntime: TaskRuntimeFacade;
  runtimes?: Partial<Record<RuntimeEngine, TaskRuntimeFacade>>;
}

export function parseRuntimeEngine(value: string | undefined | null): RuntimeEngine | null {
  if (value === "sdk" || value === "app-server") {
    return value;
  }
  return null;
}

export function resolveRuntimeEngine(
  configured: string | undefined | null,
  fallback: RuntimeEngine = "sdk",
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
