import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ThemisUpdateService,
  readThemisManagedUpdateOperation,
  readThemisRestartRequestMarker,
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

test("ThemisUpdateService.requestRestart 会按受控重启计划请求 systemd 重启", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-update-restart-"));
  const calls: Array<{ serviceUnit: string; workingDirectory: string }> = [];

  try {
    const service = new ThemisUpdateService({
      workingDirectory: root,
      resolveRestartPlan: () => ({
        mode: "restart",
        serviceUnit: "themis-prod.service",
        message: "重启 systemd --user 服务 themis-prod.service。",
      }),
      requestRestartProcess: async (plan, input) => {
        if (plan.mode === "restart" && plan.serviceUnit) {
          calls.push({
            serviceUnit: plan.serviceUnit,
            workingDirectory: input.workingDirectory,
          });
        }
      },
    });

    const prepared = service.prepareRestart();
    assert.deepEqual(prepared, {
      serviceUnit: "themis-prod.service",
      message: "重启 systemd --user 服务 themis-prod.service。",
    });

    const result = await service.requestRestart();
    assert.deepEqual(result, prepared);
    assert.deepEqual(calls, [{
      serviceUnit: "themis-prod.service",
      workingDirectory: root,
    }]);

    const marker = readThemisRestartRequestMarker(root);
    assert.equal(marker?.status, "requested");
    assert.equal(marker?.reason, "ops_restart");
    assert.equal(marker?.serviceUnit, "themis-prod.service");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ThemisUpdateService.acknowledgeRestartRequest 会在新进程启动后确认 marker", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-update-restart-ack-"));

  try {
    const service = new ThemisUpdateService({
      workingDirectory: root,
      env: {
        ...process.env,
        THEMIS_BUILD_COMMIT: "111111122222223333333444444455555556666",
      },
      processStartedAt: "2026-04-24T03:00:00.000Z",
      now: () => new Date("2026-04-24T03:10:00.000Z"),
      resolveRestartPlan: () => ({
        mode: "restart",
        serviceUnit: "themis-prod.service",
        message: "重启 systemd --user 服务 themis-prod.service。",
      }),
      requestRestartProcess: async () => {},
    });

    await service.requestRestart();
    assert.equal(readThemisRestartRequestMarker(root)?.status, "requested");

    const restartedService = new ThemisUpdateService({
      workingDirectory: root,
      env: {
        ...process.env,
        THEMIS_BUILD_COMMIT: "111111122222223333333444444455555556666",
      },
      processStartedAt: "2026-04-24T03:11:00.000Z",
      now: () => new Date("2026-04-24T03:11:05.000Z"),
    });

    const marker = restartedService.acknowledgeRestartRequest();
    assert.equal(marker?.status, "confirmed");
    assert.equal(marker?.confirmedAt, "2026-04-24T03:11:05.000Z");
    assert.equal(marker?.confirmedCommit, "111111122222223333333444444455555556666");
    assert.equal(marker?.confirmedProcessStartedAt, "2026-04-24T03:11:00.000Z");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ThemisUpdateService.readOpsStatus 会读取服务状态和重启 marker", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-update-ops-status-"));

  try {
    const service = new ThemisUpdateService({
      workingDirectory: root,
      env: {
        ...process.env,
        THEMIS_BUILD_COMMIT: "222222233333334444444555555566666667777",
        THEMIS_BUILD_BRANCH: "main",
      },
      processStartedAt: "2026-04-24T03:00:00.000Z",
      now: () => new Date("2026-04-24T03:10:00.000Z"),
      resolveRestartPlan: () => ({
        mode: "restart",
        serviceUnit: "themis-prod.service",
        message: "重启 systemd --user 服务 themis-prod.service。",
      }),
      readServiceStatus: ({ serviceUnit }) => ({
        serviceUnit,
        loadState: "loaded",
        activeState: "active",
        subState: "running",
        mainPid: 4321,
        execMainStartTimestamp: "Fri 2026-04-24 11:00:00 CST",
        errorMessage: null,
      }),
      requestRestartProcess: async () => {},
    });

    await service.requestRestart();
    const status = service.readOpsStatus();

    assert.equal(status.currentCommit, "222222233333334444444555555566666667777");
    assert.equal(status.currentCommitSource, "env");
    assert.equal(status.currentBranch, "main");
    assert.equal(status.serviceUnit, "themis-prod.service");
    assert.equal(status.serviceStatus?.activeState, "active");
    assert.equal(status.restartRequest?.status, "requested");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
