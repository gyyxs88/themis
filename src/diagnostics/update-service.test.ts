import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ThemisUpdateService,
  readThemisManagedUpdateOperation,
  runManagedThemisUpdateWorker,
} from "./update-service.js";

test("runManagedThemisUpdateWorker 会把成功结果写入状态文件", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-update-worker-"));

  try {
    const result = await runManagedThemisUpdateWorker({
      action: "apply",
      workingDirectory: root,
      skipRestart: true,
      initiatedBy: {
        channel: "web",
        channelUserId: "owner-web",
      },
      applyImpl: async ({ onProgress }) => {
        onProgress?.({
          step: "fetch",
          message: "正在拉取远端提交。",
        });

        return {
          outcome: "updated",
          updateChannel: "branch",
          previousCommit: "111111122222223333333444444455555556666",
          currentCommit: "aaaaaaabbbbbbbcccccccdddddddeeeeeeeffff",
          targetCommit: "aaaaaaabbbbbbbcccccccdddddddeeeeeeeffff",
          branch: "main",
          restartedService: false,
          serviceUnit: null,
          buildMetadataUpdated: true,
          appliedReleaseTag: null,
        };
      },
    });

    assert.equal(result.status, "completed");
    assert.equal(result.result?.outcome, "updated");
    assert.equal(result.result?.restartStatus, "skipped");
    assert.match(result.result?.summary ?? "", /升级完成：1111111 -> aaaaaaa。/);

    const stored = readThemisManagedUpdateOperation(root);
    assert.equal(stored?.status, "completed");
    assert.equal(stored?.result?.currentCommit, "aaaaaaabbbbbbbcccccccdddddddeeeeeeeffff");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ThemisUpdateService.startApply 会写入 running 状态并启动后台 worker", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-update-service-"));
  const calls: Array<{ cliPath: string; args: string[] }> = [];

  try {
    const service = new ThemisUpdateService({
      workingDirectory: root,
      cliPath: "/tmp/themis",
      spawnWorkerProcess: async (cliPath, args) => {
        calls.push({ cliPath, args });
      },
    });

    const operation = await service.startApply({
      initiatedBy: {
        channel: "feishu",
        channelUserId: "user-1",
        displayName: "owner",
        chatId: "chat-1",
      },
    });

    assert.equal(operation.status, "running");
    assert.equal(operation.action, "apply");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.cliPath, "/tmp/themis");
    assert.deepEqual(calls[0]?.args, [
      "update",
      "worker",
      "apply",
      "--channel",
      "feishu",
      "--user",
      "user-1",
      "--name",
      "owner",
      "--chat",
      "chat-1",
    ]);

    const stored = readThemisManagedUpdateOperation(root);
    assert.equal(stored?.status, "running");
    assert.equal(stored?.initiatedBy.channel, "feishu");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
