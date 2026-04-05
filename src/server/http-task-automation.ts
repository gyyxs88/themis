import type {
  WebAutomationContractEvaluation,
  WebAutomationFailureMode,
  WebAutomationOptions,
  WebAutomationOutputMode,
  WebAutomationParseStatus,
  WebAutomationSchemaIssue,
  WebAutomationSchemaValidationStatus,
  WebAutomationSessionSummary,
  WebTaskAutomationRunResponse,
} from "../channels/index.js";
import type { TaskRequest, TaskResult } from "../types/index.js";

const AUTOMATION_OUTPUT_MODES = new Set<WebAutomationOutputMode>(["text", "json"]);
const AUTOMATION_FAILURE_MODES = new Set<WebAutomationFailureMode>(["report", "reject"]);

export interface ResolvedAutomationContract {
  outputMode: WebAutomationOutputMode;
  jsonSchema: Record<string, unknown> | null;
  onInvalidJson: WebAutomationFailureMode;
  onSchemaMismatch: WebAutomationFailureMode;
}

export interface BuiltAutomationTaskRunResponse {
  response: WebTaskAutomationRunResponse;
  httpStatus: number;
}

export function prepareAutomationTaskRequest(
  request: TaskRequest,
  automation: WebAutomationOptions | undefined,
): {
  request: TaskRequest;
  contract: ResolvedAutomationContract;
} {
  const contract = resolveAutomationContract(automation);

  if (contract.outputMode !== "json") {
    return {
      request,
      contract,
    };
  }

  const instruction = buildAutomationJsonInstruction(contract.jsonSchema);

  return {
    request: {
      ...request,
      inputText: appendAutomationInstruction(request.inputText, instruction),
    },
    contract,
  };
}

export function buildAutomationTaskRunResponse(
  request: Pick<TaskRequest, "requestId">,
  result: TaskResult,
  contract: ResolvedAutomationContract,
): BuiltAutomationTaskRunResponse {
  const structuredOutput = isRecord(result.structuredOutput) ? result.structuredOutput : {};
  const outputText = normalizeAutomationOutputText(result);
  const parsed = parseAutomationOutput(outputText, contract.outputMode);
  const schemaValidation = validateAutomationSchema(parsed.parsedOutput, parsed.parseStatus, contract.jsonSchema);
  const contractEvaluation = evaluateAutomationContract(parsed, schemaValidation, contract);

  return {
    httpStatus: contractEvaluation.rejected ? 422 : 200,
    response: {
      mode: "automation",
      automationVersion: 1,
      requestId: request.requestId,
      taskId: result.taskId,
      result: {
        status: result.status,
        summary: result.summary,
        outputMode: contract.outputMode,
        outputText,
        parseStatus: parsed.parseStatus,
        parseError: parsed.parseError,
        parsedOutput: parsed.parsedOutput,
        schemaValidation,
        contract: contractEvaluation,
        structuredOutput,
        session: readAutomationSessionSummary(structuredOutput),
        touchedFiles: result.touchedFiles ?? [],
        memoryUpdates: result.memoryUpdates ?? [],
        nextSteps: result.nextSteps ?? [],
        completedAt: result.completedAt,
      },
    },
  };
}

function resolveAutomationContract(automation: WebAutomationOptions | undefined): ResolvedAutomationContract {
  if (automation === undefined) {
    return {
      outputMode: "text",
      jsonSchema: null,
      onInvalidJson: "report",
      onSchemaMismatch: "report",
    };
  }

  if (!isRecord(automation)) {
    throw new Error("Invalid automation config: expected an object.");
  }

  const requestedOutputMode = automation.outputMode;
  const hasSchema = automation.jsonSchema !== undefined;
  const hasJsonContractOptions = automation.onInvalidJson !== undefined || automation.onSchemaMismatch !== undefined;
  const outputMode = requestedOutputMode === undefined
    ? hasSchema || hasJsonContractOptions
      ? "json"
      : "text"
    : normalizeAutomationOutputMode(requestedOutputMode);

  const jsonSchema = normalizeAutomationSchema(automation.jsonSchema);
  const onInvalidJson = normalizeAutomationFailureMode(automation.onInvalidJson, "automation.onInvalidJson");
  const onSchemaMismatch = normalizeAutomationFailureMode(automation.onSchemaMismatch, "automation.onSchemaMismatch");

  if (outputMode !== "json" && jsonSchema) {
    throw new Error("automation.jsonSchema requires automation.outputMode = \"json\".");
  }

  if (outputMode !== "json" && automation.onInvalidJson !== undefined) {
    throw new Error("automation.onInvalidJson requires automation.outputMode = \"json\".");
  }

  if (!jsonSchema && automation.onSchemaMismatch !== undefined) {
    throw new Error("automation.onSchemaMismatch requires automation.jsonSchema.");
  }

  return {
    outputMode,
    jsonSchema,
    onInvalidJson,
    onSchemaMismatch,
  };
}

