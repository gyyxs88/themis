import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { WebAccessService } from "./web-access.js";

const NOW = "2026-03-28T09:00:00.000Z";

test("删除口令后关联 session 立即失效", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-web-access-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });
  const service = new WebAccessService({
    registry,
    now: () => NOW,
  });

  try {
    const created = service.createToken({
      label: "owner",
      secret: "correct horse battery staple",
    });

    const authenticated = service.authenticate({
      label: "owner",
      secret: "correct horse battery staple",
    });

    assert.equal(authenticated.ok, true);
    if (!authenticated.ok) {
      throw new Error("expected authentication to succeed");
    }

    const sessionId = authenticated.session.sessionId;

    assert.deepEqual(service.readSession(sessionId), {
      ok: true,
      session: {
        sessionId,
        tokenId: created.tokenId,
        createdAt: NOW,
        lastSeenAt: NOW,
        expiresAt: "2026-04-27T09:00:00.000Z",
      },
    });

    service.revokeTokenByLabel("owner");

    assert.deepEqual(service.readSession(sessionId), {
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
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
