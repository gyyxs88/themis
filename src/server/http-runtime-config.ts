import type { ServerResponse } from "node:http";
import type { RuntimeServiceHost } from "../core/runtime-service-host.js";
import { toErrorMessage } from "./http-errors.js";
import { writeJson } from "./http-responses.js";

export async function handleRuntimeConfig(
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "readRuntimeConfig">,
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
