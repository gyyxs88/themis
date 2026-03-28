export const RUNTIME_ENGINES = ["sdk", "app-server"] as const;

export type RuntimeEngine = (typeof RUNTIME_ENGINES)[number];

export interface TaskRuntimeFacade {
  runTask: (...args: any[]) => Promise<any>;
  getRuntimeStore: () => any;
  getIdentityLinkService: () => any;
  getPrincipalSkillsService: () => any;
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
