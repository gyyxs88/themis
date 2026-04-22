import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskPrompt } from "./prompt.js";
import type { TaskRequest } from "../types/index.js";

test("buildTaskPrompt 会拼接 additionalPromptSections", () => {
  const prompt = buildTaskPrompt(createTaskRequest({
    additionalPromptSections: [
      "Recovered prior Feishu attachment facts:\n- source=history; exists=yes; path=/workspace/temp/feishu-attachments/id_ed25519",
    ],
  }));

  assert.match(prompt, /Recovered prior Feishu attachment facts:/);
  assert.match(prompt, /path=\/workspace\/temp\/feishu-attachments\/id_ed25519/);
});

function createTaskRequest(input: Partial<TaskRequest> = {}): TaskRequest {
  return {
    requestId: "req-prompt-1",
    sourceChannel: "feishu",
    user: {
      userId: "user-prompt-1",
    },
    goal: "帮我看看之前发过的附件",
    channelContext: {
      sessionId: "session-prompt-1",
    },
    createdAt: "2026-04-22T09:40:00.000Z",
    ...input,
  };
}
