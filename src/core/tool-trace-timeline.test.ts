import assert from "node:assert/strict";
import test from "node:test";
import {
  ToolTraceTimeline,
  type ToolTraceEntryPhase,
} from "./tool-trace-timeline.js";

function createInput(input: {
  opId: string;
  label: string;
  phase: ToolTraceEntryPhase;
  toolKind?: string;
  startedAt?: string;
  summary?: string | null;
}) {
  return {
    opId: input.opId,
    label: input.label,
    phase: input.phase,
    toolKind: input.toolKind ?? "exec_command",
    startedAt: input.startedAt ?? "2026-04-21T08:00:00.000Z",
    updatedAt: input.startedAt ?? "2026-04-21T08:00:00.000Z",
    summary: input.summary ?? null,
  };
}

test("ToolTraceTimeline 会按首次出现顺序固定行，并在同一 opId 上原地更新状态", () => {
  const timeline = new ToolTraceTimeline({ maxEntries: 10, maxEdits: 12 });

  const first = timeline.apply(createInput({
    opId: "op-1",
    label: "npm run build",
    phase: "started",
  }));
  const second = timeline.apply(createInput({
    opId: "op-2",
    label: "github.search_code",
    phase: "started",
    toolKind: "mcp",
    startedAt: "2026-04-21T08:00:01.000Z",
  }));
  const third = timeline.apply(createInput({
    opId: "op-1",
    label: "npm run build",
    phase: "completed",
    summary: "exit 0",
  }));

  assert.equal(first.bucketId, "tool-trace-1");
  assert.equal(second.bucketId, "tool-trace-1");
  assert.equal(third.bucketId, "tool-trace-1");
  assert.match(third.text, /1\. 已运行 npm run build/);
  assert.match(third.text, /2\. 正在调用 MCP github\.search_code/);
});

test("ToolTraceTimeline 在超过 maxEntries 时会滚动到新 bucket，并只继承未终态行", () => {
  const timeline = new ToolTraceTimeline({ maxEntries: 2, maxEdits: 12 });

  timeline.apply(createInput({ opId: "op-1", label: "cmd-1", phase: "completed" }));
  timeline.apply(createInput({
    opId: "op-2",
    label: "cmd-2",
    phase: "waiting_approval",
    startedAt: "2026-04-21T08:00:01.000Z",
  }));
  const rolled = timeline.apply(createInput({
    opId: "op-3",
    label: "cmd-3",
    phase: "started",
    startedAt: "2026-04-21T08:00:02.000Z",
  }));

  assert.equal(rolled.bucketId, "tool-trace-2");
  assert.doesNotMatch(rolled.text, /cmd-1/);
  assert.match(rolled.text, /1\. 等待审批 cmd-2/);
  assert.match(rolled.text, /2\. 正在运行 cmd-3/);
});

test("ToolTraceTimeline 在超过 maxEdits 时也会滚动到新 bucket", () => {
  const timeline = new ToolTraceTimeline({ maxEntries: 10, maxEdits: 2 });

  timeline.apply(createInput({ opId: "op-1", label: "cmd-1", phase: "started" }));
  timeline.apply(createInput({ opId: "op-1", label: "cmd-1", phase: "waiting_approval" }));
  const rolled = timeline.apply(createInput({ opId: "op-1", label: "cmd-1", phase: "started" }));

  assert.equal(rolled.bucketId, "tool-trace-2");
  assert.match(rolled.text, /1\. 正在运行 cmd-1/);
});

test("ToolTraceTimeline 会忽略 completed 之后的回退状态", () => {
  const timeline = new ToolTraceTimeline({ maxEntries: 10, maxEdits: 12 });

  timeline.apply(createInput({ opId: "op-1", label: "cmd-1", phase: "completed" }));
  const ignored = timeline.apply(createInput({ opId: "op-1", label: "cmd-1", phase: "started" }));

  assert.match(ignored.text, /1\. 已运行 cmd-1/);
});

test("ToolTraceTimeline 可以把所有未终态行收口成 interrupted", () => {
  const timeline = new ToolTraceTimeline({ maxEntries: 10, maxEdits: 12 });

  timeline.apply(createInput({ opId: "op-1", label: "cmd-1", phase: "started" }));
  timeline.apply(createInput({
    opId: "op-2",
    label: "cmd-2",
    phase: "waiting_input",
    startedAt: "2026-04-21T08:00:01.000Z",
  }));
  const interrupted = timeline.interruptOpenOps("2026-04-21T08:00:10.000Z");

  assert.equal(interrupted, true);
  assert.match(timeline.renderActiveBucket() ?? "", /1\. 中断 cmd-1/);
  assert.match(timeline.renderActiveBucket() ?? "", /2\. 中断 cmd-2/);
});
