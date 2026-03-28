import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { WEB_SESSION_TTL_MS, WebAccessService } from "./web-access.js";

const NOW = "2026-03-28T09:00:00.000Z";
const EXPIRES_AT = new Date(Date.parse(NOW) + WEB_SESSION_TTL_MS).toISOString();
const EXPIRED_NOW = new Date(Date.parse(NOW) + WEB_SESSION_TTL_MS + 1).toISOString();

function createService(now: () => string) {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-web-access-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });
  const service = new WebAccessService({
    registry,
    now,
  });

  return { workingDirectory, registry, service };
}

test("schema 10 迁移会补齐 web 审计字段和 active label 唯一索引", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-web-access-migration-"));
  const databaseFile = join(workingDirectory, "infra/local/themis.db");

  try {
    mkdirSync(join(workingDirectory, "infra/local"), { recursive: true });
    const bootstrap = new Database(databaseFile);
    bootstrap.exec(`
      CREATE TABLE themis_auth_accounts (
        account_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        codex_home TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE themis_third_party_providers (
        provider_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        default_model TEXT,
        wire_api TEXT NOT NULL DEFAULT 'responses',
        supports_websockets INTEGER NOT NULL DEFAULT 0,
        model_catalog_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE themis_web_access_tokens (
        token_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      );

      CREATE TABLE themis_web_sessions (
        session_id TEXT PRIMARY KEY,
        token_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      );

      CREATE TABLE themis_web_audit_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        token_id TEXT,
        token_label TEXT,
        session_id TEXT,
        payload_json TEXT
      );

      PRAGMA user_version = 10;
    `);
    bootstrap.close();

    new SqliteCodexSessionRegistry({ databaseFile });

    const verify = new Database(databaseFile, { readonly: true });
    const auditColumns = verify.prepare(`PRAGMA table_info(themis_web_audit_events)`).all() as Array<{ name: string }>;
    assert.equal(auditColumns.some((column) => column.name === "remote_ip"), true);
    assert.equal(auditColumns.some((column) => column.name === "summary"), true);

    const tokenIndexes = verify.prepare(`PRAGMA index_list(themis_web_access_tokens)`).all() as Array<{ name: string; unique: number }>;
    assert.equal(
      tokenIndexes.some(
        (index) => index.name === "themis_web_access_tokens_active_label_idx" && index.unique === 1,
      ),
      true,
    );
    verify.close();
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("authenticate 成功会创建 30 天 session 并写登录成功审计", () => {
  const { workingDirectory, registry, service } = createService(() => NOW);

  try {
    const created = service.createToken({
      label: "owner",
      secret: "correct horse battery staple",
      remoteIp: "192.168.1.10",
    });

    const authenticated = service.authenticate({
      secret: "correct horse battery staple",
      remoteIp: "192.168.1.10",
    });

    assert.equal(authenticated.ok, true);
    if (!authenticated.ok) {
      throw new Error("expected authentication to succeed");
    }

    assert.equal(authenticated.session.expiresAt, EXPIRES_AT);

    const readSession = service.readSession(authenticated.session.sessionId);
    assert.equal(readSession.ok, true);
    if (!readSession.ok) {
      throw new Error("expected session to be readable");
    }

    assert.equal(readSession.session.token.label, "owner");

    const auditEvents = registry.listWebAuditEvents();
    assert.equal(auditEvents.some((event) => event.eventType === "web_access.login_succeeded"), true);

    const loginSucceeded = auditEvents.find((event) => event.eventType === "web_access.login_succeeded");
    assert.ok(loginSucceeded);
    assert.equal(loginSucceeded?.remoteIp, "192.168.1.10");
    assert.equal(loginSucceeded?.tokenLabel, "owner");
    assert.equal(loginSucceeded?.summary, "Web 登录成功");
    assert.equal(loginSucceeded?.sessionId, authenticated.session.sessionId);
    assert.equal(loginSucceeded?.tokenId, created.tokenId);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("authenticate 失败会返回失败 reason 并写登录失败审计", () => {
  const { workingDirectory, registry, service } = createService(() => NOW);

  try {
    service.createToken({
      label: "owner",
      secret: "correct horse battery staple",
    });

    const result = service.authenticate({
      secret: "wrong secret",
      remoteIp: "192.168.1.11",
    });

    assert.deepEqual(result, {
      ok: false,
      reason: "INVALID_CREDENTIALS",
    });

    const loginFailed = registry
      .listWebAuditEvents()
      .find((event) => event.eventType === "web_access.login_failed");

    assert.ok(loginFailed);
    assert.equal(loginFailed?.remoteIp, "192.168.1.11");
    assert.equal(loginFailed?.summary, "Web 登录失败");
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("删除口令后关联 session 立即失效", () => {
  const { workingDirectory, service } = createService(() => NOW);

  try {
    const created = service.createToken({
      label: "owner",
      secret: "correct horse battery staple",
    });

    const authenticated = service.authenticate({
      secret: "correct horse battery staple",
    });

    assert.equal(authenticated.ok, true);
    if (!authenticated.ok) {
      throw new Error("expected authentication to succeed");
    }

    const initialRead = service.readSession(authenticated.session.sessionId);
    assert.equal(initialRead.ok, true);
    if (!initialRead.ok) {
      throw new Error("expected session to be readable");
    }

    assert.equal(initialRead.session.token.label, "owner");

    service.revokeTokenByLabel({
      label: "owner",
    });

    assert.deepEqual(service.readSession(authenticated.session.sessionId), {
      ok: false,
      reason: "SESSION_REVOKED",
    });

    const tokens = service.listTokens();
    assert.equal(tokens.length, 1);
    const token = tokens[0];
    if (!token) {
      throw new Error("expected one token");
    }

    assert.equal(token.label, "owner");
    assert.ok(token.revokedAt);
    assert.equal(token.tokenId, created.tokenId);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("吊销后可用同名 label 重建新 token", () => {
  const { workingDirectory, registry, service } = createService(() => NOW);

  try {
    const first = service.createToken({
      label: "owner",
      secret: "first secret",
    });

    const revoked = service.revokeTokenByLabel({
      label: "owner",
      remoteIp: "192.168.1.12",
    });

    assert.ok(revoked.revokedAt);

    const second = service.createToken({
      label: "owner",
      secret: "second secret",
      remoteIp: "192.168.1.13",
    });

    assert.notEqual(first.tokenId, second.tokenId);

    const activeTokens = registry.listActiveWebAccessTokens();
    assert.equal(activeTokens.length, 1);
    assert.equal(activeTokens[0]?.label, "owner");

    const allTokens = service.listTokens();
    assert.equal(allTokens.filter((token) => token.label === "owner").length, 2);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("renameToken 会写重命名审计", () => {
  const { workingDirectory, registry, service } = createService(() => NOW);

  try {
    const created = service.createToken({
      label: "owner",
      secret: "first secret",
    });

    const renamed = service.renameToken({
      tokenId: created.tokenId,
      label: "owner-renamed",
      remoteIp: "192.168.1.14",
    });

    assert.equal(renamed.label, "owner-renamed");

    const renameAudit = registry
      .listWebAuditEvents()
      .find((event) => event.eventType === "web_access.token_renamed");

    assert.ok(renameAudit);
    assert.equal(renameAudit?.remoteIp, "192.168.1.14");
    assert.equal(renameAudit?.tokenLabel, "owner-renamed");
    assert.equal(renameAudit?.summary, "重命名 Web 口令 owner -> owner-renamed");
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("readSession 过期分支返回 SESSION_EXPIRED", () => {
  let current = NOW;
  const { workingDirectory, service } = createService(() => current);

  try {
    service.createToken({
      label: "owner",
      secret: "correct horse battery staple",
    });

    const authenticated = service.authenticate({
      secret: "correct horse battery staple",
    });

    assert.equal(authenticated.ok, true);
    if (!authenticated.ok) {
      throw new Error("expected authentication to succeed");
    }

    current = EXPIRED_NOW;

    assert.deepEqual(service.readSession(authenticated.session.sessionId), {
      ok: false,
      reason: "SESSION_EXPIRED",
    });
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
