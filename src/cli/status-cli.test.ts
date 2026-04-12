import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const cliEntryPath = resolve(repoRoot, "src/cli/main.ts");
const tsxBinaryPath = resolve(repoRoot, "node_modules/.bin/tsx");
const CURRENT_COMMIT = "1111111111111111111111111111111111111111";
const LATEST_COMMIT = "2222222222222222222222222222222222222222";

function runCliWithEnv(
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsxBinaryPath, [cliEntryPath, ...args], {
      cwd,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`CLI 超时：${args.join(" ")}`));
    }, 15000);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.once("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

test("themis status 会输出 GitHub 检查更新结果", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-status-cli-"));
  let server: ReturnType<typeof createServer> | null = null;

  try {
    mkdirSync(resolve(workspace, "infra", "local"), { recursive: true });
    writeFileSync(resolve(workspace, "package.json"), JSON.stringify({
      name: "themis-status-cli-test",
      version: "9.9.9",
      type: "module",
    }, null, 2));

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/repos/gyyxs88/themis") {
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify({
          default_branch: "main",
          html_url: "https://github.com/gyyxs88/themis",
        }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/repos/gyyxs88/themis/commits/main") {
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify({
          sha: LATEST_COMMIT,
          html_url: `https://github.com/gyyxs88/themis/commit/${LATEST_COMMIT}`,
          commit: {
            author: {
              date: "2026-04-09T04:20:00Z",
            },
          },
        }));
        return;
      }

      if (req.method === "GET" && url.pathname === `/repos/gyyxs88/themis/compare/${CURRENT_COMMIT}...${LATEST_COMMIT}`) {
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify({
          status: "behind",
        }));
        return;
      }

      res.writeHead(404, {
        "content-type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify({
        message: "not found",
      }));
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("test server failed to bind");
    }

    const result = await runCliWithEnv(["status"], workspace, {
      THEMIS_BUILD_COMMIT: CURRENT_COMMIT,
      THEMIS_BUILD_BRANCH: "prod/main",
      THEMIS_UPDATE_API_BASE_URL: `http://127.0.0.1:${address.port}`,
      THEMIS_UPDATE_REPO: "gyyxs88/themis",
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Themis 配置状态/);
    assert.match(result.stdout, /版本更新/);
    assert.match(result.stdout, /- package\.json 版本：9\.9\.9/);
    assert.match(result.stdout, /- 更新渠道：GitHub 默认分支/);
    assert.match(result.stdout, /- 当前提交：1111111 \(THEMIS_BUILD_COMMIT\)/);
    assert.match(result.stdout, /- 当前分支：prod\/main/);
    assert.match(result.stdout, /- 更新源：gyyxs88\/themis/);
    assert.match(result.stdout, /- 更新源默认分支：main/);
    assert.match(result.stdout, /- GitHub 最新提交：2222222 \(2026-04-09T04:20:00Z\)/);
    assert.match(result.stdout, /- 对比结果：behind/);
    assert.match(result.stdout, /- 判断：发现 GitHub 新提交，可安排升级。/);
    assert.match(result.stdout, /\.\/themis update apply/);
  } finally {
    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.unref();
      server.close();
    }

    rmSync(workspace, { recursive: true, force: true });
  }
});
