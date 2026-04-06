import type { IncomingMessage, ServerResponse } from "node:http";
import type { CodexTaskRuntime } from "../core/codex-runtime.js";
import type { TaskRequest, TaskResult } from "../types/index.js";
import { createTaskError, resolveErrorStatusCode, toErrorMessage } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

interface IdentityPayload {
  channel: string;
  channelUserId: string;
  displayName?: string;
}

interface ActorCreatePayload extends IdentityPayload {
  actor: {
    displayName: string;
    role: string;
  };
}

interface ActorScopePayload extends IdentityPayload {
  actorId: string;
  scopeId: string;
}

interface MainMemoryCandidateSuggestPayload extends IdentityPayload {
  candidate: {
    kind: string;
    title: string;
    summary: string;
    rationale: string;
    suggestedContent: string;
    sourceType: string;
    sourceLabel: string;
    sourceTaskId?: string;
    sourceConversationId?: string;
  };
}

interface MainMemoryCandidateListPayload extends IdentityPayload {
  status?: string;
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface MainMemoryCandidateReviewPayload extends IdentityPayload {
  candidateId: string;
  decision: "approve" | "reject" | "archive";
}

interface MainMemoryCandidateExtractPayload extends IdentityPayload {
  requestId: string;
}

async function readAndNormalizePayload<T>(
  request: IncomingMessage,
  response: ServerResponse,
  normalize: (value: unknown) => T,
): Promise<T | null> {
  try {
    return normalize(await readJsonBody(request));
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, false), {
      error: createTaskError(error, false),
    });
    return null;
  }
}

function writeRuntimeError(response: ServerResponse, error: unknown): void {
  writeJson(response, resolveErrorStatusCode(error, true), {
    error: createTaskError(error, true),
  });
}

function writeActorBoundaryError(response: ServerResponse, error: unknown): void {
  if (isActorBoundaryError(error)) {
    writeJson(response, 400, {
      error: createTaskError(error, false),
    });
    return;
  }

  writeRuntimeError(response, error);
}

export async function handleActorCreate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeActorCreatePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const actor = runtime.getPrincipalActorsService().createActor({
      principalId: identity.principalId,
      displayName: payload.actor.displayName,
      role: payload.actor.role,
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      actor,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handleActorList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeIdentityPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const actors = runtime.getPrincipalActorsService().listActors(identity.principalId);

    writeJson(response, 200, {
      identity,
      actors,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handleActorTimeline(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeActorScopePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const takeover = runtime.getPrincipalActorsService().takeOverActorTask({
      principalId: identity.principalId,
      actorId: payload.actorId,
      scopeId: payload.scopeId,
    });

    writeJson(response, 200, {
      identity,
      timeline: takeover.timeline,
    });
  } catch (error) {
    writeActorBoundaryError(response, error);
  }
}

export async function handleActorTakeover(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeActorScopePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const result = runtime.getPrincipalActorsService().takeOverActorTask({
      principalId: identity.principalId,
      actorId: payload.actorId,
      scopeId: payload.scopeId,
    });

    writeJson(response, 200, result);
  } catch (error) {
    writeActorBoundaryError(response, error);
  }
}

export async function handleMainMemoryCandidateSuggest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeMainMemoryCandidateSuggestPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const candidate = runtime.getPrincipalActorsService().suggestMainMemoryCandidate({
      principalId: identity.principalId,
      kind: payload.candidate.kind as never,
      title: payload.candidate.title,
      summary: payload.candidate.summary,
      rationale: payload.candidate.rationale,
      suggestedContent: payload.candidate.suggestedContent,
      sourceType: payload.candidate.sourceType as never,
      sourceLabel: payload.candidate.sourceLabel,
      ...(payload.candidate.sourceTaskId ? { sourceTaskId: payload.candidate.sourceTaskId } : {}),
      ...(payload.candidate.sourceConversationId
        ? { sourceConversationId: payload.candidate.sourceConversationId }
        : {}),
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      candidate,
    });
  } catch (error) {
    writeActorBoundaryError(response, error);
  }
}

export async function handleMainMemoryCandidateList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeMainMemoryCandidateListPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const candidates = runtime.getPrincipalActorsService().listMainMemoryCandidates({
      principalId: identity.principalId,
      ...(payload.status ? { status: payload.status as never } : {}),
      ...(payload.query ? { query: payload.query } : {}),
      ...(payload.includeArchived ? { includeArchived: true } : {}),
      ...(typeof payload.limit === "number" ? { limit: payload.limit } : {}),
    });

    writeJson(response, 200, {
      identity,
      candidates,
    });
  } catch (error) {
    writeActorBoundaryError(response, error);
  }
}

