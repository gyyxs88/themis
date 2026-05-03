import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import {
  SqliteCodexSessionRegistry,
  type StoredWebAccessTokenRecord,
  type StoredWebSessionRecord,
} from "../storage/index.js";

export const WEB_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type WebAccessTokenKind = "web_login" | "platform_service";
export type PlatformServiceRole = "gateway" | "worker";

export interface WebAccessTokenSummary {
  tokenId: string;
  label: string;
  tokenKind: WebAccessTokenKind;
  ownerPrincipalId?: string;
  serviceRole?: PlatformServiceRole;
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
  token: WebAccessSessionTokenSummary;
}

export interface WebAccessSessionTokenSummary {
  tokenId: string;
  label: string;
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

export interface PlatformServiceTokenSummary extends WebAccessTokenSummary {
  tokenKind: "platform_service";
  ownerPrincipalId: string;
  serviceRole: PlatformServiceRole;
}

export type PlatformServiceAuthenticationFailureReason = "INVALID_CREDENTIALS" | "INVALID_TOKEN_SHAPE";

export type PlatformServiceAuthenticationResult =
  | { ok: true; token: PlatformServiceTokenSummary }
  | { ok: false; reason: PlatformServiceAuthenticationFailureReason };

export interface WebAccessServiceOptions {
  registry: SqliteCodexSessionRegistry;
  now?: () => string;
}

export interface CreateWebAccessTokenInput {
  label: string;
  secret: string;
  remoteIp?: string;
}

export interface CreatePlatformServiceTokenInput {
  label: string;
  secret: string;
  ownerPrincipalId: string;
  serviceRole: PlatformServiceRole;
  remoteIp?: string;
}

export interface RenameWebAccessTokenInput {
  tokenId: string;
  label: string;
  remoteIp?: string;
}

export interface RevokeWebAccessTokenInput {
  label: string;
  remoteIp?: string;
}

export interface RevokePlatformServiceTokenInput extends RevokeWebAccessTokenInput {}

export interface AuthenticateWebAccessInput {
  secret: string;
  remoteIp?: string;
}

export interface AuthenticatePlatformServiceInput {
  secret: string;
  remoteIp?: string;
}

export interface RevokeWebSessionInput {
  sessionId: string;
  remoteIp?: string;
}

export interface RecordDeniedAccessInput {
  reason: string;
  sessionId?: string;
  tokenLabel?: string;
  tokenId?: string;
  remoteIp?: string;
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
    return this.listActiveTokensByKind("web_login").length > 0;
  }

  listTokens(): WebAccessTokenSummary[] {
    return this.registry.listWebAccessTokens().map((record) => this.toTokenSummary(record));
  }

  listWebTokens(): WebAccessTokenSummary[] {
    return this.listTokens().filter((record) => record.tokenKind === "web_login");
  }

  listPlatformServiceTokens(): PlatformServiceTokenSummary[] {
    return this.registry
      .listWebAccessTokens()
      .filter((record) => record.tokenKind === "platform_service")
      .map((record) => this.toPlatformServiceTokenSummary(record));
  }

  createToken(input: CreateWebAccessTokenInput): WebAccessTokenSummary {
    return this.toTokenSummary(this.createStoredToken({
      label: input.label,
      secret: input.secret,
      tokenKind: "web_login",
      ...(input.remoteIp ? { remoteIp: input.remoteIp } : {}),
    }));
  }

  createPlatformServiceToken(input: CreatePlatformServiceTokenInput): PlatformServiceTokenSummary {
    const ownerPrincipalId = input.ownerPrincipalId.trim();

    if (!ownerPrincipalId) {
      throw new Error("Platform service token ownerPrincipalId is required.");
    }

    return this.toPlatformServiceTokenSummary(this.createStoredToken({
      label: input.label,
      secret: input.secret,
      tokenKind: "platform_service",
      ownerPrincipalId,
      serviceRole: input.serviceRole,
      ...(input.remoteIp ? { remoteIp: input.remoteIp } : {}),
    }));
  }

