import type { ManagedAgentWorkerStore } from "../storage/index.js";
import type {
  StoredAgentRunRecord,
  StoredAgentWorkItemRecord,
  StoredManagedAgentRecord,
  TaskOptions,
  TaskRequest,
} from "../types/index.js";
import { MANAGED_AGENT_INTERNAL_SOURCE_CHANNEL } from "../types/index.js";
import { buildManagedAgentWorkItemSessionId } from "./managed-agent-execution-service.js";

export interface ManagedAgentWorkerExecutionContract {
  request: TaskRequest;
  context: {
    principalId: string;
    conversationId: string;
  };
  workspacePath?: string;
}

export function buildManagedAgentWorkerExecutionContract(
  registry: ManagedAgentWorkerStore,
  input: {
    run: StoredAgentRunRecord;
    workItem: StoredAgentWorkItemRecord;
    targetAgent: StoredManagedAgentRecord;
    now?: string;
  },
): ManagedAgentWorkerExecutionContract {
  const sessionId = buildManagedAgentWorkItemSessionId(input.workItem.workItemId);
  const options = resolveTaskOptions(input.workItem.runtimeProfileSnapshot) ?? {};
  const additionalDirectories = resolveAdditionalDirectories(input.workItem.workspacePolicySnapshot);
  const allowNetworkAccess = resolveAllowNetworkAccess(input.workItem.workspacePolicySnapshot);
  const workspacePath = resolveWorkspacePath(input.workItem.workspacePolicySnapshot) ?? undefined;
  const inputText = buildExecutionInputText(registry, input.workItem, input.targetAgent);

  if (additionalDirectories.length > 0) {
    options.additionalDirectories = dedupeStrings([
      ...(Array.isArray(options.additionalDirectories) ? options.additionalDirectories : []),
      ...additionalDirectories,
    ]);
  }

  if (allowNetworkAccess === false) {
    options.networkAccessEnabled = false;
  }

  return {
    request: {
      requestId: `agent-run-request:${input.run.runId}`,
      taskId: input.run.runId,
      sourceChannel: MANAGED_AGENT_INTERNAL_SOURCE_CHANNEL,
      user: {
        userId: input.targetAgent.principalId,
        displayName: input.targetAgent.displayName,
      },
      goal: input.workItem.goal,
      ...(inputText ? { inputText } : {}),
      ...(Object.keys(options).length > 0 ? { options } : {}),
      channelContext: {
        sessionId,
        channelSessionKey: sessionId,
      },
      createdAt: normalizeOptionalText(input.now) ?? new Date().toISOString(),
    },
    context: {
      principalId: input.targetAgent.principalId,
      conversationId: sessionId,
    },
    ...(workspacePath ? { workspacePath } : {}),
  };
}

function buildExecutionInputText(
  registry: ManagedAgentWorkerStore,
  workItem: StoredAgentWorkItemRecord,
  targetAgent: StoredManagedAgentRecord,
): string | null {
  const sections: string[] = [
    `派工说明：${workItem.dispatchReason}`,
    `优先级：${workItem.priority}`,
    `来源类型：${workItem.sourceType}`,
  ];
  const sourceAgent = normalizeOptionalText(workItem.sourceAgentId)
    ? registry.getManagedAgent(workItem.sourceAgentId as string)
    : null;
  const sourcePrincipal = registry.getPrincipal(workItem.sourcePrincipalId);

  if (sourceAgent) {
    sections.push(`上游 agent：${sourceAgent.displayName}`);
  } else if (sourcePrincipal?.displayName?.trim()) {
    sections.push(`发起方：${sourcePrincipal.displayName.trim()}`);
  }

  if (normalizeOptionalText(workItem.parentWorkItemId)) {
    sections.push(`父 work item：${workItem.parentWorkItemId}`);
  }

  if (workItem.contextPacket !== undefined) {
    sections.push(`上下文包(JSON)：\n${serializeJson(workItem.contextPacket)}`);
  }

  const resumeContext = buildResumeContext(registry, workItem, targetAgent.agentId);

  if (resumeContext) {
    sections.push(`最新上游回复：\n${resumeContext}`);
  }

  return sections.join("\n\n").trim() || null;
}