export async function handleMainMemoryCandidateReview(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeMainMemoryCandidateReviewPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const result = runtime.getPrincipalActorsService().reviewMainMemoryCandidate({
      principalId: identity.principalId,
      candidateId: payload.candidateId,
      decision: payload.decision,
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      candidate: result.candidate,
      ...(result.memory ? { memory: result.memory } : { memory: null }),
    });
  } catch (error) {
    writeActorBoundaryError(response, error);
  }
}

export async function handleMainMemoryCandidateExtract(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeMainMemoryCandidateExtractPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const turn = runtime.getRuntimeStore().getTurn(payload.requestId);

    if (!turn) {
      throw new Error("长期记忆候选提炼请求指定的任务不存在。");
    }

    if (turn.status !== "completed") {
      throw new Error("只能从已完成任务提炼长期记忆候选。");
    }

    const turnIdentity = runtime.getRuntimeStore().getChannelIdentity(turn.sourceChannel, turn.userId);
    if (turnIdentity?.principalId !== identity.principalId) {
      throw new Error("长期记忆候选提炼请求越过了 principal 边界。");
    }

    const requestRecord = restoreTaskRequestFromTurn(turn);
    const resultRecord = restoreTaskResultFromTurn(turn);
    const extracted = runtime.getPrincipalActorsService().suggestMainMemoryCandidatesFromTask({
      principalId: identity.principalId,
      request: requestRecord,
      result: resultRecord,
      ...(turn.sessionId ? { conversationId: turn.sessionId } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      requestId: turn.requestId,
      candidates: extracted.candidates,
      updates: extracted.updates,
    });
  } catch (error) {
    writeActorBoundaryError(response, error);
  }
}

function normalizeIdentityPayload(value: unknown): IdentityPayload {
  if (!isRecord(value)) {
    throw new Error("身份请求缺少必要字段。");
  }

  const channel = normalizeText(value.channel);
  const channelUserId = normalizeText(value.channelUserId);
  const displayName = normalizeText(value.displayName);

  if (!channel || !channelUserId) {
    throw new Error("身份请求缺少必要字段。");
  }

  return {
    channel,
    channelUserId,
    ...(displayName ? { displayName } : {}),
  };
}

