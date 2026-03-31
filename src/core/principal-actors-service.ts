import type {
  ActorRuntimeMemoryKind,
  PrincipalMainMemoryStatus,
  StoredActorRuntimeMemoryRecord,
  StoredActorTaskScopeRecord,
  StoredPrincipalActorRecord,
  StoredPrincipalMainMemoryRecord,
} from "../types/index.js";
import type { SqliteCodexSessionRegistry } from "../storage/index.js";

export interface PrincipalActorsServiceOptions {
  registry: SqliteCodexSessionRegistry;
}

export interface CreateActorInput {
  principalId: string;
  displayName: string;
  role: string;
  actorId?: string;
  now?: string;
}

export interface UpsertMainMemoryInput {
  principalId: string;
  kind: StoredPrincipalMainMemoryRecord["kind"];
  title: string;
  summary: string;
  bodyMarkdown: string;
  sourceType: StoredPrincipalMainMemoryRecord["sourceType"];
  memoryId?: string;
  status?: PrincipalMainMemoryStatus;
  now?: string;
}

export interface DispatchTaskToActorInput {
  principalId: string;
  actorId: string;
  taskId: string;
  goal: string;
  conversationId?: string;
  workspacePath?: string;
  now?: string;
}

export interface ActorDispatchPacket {
  actor: StoredPrincipalActorRecord;
  scope: StoredActorTaskScopeRecord;
  goal: string;
  conversationId?: string;
  workspacePath?: string;
  authorizedMemory: StoredPrincipalMainMemoryRecord[];
}

export interface AppendActorRuntimeMemoryInput {
  principalId: string;
  actorId: string;
  taskId: string;
  scopeId: string;
  conversationId?: string;
  kind: StoredActorRuntimeMemoryRecord["kind"];
  title: string;
  content: string;
  status: StoredActorRuntimeMemoryRecord["status"];
  runtimeMemoryId?: string;
  createdAt?: string;
}

export interface SearchActorRuntimeMemoryInput {
  principalId: string;
  actorId?: string;
  scopeId?: string;
  query?: string;
  limit?: number;
}

export interface GetActorTaskTimelineInput {
  principalId: string;
  actorId?: string;
  scopeId?: string;
  taskId?: string;
  limit?: number;
}

export interface TakeOverActorTaskInput {
  principalId: string;
  actorId: string;
  scopeId: string;
}

export interface ActorTaskTakeoverSummary {
  actor: StoredPrincipalActorRecord;
  scope: StoredActorTaskScopeRecord;
  timeline: StoredActorRuntimeMemoryRecord[];
  handoff: {
    goal: string;
    latestBlocker: string | null;
    latestResult: string | null;
  };
}

const DISPATCH_AUTHORIZED_MEMORY_LIMIT = 5;
const TASK_FILTERED_TIMELINE_LIMIT_FALLBACK = 20;
const TASK_FILTERED_TIMELINE_FETCH_LIMIT = 1000000;
const GOAL_ACTION_PREFIXES = [
  "修复",
  "解决",
  "处理",
  "排查",
  "定位",
  "检查",
  "确认",
  "优化",
  "补齐",
  "补充",
  "实现",
  "新增",
  "更新",
  "查看",
  "分析",
  "跟进",
  "推进",
] as const;

export class PrincipalActorsService {
  private readonly registry: SqliteCodexSessionRegistry;

  constructor(options: PrincipalActorsServiceOptions) {
    this.registry = options.registry;
  }