function buildResumeContext(
  registry: ManagedAgentWorkerStore,
  workItem: StoredAgentWorkItemRecord,
  targetAgentId: string,
): string | null {
  const humanResumeContext = buildHumanResumeContext(workItem);

  if (humanResumeContext) {
    return humanResumeContext;
  }

  if (typeof registry.listAgentMessagesByWorkItem !== "function") {
    return null;
  }

  const sourceAgentId = normalizeOptionalText(workItem.sourceAgentId);

  if (!sourceAgentId) {
    return null;
  }

  const messages = registry.listAgentMessagesByWorkItem(workItem.workItemId);
  const latestWaitingMessage = [...messages].reverse().find((message) =>
    message.fromAgentId === targetAgentId
    && message.toAgentId === sourceAgentId
    && (message.messageType === "approval_request" || message.messageType === "question")
  );

  if (!latestWaitingMessage) {
    return null;
  }

  const resumeMessages = messages.filter((message) =>
    message.toAgentId === targetAgentId
    && (message.messageType === "approval_result" || message.messageType === "answer")
    && (
      message.parentMessageId === latestWaitingMessage.messageId
      || message.createdAt > latestWaitingMessage.createdAt
    )
  );

  if (resumeMessages.length === 0) {
    return null;
  }

  const sourceAgent = registry.getManagedAgent(sourceAgentId);
  const sourceLabel = sourceAgent?.displayName ?? sourceAgentId;

  return resumeMessages
    .map((message) => formatResumeMessage(sourceLabel, message))
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function buildHumanResumeContext(workItem: StoredAgentWorkItemRecord): string | null {
  const response = asRecord(workItem.latestHumanResponse);

  if (!response) {
    return null;
  }

  const waitingAction = asRecord(workItem.waitingActionRequest);
  const actionType = normalizeOptionalText(asString(waitingAction?.actionType));
  const prompt = normalizeOptionalText(asString(waitingAction?.prompt));
  const decision = normalizeOptionalText(asString(response.decision));
  const inputText = normalizeOptionalText(asString(response.inputText));
  const payload = response.payload;
  const extraKeys = Object.keys(response).filter((key) =>
    !["sourceType", "actionType", "decision", "inputText", "respondedAt"].includes(key)
  );
  const details = payload !== undefined
    ? serializeJson(payload)
    : extraKeys.length > 0
      ? serializeJson(response)
      : null;

  return [
    `- 顶层治理回复${actionType ? `（${actionType}）` : ""}${decision ? `：${decision}` : ""}`,
    prompt ? `  原等待提示：${prompt}` : null,
    inputText ? `  补充：${inputText}` : null,
    details ? `  详情：${details}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatResumeMessage(sourceLabel: string, message: { messageType: string; payload?: unknown }): string | null {
  const payload = asRecord(message.payload);

  if (message.messageType === "approval_result") {
    const decision = normalizeOptionalText(asString(payload?.decision));
    const inputText = normalizeOptionalText(asString(payload?.inputText));
    const extras = payload && Object.keys(payload).length > 0
      ? serializeJson(payload)
      : null;

    return [
      `- ${sourceLabel} 的审批结果：${decision ?? "unknown"}`,
      inputText ? `  补充：${inputText}` : null,
      !inputText && extras ? `  详情：${extras}` : null,
    ].filter((line): line is string => Boolean(line)).join("\n");
  }

  if (message.messageType === "answer") {
    const inputText = normalizeOptionalText(asString(payload?.inputText));
    const nestedPayload = payload?.payload;
    const details = nestedPayload !== undefined
      ? serializeJson(nestedPayload)
      : payload && Object.keys(payload).length > (inputText ? 1 : 0)
        ? serializeJson(payload)
        : null;

    return [
      `- ${sourceLabel} 的回复：${inputText ?? "已给出结构化回复"}`,
      details ? `  详情：${details}` : null,
    ].filter((line): line is string => Boolean(line)).join("\n");
  }

  return null;
}

function resolveTaskOptions(snapshot: unknown): TaskOptions | undefined {
  const record = asRecord(snapshot);

  if (!record) {
    return undefined;
  }

  const options: TaskOptions = {};

  assignOptionalTaskOptionString(options, "profile", record.profile);
  assignOptionalTaskOptionString(options, "languageStyle", record.languageStyle);
  assignOptionalTaskOptionString(options, "assistantMbti", record.assistantMbti);
  assignOptionalTaskOptionString(options, "styleNotes", record.styleNotes);
  assignOptionalTaskOptionString(options, "assistantSoul", record.assistantSoul);
  assignOptionalTaskOptionString(options, "authAccountId", record.authAccountId);
  assignOptionalTaskOptionString(options, "model", record.model);
  assignOptionalTaskOptionString(options, "reasoning", record.reasoning);
  assignOptionalTaskOptionString(options, "memoryMode", record.memoryMode);
  assignOptionalTaskOptionString(options, "sandboxMode", record.sandboxMode);
  assignOptionalTaskOptionString(options, "webSearchMode", record.webSearchMode);
  assignOptionalTaskOptionString(options, "approvalPolicy", record.approvalPolicy);
  assignOptionalTaskOptionString(options, "accessMode", record.accessMode);
  assignOptionalTaskOptionString(options, "thirdPartyProviderId", record.thirdPartyProviderId);

  if (typeof record.networkAccessEnabled === "boolean") {
    options.networkAccessEnabled = record.networkAccessEnabled;
  }

  if (Array.isArray(record.additionalDirectories)) {
    const additionalDirectories = record.additionalDirectories
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (additionalDirectories.length > 0) {
      options.additionalDirectories = additionalDirectories;
    }
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

function resolveWorkspacePath(snapshot: unknown): string | null {
  const record = asRecord(snapshot);
  return normalizeOptionalText(asString(record?.workspacePath));
}

function resolveAdditionalDirectories(snapshot: unknown): string[] {
  const record = asRecord(snapshot);

  if (!Array.isArray(record?.additionalDirectories)) {
    return [];
  }

  return record.additionalDirectories
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function resolveAllowNetworkAccess(snapshot: unknown): boolean | null {
  const record = asRecord(snapshot);
  return typeof record?.allowNetworkAccess === "boolean" ? record.allowNetworkAccess : null;
}

function assignOptionalTaskOptionString(
  target: TaskOptions,
  key: keyof TaskOptions,
  value: unknown,
): void {
  const normalized = normalizeOptionalText(asString(value));

  if (normalized) {
    (target as Record<string, unknown>)[key] = normalized;
  }
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function serializeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeOptionalText(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
