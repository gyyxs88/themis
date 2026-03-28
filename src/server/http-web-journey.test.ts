import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { Codex, Thread, ThreadEvent, ThreadOptions } from "@openai/codex-sdk";
import type { CodexAuthRuntime } from "../core/codex-auth.js";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { CodexThreadSessionStore } from "../core/codex-session-store.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  baseUrl: string;
  root: string;
  runtimeStore: SqliteCodexSessionRegistry;
  authHeaders: Record<string, string>;
  journeyCodex: JourneyCodexDouble;
}

interface JourneyCodexDouble {
  capturedThreadOptions: ThreadOptions[];
  capturedPrompts: string[];
  calls: {
    start: ThreadOptions[];
    resume: Array<{ threadId: string; options: ThreadOptions }>;
  };
}

test("真实 Web 旅程会走通 owner 登录、workspace 保存、task stream 与 history 查询", async () => {
  await withHttpServer(async ({ baseUrl, root, runtimeStore, authHeaders, journeyCodex }) => {
    const sessionId = "session-web-journey-1";
    const workspace = join(root, "workspace");

    writeWorkspaceDocs(workspace);

    const saveWorkspaceResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/settings`, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        settings: {
          workspacePath: workspace,
        },
      }),
    });

    assert.equal(saveWorkspaceResponse.status, 200);
    assert.equal(runtimeStore.getSessionTaskSettings(sessionId)?.settings.workspacePath, workspace);

    const taskResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: "请执行真实 web 旅程测试",
      }),
    });

    assert.equal(taskResponse.status, 200);

    const ndjson = parseNdjson(await taskResponse.text());
    assert.ok(ndjson.length >= 4);
    assert.deepEqual(ndjson.slice(0, 1).map((line) => line.kind), ["ack"]);
    assert.ok(ndjson.some((line) => line.kind === "event"));
    assert.ok(ndjson.some((line) => line.kind === "result"));
    assert.deepEqual(ndjson.slice(-1).map((line) => line.kind), ["done"]);
    assert.equal(runtimeStore.getSession(sessionId)?.threadId, "thread-web-journey-1");

    const resumedTaskResponse = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        goal: "请继续执行真实 web 旅程测试",
      }),
    });

    assert.equal(resumedTaskResponse.status, 200);

    const resumedNdjson = parseNdjson(await resumedTaskResponse.text());
    assert.ok(resumedNdjson.some((line) => line.kind === "result"));
    assert.deepEqual(resumedNdjson.slice(-1).map((line) => line.kind), ["done"]);

    const historyListResponse = await fetch(`${baseUrl}/api/history/sessions`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(historyListResponse.status, 200);

    const historyListPayload = await historyListResponse.json() as {
      sessions?: Array<{
        sessionId?: string;
      }>;
    };
    assert.ok(historyListPayload.sessions?.some((session) => session.sessionId === sessionId));

    const historyDetailResponse = await fetch(`${baseUrl}/api/history/sessions/${sessionId}`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(historyDetailResponse.status, 200);

    const historyDetailPayload = await historyDetailResponse.json() as {
      turns?: Array<{
        events?: Array<{
          type?: string;
        }>;
        touchedFiles?: string[];
      }>;
    };

    assert.equal(historyDetailPayload.turns?.length, 2);
    assert.ok(historyDetailPayload.turns?.every((turn) => turn.events?.some((event) => event.type === "task.context_built")));
    assert.deepEqual(historyDetailPayload.turns?.[0]?.touchedFiles, [join(workspace, "notes.txt")]);
    assert.deepEqual(historyDetailPayload.turns?.[1]?.touchedFiles, [join(workspace, "notes.txt")]);
    assert.equal(journeyCodex.calls.start.length, 1);
    assert.equal(journeyCodex.calls.resume.length, 1);
    assert.equal(journeyCodex.calls.resume[0]?.threadId, "thread-web-journey-1");
    assert.equal(journeyCodex.capturedThreadOptions[0]?.workingDirectory, workspace);
    assert.equal(journeyCodex.capturedThreadOptions[1]?.workingDirectory, workspace);
    assert.match(journeyCodex.capturedPrompts[0] ?? "", /真实 web 旅程测试/);
    assert.match(journeyCodex.capturedPrompts[1] ?? "", /继续执行真实 web 旅程测试/);
    assert.equal(runtimeStore.getSession(sessionId)?.threadId, "thread-web-journey-1");
    assert.equal(runtimeStore.getSession(sessionId)?.activeTaskId, undefined);
  });
});

async function withHttpServer(
  run: (context: TestServerContext) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-web-journey-"));
  const controlDirectory = join(root, "control");
  mkdirSync(controlDirectory, { recursive: true });
  writeWorkspaceDocs(controlDirectory, {
    agents: "control-rule",
    readmeTitle: "control",
  });

  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const { codex, journeyCodex } = createJourneyCodexDouble();
  const journeyStore = new CodexThreadSessionStore({
    codex,
    sessionRegistry: runtimeStore,
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
    sessionStore: journeyStore,
  });
  const server = createThemisHttpServer({
    runtime,
    authRuntime: createAuthRuntime({
      authenticated: false,
      requiresOpenaiAuth: false,
    }),
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const authHeaders = await createAuthenticatedWebHeaders({
    baseUrl,
    runtimeStore,
  });

  try {
    await run({
      baseUrl,
      root,
      runtimeStore,
      authHeaders,
      journeyCodex,
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
}

function createJourneyCodexDouble(): {
  codex: Codex;
  journeyCodex: JourneyCodexDouble;
} {
  const capturedThreadOptions: ThreadOptions[] = [];
  const capturedPrompts: string[] = [];
  const calls = {
    start: [] as ThreadOptions[],
    resume: [] as Array<{ threadId: string; options: ThreadOptions }>,
  };

  return {
    codex: {
      startThread(options: ThreadOptions) {
        calls.start.push(options);
        capturedThreadOptions.push(options);
        return createJourneyThread(options);
      },
      resumeThread(threadId: string, options: ThreadOptions) {
        calls.resume.push({ threadId, options });
        capturedThreadOptions.push(options);
        return createJourneyThread(options);
      },
    } as Codex,
    journeyCodex: {
      calls,
      capturedThreadOptions,
      capturedPrompts,
    },
  };
  
  function createJourneyThread(threadOptions: ThreadOptions): Thread {
    return {
      id: "thread-web-journey-1",
      runStreamed: async (prompt: string) => {
        capturedPrompts.push(prompt);
        const workspace = String(threadOptions.workingDirectory ?? "");

        return {
          events: createThreadEvents(workspace),
        };
      },
    } as Thread;
  }
}

function writeWorkspaceDocs(
  workspace: string,
  options: {
    agents?: string;
    readmeTitle?: string;
  } = {},
): void {
  writeRuntimeFile(workspace, "AGENTS.md", options.agents ?? "workspace-rule");
  writeRuntimeFile(workspace, "README.md", `# ${options.readmeTitle ?? "workspace"}`);
  writeRuntimeFile(workspace, "memory/architecture/overview.md", "# architecture");
  writeRuntimeFile(workspace, "docs/memory/2026/03/web-journey.md", "# web journey");
  writeRuntimeFile(workspace, "notes.txt", "journey note");
}

function parseNdjson(payload: string): Array<Record<string, unknown>> {
  return payload
    .trim()
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function listenServer(server: Server): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function writeRuntimeFile(root: string, path: string, content: string): void {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${content}\n`, "utf8");
}

function createThreadEvents(workspace: string): AsyncGenerator<ThreadEvent> {
  const events: ThreadEvent[] = [
    {
      type: "thread.started",
      thread_id: "thread-web-journey-1",
    },
    {
      type: "turn.started",
    },
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        id: "item-web-journey-message",
        text: "真实 web 旅程测试已完成",
      },
    },
    {
      type: "item.completed",
      item: {
        type: "file_change",
        id: "item-web-journey-file",
        status: "completed",
        changes: [
          {
            path: join(workspace, "notes.txt"),
            kind: "update",
          },
        ],
      },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 1,
        cached_input_tokens: 0,
        output_tokens: 1,
      },
    },
  ];

  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

function createAuthRuntime(snapshot: {
  authenticated: boolean;
  requiresOpenaiAuth: boolean;
}): CodexAuthRuntime {
  return {
    readSnapshot: async () => snapshot,
    readThirdPartyProviderProfile: () => null,
  } as unknown as CodexAuthRuntime;
}
