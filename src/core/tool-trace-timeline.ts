export type ToolTraceEntryPhase =
  | "started"
  | "waiting_approval"
  | "waiting_input"
  | "completed"
  | "failed"
  | "interrupted";

export interface ToolTraceInput {
  opId: string;
  toolKind: string;
  label: string;
  phase: ToolTraceEntryPhase;
  startedAt: string;
  updatedAt: string;
  summary: string | null;
}

interface ToolTraceEntry extends ToolTraceInput {
  terminal: boolean;
}

interface ToolTraceBucket {
  bucketId: string;
  entries: ToolTraceEntry[];
  editCount: number;
  sealed: boolean;
}

export class ToolTraceTimeline {
  private readonly maxEntries: number;
  private readonly maxEdits: number;
  private readonly buckets: ToolTraceBucket[] = [];
  private readonly ops = new Map<string, ToolTraceEntry>();
  private nextBucketNumber = 1;

  constructor(options: { maxEntries: number; maxEdits: number }) {
    this.maxEntries = options.maxEntries;
    this.maxEdits = options.maxEdits;
  }

  apply(input: ToolTraceInput): { bucketId: string; text: string } {
    const activeBucket = this.ensureActiveBucket();
    const previous = this.ops.get(input.opId);

    if (previous && !canTransition(previous.phase, input.phase)) {
      return {
        bucketId: activeBucket.bucketId,
        text: this.renderBucket(activeBucket),
      };
    }

    const shouldRollForNewEntry = !previous && activeBucket.entries.length >= this.maxEntries;
    const shouldRollForEditBudget = activeBucket.editCount >= this.maxEdits;
    const bucket = shouldRollForNewEntry || shouldRollForEditBudget
      ? this.rollBucket()
      : activeBucket;
    const nextEntry: ToolTraceEntry = {
      ...input,
      terminal: isTerminalPhase(input.phase),
    };

    if (!previous) {
      bucket.entries.push(nextEntry);
    } else {
      const index = bucket.entries.findIndex((entry) => entry.opId === input.opId);

      if (index >= 0) {
        bucket.entries[index] = nextEntry;
      } else {
        bucket.entries.push(nextEntry);
      }
    }

    this.ops.set(input.opId, nextEntry);
    bucket.editCount += 1;
    return {
      bucketId: bucket.bucketId,
      text: this.renderBucket(bucket),
    };
  }

  interruptOpenOps(updatedAt: string): boolean {
    let changed = false;

    for (const [opId, entry] of this.ops.entries()) {
      if (entry.terminal) {
        continue;
      }

      changed = true;
      this.ops.set(opId, {
        ...entry,
        phase: "interrupted",
        updatedAt,
        terminal: true,
      });
    }

    if (!changed) {
      return false;
    }

    const bucket = this.ensureActiveBucket();
    bucket.entries = bucket.entries.map((entry) => entry.terminal
      ? entry
      : {
        ...entry,
        phase: "interrupted",
        updatedAt,
        terminal: true,
      });
    bucket.editCount += 1;
    return true;
  }

  renderActiveBucket(): string | null {
    const activeBucket = this.buckets[this.buckets.length - 1];
    return activeBucket ? this.renderBucket(activeBucket) : null;
  }

  getActiveBucketId(): string | null {
    const activeBucket = this.buckets[this.buckets.length - 1];
    return activeBucket ? activeBucket.bucketId : null;
  }

  private ensureActiveBucket(): ToolTraceBucket {
    const activeBucket = this.buckets[this.buckets.length - 1];

    if (activeBucket && !activeBucket.sealed) {
      return activeBucket;
    }

    const bucket: ToolTraceBucket = {
      bucketId: `tool-trace-${this.nextBucketNumber++}`,
      entries: [],
      editCount: 0,
      sealed: false,
    };
    this.buckets.push(bucket);
    return bucket;
  }

  private rollBucket(): ToolTraceBucket {
    const current = this.ensureActiveBucket();
    current.sealed = true;
    const next = this.ensureActiveBucket();
    next.entries = current.entries
      .filter((entry) => !entry.terminal)
      .map((entry) => ({ ...entry }));
    return next;
  }

  private renderBucket(bucket: ToolTraceBucket): string {
    const lines = bucket.entries.map((entry, index) => `${index + 1}. ${formatToolTraceLine(entry)}`);
    return `工具轨迹\n${lines.join("\n\n")}`;
  }
}

const TOOL_TRACE_MAX_DETAIL_CHARS = 50;

function isTerminalPhase(phase: ToolTraceEntryPhase): boolean {
  return phase === "completed" || phase === "failed" || phase === "interrupted";
}

function canTransition(from: ToolTraceEntryPhase, to: ToolTraceEntryPhase): boolean {
  if (isTerminalPhase(from)) {
    return false;
  }

  if (from === "started") {
    return ["waiting_approval", "waiting_input", "completed", "failed", "interrupted"].includes(to);
  }

  if (from === "waiting_approval" || from === "waiting_input") {
    return ["started", "completed", "failed", "interrupted"].includes(to);
  }

  return false;
}

function formatToolTraceLine(entry: ToolTraceEntry): string {
  const label = entry.label.trim();

  switch (entry.phase) {
    case "completed":
      return entry.toolKind === "mcp"
        ? `已调用 MCP ${truncateToolTraceDetail(label)}`
        : `已运行 ${truncateToolTraceDetail(label)}`;
    case "failed":
      return entry.summary
        ? `执行失败 ${truncateToolTraceDetail(`${label}：${entry.summary}`)}`
        : `执行失败 ${truncateToolTraceDetail(label)}`;
    case "waiting_approval":
      return `等待审批 ${truncateToolTraceDetail(label)}`;
    case "waiting_input":
      return `等待输入 ${truncateToolTraceDetail(label)}`;
    case "interrupted":
      return `中断 ${truncateToolTraceDetail(label)}`;
    case "started":
    default:
      return entry.toolKind === "mcp"
        ? `正在调用 MCP ${truncateToolTraceDetail(label)}`
        : `正在运行 ${truncateToolTraceDetail(label)}`;
  }
}

function truncateToolTraceDetail(detail: string): string {
  const normalized = detail.trim();

  if (!normalized) {
    return normalized;
  }

  const chars = Array.from(normalized);

  if (chars.length <= TOOL_TRACE_MAX_DETAIL_CHARS) {
    return normalized;
  }

  return `${chars.slice(0, TOOL_TRACE_MAX_DETAIL_CHARS).join("")}...`;
}