  private createStoredToken(input: {
    label: string;
    secret: string;
    tokenKind: WebAccessTokenKind;
    ownerPrincipalId?: string;
    serviceRole?: PlatformServiceRole;
    remoteIp?: string;
  }): StoredWebAccessTokenRecord {
    const label = input.label.trim();
    const secret = normalizeWebAccessSecret(input.secret);

    if (!label) {
      throw new Error("Web access token label is required.");
    }

    if (!secret) {
      throw new Error("Web access token secret is required.");
    }

    if (this.getActiveTokenByLabel(label)) {
      throw new Error(`Web access token label ${label} already exists.`);
    }

    const now = this.now();
    const record: StoredWebAccessTokenRecord = {
      tokenId: randomUUID(),
      label,
      tokenHash: hashWebAccessSecret(secret),
      tokenKind: input.tokenKind,
      ...(input.ownerPrincipalId ? { ownerPrincipalId: input.ownerPrincipalId } : {}),
      ...(input.serviceRole ? { serviceRole: input.serviceRole } : {}),
      createdAt: now,
      updatedAt: now,
    };

    try {
      this.registry.saveWebAccessToken(record);
    } catch (error) {
      if (isActiveWebAccessTokenLabelConflictError(error)) {
        throw new Error(`Web access token label ${label} already exists.`);
      }

      throw error;
    }

    this.appendAudit(
      input.tokenKind === "web_login" ? "web_access.token_created" : "platform_auth.token_created",
      input.tokenKind === "web_login" ? `新增 Web 口令 ${label}` : `新增平台服务令牌 ${label}`,
      {
        label,
        tokenId: record.tokenId,
        tokenKind: input.tokenKind,
        ...(record.ownerPrincipalId ? { ownerPrincipalId: record.ownerPrincipalId } : {}),
        ...(record.serviceRole ? { serviceRole: record.serviceRole } : {}),
      },
      {
        tokenId: record.tokenId,
        tokenLabel: label,
        ...(input.remoteIp ? { remoteIp: input.remoteIp } : {}),
      },
    );
    return record;
  }

  renameToken(input: RenameWebAccessTokenInput): WebAccessTokenSummary {
    const normalizedTokenId = input.tokenId.trim();
    const normalizedLabel = input.label.trim();

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

    const conflict = this.getActiveTokenByLabel(normalizedLabel);

    if (conflict && conflict.tokenId !== normalizedTokenId) {
      throw new Error(`Web access token label ${normalizedLabel} already exists.`);
    }

    const now = this.now();
    const previousLabel = existing.label;

    try {
      this.registry.renameWebAccessToken(normalizedTokenId, normalizedLabel, now);
    } catch (error) {
      if (isActiveWebAccessTokenLabelConflictError(error)) {
        throw new Error(`Web access token label ${normalizedLabel} already exists.`);
      }

      throw error;
    }

    const updated = this.registry.getWebAccessTokenById(normalizedTokenId);

    if (!updated) {
      throw new Error(`Web access token ${normalizedTokenId} not found after rename.`);
    }

    this.appendAudit(
      updated.tokenKind === "platform_service" ? "platform_auth.token_renamed" : "web_access.token_renamed",
      updated.tokenKind === "platform_service"
        ? `重命名平台服务令牌 ${previousLabel} -> ${normalizedLabel}`
        : `重命名 Web 口令 ${previousLabel} -> ${normalizedLabel}`,
      {
        tokenId: normalizedTokenId,
        previousLabel,
        label: normalizedLabel,
        tokenKind: updated.tokenKind ?? "web_login",
      },
      {
        tokenId: normalizedTokenId,
        tokenLabel: normalizedLabel,
        ...(input.remoteIp ? { remoteIp: input.remoteIp } : {}),
      },
    );

    return this.toTokenSummary(updated);
  }

