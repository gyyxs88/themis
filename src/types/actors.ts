export const PRINCIPAL_ACTOR_STATUSES = ["active", "paused", "archived"] as const;

export type PrincipalActorStatus = (typeof PRINCIPAL_ACTOR_STATUSES)[number];

export const PRINCIPAL_MAIN_MEMORY_KINDS = [
  "collaboration-style",
  "behavior",
  "preference",
  "task-note",
] as const;

export type PrincipalMainMemoryKind = (typeof PRINCIPAL_MAIN_MEMORY_KINDS)[number];

export const PRINCIPAL_MAIN_MEMORY_STATUSES = ["active", "deprecated", "archived"] as const;

export type PrincipalMainMemoryStatus = (typeof PRINCIPAL_MAIN_MEMORY_STATUSES)[number];

export const PRINCIPAL_MAIN_MEMORY_SOURCE_TYPES = ["themis", "manual", "imported"] as const;

export type PrincipalMainMemorySourceType = (typeof PRINCIPAL_MAIN_MEMORY_SOURCE_TYPES)[number];

export const ACTOR_TASK_SCOPE_STATUSES = [
  "open",
  "completed",
  "failed",
  "cancelled",
  "taken_over",
] as const;

export type ActorTaskScopeStatus = (typeof ACTOR_TASK_SCOPE_STATUSES)[number];

export const ACTOR_RUNTIME_MEMORY_KINDS = [
  "progress",
  "observation",
  "blocker",
  "result",
  "handoff",
] as const;

export type ActorRuntimeMemoryKind = (typeof ACTOR_RUNTIME_MEMORY_KINDS)[number];

export const ACTOR_RUNTIME_MEMORY_STATUSES = ["active", "resolved", "archived"] as const;

export type ActorRuntimeMemoryStatus = (typeof ACTOR_RUNTIME_MEMORY_STATUSES)[number];

export interface StoredPrincipalActorRecord {
  actorId: string;
  ownerPrincipalId: string;
  displayName: string;
  role: string;
  status: PrincipalActorStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StoredPrincipalMainMemoryRecord {
  memoryId: string;
  principalId: string;
  kind: PrincipalMainMemoryKind;
  title: string;
  summary: string;
  bodyMarkdown: string;
  sourceType: PrincipalMainMemorySourceType;
  status: PrincipalMainMemoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StoredActorTaskScopeRecord {
  scopeId: string;
  principalId: string;
  actorId: string;
  taskId: string;
  conversationId?: string;
  goal: string;
  workspacePath?: string;
  status: ActorTaskScopeStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StoredActorRuntimeMemoryRecord {
  runtimeMemoryId: string;
  principalId: string;
  actorId: string;
  taskId: string;
  conversationId?: string;
  scopeId: string;
  kind: ActorRuntimeMemoryKind;
  title: string;
  content: string;
  status: ActorRuntimeMemoryStatus;
  createdAt: string;
}
