import assert from "node:assert/strict";
import test from "node:test";
import { createTaskActivityTimeoutController } from "./task-activity-timeout.js";

test("TaskActivityTimeoutController 会按最近一次活动续期，而不是按总时长硬超时", {
  timeout: 400,
}, async () => {
  const controller = createTaskActivityTimeoutController(undefined, 20);

  try {
    await delay(10);
    controller.touch();
    await delay(15);
    controller.touch();
    await delay(15);

    assert.equal(controller.signal.aborted, false);

    await delay(10);
    assert.equal(controller.signal.aborted, true);
    assert.match(String(controller.signal.reason), /TASK_TIMEOUT:20/);
  } finally {
    controller.cleanup();
  }
});

test("TaskActivityTimeoutController.wrap 会在静默超时后打断卡住的异步操作", {
  timeout: 400,
}, async () => {
  const controller = createTaskActivityTimeoutController(undefined, 20);

  try {
    await assert.rejects(
      async () => await controller.wrap(new Promise<void>(() => {})),
      /TASK_TIMEOUT:20/,
    );
  } finally {
    controller.cleanup();
  }
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