  revokeTokenByLabel(input: RevokeWebAccessTokenInput): WebAccessTokenSummary {
    return this.toTokenSummary(this.revokeStoredTokenByLabel(input.label, input.remoteIp));
  }

  revokePlatformServiceTokenByLabel(input: RevokePlatformServiceTokenInput): PlatformServiceTokenSummary {
    return this.toPlatformServiceTokenSummary(
      this.revokeStoredTokenByLabel(input.label, input.remoteIp, "platform_service"),
    );
  }

  private revokeStoredTokenByLabel(
    label: string,
    remoteIp?: string,
    expectedKind?: WebAccessTokenKind,
  ): StoredWebAccessTokenRecord {
    const normalizedLabel = label.trim();

    if (!normalizedLabel) {
      throw new Error("Web access token label is required.");
    }

    const token = this.getActiveTokenByLabel(normalizedLabel, expectedKind)
      ?? this.registry.getWebAccessTokenByLabel(normalizedLabel);

    if (!token) {
      throw new Error(`Web access token ${normalizedLabel} not found.`);
    }

    if (expectedKind && token.tokenKind !== expectedKind) {
      throw new Error(`Web access token ${normalizedLabel} kind mismatch.`);
    }

    const now = this.now();

    if (!token.revokedAt) {
      this.registry.revokeWebAccessToken(token.tokenId, now, now);
    }

    const revokedSessionCount = this.registry.revokeWebSessionsByTokenId(token.tokenId, now, now);

    this.appendAudit(
      token.tokenKind === "platform_service" ? "platform_auth.token_revoked" : "web_access.token_revoked",
      token.tokenKind === "platform_service" ? `删除平台服务令牌 ${token.label}` : `删除 Web 口令 ${token.label}`,
      {
        tokenId: token.tokenId,
        label: token.label,
        tokenKind: token.tokenKind ?? "web_login",
        revokedAt: now,
      },
      {
        tokenId: token.tokenId,
        tokenLabel: token.label,
        ...(remoteIp ? { remoteIp } : {}),
      },
    );

    if (token.tokenKind !== "platform_service") {
      this.appendAudit(
        "web_access.sessions_revoked_by_token",
        `撤销 Web 口令关联会话 ${revokedSessionCount} 个`,
        {
          tokenId: token.tokenId,
          revokedAt: now,
          revokedSessionCount,
        },
        {
          tokenId: token.tokenId,
          tokenLabel: token.label,
          ...(remoteIp ? { remoteIp } : {}),
        },
      );
    }

    return this.registry.getWebAccessTokenById(token.tokenId) ?? {
      ...token,
      revokedAt: token.revokedAt ?? now,
      updatedAt: now,
    };
  }

