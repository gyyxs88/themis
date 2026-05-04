import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFormalSourceEditGuardPromptSection,
  buildFormalSourceEditGuardPromptSectionIfNeeded,
  shouldEnableFormalSourceEditGuard,
} from "./formal-source-edit-guard.js";

test("shouldEnableFormalSourceEditGuard 会识别正式服务 checkout", () => {
  assert.equal(
    shouldEnableFormalSourceEditGuard("/home/abner/services/themis-prod", {}),
    true,
  );
  assert.equal(
    shouldEnableFormalSourceEditGuard("/home/leyi/projects/themis", {}),
    false,
  );
});

test("shouldEnableFormalSourceEditGuard 支持显式环境变量开关", () => {
  assert.equal(
    shouldEnableFormalSourceEditGuard("/home/leyi/projects/themis", {
      THEMIS_SOURCE_EDIT_POLICY: "todoist-task",
    }),
    true,
  );
  assert.equal(
    shouldEnableFormalSourceEditGuard("/home/abner/services/themis-prod", {
      THEMIS_SOURCE_EDIT_POLICY: "off",
    }),
    false,
  );
  assert.equal(
    shouldEnableFormalSourceEditGuard("/tmp/themis", {
      THEMIS_UPDATE_SYSTEMD_SERVICE: "themis-prod.service",
    }),
    true,
  );
});

test("buildFormalSourceEditGuardPromptSection 明确要求源码修改转 Todoist", () => {
  const section = buildFormalSourceEditGuardPromptSection({
    workingDirectory: "/home/abner/services/themis-prod",
    serviceName: "themis-prod.service",
  });

  assert.match(section, /Formal production source modification guard/);
  assert.match(section, /Do not create, modify, delete, or generate repository source files/);
  assert.match(section, /create a Todoist task instead of applying the patch/);
  assert.match(section, /User phrases such as 'continue'/);
});

test("buildFormalSourceEditGuardPromptSectionIfNeeded 非正式 checkout 不注入", () => {
  assert.equal(
    buildFormalSourceEditGuardPromptSectionIfNeeded("/home/leyi/projects/themis", {}),
    null,
  );
});
