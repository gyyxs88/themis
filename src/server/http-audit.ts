import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { SqliteCodexSessionRegistry, StoredWebAuditEventRecord } from "../storage/index.js";

export interface WebAuditEventContext {
  remoteIp?: string;
  tokenId?: string;
  tokenLabel?: string;
  sessionId?: string;
}

export function appendWebAuditEvent(
  store: SqliteCodexSessionRegistry,
  eventType: string,
  summary: string,
  payload: Record<string, unknown>,
  context: WebAuditEventContext = {},
): void {
  const record: StoredWebAuditEventRecord = {
    eventId: randomUUID(),
    eventType,
    createdAt: new Date().toISOString(),
    summary,
    payloadJson: JSON.stringify(payload),
    ...(context.remoteIp ? { remoteIp: context.remoteIp } : {}),
    ...(context.tokenId ? { tokenId: context.tokenId } : {}),
    ...(context.tokenLabel ? { tokenLabel: context.tokenLabel } : {}),
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
  };

  store.appendWebAuditEvent(record);
}

export function resolveRemoteIp(request: IncomingMessage): string | undefined {
  return request.socket.remoteAddress ?? undefined;
}

export function buildRemoteIpContext(request: IncomingMessage): WebAuditEventContext {
  const remoteIp = resolveRemoteIp(request);
  return remoteIp ? { remoteIp } : {};
}
