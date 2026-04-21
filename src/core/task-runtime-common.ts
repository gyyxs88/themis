import type { TaskEvent, TaskRequest, TaskResult } from "../types/index.js";
import type { CompiledTaskInput } from "./runtime-input-compiler.js";
import type {
  StoredTurnInputCompileAssetFact,
  StoredTurnInputCompileCapabilityMatrix,
  StoredTurnInputCompileCapabilitySnapshot,
  StoredTurnInputCompileSummary,
} from "../storage/index.js";

export class SessionBusyError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session ${sessionId} is already running another Codex task.`);
    this.name = "SessionBusyError";
    this.sessionId = sessionId;
  }
}

export async function finalizeTaskResult(
  request: TaskRequest,
  result: TaskResult,
  finalizeResult: ((request: TaskRequest, result: TaskResult) => Promise<TaskResult> | TaskResult) | undefined,
): Promise<TaskResult> {
  if (!finalizeResult) {
    return result;
  }

  try {
    return await finalizeResult(request, result);
  } catch {
    return result;
  }
}

export function createTaskEvent(
  taskId: string,
  requestId: string,
  type: TaskEvent["type"],
  status: TaskEvent["status"],
  message: string,
  payload?: Record<string, unknown>,
): TaskEvent {
  return {
    eventId: createId("event"),
    taskId,
    requestId,
    type,
    status,
    message,
    ...(payload ? { payload } : {}),
    timestamp: new Date().toISOString(),
  };
}

export function buildStoredTurnInputCompileSummary(input: {
  runtimeTarget: string;
  compiledInput: CompiledTaskInput;
}): StoredTurnInputCompileSummary {
  return {
    runtimeTarget: input.runtimeTarget,
    degradationLevel: input.compiledInput.degradationLevel,
    warnings: input.compiledInput.compileWarnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
      ...(warning.assetId ? { assetId: warning.assetId } : {}),
    })),
    capabilityMatrix: buildStoredTurnInputCapabilityMatrix(input.compiledInput),
  };
}

function buildStoredTurnInputCapabilityMatrix(
  compiledInput: CompiledTaskInput,
): StoredTurnInputCompileCapabilityMatrix {
  return {
    modelCapabilities: compiledInput.capabilityMatrix.modelCapabilities
      ? mapStoredTurnInputCompileCapabilitySnapshot(compiledInput.capabilityMatrix.modelCapabilities)
      : null,
    transportCapabilities: compiledInput.capabilityMatrix.transportCapabilities
      ? mapStoredTurnInputCompileCapabilitySnapshot(compiledInput.capabilityMatrix.transportCapabilities)
      : null,
    effectiveCapabilities: mapStoredTurnInputCompileCapabilitySnapshot(compiledInput.capabilityMatrix.effectiveCapabilities),
    assetFacts: compiledInput.capabilityMatrix.assetFacts.map(mapStoredTurnInputCompileAssetFact),
  };
}

function mapStoredTurnInputCompileCapabilitySnapshot(
  snapshot: CompiledTaskInput["capabilityMatrix"]["effectiveCapabilities"],
): StoredTurnInputCompileCapabilitySnapshot {
  return {
    nativeTextInput: snapshot.nativeTextInput,
    nativeImageInput: snapshot.nativeImageInput,
    nativeDocumentInput: snapshot.nativeDocumentInput,
    supportedDocumentMimeTypes: [...snapshot.supportedDocumentMimeTypes],
  };
}

function mapStoredTurnInputCompileAssetFact(
  fact: CompiledTaskInput["capabilityMatrix"]["assetFacts"][number],
): StoredTurnInputCompileAssetFact {
  return {
    assetId: fact.assetId,
    kind: fact.kind,
    mimeType: fact.mimeType,
    localPathStatus: fact.localPathStatus,
    modelNativeSupport: fact.modelNativeSupport,
    transportNativeSupport: fact.transportNativeSupport,
    effectiveNativeSupport: fact.effectiveNativeSupport,
    modelMimeTypeSupported: fact.modelMimeTypeSupported,
    transportMimeTypeSupported: fact.transportMimeTypeSupported,
    effectiveMimeTypeSupported: fact.effectiveMimeTypeSupported,
    handling: fact.handling,
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
