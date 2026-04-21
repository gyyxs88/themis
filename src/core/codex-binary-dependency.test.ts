import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  dependencies?: Record<string, string>;
};

test("app-server runtime 直接声明 codex CLI 依赖", () => {
  assert.ok(
    packageJson.dependencies?.["@openai/codex"],
    "package.json 必须直接声明 @openai/codex，否则部署时 node_modules/.bin/codex 会被 prune 掉。",
  );
});