function normalizeActorCreatePayload(value: unknown): ActorCreatePayload {
  if (!isRecord(value) || !isRecord(value.actor)) {
    throw new Error("actor 创建请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const displayName = normalizeText(value.actor.displayName);
  const role = normalizeText(value.actor.role);

  if (!displayName || !role) {
    throw new Error("actor 创建请求缺少必要字段。");
  }

  return {
    ...identity,
    actor: {
      displayName,
      role,
    },
  };
}

function normalizeActorScopePayload(value: unknown): ActorScopePayload {
  if (!isRecord(value)) {
    throw new Error("actor scope 请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const actorId = normalizeText(value.actorId);
  const scopeId = normalizeText(value.scopeId);

  if (!actorId || !scopeId) {
    throw new Error("actor scope 请求缺少必要字段。");
  }

  return {
    ...identity,
    actorId,
    scopeId,
  };
}

function normalizeMainMemoryCandidateSuggestPayload(value: unknown): MainMemoryCandidateSuggestPayload {
  if (!isRecord(value) || !isRecord(value.candidate)) {
    throw new Error("长期记忆候选请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const kind = normalizeText(value.candidate.kind);
  const title = normalizeText(value.candidate.title);
  const summary = normalizeText(value.candidate.summary);
  const rationale = normalizeText(value.candidate.rationale);
  const suggestedContent = normalizeText(value.candidate.suggestedContent);
  const sourceType = normalizeText(value.candidate.sourceType);
  const sourceLabel = normalizeText(value.candidate.sourceLabel);
  const sourceTaskId = normalizeText(value.candidate.sourceTaskId);
  const sourceConversationId = normalizeText(value.candidate.sourceConversationId);

  if (!kind || !title || !summary || !rationale || !suggestedContent || !sourceType || !sourceLabel) {
    throw new Error("长期记忆候选请求缺少必要字段。");
  }

  return {
    ...identity,
    candidate: {
      kind,
      title,
      summary,
      rationale,
      suggestedContent,
      sourceType,
      sourceLabel,
      ...(sourceTaskId ? { sourceTaskId } : {}),
      ...(sourceConversationId ? { sourceConversationId } : {}),
    },
  };
}

function normalizeMainMemoryCandidateListPayload(value: unknown): MainMemoryCandidateListPayload {
  if (!isRecord(value)) {
    throw new Error("长期记忆候选列表请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const status = normalizeText(value.status);
  const query = normalizeText(value.query);
  const includeArchived = value.includeArchived === true || value.includeArchived === 1 || value.includeArchived === "1";
  const limit = typeof value.limit === "number" && Number.isFinite(value.limit) && value.limit > 0
    ? Math.floor(value.limit)
    : undefined;

  return {
    ...identity,
    ...(status ? { status } : {}),
    ...(query ? { query } : {}),
    ...(includeArchived ? { includeArchived: true } : {}),
    ...(typeof limit === "number" ? { limit } : {}),
  };
}

function normalizeMainMemoryCandidateReviewPayload(value: unknown): MainMemoryCandidateReviewPayload {
  if (!isRecord(value)) {
    throw new Error("长期记忆候选审批请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const candidateId = normalizeText(value.candidateId);
  const decision = normalizeText(value.decision);

  if (!candidateId || (decision !== "approve" && decision !== "reject" && decision !== "archive")) {
    throw new Error("长期记忆候选审批请求缺少必要字段。");
  }

  return {
    ...identity,
    candidateId,
    decision,
  };
}

function normalizeMainMemoryCandidateExtractPayload(value: unknown): MainMemoryCandidateExtractPayload {
  if (!isRecord(value)) {
    throw new Error("长期记忆候选提炼请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const requestId = normalizeText(value.requestId);

  if (!requestId) {
    throw new Error("长期记忆候选提炼请求缺少必要字段。");
  }

  return {
    ...identity,
    requestId,
  };
}

function restoreTaskRequestFromTurn(turn: {
  requestId: string;
  taskId: string;
  sessionId?: string;
  sourceChannel: string;
  userId: string;
  userDisplayName?: string;
  goal: string;
  inputText?: string;
  historyContext?: string;
  optionsJson?: string;
  createdAt: string;
}): TaskRequest {
  const options = parseOptionalJsonObject(turn.optionsJson) as NonNullable<TaskRequest["options"]> | null;
  const request: TaskRequest = {
    requestId: turn.requestId,
    taskId: turn.taskId,
    sourceChannel: turn.sourceChannel as TaskRequest["sourceChannel"],
    user: {
      userId: turn.userId,
      ...(turn.userDisplayName ? { displayName: turn.userDisplayName } : {}),
    },
    goal: turn.goal,
    channelContext: {
      ...(turn.sessionId ? { sessionId: turn.sessionId, channelSessionKey: turn.sessionId } : {}),
    },
    createdAt: turn.createdAt,
  };

  if (turn.inputText) {
    request.inputText = turn.inputText;
  }

  if (turn.historyContext) {
    request.historyContext = turn.historyContext;
  }

  if (options) {
    request.options = options;
  }

  return request;
}

function restoreTaskResultFromTurn(turn: {
  taskId: string;
  requestId: string;
  status: string;
  summary?: string;
  output?: string;
  structuredOutputJson?: string;
  completedAt?: string;
  updatedAt: string;
}): TaskResult {
  const structuredOutput = parseOptionalJsonObject(turn.structuredOutputJson);

  return {
    taskId: turn.taskId,
    requestId: turn.requestId,
    status: turn.status as TaskResult["status"],
    summary: turn.summary ?? "",
    ...(turn.output ? { output: turn.output } : {}),
    ...(structuredOutput ? { structuredOutput } : {}),
    completedAt: turn.completedAt ?? turn.updatedAt,
  };
}

function parseOptionalJsonObject(value: string | undefined): Record<string, unknown> | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isActorBoundaryError(error: unknown): boolean {
  const message = toErrorMessage(error);

  return message === "Principal actor does not exist."
    || message === "Actor task scope does not exist."
    || message === "Principal main memory candidate does not exist."
    || message === "Principal main memory candidate is archived."
    || message === "Principal main memory candidate is no longer pending review."
    || message === "长期记忆候选提炼请求指定的任务不存在。"
    || message === "只能从已完成任务提炼长期记忆候选。"
    || message === "长期记忆候选提炼请求越过了 principal 边界。";
}
