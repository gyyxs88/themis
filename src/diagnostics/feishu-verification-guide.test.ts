import assert from "node:assert/strict";
import test from "node:test";
import {
  FEISHU_FIXED_VERIFICATION_MATRIX,
  FEISHU_RERUN_SEQUENCE,
  buildFeishuSmokeNextSteps,
} from "./feishu-verification-guide.js";

test("飞书复验指引会固定关键路径与复跑顺序", () => {
  assert.deepEqual(
    FEISHU_FIXED_VERIFICATION_MATRIX.map((item) => item.id),
    [
      "direct_text_takeover",
      "mixed_recovery",
      "session_rebind",
      "duplicate_or_stale_ignore",
      "diagnostic_failure_branches",
    ],
  );

  assert.deepEqual(FEISHU_RERUN_SEQUENCE, [
    "./themis doctor feishu",
    "./themis doctor smoke web",
    "./themis doctor smoke feishu",
  ]);

  assert.deepEqual(buildFeishuSmokeNextSteps(), [
    "建议先运行：./themis doctor feishu",
    "再运行：./themis doctor smoke web",
    "最后运行：./themis doctor smoke feishu，并按文档里的 A/B 手工路径继续接力。",
  ]);
});
