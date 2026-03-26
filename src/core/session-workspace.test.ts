import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizeSessionTaskSettings } from "./session-task-settings.js";
import {
  normalizeWorkspacePath,
  validateWorkspacePath,
} from "./session-workspace.js";

test("normalizeSessionTaskSettings 会保留 workspacePath", () => {
  const settings = normalizeSessionTaskSettings({
    accessMode: "auth",
    workspacePath: "/srv/projects/demo",
  });

  assert.deepEqual(settings, {
    accessMode: "auth",
    workspacePath: "/srv/projects/demo",
  });
});

test("validateWorkspacePath 只接受存在的绝对目录", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-session-workspace-"));
  const filePath = join(root, "README.md");
  writeFileSync(filePath, "# demo\n", "utf8");

  try {
    assert.equal(
      normalizeWorkspacePath("  /srv/projects/demo  "),
      "/srv/projects/demo",
    );
    assert.equal(validateWorkspacePath(root), root);
    assert.throws(() => validateWorkspacePath("relative/demo"), /绝对路径/);
    assert.throws(() => validateWorkspacePath(join(root, "missing")), /不存在/);
    assert.throws(() => validateWorkspacePath(filePath), /不是目录/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
