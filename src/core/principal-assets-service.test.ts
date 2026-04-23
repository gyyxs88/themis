import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { PrincipalAssetsService } from "./principal-assets-service.js";

function createServiceContext(): {
  root: string;
  databaseFile: string;
  registry: SqliteCodexSessionRegistry;
  service: PrincipalAssetsService;
} {
  const root = mkdtempSync(join(tmpdir(), "themis-principal-assets-service-"));
  const databaseFile = join(root, "infra/local/themis.db");
  const registry = new SqliteCodexSessionRegistry({
    databaseFile,
  });
  const service = new PrincipalAssetsService({ registry });
  const now = "2026-04-23T10:00:00.000Z";

  registry.savePrincipal({
    principalId: "principal-owner",
    displayName: "Owner",
    createdAt: now,
    updatedAt: now,
  });

  return {
    root,
    databaseFile,
    registry,
    service,
  };
}

test("createAsset 会创建首版资产台账记录并落到 SQLite schema", () => {
  const context = createServiceContext();

  try {
    const asset = context.service.createAsset({
      principalId: "principal-owner",
      kind: "site",
      name: "Themis 官网",
      status: "active",
      ownerPrincipalId: "principal-owner",
      summary: "主站和落地页入口",
      tags: ["官网", "landing", "官网"],
      refs: [{
        kind: "domain",
        value: "themis.example.com",
      }, {
        kind: "repo",
        value: "github.com/demo/themis-site",
        label: "站点仓库",
      }],
      now: "2026-04-23T10:10:00.000Z",
    });

    assert.equal(asset.kind, "site");
    assert.deepEqual(asset.tags, ["官网", "landing"]);
    assert.equal(asset.refs.length, 2);

    const listed = context.service.listAssets({
      principalId: "principal-owner",
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.assetId, asset.assetId);

    const inspector = new Database(context.databaseFile, { readonly: true });

    try {
      const row = inspector.prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name = 'themis_principal_assets'
        `,
      ).get() as { name: string } | undefined;

      assert.equal(row?.name, "themis_principal_assets");
    } finally {
      inspector.close();
    }
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("listAssets 默认隐藏 archived，并支持按状态筛选", () => {
  const context = createServiceContext();

  try {
    context.service.createAsset({
      principalId: "principal-owner",
      kind: "domain",
      name: "themis.example.com",
      status: "active",
      now: "2026-04-23T11:00:00.000Z",
    });
    context.service.createAsset({
      principalId: "principal-owner",
      kind: "database",
      name: "订单库",
      status: "watch",
      now: "2026-04-23T11:01:00.000Z",
    });
    context.service.createAsset({
      principalId: "principal-owner",
      kind: "account",
      name: "旧备案账号",
      status: "archived",
      now: "2026-04-23T11:02:00.000Z",
    });

    const visible = context.service.listAssets({
      principalId: "principal-owner",
    });
    const archived = context.service.listAssets({
      principalId: "principal-owner",
      status: "archived",
      includeArchived: true,
    });

    assert.deepEqual(
      visible.map((asset) => asset.name),
      ["订单库", "themis.example.com"],
    );
    assert.deepEqual(
      archived.map((asset) => asset.name),
      ["旧备案账号"],
    );
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("updateAsset 会保留 createdAt，并允许清空 owner 和 summary", () => {
  const context = createServiceContext();

  try {
    const created = context.service.createAsset({
      principalId: "principal-owner",
      kind: "server",
      name: "prod-web-1",
      status: "watch",
      ownerPrincipalId: "principal-owner",
      summary: "迁移中",
      tags: ["prod"],
      refs: [{
        kind: "host",
        value: "10.0.0.8",
      }],
      now: "2026-04-23T12:00:00.000Z",
    });

    const updated = context.service.updateAsset({
      principalId: "principal-owner",
      assetId: created.assetId,
      kind: "server",
      name: "prod-web-1",
      status: "active",
      ownerPrincipalId: "",
      summary: "",
      tags: ["prod", "web"],
      refs: [{
        kind: "host",
        value: "10.0.0.8",
      }, {
        kind: "doc",
        value: "docs/infra/prod-web-1.md",
      }],
      now: "2026-04-23T12:05:00.000Z",
    });

    assert.equal(updated.createdAt, "2026-04-23T12:00:00.000Z");
    assert.equal(updated.updatedAt, "2026-04-23T12:05:00.000Z");
    assert.equal(updated.status, "active");
    assert.equal(updated.ownerPrincipalId, undefined);
    assert.equal(updated.summary, undefined);
    assert.deepEqual(updated.tags, ["prod", "web"]);
    assert.equal(updated.refs.length, 2);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});
