import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TaskRequest, TaskResult } from "../types/index.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { PrincipalActorsService } from "./principal-actors-service.js";

function createContext() {
  const root = mkdtempSync(join(tmpdir(), "themis-principal-memory-experience-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const service = new PrincipalActorsService({ registry });

  return {
    root,
    registry,
    service,
  };
}

function createRequest(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    requestId: "req-memory-experience-1",
    taskId: "task-memory-experience-1",
    sourceChannel: "web",
    user: {
      userId: "browser-memory-owner",
      displayName: "Owner",
    },
    goal: "以后默认中文回复。以后先给结论再展开。以后不要说官话，保持表达直接。",
    channelContext: {
      sessionId: "session-memory-experience-1",
      channelSessionKey: "session-memory-experience-1",
    },
    createdAt: "2026-04-06T08:00:00.000Z",
    ...overrides,
  };
}

function createResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    taskId: "task-memory-experience-1",
    requestId: "req-memory-experience-1",
    status: "completed",
    summary: "已完成当前任务，并保留沟通偏好。",
    completedAt: "2026-04-06T08:05:00.000Z",
    ...overrides,
  };
}

test("suggestMainMemoryCandidatesFromTask 会从稳定协作表达里提炼候选", () => {
  const { root, registry, service } = createContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-04-06T08:00:00.000Z",
      updatedAt: "2026-04-06T08:00:00.000Z",
    });

    const result = service.suggestMainMemoryCandidatesFromTask({
      principalId: "principal-owner",
      request: createRequest(),
      result: createResult(),
      conversationId: "session-memory-experience-1",
      now: "2026-04-06T08:06:00.000Z",
    });

    assert.equal(result.candidates.length, 3);
    assert.deepEqual(result.candidates.map((candidate) => candidate.title), [
      "默认中文沟通",
      "回答先给结论",
      "避免官话",
    ]);
    assert.deepEqual(result.candidates.map((candidate) => candidate.status), [
      "suggested",
      "suggested",
      "suggested",
    ]);
    assert.ok(result.candidates.every((candidate) => candidate.sourceTaskId === "task-memory-experience-1"));
    assert.ok(result.updates.every((update) => update.action === "suggested"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("suggestMainMemoryCandidatesFromTask 会跳过已存在的正式主记忆和候选", () => {
  const { root, registry, service } = createContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      createdAt: "2026-04-06T08:00:00.000Z",
      updatedAt: "2026-04-06T08:00:00.000Z",
    });
    registry.savePrincipalMainMemory({
      memoryId: "main-memory-existing",
      principalId: "principal-owner",
      kind: "preference",
      title: "回答节奏",
      summary: "默认先给结论，再展开。",
      bodyMarkdown: "默认先给结论，再展开。",
      sourceType: "themis",
      status: "active",
      createdAt: "2026-04-06T08:00:00.000Z",
      updatedAt: "2026-04-06T08:00:00.000Z",
    });
    registry.savePrincipalMainMemoryCandidate({
      candidateId: "memory-candidate-existing",
      principalId: "principal-owner",
      kind: "behavior",
      title: "默认中文沟通",
      summary: "默认中文回复。",
      rationale: "已有候选。",
      suggestedContent: "默认中文回复。",
      sourceType: "themis",
      sourceLabel: "session old / task old",
      status: "suggested",
      createdAt: "2026-04-06T08:01:00.000Z",
      updatedAt: "2026-04-06T08:01:00.000Z",
    });

    const result = service.suggestMainMemoryCandidatesFromTask({
      principalId: "principal-owner",
      request: createRequest({
        goal: "保持当前节奏",
      }),
      result: createResult({
        output: [
          "长期记忆建议：",
          "类型：preference",
          "标题：回答节奏",
          "摘要：默认先给结论，再展开。",
          "理由：这是稳定协作偏好。",
          "内容：默认先给结论，再展开。",
          "",
          "长期记忆建议：",
          "类型：behavior",
          "标题：复盘先说风险",
          "摘要：复盘时先列风险。",
          "理由：本轮任务明确要求复盘先说风险。",
          "内容：复盘时默认先列风险和回滚面。",
        ].join("\n"),
      }),
      conversationId: "session-memory-experience-1",
      now: "2026-04-06T08:06:00.000Z",
    });

    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]?.title, "复盘先说风险");
    assert.equal(result.candidates[0]?.suggestedContent, "复盘时默认先列风险和回滚面。");
    assert.equal(result.updates.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
