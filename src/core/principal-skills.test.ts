import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  normalizePrincipalSkillMaterializationState,
  normalizePrincipalSkillRecordInput,
  normalizePrincipalSkillSourceType,
} from "./principal-skills.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

test("normalizePrincipalSkillSourceType 只接受允许来源", () => {
  assert.equal(normalizePrincipalSkillSourceType("local-path"), "local-path");
  assert.equal(normalizePrincipalSkillSourceType("github-url"), "github-url");
  assert.equal(normalizePrincipalSkillSourceType("bad"), null);
});

test("normalizePrincipalSkillMaterializationState 只接受允许状态", () => {
  assert.equal(normalizePrincipalSkillMaterializationState("synced"), "synced");
  assert.equal(normalizePrincipalSkillMaterializationState("conflict"), "conflict");
  assert.equal(normalizePrincipalSkillMaterializationState("broken"), null);
});

test("normalizePrincipalSkillRecordInput 会清理空白并保留合法字段", () => {
  const result = normalizePrincipalSkillRecordInput({
    principalId: " principal-local-owner ",
    skillName: " demo-skill ",
    description: " a demo skill ",
    sourceType: "local-path",
    sourceRefJson: "{\"path\":\"/srv/demo\"}",
    managedPath: "/srv/themis/skills/demo-skill",
    installStatus: "ready",
    lastError: " ",
  });

  assert.deepEqual(result, {
    principalId: "principal-local-owner",
    skillName: "demo-skill",
    description: "a demo skill",
    sourceType: "local-path",
    sourceRefJson: "{\"path\":\"/srv/demo\"}",
    managedPath: "/srv/themis/skills/demo-skill",
    installStatus: "ready",
  });
});

test("registry 可以按 principal 读写 skills 主记录", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-principal-skills-"));

  try {
    const registry = new SqliteCodexSessionRegistry({
      databaseFile: join(workingDirectory, "infra/local/themis.db"),
    });

    registry.savePrincipal({
      principalId: "principal-local-owner",
      displayName: "Tester",
      createdAt: "2026-03-27T00:00:00.000Z",
      updatedAt: "2026-03-27T00:00:00.000Z",
    });

    registry.savePrincipalSkill({
      principalId: "principal-local-owner",
      skillName: "demo-skill",
      description: "demo",
      sourceType: "local-path",
      sourceRefJson: "{\"path\":\"/srv/demo\"}",
      managedPath: "/srv/themis/skills/demo-skill",
      installStatus: "ready",
      createdAt: "2026-03-27T00:00:00.000Z",
      updatedAt: "2026-03-27T00:00:00.000Z",
    });

    assert.equal(registry.listPrincipalSkills("principal-local-owner").length, 1);
    assert.equal(
      registry.getPrincipalSkill("principal-local-owner", "demo-skill")?.managedPath,
      "/srv/themis/skills/demo-skill",
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("registry 可以读写账号槽位物化状态", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-principal-skill-materializations-"));

  try {
    const registry = new SqliteCodexSessionRegistry({
      databaseFile: join(workingDirectory, "infra/local/themis.db"),
    });

    registry.savePrincipal({
      principalId: "principal-local-owner",
      displayName: "Tester",
      createdAt: "2026-03-27T00:00:00.000Z",
      updatedAt: "2026-03-27T00:00:00.000Z",
    });

    registry.savePrincipalSkill({
      principalId: "principal-local-owner",
      skillName: "demo-skill",
      description: "demo",
      sourceType: "local-path",
      sourceRefJson: "{\"path\":\"/srv/demo\"}",
      managedPath: "/srv/themis/skills/demo-skill",
      installStatus: "ready",
      createdAt: "2026-03-27T00:00:00.000Z",
      updatedAt: "2026-03-27T00:00:00.000Z",
    });

    registry.savePrincipalSkillMaterialization({
      principalId: "principal-local-owner",
      skillName: "demo-skill",
      targetKind: "auth-account",
      targetId: "default",
      targetPath: "/srv/themis/auth/default/skills/demo-skill",
      state: "synced",
      lastSyncedAt: "2026-03-27T00:00:00.000Z",
    });

    assert.equal(
      registry.listPrincipalSkillMaterializations("principal-local-owner", "demo-skill")[0]?.state,
      "synced",
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("resetPrincipalState 会清理 skills 主记录和物化状态", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-principal-skill-reset-"));

  try {
    const registry = new SqliteCodexSessionRegistry({
      databaseFile: join(workingDirectory, "infra/local/themis.db"),
    });

    registry.savePrincipal({
      principalId: "principal-local-owner",
      displayName: "Tester",
      createdAt: "2026-03-27T00:00:00.000Z",
      updatedAt: "2026-03-27T00:00:00.000Z",
    });

    registry.savePrincipalSkill({
      principalId: "principal-local-owner",
      skillName: "demo-skill",
      description: "demo",
      sourceType: "local-path",
      sourceRefJson: "{\"path\":\"/srv/demo\"}",
      managedPath: "/srv/themis/skills/demo-skill",
      installStatus: "ready",
      createdAt: "2026-03-27T00:00:00.000Z",
      updatedAt: "2026-03-27T00:00:00.000Z",
    });

    registry.savePrincipalSkillMaterialization({
      principalId: "principal-local-owner",
      skillName: "demo-skill",
      targetKind: "auth-account",
      targetId: "default",
      targetPath: "/srv/themis/auth/default/skills/demo-skill",
      state: "synced",
      lastSyncedAt: "2026-03-27T00:00:00.000Z",
    });

    registry.resetPrincipalState("principal-local-owner", "2026-03-27T00:00:01.000Z");

    assert.equal(registry.listPrincipalSkills("principal-local-owner").length, 0);
    assert.equal(registry.listPrincipalSkillMaterializations("principal-local-owner").length, 0);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
