export const MEMORY_UPDATE_KINDS = [
  "session",
  "task",
  "decision",
  "project",
] as const;

export type MemoryUpdateKind = (typeof MEMORY_UPDATE_KINDS)[number];

export const MEMORY_UPDATE_ACTIONS = [
  "created",
  "updated",
  "suggested",
] as const;

export type MemoryUpdateAction = (typeof MEMORY_UPDATE_ACTIONS)[number];

export interface MemoryUpdate {
  kind: MemoryUpdateKind;
  target: string;
  action: MemoryUpdateAction;
}
