import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkThemisUpdates, formatShortCommitHash } from "./update-check.js";

const CURRENT_COMMIT = "1111111111111111111111111111111111111111";
const LATEST_COMMIT = "2222222222222222222222222222222222222222";

test("checkThemisUpdates 会在当前提交落后时返回 update_available", async () => {
  const requests: string[] = [];
  const result = await checkThemisUpdates({
    workingDirectory: process.cwd(),
    env: {
      ...process.env,
      THEMIS_BUILD_COMMIT: CURRENT_COMMIT,
      THEMIS_BUILD_BRANCH: "main",
      THEMIS_UPDATE_REPO: "gyyxs88/themis",
      THEMIS_UPDATE_API_BASE_URL: "https://updates.example.test",
    },
    fetchImpl: async (input) => {
      const url = String(input);
      requests.push(url);

      if (url === "https://updates.example.test/repos/gyyxs88/themis/commits/main") {
        return new Response(JSON.stringify({
          sha: LATEST_COMMIT,
          html_url: `https://github.com/gyyxs88/themis/commit/${LATEST_COMMIT}`,
          commit: {
            author: {
              date: "2026-04-09T04:20:00Z",
            },
          },
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      if (url === `https://updates.example.test/repos/gyyxs88/themis/compare/${CURRENT_COMMIT}...${LATEST_COMMIT}`) {
        return new Response(JSON.stringify({
          status: "behind",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      throw new Error(`unexpected request: ${url}`);
    },
  });

  assert.equal(result.outcome, "update_available");
  assert.equal(result.comparisonStatus, "behind");
  assert.equal(result.currentCommit, CURRENT_COMMIT);
  assert.equal(result.latestCommit, LATEST_COMMIT);
  assert.equal(result.currentCommitSource, "env");
  assert.equal(result.summary, "发现 GitHub 新提交，可安排升级。");
  assert.deepEqual(requests, [
    "https://updates.example.test/repos/gyyxs88/themis/commits/main",
    `https://updates.example.test/repos/gyyxs88/themis/compare/${CURRENT_COMMIT}...${LATEST_COMMIT}`,
  ]);
});

test("checkThemisUpdates 会在当前提交已追平时返回 up_to_date", async () => {
  const result = await checkThemisUpdates({
    workingDirectory: process.cwd(),
    env: {
      ...process.env,
      THEMIS_BUILD_COMMIT: LATEST_COMMIT,
      THEMIS_UPDATE_REPO: "https://github.com/gyyxs88/themis",
      THEMIS_UPDATE_API_BASE_URL: "https://updates.example.test",
    },
    fetchImpl: async (input) => {
      const url = String(input);

      if (url === "https://updates.example.test/repos/gyyxs88/themis/commits/main") {
        return new Response(JSON.stringify({
          sha: LATEST_COMMIT,
          html_url: `https://github.com/gyyxs88/themis/commit/${LATEST_COMMIT}`,
          commit: {
            author: {
              date: "2026-04-09T04:20:00Z",
            },
          },
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      throw new Error(`unexpected request: ${url}`);
    },
  });

  assert.equal(result.outcome, "up_to_date");
  assert.equal(result.comparisonStatus, "identical");
  assert.equal(result.summary, "当前已经是 GitHub 默认分支的最新提交。");
});

test("checkThemisUpdates 会在没有当前提交时返回 comparison_unavailable", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-update-check-"));

  try {
    const result = await checkThemisUpdates({
      workingDirectory: workspace,
      env: {
        ...process.env,
        THEMIS_UPDATE_REPO: "git@github.com:gyyxs88/themis.git",
        THEMIS_UPDATE_API_BASE_URL: "https://updates.example.test",
        THEMIS_BUILD_COMMIT: "",
      },
      fetchImpl: async (input) => {
        const url = String(input);

        if (url === "https://updates.example.test/repos/gyyxs88/themis/commits/main") {
          return new Response(JSON.stringify({
            sha: LATEST_COMMIT,
            html_url: `https://github.com/gyyxs88/themis/commit/${LATEST_COMMIT}`,
          }), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          });
        }

        throw new Error(`unexpected request: ${url}`);
      },
    });

    assert.equal(result.outcome, "comparison_unavailable");
    assert.equal(result.currentCommit, null);
    assert.equal(result.summary, "已读到 GitHub 最新提交，但当前实例没有可比较的本地提交。");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("formatShortCommitHash 会缩短 SHA 并兼容空值", () => {
  assert.equal(formatShortCommitHash(LATEST_COMMIT), "2222222");
  assert.equal(formatShortCommitHash(null), "未检测到");
});
