import type { MemoryUpdate, TaskAttachment, TaskInputEnvelope, TaskOptions, TaskResultStatus } from "../../types/index.js";

export interface WebTaskPayload {
  source?: "web";
  requestId?: string;
  taskId?: string;
  goal?: string;
  inputText?: string;
  historyContext?: string;
  inputEnvelope?: TaskInputEnvelope;
  userId?: string;
  displayName?: string;
  sessionId?: string;
  attachments?: TaskAttachment[];
  options?: TaskOptions;
  automation?: WebAutomationOptions;
  createdAt?: string;
}

export const WEB_AUTOMATION_OUTPUT_MODES = ["text", "json"] as const;

export type WebAutomationOutputMode = (typeof WEB_AUTOMATION_OUTPUT_MODES)[number];

export const WEB_AUTOMATION_FAILURE_MODES = ["report", "reject"] as const;

export type WebAutomationFailureMode = (typeof WEB_AUTOMATION_FAILURE_MODES)[number];

export interface WebAutomationOptions {
  outputMode?: WebAutomationOutputMode;
  jsonSchema?: Record<string, unknown>;
  onInvalidJson?: WebAutomationFailureMode;
  onSchemaMismatch?: WebAutomationFailureMode;
}

export type WebDeliveryKind = "event" | "result" | "error";

export interface WebDeliveryMessage {
  kind: WebDeliveryKind;
  requestId: string;
  taskId?: string;
  title: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export type WebMessageSink = (message: WebDeliveryMessage) => Promise<void>;

export interface WebTaskRunResponse {
  requestId: string;
  taskId: string;
  deliveries: WebDeliveryMessage[];
  result: {
    status: string;
    summary: string;
    output?: string;
    touchedFiles?: string[];
    structuredOutput?: Record<string, unknown>;
  };
}

export interface WebAutomationSessionSummary {
  sessionId: string | null;
  conversationId: string | null;
  threadId: string | null;
  engine: string | null;
  mode: string | null;
  accessMode: string | null;
  authAccountId: string | null;
  thirdPartyProviderId: string | null;
}

export interface WebTaskAutomationResult {
  status: TaskResultStatus;
  summary: string;
  outputMode: WebAutomationOutputMode;
  outputText: string;
  parseStatus: WebAutomationParseStatus;
  parseError: string | null;
  parsedOutput: unknown | null;
  schemaValidation: WebAutomationSchemaValidation;
  contract: WebAutomationContractEvaluation;
  structuredOutput: Record<string, unknown>;
  session: WebAutomationSessionSummary;
  touchedFiles: string[];
  memoryUpdates: MemoryUpdate[];
  nextSteps: string[];
  completedAt: string;
}

export const WEB_AUTOMATION_PARSE_STATUSES = ["not_requested", "parsed", "invalid_json"] as const;

export type WebAutomationParseStatus = (typeof WEB_AUTOMATION_PARSE_STATUSES)[number];

export const WEB_AUTOMATION_SCHEMA_VALIDATION_STATUSES = [
  "not_requested",
  "passed",
  "failed",
  "skipped_invalid_json",
] as const;

export type WebAutomationSchemaValidationStatus = (typeof WEB_AUTOMATION_SCHEMA_VALIDATION_STATUSES)[number];

export interface WebAutomationSchemaIssue {
  path: string;
  keyword: string;
  message: string;
}

export interface WebAutomationSchemaValidation {
  status: WebAutomationSchemaValidationStatus;
  errors: string[];
  issues: WebAutomationSchemaIssue[];
}

export const WEB_AUTOMATION_CONTRACT_STATUSES = ["not_requested", "passed", "failed"] as const;

export type WebAutomationContractStatus = (typeof WEB_AUTOMATION_CONTRACT_STATUSES)[number];

export interface WebAutomationContractFailure {
  kind: "invalid_json" | "schema_mismatch";
  message: string;
}

export interface WebAutomationContractEvaluation {
  status: WebAutomationContractStatus;
  rejected: boolean;
  onInvalidJson: WebAutomationFailureMode;
  onSchemaMismatch: WebAutomationFailureMode;
  failures: WebAutomationContractFailure[];
}

export interface WebTaskAutomationRunResponse {
  mode: "automation";
  automationVersion: 1;
  requestId: string;
  taskId: string;
  result: WebTaskAutomationResult;
}