  createActor(input: CreateActorInput): StoredPrincipalActorRecord {
    const now = normalizeNow(input.now);
    const actor: StoredPrincipalActorRecord = {
      actorId: normalizeOptionalText(input.actorId) ?? createId("actor"),
      ownerPrincipalId: normalizeRequiredText(input.principalId, "Principal id is required."),
      displayName: normalizeRequiredText(input.displayName, "Actor display name is required."),
      role: normalizeRequiredText(input.role, "Actor role is required."),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    this.registry.savePrincipalActor(actor);
    return actor;
  }

  listActors(principalId: string): StoredPrincipalActorRecord[] {
    return this.registry.listPrincipalActors(normalizeRequiredText(principalId, "Principal id is required."));
  }

  upsertMainMemory(input: UpsertMainMemoryInput): StoredPrincipalMainMemoryRecord {
    const now = normalizeNow(input.now);
    const record: StoredPrincipalMainMemoryRecord = {
      memoryId: normalizeOptionalText(input.memoryId) ?? createId("main-memory"),
      principalId: normalizeRequiredText(input.principalId, "Principal id is required."),
      kind: input.kind,
      title: normalizeRequiredText(input.title, "Main memory title is required."),
      summary: normalizeRequiredText(input.summary, "Main memory summary is required."),
      bodyMarkdown: normalizeRequiredText(input.bodyMarkdown, "Main memory body is required."),
      sourceType: input.sourceType,
      status: input.status ?? "active",
      createdAt: now,
      updatedAt: now,
    };

    this.registry.savePrincipalMainMemory(record);
    return record;
  }

  dispatchTaskToActor(input: DispatchTaskToActorInput): ActorDispatchPacket {
    const principalId = normalizeRequiredText(input.principalId, "Principal id is required.");
    const now = normalizeNow(input.now);
    const actor = this.requireActor(principalId, input.actorId);
    const conversationId = normalizeOptionalText(input.conversationId);
    const workspacePath = normalizeOptionalText(input.workspacePath);
    const scope: StoredActorTaskScopeRecord = {
      scopeId: createId("scope"),
      principalId,
      actorId: actor.actorId,
      taskId: normalizeRequiredText(input.taskId, "Task id is required."),
      ...(conversationId ? { conversationId } : {}),
      goal: normalizeRequiredText(input.goal, "Goal is required."),
      ...(workspacePath ? { workspacePath } : {}),
      status: "open",
      createdAt: now,
      updatedAt: now,
    };

    this.registry.saveActorTaskScope(scope);

    return {
      actor,
      scope,
      goal: scope.goal,
      ...(scope.conversationId ? { conversationId: scope.conversationId } : {}),
      ...(scope.workspacePath ? { workspacePath: scope.workspacePath } : {}),
      authorizedMemory: this.buildAuthorizedMemoryView(principalId, scope.goal),
    };
  }

  appendActorRuntimeMemory(input: AppendActorRuntimeMemoryInput): StoredActorRuntimeMemoryRecord {
    const principalId = normalizeRequiredText(input.principalId, "Principal id is required.");
    const actorId = normalizeRequiredText(input.actorId, "Actor id is required.");
    const taskId = normalizeRequiredText(input.taskId, "Task id is required.");
    const scopeId = normalizeRequiredText(input.scopeId, "Scope id is required.");
    const conversationId = normalizeOptionalText(input.conversationId);
    const scope = this.requireScope(principalId, scopeId);

    if (scope.actorId !== actorId) {
      throw new Error("Actor runtime memory scope must belong to the same actor.");
    }

    if (scope.taskId !== taskId) {
      throw new Error("Actor runtime memory scope must belong to the same task.");
    }

    const record: StoredActorRuntimeMemoryRecord = {
      runtimeMemoryId: normalizeOptionalText(input.runtimeMemoryId) ?? createId("runtime-memory"),
      principalId,
      actorId,
      taskId,
      ...(conversationId ? { conversationId } : {}),
      scopeId,
      kind: input.kind,
      title: normalizeRequiredText(input.title, "Runtime memory title is required."),
      content: normalizeRequiredText(input.content, "Runtime memory content is required."),
      status: input.status,
      createdAt: normalizeNow(input.createdAt),
    };

    this.registry.appendActorRuntimeMemory(record);
    return record;
  }

  searchMainMemory(principalId: string, query: string, limit = 8): StoredPrincipalMainMemoryRecord[] {
    return this.registry.searchPrincipalMainMemory(
      normalizeRequiredText(principalId, "Principal id is required."),
      query,
      limit,
    );
  }

  searchActorRuntimeMemory(input: SearchActorRuntimeMemoryInput): StoredActorRuntimeMemoryRecord[] {
    const actorId = normalizeOptionalText(input.actorId);
    const scopeId = normalizeOptionalText(input.scopeId);
    const query = normalizeOptionalText(input.query);
    return this.registry.searchActorRuntimeMemory({
      principalId: normalizeRequiredText(input.principalId, "Principal id is required."),
      ...(actorId ? { actorId } : {}),
      ...(scopeId ? { scopeId } : {}),
      ...(query ? { query } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    });
  }

  getActorTaskTimeline(input: GetActorTaskTimelineInput): StoredActorRuntimeMemoryRecord[] {
    const principalId = normalizeRequiredText(input.principalId, "Principal id is required.");
    const scopeId = normalizeOptionalText(input.scopeId);
    const scope = scopeId ? this.registry.getActorTaskScope(principalId, scopeId) : null;
    const actorId = scope?.actorId ?? normalizeOptionalText(input.actorId);
    const taskId = scope?.taskId ?? normalizeOptionalText(input.taskId);

    if (scopeId && !scope) {
      return [];
    }

    if (taskId) {
      const filteredTimeline = filterTimelineEntries(
        this.registry.listActorTaskTimeline({
          principalId,
          ...(actorId ? { actorId } : {}),
          ...(scopeId ? { scopeId } : {}),
          limit: TASK_FILTERED_TIMELINE_FETCH_LIMIT,
        }),
        {
          principalId,
          ...(actorId ? { actorId } : {}),
          ...(scopeId ? { scopeId } : {}),
          taskId,
        },
      );

      return applyTimelineLimit(
        filteredTimeline,
        normalizeLimitValue(input.limit, TASK_FILTERED_TIMELINE_LIMIT_FALLBACK),
      );
    }

    const timeline = this.registry.listActorTaskTimeline({
      principalId,
      ...(actorId ? { actorId } : {}),
      ...(scopeId ? { scopeId } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    });

    return timeline;
  }

  takeOverActorTask(input: TakeOverActorTaskInput): ActorTaskTakeoverSummary {
    const principalId = normalizeRequiredText(input.principalId, "Principal id is required.");
    const actor = this.requireActor(principalId, input.actorId);
    const scopeId = normalizeRequiredText(input.scopeId, "Scope id is required.");
    const scope = this.registry.getActorTaskScope(principalId, scopeId);

    if (!scope || scope.actorId !== actor.actorId) {
      throw new Error("Actor task scope does not exist.");
    }

    const timeline = filterTimelineEntries(
      this.registry.listActorTaskTimeline({
        principalId,
        scopeId,
        limit: TASK_FILTERED_TIMELINE_FETCH_LIMIT,
      }),
      {
        principalId,
        actorId: actor.actorId,
        scopeId,
        taskId: scope.taskId,
      },
    );

    return {
      actor,
      scope,
      timeline,
      handoff: {
        goal: scope.goal,
        latestBlocker: findLatestTimelineContent(timeline, ["blocker"]),
        latestResult: findLatestTimelineContent(timeline, ["result", "handoff"]),
      },
    };
  }

  private requireActor(principalId: string, actorId: string): StoredPrincipalActorRecord {
    const actor = this.registry.getPrincipalActor(
      normalizeRequiredText(principalId, "Principal id is required."),
      normalizeRequiredText(actorId, "Actor id is required."),
    );

    if (!actor) {
      throw new Error("Principal actor does not exist.");
    }

    return actor;
  }

  private requireScope(principalId: string, scopeId: string): StoredActorTaskScopeRecord {
    const scope = this.registry.getActorTaskScope(principalId, scopeId);

    if (!scope) {
      throw new Error("Actor task scope does not exist.");
    }

    return scope;
  }

  private buildAuthorizedMemoryView(
    principalId: string,
    goal: string,
  ): StoredPrincipalMainMemoryRecord[] {
    const recordsById = new Map<string, StoredPrincipalMainMemoryRecord>();

    for (const query of expandGoalSearchQueries(goal)) {
      const records = this.registry.searchPrincipalMainMemory(
        principalId,
        query,
        DISPATCH_AUTHORIZED_MEMORY_LIMIT,
      );

      for (const record of records) {
        if (record.status !== "active" || recordsById.has(record.memoryId)) {
          continue;
        }

        recordsById.set(record.memoryId, record);
      }
    }

    return [...recordsById.values()]
      .sort(compareMainMemoryByUpdatedAtDesc)
      .slice(0, DISPATCH_AUTHORIZED_MEMORY_LIMIT);
  }
}

function findLatestTimelineContent(
  timeline: StoredActorRuntimeMemoryRecord[],
  kinds: ActorRuntimeMemoryKind[],
): string | null {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const entry = timeline[index];

    if (entry && kinds.includes(entry.kind)) {
      return entry.content;
    }
  }

  return null;
}

function filterTimelineEntries(
  timeline: StoredActorRuntimeMemoryRecord[],
  filters: {
    principalId: string;
    actorId?: string;
    scopeId?: string;
    taskId?: string;
  },
): StoredActorRuntimeMemoryRecord[] {
  return timeline.filter((entry) => {
    if (entry.principalId !== filters.principalId) {
      return false;
    }

    if (filters.actorId && entry.actorId !== filters.actorId) {
      return false;
    }

    if (filters.scopeId && entry.scopeId !== filters.scopeId) {
      return false;
    }

    if (filters.taskId && entry.taskId !== filters.taskId) {
      return false;
    }

    return true;
  });
}

function applyTimelineLimit(
  timeline: StoredActorRuntimeMemoryRecord[],
  limit: number,
): StoredActorRuntimeMemoryRecord[] {
  return timeline.slice(0, limit);
}

function expandGoalSearchQueries(goal: string): string[] {
  const normalizedGoal = normalizeRequiredText(goal, "Goal is required.");
  const queries = new Set<string>();
  const strippedGoal = stripLeadingGoalAction(normalizedGoal);

  for (const candidate of [normalizedGoal, strippedGoal]) {
    addGoalCandidate(queries, candidate);

    for (const segment of candidate.split(/[，,。；;、]/u)) {
      addGoalCandidate(queries, segment);
    }
  }

  return [...queries];
}

function addGoalCandidate(queries: Set<string>, value: string): void {
  const normalized = normalizeOptionalText(value);

  if (!normalized || normalized.length < 2) {
    return;
  }

  queries.add(normalized);
}

function stripLeadingGoalAction(goal: string): string {
  let current = goal.trim();
  let changed = true;

  while (changed) {
    changed = false;
    current = current.replace(/^[\s:：\-]+/u, "");

    for (const prefix of GOAL_ACTION_PREFIXES) {
      if (current.startsWith(prefix) && current.length > prefix.length) {
        current = current.slice(prefix.length).trim();
        changed = true;
        break;
      }
    }
  }

  return current;
}

function compareMainMemoryByUpdatedAtDesc(
  left: StoredPrincipalMainMemoryRecord,
  right: StoredPrincipalMainMemoryRecord,
): number {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt.localeCompare(left.updatedAt);
  }

  return right.memoryId.localeCompare(left.memoryId);
}

function normalizeRequiredText(value: string, message: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function normalizeOptionalText(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeNow(now?: string): string {
  return normalizeOptionalText(now) ?? new Date().toISOString();
}

function normalizeLimitValue(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || typeof value !== "number" || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}