  authenticate(input: AuthenticateWebAccessInput): WebAccessAuthenticationResult {
    const secret = normalizeWebAccessSecret(input.secret);

    if (!secret) {
      this.appendAudit(
        "web_access.login_failed",
        "Web 登录失败",
        {
          reason: "INVALID_CREDENTIALS",
        },
      {
        ...(input.remoteIp ? { remoteIp: input.remoteIp } : {}),
      },
    );
      return { ok: false, reason: "INVALID_CREDENTIALS" };
    }

    const token = this.listActiveTokensByKind("web_login")
      .find((record) => verifyWebAccessSecret(secret, record.tokenHash));

    if (!token) {
      this.appendAudit(
        "web_access.login_failed",
        "Web 登录失败",
        {
          reason: "INVALID_CREDENTIALS",
        },
      {
        ...(input.remoteIp ? { remoteIp: input.remoteIp } : {}),
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

    this.appendAudit(
      "web_access.login_succeeded",
      "Web 登录成功",
      {
        tokenId: token.tokenId,
        tokenLabel: token.label,
        sessionId: session.sessionId,
      },
      {
        tokenId: token.tokenId,
        tokenLabel: token.label,
        sessionId: session.sessionId,
        ...(input.remoteIp ? { remoteIp: input.remoteIp } : {}),
      },
    );

    return {
      ok: true,
      session: this.toSessionSummary(session, token),
    };
  }

  authenticatePlatformServiceToken(input: AuthenticatePlatformServiceInput): PlatformServiceAuthenticationResult {
    const secret = normalizeWebAccessSecret(input.secret);

    if (!secret) {
      this.appendAudit(
        "platform_auth.authenticate_failed",
        "平台服务鉴权失败",
        {
          reason: "INVALID_CREDENTIALS",
        },
        {
          ...(input.remoteIp ? { remoteIp: input.remoteIp } : {}),
        },
      );
      return { ok: false, reason: "INVALID_CREDENTIALS" };
    }

    const token = this.listActiveTokensByKind("platform_service")
      .find((record) => verifyWebAccessSecret(secret, record.tokenHash));

    if (!token) {
      this.appendAudit(
        "platform_auth.authenticate_failed",
        "平台服务鉴权失败",
        {
          reason: "INVALID_CREDENTIALS",
        },
        {
          ...(input.remoteIp ? { remoteIp: input.remoteIp } : {}),
        },
      );
      return { ok: false, reason: "INVALID_CREDENTIALS" };
    }

    if (!token.ownerPrincipalId || !token.serviceRole) {
      this.appendAudit(
        "platform_auth.authenticate_failed",
        "平台服务鉴权失败",
        {
          reason: "INVALID_TOKEN_SHAPE",
          tokenId: token.tokenId,
          tokenLabel: token.label,
        },
        {
          tokenId: token.tokenId,
          tokenLabel: token.label,
          ...(input.remoteIp ? { remoteIp: input.remoteIp } : {}),
        },
      );
      return { ok: false, reason: "INVALID_TOKEN_SHAPE" };
    }

    const now = this.now();
    this.registry.touchWebAccessToken(token.tokenId, now, now);
    this.appendAudit(
      "platform_auth.authenticate_succeeded",
      "平台服务鉴权成功",
      {
        tokenId: token.tokenId,
        tokenLabel: token.label,
        ownerPrincipalId: token.ownerPrincipalId,
        serviceRole: token.serviceRole,
      },
      {
        tokenId: token.tokenId,
        tokenLabel: token.label,
        ...(input.remoteIp ? { remoteIp: input.remoteIp } : {}),
      },
    );

    return {
      ok: true,
      token: this.toPlatformServiceTokenSummary({
        ...token,
        updatedAt: now,
        lastUsedAt: now,
      }),
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
      this.expireSession(normalizedSessionId, {
        sessionId: normalizedSessionId,
        tokenId: session.tokenId,
        tokenLabel: token.label,
      });
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
        token: {
          tokenId: token.tokenId,
          label: token.label,
        },
      },
    };
  }

  revokeSession(input: RevokeWebSessionInput): void {
    const normalizedSessionId = input.sessionId.trim();

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
      "主动登出",
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
        ...(input.remoteIp ? { remoteIp: input.remoteIp } : {}),
      },
    );
  }

  private expireSession(
    sessionId: string,
    context: {
      sessionId: string;
      tokenId: string;
      tokenLabel: string;
    },
  ): void {
    const now = this.now();
    const session = this.registry.getWebSession(sessionId);

    if (!session || session.revokedAt) {
      return;
    }

    this.registry.revokeWebSession(sessionId, now, now);
    this.appendAudit(
      "web_access.session_expired",
      "会话已过期",
      {
        sessionId: context.sessionId,
        tokenId: context.tokenId,
        tokenLabel: context.tokenLabel,
        revokedAt: now,
      },
      {
        sessionId: context.sessionId,
        tokenId: context.tokenId,
        tokenLabel: context.tokenLabel,
      },
    );
  }

