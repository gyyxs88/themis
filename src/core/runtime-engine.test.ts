import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRuntimeEngine,
  resolveRuntimeEngine,
} from "./runtime-engine.js";

test("parseRuntimeEngine 会接受 sdk", () => {
  assert.equal(parseRuntimeEngine("sdk"), "sdk");
});

test("parseRuntimeEngine 会接受 app-server", () => {
  assert.equal(parseRuntimeEngine("app-server"), "app-server");
});

test("parseRuntimeEngine 会拒绝空串和非法值", () => {
  assert.equal(parseRuntimeEngine(""), null);
  assert.equal(parseRuntimeEngine("bad-value"), null);
  assert.equal(parseRuntimeEngine(undefined), null);
  assert.equal(parseRuntimeEngine(null), null);
});

test("resolveRuntimeEngine 会在未配置时使用 sdk 作为后备值", () => {
  assert.equal(resolveRuntimeEngine(undefined, "sdk"), "sdk");
});

test("resolveRuntimeEngine 会在未配置时使用 app-server 作为后备值", () => {
  assert.equal(resolveRuntimeEngine(undefined, "app-server"), "app-server");
});

test("resolveRuntimeEngine 会忽略非法配置并回退到 sdk", () => {
  assert.equal(resolveRuntimeEngine("bad-value", "sdk"), "sdk");
});