function normalizeAutomationOutputMode(value: unknown): WebAutomationOutputMode {
  if (typeof value !== "string") {
    throw new Error(`Invalid automation.outputMode: ${String(value)}`);
  }

  const normalized = value.trim().toLowerCase();

  if (!AUTOMATION_OUTPUT_MODES.has(normalized as WebAutomationOutputMode)) {
    throw new Error(`Invalid automation.outputMode: ${value}`);
  }

  return normalized as WebAutomationOutputMode;
}

function normalizeAutomationSchema(value: unknown): Record<string, unknown> | null {
  if (value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new Error("Invalid automation.jsonSchema: expected a JSON object.");
  }

  return value;
}

function normalizeAutomationFailureMode(
  value: unknown,
  label: "automation.onInvalidJson" | "automation.onSchemaMismatch",
): WebAutomationFailureMode {
  if (value === undefined) {
    return "report";
  }

  if (typeof value !== "string") {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }

  const normalized = value.trim().toLowerCase();

  if (!AUTOMATION_FAILURE_MODES.has(normalized as WebAutomationFailureMode)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return normalized as WebAutomationFailureMode;
}

function buildAutomationJsonInstruction(jsonSchema: Record<string, unknown> | null): string {
  const sections = [
    "Automation output contract:",
    "- This run is in automation mode.",
    "- Return exactly one valid JSON value and nothing else.",
    "- Do not wrap the JSON in Markdown code fences.",
    "- Do not add commentary before or after the JSON.",
  ];

  if (jsonSchema) {
    sections.push(
      "The JSON output should conform to this schema:",
      JSON.stringify(jsonSchema, null, 2),
    );
  }

  return sections.join("\n");
}

function appendAutomationInstruction(inputText: string | undefined, instruction: string): string {
  const normalizedInputText = typeof inputText === "string" ? inputText.trim() : "";

  if (!normalizedInputText) {
    return instruction;
  }

  return `${normalizedInputText}\n\n${instruction}`;
}

function normalizeAutomationOutputText(result: TaskResult): string {
  const output = typeof result.output === "string" ? result.output.trim() : "";

  if (output) {
    return output;
  }

  return result.summary.trim();
}

function parseAutomationOutput(
  outputText: string,
  outputMode: WebAutomationOutputMode,
): {
  parseStatus: WebAutomationParseStatus;
  parseError: string | null;
  parsedOutput: unknown | null;
} {
  if (outputMode !== "json") {
    return {
      parseStatus: "not_requested",
      parseError: null,
      parsedOutput: null,
    };
  }

  const normalized = unwrapJsonCodeFence(outputText.trim());

  if (!normalized) {
    return {
      parseStatus: "invalid_json",
      parseError: "Automation JSON output is empty.",
      parsedOutput: null,
    };
  }

  try {
    return {
      parseStatus: "parsed",
      parseError: null,
      parsedOutput: JSON.parse(normalized),
    };
  } catch (error) {
    return {
      parseStatus: "invalid_json",
      parseError: toErrorMessage(error),
      parsedOutput: null,
    };
  }
}

function unwrapJsonCodeFence(value: string): string {
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? value;
}

function validateAutomationSchema(
  parsedOutput: unknown,
  parseStatus: WebAutomationParseStatus,
  jsonSchema: Record<string, unknown> | null,
): {
  status: WebAutomationSchemaValidationStatus;
  errors: string[];
  issues: WebAutomationSchemaIssue[];
} {
  if (!jsonSchema) {
    return {
      status: "not_requested",
      errors: [],
      issues: [],
    };
  }

  if (parseStatus !== "parsed") {
    return {
      status: "skipped_invalid_json",
      errors: [],
      issues: [],
    };
  }

  const issues = validateJsonSchemaNode(parsedOutput, jsonSchema, "$");

  return {
    status: issues.length > 0 ? "failed" : "passed",
    errors: issues.map((issue) => issue.message),
    issues,
  };
}

function evaluateAutomationContract(
  parsed: {
    parseStatus: WebAutomationParseStatus;
    parseError: string | null;
  },
  schemaValidation: {
    status: WebAutomationSchemaValidationStatus;
    errors: string[];
    issues: WebAutomationSchemaIssue[];
  },
  contract: ResolvedAutomationContract,
): WebAutomationContractEvaluation {
  const failures: WebAutomationContractEvaluation["failures"] = [];

  if (contract.outputMode !== "json" && !contract.jsonSchema) {
    return {
      status: "not_requested",
      rejected: false,
      onInvalidJson: contract.onInvalidJson,
      onSchemaMismatch: contract.onSchemaMismatch,
      failures,
    };
  }

  if (parsed.parseStatus === "invalid_json") {
    failures.push({
      kind: "invalid_json",
      message: parsed.parseError ?? "Automation JSON output is invalid.",
    });
  }

  if (schemaValidation.status === "failed") {
    failures.push(...schemaValidation.errors.map((message) => ({
      kind: "schema_mismatch" as const,
      message,
    })));
  }

  const rejected = failures.some((failure) => {
    if (failure.kind === "invalid_json") {
      return contract.onInvalidJson === "reject";
    }

    return contract.onSchemaMismatch === "reject";
  });

  return {
    status: failures.length > 0 ? "failed" : "passed",
    rejected,
    onInvalidJson: contract.onInvalidJson,
    onSchemaMismatch: contract.onSchemaMismatch,
    failures,
  };
}

function validateJsonSchemaNode(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
): WebAutomationSchemaIssue[] {
  const issues: WebAutomationSchemaIssue[] = [];
  const type = typeof schema.type === "string" ? schema.type.trim() : null;

  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => deepEqual(entry, value))) {
    issues.push(createSchemaIssue(path, "enum", `${path}: value is not in enum.`));
  }

  if ("const" in schema && !deepEqual(schema.const, value)) {
    issues.push(createSchemaIssue(path, "const", `${path}: value does not match const.`));
  }

  if (type && !matchesJsonSchemaType(value, type)) {
    issues.push(createSchemaIssue(path, "type", `${path}: expected ${type}.`));
    return issues;
  }

  if (isRecord(value) && (type === "object" || type === null)) {
    const properties = isRecord(schema.properties) ? schema.properties : null;
    const required = Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
    const minProperties = readNonNegativeNumber(schema.minProperties);
    const maxProperties = readNonNegativeNumber(schema.maxProperties);

    for (const key of required) {
      if (!(key in value)) {
        issues.push(createSchemaIssue(joinJsonPath(path, key), "required", `${joinJsonPath(path, key)}: is required.`));
      }
    }

    const propertyCount = Object.keys(value).length;

    if (minProperties !== null && propertyCount < minProperties) {
      issues.push(createSchemaIssue(path, "minProperties", `${path}: expected at least ${minProperties} properties.`));
    }

    if (maxProperties !== null && propertyCount > maxProperties) {
      issues.push(createSchemaIssue(path, "maxProperties", `${path}: expected at most ${maxProperties} properties.`));
    }

    if (properties) {
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (!(key in value) || !isRecord(propertySchema)) {
          continue;
        }

        issues.push(...validateJsonSchemaNode(value[key], propertySchema, joinJsonPath(path, key)));
      }
    }

    const additionalProperties = schema.additionalProperties;

    if (additionalProperties === false && properties) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          issues.push(createSchemaIssue(
            joinJsonPath(path, key),
            "additionalProperties",
            `${joinJsonPath(path, key)}: additional property is not allowed.`,
          ));
        }
      }
    } else if (isRecord(additionalProperties) && properties) {
      for (const [key, nestedValue] of Object.entries(value)) {
        if (key in properties) {
          continue;
        }

        issues.push(...validateJsonSchemaNode(nestedValue, additionalProperties, joinJsonPath(path, key)));
      }
    }
  }

  if (Array.isArray(value) && (type === "array" || type === null)) {
    const minItems = readNonNegativeNumber(schema.minItems);
    const maxItems = readNonNegativeNumber(schema.maxItems);

    if (minItems !== null && value.length < minItems) {
      issues.push(createSchemaIssue(path, "minItems", `${path}: expected at least ${minItems} items.`));
    }

    if (maxItems !== null && value.length > maxItems) {
      issues.push(createSchemaIssue(path, "maxItems", `${path}: expected at most ${maxItems} items.`));
    }

    if (schema.uniqueItems === true) {
      for (let index = 0; index < value.length; index += 1) {
        for (let compareIndex = 0; compareIndex < index; compareIndex += 1) {
          if (deepEqual(value[index], value[compareIndex])) {
            issues.push(createSchemaIssue(
              `${path}[${index}]`,
              "uniqueItems",
              `${path}[${index}]: duplicate item is not allowed.`,
            ));
            break;
          }
        }
      }
    }

    if (isRecord(schema.items)) {
      for (const [index, item] of value.entries()) {
        issues.push(...validateJsonSchemaNode(item, schema.items, `${path}[${index}]`));
      }
    }
  }

  if (typeof value === "string" && (type === "string" || type === null)) {
    const minLength = readNonNegativeNumber(schema.minLength);
    const maxLength = readNonNegativeNumber(schema.maxLength);
    const pattern = typeof schema.pattern === "string" && schema.pattern.trim() ? schema.pattern : null;

    if (minLength !== null && value.length < minLength) {
      issues.push(createSchemaIssue(path, "minLength", `${path}: expected length >= ${minLength}.`));
    }

    if (maxLength !== null && value.length > maxLength) {
      issues.push(createSchemaIssue(path, "maxLength", `${path}: expected length <= ${maxLength}.`));
    }

    if (pattern) {
      try {
        if (!new RegExp(pattern).test(value)) {
          issues.push(createSchemaIssue(path, "pattern", `${path}: expected to match pattern ${pattern}.`));
        }
      } catch {
        issues.push(createSchemaIssue(path, "pattern", `${path}: pattern ${pattern} is invalid.`));
      }
    }
  }

  if (typeof value === "number" && Number.isFinite(value) && (type === "number" || type === "integer" || type === null)) {
    const minimum = readNumber(schema.minimum);
    const maximum = readNumber(schema.maximum);

    if (minimum !== null && value < minimum) {
      issues.push(createSchemaIssue(path, "minimum", `${path}: expected >= ${minimum}.`));
    }

    if (maximum !== null && value > maximum) {
      issues.push(createSchemaIssue(path, "maximum", `${path}: expected <= ${maximum}.`));
    }
  }

  return issues;
}

function matchesJsonSchemaType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}

function readAutomationSessionSummary(structuredOutput: Record<string, unknown>): WebAutomationSessionSummary {
  const session = isRecord(structuredOutput.session) ? structuredOutput.session : {};

  return {
    sessionId: normalizeAutomationText(session.sessionId),
    conversationId: normalizeAutomationText(session.conversationId),
    threadId: normalizeAutomationText(session.threadId),
    engine: normalizeAutomationText(session.engine),
    mode: normalizeAutomationText(session.mode),
    accessMode: normalizeAutomationText(session.accessMode),
    authAccountId: normalizeAutomationText(session.authAccountId),
    thirdPartyProviderId: normalizeAutomationText(session.thirdPartyProviderId),
  };
}

function normalizeAutomationText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function joinJsonPath(base: string, key: string): string {
  return base === "$" ? `$.${key}` : `${base}.${key}`;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createSchemaIssue(path: string, keyword: string, message: string): WebAutomationSchemaIssue {
  return {
    path,
    keyword,
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return String(error);
}