  recordDeniedAccess(input: RecordDeniedAccessInput): void {
    const sessionId = input.sessionId?.trim();
    const tokenId = input.tokenId?.trim();
    const tokenLabel = input.tokenLabel?.trim();

    this.appendAudit(
      "web_access.access_denied",
      "Web 访问被拒绝",
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
        ...(input.remoteIp ? { remoteIp: input.remoteIp } : {}),
      },
    );
  }

  private appendAudit(
    eventType: string,
    summary: string,
    payload: Record<string, unknown>,
    context: {
      tokenId?: string;
      tokenLabel?: string;
      sessionId?: string;
      remoteIp?: string;
    } = {},
  ): void {
    const tokenId = context.tokenId?.trim();
    const sessionId = context.sessionId?.trim();
    const safeTokenId = tokenId && this.registry.getWebAccessTokenById(tokenId) ? tokenId : undefined;
    const safeSessionId = sessionId && this.registry.getWebSession(sessionId) ? sessionId : undefined;

    this.registry.appendWebAuditEvent({
      eventId: randomUUID(),
      eventType,
      createdAt: this.now(),
      summary,
      ...(context.remoteIp ? { remoteIp: context.remoteIp } : {}),
      ...(safeTokenId ? { tokenId: safeTokenId } : {}),
      ...(context.tokenLabel ? { tokenLabel: context.tokenLabel } : {}),
      ...(safeSessionId ? { sessionId: safeSessionId } : {}),
      payloadJson: JSON.stringify(payload),
    });
  }

  private toTokenSummary(record: StoredWebAccessTokenRecord): WebAccessTokenSummary {
    return {
      tokenId: record.tokenId,
      label: record.label,
      tokenKind: record.tokenKind ?? "web_login",
      ...(record.ownerPrincipalId ? { ownerPrincipalId: record.ownerPrincipalId } : {}),
      ...(record.serviceRole ? { serviceRole: record.serviceRole } : {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.lastUsedAt ? { lastUsedAt: record.lastUsedAt } : {}),
      ...(record.revokedAt ? { revokedAt: record.revokedAt } : {}),
    };
  }

  private toPlatformServiceTokenSummary(record: StoredWebAccessTokenRecord): PlatformServiceTokenSummary {
    if (record.tokenKind !== "platform_service" || !record.ownerPrincipalId || !record.serviceRole) {
      throw new Error(`Platform service token ${record.label} is incomplete.`);
    }

    return {
      tokenId: record.tokenId,
      label: record.label,
      tokenKind: "platform_service",
      ownerPrincipalId: record.ownerPrincipalId,
      serviceRole: record.serviceRole,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.lastUsedAt ? { lastUsedAt: record.lastUsedAt } : {}),
      ...(record.revokedAt ? { revokedAt: record.revokedAt } : {}),
    };
  }

  private toSessionSummary(record: StoredWebSessionRecord, token: StoredWebAccessTokenRecord): WebAccessSessionSummary {
    return {
      sessionId: record.sessionId,
      tokenId: record.tokenId,
      createdAt: record.createdAt,
      lastSeenAt: record.lastSeenAt,
      expiresAt: record.expiresAt,
      token: {
        tokenId: token.tokenId,
        label: token.label,
      },
    };
  }

  private getActiveTokenByLabel(label: string, kind?: WebAccessTokenKind): StoredWebAccessTokenRecord | null {
    const normalized = label.trim();

    if (!normalized) {
      return null;
    }

    const token = this.registry.getWebAccessTokenByLabel(normalized);

    if (!token || token.revokedAt) {
      return null;
    }

    if (kind && token.tokenKind !== kind) {
      return null;
    }

    return token;
  }

  private listActiveTokensByKind(kind: WebAccessTokenKind): StoredWebAccessTokenRecord[] {
    return this.registry
      .listActiveWebAccessTokens()
      .filter((record) => (record.tokenKind ?? "web_login") === kind);
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

function normalizeWebAccessSecret(secret: string): string {
  return secret.trim();
}

function isActiveWebAccessTokenLabelConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as { code?: string }).code;
  return typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT");
}
