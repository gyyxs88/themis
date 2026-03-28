import type { ServerResponse } from "node:http";
import { RuntimeDiagnosticsService } from "../diagnostics/runtime-diagnostics.js";
import { CodexAuthRuntime } from "../core/codex-auth.js";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { toErrorMessage } from "./http-errors.js";
import { writeJson } from "./http-responses.js";

export async function handleDiagnostics(
  response: ServerResponse,
  runtime: CodexTaskRuntime,
  authRuntime: CodexAuthRuntime,
  headOnly = false,
): Promise<void> {
  try {
    const service = new RuntimeDiagnosticsService({
      workingDirectory: runtime.getWorkingDirectory(),
      runtimeStore: runtime.getRuntimeStore(),
      authRuntime,
    });
    const summary = await service.readSummary();
    writeJson(response, 200, { summary }, headOnly);
  } catch (error) {
    writeJson(
      response,
      500,
      {
        error: {
          code: "CORE_RUNTIME_ERROR",
          message: toErrorMessage(error),
        },
      },
      headOnly,
    );
  }
}
