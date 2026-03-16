import type { ServerResponse } from "node:http";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { toErrorMessage } from "./http-errors.js";
import { writeJson } from "./http-responses.js";

export async function handleRuntimeConfig(
  response: ServerResponse,
  runtime: CodexTaskRuntime,
  headOnly = false,
): Promise<void> {
  try {
    const config = await runtime.readRuntimeConfig();
    writeJson(response, 200, config, headOnly);
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
