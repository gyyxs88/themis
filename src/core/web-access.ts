import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import {
  SqliteCodexSessionRegistry,
  type StoredWebAccessTokenRecord,
  type StoredWebSessionRecord,
} from "../storage/index.js";

export const WEB_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface WebAccessTokenSummary {
  tokenId: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface WebAccessSessionSummary {
  sessionId: string;
  tokenId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export type WebAccessSessionReadFailureReason =
  | "MISSING_SESSION"
  | "SESSION_REVOKED"
  | "SESSION_EXPIRED"
  | "TOKEN_REVOKED";

export type WebAccessSessionReadResult =
  | { ok: true; session: WebAccessSessionSummary }
  | { ok: false; reason: WebAccessSessionReadFailureReason };

export type WebAccessAuthenticationFailureReason = "INVALID_CREDENTIALS";

export type WebAccessAuthenticationResult =
  | { ok: true; session: WebAccessSessionSummary }
  | { ok: false; reason: WebAccessAuthenticationFailureReason };

export interface WebAccessServiceOptions {
  registry: SqliteCodexSessionRegistry;
  now?: () => string;
}

export interface CreateWebAccessTokenInput {
  label: string;
  secret: string;
}

export interface AuthenticateWebAccessInput {
  label: string;
  secret: string;
}

export interface RecordDeniedAccessInput {
  reason: string;
  sessionId?: string;
  tokenLabel?: string;
  tokenId?: string;
  details?: Record<string, unknown>;
}

export class WebAccessService {
  private readonly registry: SqliteCodexSessionRegistry;
  private readonly now: () => string;

  constructor(options: WebAccessServiceOptions) {
    this.registry = options.registry;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  hasActiveToken(): boolean {
    return this.registry.listActiveWebAccessTokens().length > 0;
  }

  listTokens(): WebAccessTokenSummary[] {
    return this.registry.listWebAccessTokens().map((record) => this.toTokenSummary(record));
  }

  createToken(input: CreateWebAccessTokenInput): WebAccessTokenSummary {
    const label = input.label.trim();
    const secret = input.secret;

    if (!label) {
      throw new Error("Web access token label is required.");
    }

    if (secret.length === 0) {
      throw new Error("Web access token secret is required.");
    }

    if (this.registry.getWebAccessTokenByLabel(label)) {
      throw new Error(`Web access token label ${label} already exists.`);
    }

    const now = this.now();
    const record: StoredWebAccessTokenRecord = {
      tokenId: randomUUID(),
      label,
      tokenHash: hashWebAccessSecret(secret),
      createdAt: now,
      updatedAt: now,
    };

    this.registry.saveWebAccessToken(record);
    return this.toTokenSummary(record);
  }

  renameToken(tokenId: string, label: string): WebAccessTokenSummary {
    const normalizedTokenId = tokenId.trim();
    const normalizedLabel = label.trim();

    if (!normalizedTokenId) {
      throw new Error("Web access token id is required.");
    }

    if (!normalizedLabel) {
      throw new Error("Web access token label is required.");
    }

    const existing = this.registry.getWebAccessTokenById(normalizedTokenId);

    if (!existing) {
      throw new Error(`Web access token ${normalizedTokenId} not found.`);
    }

    const conflict = this.registry
      .listWebAccessTokens()
      .find((record) => record.label === normalizedLabel && record.tokenId !== normalizedTokenId);

    if (conflict) {
      throw new Error(`Web access token label ${normalizedLabel} already exists.`);
    }

    const now = this.now();
    this.registry.renameWebAccessToken(normalizedTokenId, normalizedLabel, now);
    const updated = this.registry.getWebAccessTokenById(normalizedTokenId);

    if (!updated) {
      throw new Error(`Web access token ${normalizedTokenId} not found after rename.`);
    }

    return this.toTokenSummary(updated);
  }

  revokeTokenByLabel(label: string): WebAccessTokenSummary {
    const normalizedLabel = label.trim();

    if (!normalizedLabel) {
      throw new Error("Web access token label is required.");
    }

    const token = this.registry.getWebAccessTokenByLabel(normalizedLabel);

    if (!token) {
      throw new Error(`Web access token ${normalizedLabel} not found.`);
    }

    const now = this.now();

    if (!token.revokedAt) {
      this.registry.revokeWebAccessToken(token.tokenId, now, now);
    }

    const revokedSessionCount = this.registry.revokeWebSessionsByTokenId(token.tokenId, now, now);

    this.appendAudit(
      "web_access.token_revoked",
      {
        tokenId: token.tokenId,
        tokenLabel: token.label,
        revokedAt: now,
      },
      {
        tokenId: token.tokenId,
        tokenLabel: token.label,
      },
    );
    this.appendAudit(
      "web_access.sessions_revoked_by_token",
      {
        tokenId: token.tokenId,
        tokenLabel: token.label,
        revokedAt: now,
        revokedSessionCount,
      },
      {
        tokenId: token.tokenId,
        tokenLabel: token.label,
      },
    );

    return this.toTokenSummary(
      this.registry.getWebAccessTokenById(token.tokenId) ?? {
        ...token,
        revokedAt: token.revokedAt ?? now,
        updatedAt: now,
      },
    );
  }

  authenticate(input: AuthenticateWebAccessInput): WebAccessAuthenticationResult {
    const label = input.label.trim();
    const secret = input.secret;

    if (!label || secret.length === 0) {
      const attemptedTokenLabel = label || input.label;
      this.appendAudit(
        "web_access.login_failed",
        {
          tokenLabel: attemptedTokenLabel,
          reason: "INVALID_CREDENTIALS",
        },
        {
          ...(attemptedTokenLabel ? { tokenLabel: attemptedTokenLabel } : {}),
        },
      );
      return { ok: false, reason: "INVALID_CREDENTIALS" };
    }

    const token = this.registry.getWebAccessTokenByLabel(label);

    if (!token || token.revokedAt || !verifyWebAccessSecret(secret, token.tokenHash)) {
      const tokenId = token?.tokenId;
      this.appendAudit(
        "web_access.login_failed",
        {
          tokenLabel: label,
          ...(tokenId ? { tokenId } : {}),
          reason: "INVALID_CREDENTIALS",
        },
        {
          tokenLabel: label,
          ...(tokenId ? { tokenId } : {}),
        },
      );
      return { ok: false, reason: "INVALID_CREDENTIALS" };
    }

    const now = this.now();
    const session: StoredWebSessionRecord = {
      sessionId: randomUUID(),
      tokenId: token.tokenId,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      expiresAt: new Date(Date.parse(now) + WEB_SESSION_TTL_MS).toISOString(),
    };

    this.registry.saveWebSession(session);
    this.registry.touchWebAccessToken(token.tokenId, now, now);

    return {
      ok: true,
      session: this.toSessionSummary(session),
    };
  }

  readSession(sessionId: string): WebAccessSessionReadResult {
    const normalizedSessionId = sessionId.trim();

    if (!normalizedSessionId) {
      return { ok: false, reason: "MISSING_SESSION" };
    }

    const session = this.registry.getWebSession(normalizedSessionId);

    if (!session) {
      return { ok: false, reason: "MISSING_SESSION" };
    }

    if (session.revokedAt) {
      return { ok: false, reason: "SESSION_REVOKED" };
    }

    const token = this.registry.getWebAccessTokenById(session.tokenId);

    if (!token) {
      return { ok: false, reason: "MISSING_SESSION" };
    }

    if (token.revokedAt) {
      return { ok: false, reason: "TOKEN_REVOKED" };
    }

    const now = this.now();

    if (Date.parse(session.expiresAt) <= Date.parse(now)) {
      this.revokeSession(normalizedSessionId);
      return { ok: false, reason: "SESSION_EXPIRED" };
    }

    this.registry.touchWebSession(normalizedSessionId, now, now);

    return {
      ok: true,
      session: {
        sessionId: session.sessionId,
        tokenId: session.tokenId,
        createdAt: session.createdAt,
        lastSeenAt: now,
        expiresAt: session.expiresAt,
      },
    };
  }

  revokeSession(sessionId: string): void {
    const normalizedSessionId = sessionId.trim();

    if (!normalizedSessionId) {
      return;
    }

    const now = this.now();
    const session = this.registry.getWebSession(normalizedSessionId);

    if (!session || session.revokedAt) {
      return;
    }

    this.registry.revokeWebSession(normalizedSessionId, now, now);
    const tokenLabel = this.registry.getWebAccessTokenById(session.tokenId)?.label;
    this.appendAudit(
      "web_access.session_revoked",
      {
        sessionId: normalizedSessionId,
        tokenId: session.tokenId,
        ...(tokenLabel ? { tokenLabel } : {}),
        revokedAt: now,
      },
      {
        sessionId: normalizedSessionId,
        tokenId: session.tokenId,
        ...(tokenLabel ? { tokenLabel } : {}),
      },
    );
  }

  recordDeniedAccess(input: RecordDeniedAccessInput): void {
    const sessionId = input.sessionId?.trim();
    const tokenId = input.tokenId?.trim();
    const tokenLabel = input.tokenLabel?.trim();

    this.appendAudit(
      "web_access.access_denied",
      {
        reason: input.reason,
        ...(sessionId ? { sessionId } : {}),
        ...(tokenId ? { tokenId } : {}),
        ...(tokenLabel ? { tokenLabel } : {}),
        ...(input.details ? { details: input.details } : {}),
      },
      {
        ...(sessionId ? { sessionId } : {}),
        ...(tokenId ? { tokenId } : {}),
        ...(tokenLabel ? { tokenLabel } : {}),
      },
    );
  }

  private appendAudit(
    eventType: string,
    payload: Record<string, unknown>,
    context: {
      tokenId?: string;
      tokenLabel?: string;
      sessionId?: string;
    } = {},
  ): void {
    this.registry.appendWebAuditEvent({
      eventId: randomUUID(),
      eventType,
      createdAt: this.now(),
      ...(context.tokenId ? { tokenId: context.tokenId } : {}),
      ...(context.tokenLabel ? { tokenLabel: context.tokenLabel } : {}),
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
      payloadJson: JSON.stringify(payload),
    });
  }

  private toTokenSummary(record: StoredWebAccessTokenRecord): WebAccessTokenSummary {
    return {
      tokenId: record.tokenId,
      label: record.label,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.lastUsedAt ? { lastUsedAt: record.lastUsedAt } : {}),
      ...(record.revokedAt ? { revokedAt: record.revokedAt } : {}),
    };
  }

  private toSessionSummary(record: StoredWebSessionRecord): WebAccessSessionSummary {
    return {
      sessionId: record.sessionId,
      tokenId: record.tokenId,
      createdAt: record.createdAt,
      lastSeenAt: record.lastSeenAt,
      expiresAt: record.expiresAt,
    };
  }
}

function hashWebAccessSecret(secret: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(secret, salt, 64).toString("hex");
  return `scrypt:${salt}:${digest}`;
}

function verifyWebAccessSecret(secret: string, storedHash: string): boolean {
  const [scheme, salt, digest] = storedHash.split(":");

  if (scheme !== "scrypt" || !salt || !digest) {
    return false;
  }

  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(secret, salt, expected.length);

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}
