import type { TaskRequest } from "../types/index.js";

export const THEMIS_OPERATIONS_TOOL_NAMES = [
  "list_operation_objects",
  "create_operation_object",
  "update_operation_object",
  "list_operation_edges",
  "create_operation_edge",
  "update_operation_edge",
  "query_operation_graph",
  "get_operations_boss_view",
] as const;

const THEMIS_OPERATIONS_TOOL_NAME_SET = new Set<string>(THEMIS_OPERATIONS_TOOL_NAMES);

export function buildThemisOperationsPromptSection(request: TaskRequest): string {
  const sessionId = normalizeText(request.channelContext.sessionId) ?? "<none>";
  const channelSessionKey = normalizeText(request.channelContext.channelSessionKey) ?? "<none>";
  const displayName = normalizeText(request.user.displayName) ?? "<none>";

  return [
    "Themis operations center tools are available in this session.",
    "Treat them as a machine-native operating ledger for Themis and digital employees, not as a human task-management UI.",
    "Humans primarily observe, audit, and emergency-brake; Themis and managed agents should keep the ledger current during execution.",
    "Use Asset for real operational resources, Decision for committed choices, Risk for threats or incidents, Cadence for recurring operating rhythms, and Commitment for durable company-level promises or objectives.",
    "When intent is clear, use create_operation_object, update_operation_object, and create_operation_edge directly instead of asking the human to fill forms.",
    "Use OperationEdge to connect facts: depends_on for prerequisites, blocks for blockers, mitigates for risk controls, tracks for recurring follow-up, relates_to for context, and evidence_for for proof.",
    "Use query_operation_graph to inspect blast radius, dependencies, and shortest paths; use get_operations_boss_view for read-only operating status.",
    "Do not invent fake ids. If an object id is unknown, first use list_operation_objects, list_operation_edges, query_operation_graph, or get_operations_boss_view to inspect the ledger.",
    "For emergency brake requests, prefer managed-agent lifecycle and execution-boundary tools; operations tools record the operational facts and relationships around that intervention.",
    `Current operations context: sourceChannel=${request.sourceChannel}, channelUserId=${request.user.userId}, displayName=${displayName}, sessionId=${sessionId}, channelSessionKey=${channelSessionKey}.`,
  ].join("\n");
}

export function isThemisOperationsToolName(value: string | null | undefined): boolean {
  const normalized = normalizeText(value ?? undefined);
  return normalized ? THEMIS_OPERATIONS_TOOL_NAME_SET.has(normalized) : false;
}

function normalizeText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}
