import type { ServerResponse } from "node:http";
import { RuntimeDiagnosticsService } from "../diagnostics/runtime-diagnostics.js";
import { CodexAuthRuntime } from "../core/codex-auth.js";
import type { RuntimeServiceHost } from "../core/runtime-service-host.js";
import { McpInspector } from "../mcp/mcp-inspector.js";
import { toErrorMessage } from "./http-errors.js";
import { writeJson } from "./http-responses.js";

export type CreateMcpInspector = (workingDirectory: string) => Pick<McpInspector, "list" | "probe" | "reload">;

export async function handleDiagnostics(
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getWorkingDirectory" | "getRuntimeStore">,
  authRuntime: CodexAuthRuntime,
  createMcpInspector?: CreateMcpInspector,
  headOnly = false,
): Promise<void> {
  try {
    const service = createDiagnosticsService(runtime, authRuntime, createMcpInspector);
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

export async function handleDiagnosticsMcp(
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getWorkingDirectory" | "getRuntimeStore">,
  authRuntime: CodexAuthRuntime,
  createMcpInspector?: CreateMcpInspector,
  headOnly = false,
): Promise<void> {
  try {
    const service = createDiagnosticsService(runtime, authRuntime, createMcpInspector);
    const summary = await service.readSummary();
    writeJson(response, 200, { summary: summary.mcp }, headOnly);
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

export async function handleDiagnosticsMcpProbe(
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getWorkingDirectory">,
  createMcpInspector?: CreateMcpInspector,
): Promise<void> {
  try {
    const inspector = resolveInspector(runtime.getWorkingDirectory(), createMcpInspector);
    const summary = await inspector.probe();
    writeJson(response, 200, { summary });
  } catch (error) {
    writeJson(response, 500, {
      error: {
        code: "MCP_PROBE_FAILED",
        message: toErrorMessage(error),
      },
    });
  }
}

export async function handleDiagnosticsMcpReload(
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getWorkingDirectory">,
  createMcpInspector?: CreateMcpInspector,
): Promise<void> {
  try {
    const inspector = resolveInspector(runtime.getWorkingDirectory(), createMcpInspector);
    const summary = await inspector.reload();
    writeJson(response, 200, { summary });
  } catch (error) {
    writeJson(response, 500, {
      error: {
        code: "MCP_RELOAD_FAILED",
        message: toErrorMessage(error),
      },
    });
  }
}

function createDiagnosticsService(
  runtime: Pick<RuntimeServiceHost, "getWorkingDirectory" | "getRuntimeStore">,
  authRuntime: CodexAuthRuntime,
  createMcpInspector?: CreateMcpInspector,
): RuntimeDiagnosticsService {
  return new RuntimeDiagnosticsService({
    workingDirectory: runtime.getWorkingDirectory(),
    runtimeStore: runtime.getRuntimeStore(),
    authRuntime,
    mcpInspector: resolveInspector(runtime.getWorkingDirectory(), createMcpInspector),
  });
}

function resolveInspector(
  workingDirectory: string,
  createMcpInspector?: CreateMcpInspector,
): Pick<McpInspector, "list" | "probe" | "reload"> {
  if (createMcpInspector) {
    return createMcpInspector(workingDirectory);
  }

  return new McpInspector({
    workingDirectory,
  });
}
