import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
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
): {
  code: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(tsxBinaryPath, [cliEntryPath, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      ...extraEnv,
    },
  });

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runCliAsyncWithEnv(
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const spawned = spawn(tsxBinaryPath, [cliEntryPath, ...args], {
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
      spawned.kill("SIGKILL");
      reject(new Error(`CLI 超时：${args.join(" ")}`));
    }, 15000);

    spawned.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    spawned.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    spawned.once("error", (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    spawned.once("close", (code: number | null) => {
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

function createUpdateWorkspace(input: {
  dirty?: boolean;
  relation?: "behind" | "ahead" | "diverged" | "identical";
  serviceExists?: boolean;
  updateChannel?: "branch" | "release";
  releaseTag?: string;
} = {}): {
  workspace: string;
  stateDir: string;
  binDir: string;
  envPath: string;
  commandsLogPath: string;
} {
  const workspace = mkdtempSync(join(tmpdir(), "themis-update-cli-"));
  const stateDir = resolve(workspace, "temp", "fake-update-state");
  const binDir = resolve(workspace, "temp", "fake-bin");
  const envPath = resolve(workspace, ".env.local");
  const commandsLogPath = resolve(stateDir, "commands.log");

  mkdirSync(resolve(workspace, "infra", "local"), { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  writeFileSync(resolve(workspace, "package.json"), JSON.stringify({
    name: "themis-update-cli-test",
    version: "0.1.0",
    type: "module",
  }, null, 2));
  writeFileSync(resolve(workspace, "package-lock.json"), JSON.stringify({
    name: "themis-update-cli-test",
    lockfileVersion: 3,
  }, null, 2));
  writeFileSync(envPath, [
    `THEMIS_BUILD_COMMIT=${CURRENT_COMMIT}`,
    "THEMIS_BUILD_BRANCH=main",
    "THEMIS_UPDATE_REPO=gyyxs88/themis",
    `THEMIS_UPDATE_CHANNEL=${input.updateChannel ?? "branch"}`,
    "THEMIS_UPDATE_DEFAULT_BRANCH=main",
    "THEMIS_UPDATE_SYSTEMD_SERVICE=themis-prod.service",
    "",
  ].join("\n"), "utf8");

  writeStateFile(stateDir, "current_commit", CURRENT_COMMIT);
  writeStateFile(stateDir, "remote_commit", LATEST_COMMIT);
  writeStateFile(stateDir, "current_branch", "main");
  writeStateFile(stateDir, "origin_url", "git@github.com:gyyxs88/themis.git");
  writeStateFile(stateDir, "release_tag", input.releaseTag ?? "v0.2.0");
  writeStateFile(stateDir, "dirty", input.dirty ? "1" : "0");
  writeStateFile(stateDir, "relation", input.relation ?? "behind");
  writeStateFile(stateDir, "service_exists", input.serviceExists === false ? "0" : "1");
  writeFileSync(commandsLogPath, "", "utf8");

  writeFakeExecutable(binDir, "git", buildFakeGitScript());
  writeFakeExecutable(binDir, "npm", buildFakeNpmScript());
  writeFakeExecutable(binDir, "systemctl", buildFakeSystemctlScript());

  return {
    workspace,
    stateDir,
    binDir,
    envPath,
    commandsLogPath,
  };
}

function writeLastUpdateRecord(workspace: string, input: {
  previousCommit: string;
  currentCommit: string;
  branch?: string;
  updateChannel?: "branch" | "release";
  appliedReleaseTag?: string | null;
}): void {
  writeFileSync(resolve(workspace, "infra", "local", "themis-last-update.json"), JSON.stringify({
    previousCommit: input.previousCommit,
    currentCommit: input.currentCommit,
    branch: input.branch ?? "main",
    updateChannel: input.updateChannel ?? "branch",
    appliedReleaseTag: input.appliedReleaseTag ?? null,
    recordedAt: "2026-04-11T14:05:00.000Z",
  }, null, 2));
}

function writeStateFile(stateDir: string, name: string, value: string): void {
  writeFileSync(resolve(stateDir, name), value, "utf8");
}

function readStateFile(stateDir: string, name: string): string {
  return readFileSync(resolve(stateDir, name), "utf8").trim();
}

function writeFakeExecutable(binDir: string, name: string, content: string): void {
  const filePath = resolve(binDir, name);
  writeFileSync(filePath, content, "utf8");
  chmodSync(filePath, 0o755);
}

function buildFakeGitScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="\${THEMIS_FAKE_UPDATE_STATE_DIR:?}"
echo "git $*" >> "\${STATE_DIR}/commands.log"

read_file() {
  cat "\${STATE_DIR}/$1"
}

current_commit="$(read_file current_commit)"
remote_commit="$(read_file remote_commit)"
current_branch="$(read_file current_branch)"
origin_url="$(read_file origin_url)"
release_tag="$(read_file release_tag)"
dirty="$(read_file dirty)"
relation="$(read_file relation)"

if [ "\${1-}" = "--version" ]; then
  echo "git version 2.47.0"
  exit 0
fi

if [ "\${1-}" = "rev-parse" ] && [ "\${2-}" = "--git-dir" ]; then
  echo ".git"
  exit 0
fi

if [ "\${1-}" = "rev-parse" ] && [ "\${2-}" = "HEAD" ]; then
  echo "\${current_commit}"
  exit 0
fi

if [ "\${1-}" = "rev-parse" ] && [ "\${2-}" = "--abbrev-ref" ] && [ "\${3-}" = "HEAD" ]; then
  echo "\${current_branch}"
  exit 0
fi

if [ "\${1-}" = "remote" ] && [ "\${2-}" = "get-url" ] && [ "\${3-}" = "origin" ]; then
  echo "\${origin_url}"
  exit 0
fi

if [ "\${1-}" = "status" ] && [ "\${2-}" = "--porcelain" ]; then
  if [ "\${dirty}" = "1" ]; then
    echo " M README.md"
  fi
  exit 0
fi

if [ "\${1-}" = "fetch" ] && [ "\${2-}" = "origin" ] && [ "\${3-}" = "main" ]; then
  exit 0
fi

if [ "\${1-}" = "fetch" ] && [ "\${2-}" = "origin" ] && [ "\${3-}" = "tag" ] && [ "\${4-}" = "\${release_tag}" ]; then
  exit 0
fi

if [ "\${1-}" = "rev-parse" ] && [ "\${2-}" = "origin/main" ]; then
  echo "\${remote_commit}"
  exit 0
fi

if [ "\${1-}" = "rev-parse" ] && [ "\${2-}" = "\${release_tag}^{commit}" ]; then
  echo "\${remote_commit}"
  exit 0
fi

if [ "\${1-}" = "rev-parse" ] && [[ "\${2-}" == *"^{commit}" ]]; then
  ref_without_suffix="\${2-%^{commit}}"
  echo "\${ref_without_suffix}"
  exit 0
fi

if [ "\${1-}" = "merge-base" ] && [ "\${2-}" = "--is-ancestor" ]; then
  first="\${3-}"
  second="\${4-}"
  case "\${relation}" in
    behind)
      if [ "\${first}" = "\${current_commit}" ] && [ "\${second}" = "\${remote_commit}" ]; then
        exit 0
      fi
      exit 1
      ;;
    ahead)
      if [ "\${first}" = "\${remote_commit}" ] && [ "\${second}" = "\${current_commit}" ]; then
        exit 0
      fi
      exit 1
      ;;
    identical)
      if [ "\${first}" = "\${current_commit}" ] && [ "\${second}" = "\${remote_commit}" ]; then
        exit 0
      fi
      if [ "\${first}" = "\${remote_commit}" ] && [ "\${second}" = "\${current_commit}" ]; then
        exit 0
      fi
      exit 1
      ;;
    diverged)
      exit 1
      ;;
  esac
fi

if [ "\${1-}" = "pull" ] && [ "\${2-}" = "--ff-only" ] && [ "\${3-}" = "origin" ] && [ "\${4-}" = "main" ]; then
  printf '%s' "\${remote_commit}" > "\${STATE_DIR}/current_commit"
  exit 0
fi

if [ "\${1-}" = "merge" ] && [ "\${2-}" = "--ff-only" ] && [ "\${3-}" = "\${remote_commit}" ]; then
  printf '%s' "\${remote_commit}" > "\${STATE_DIR}/current_commit"
  exit 0
fi

if [ "\${1-}" = "reset" ] && [ "\${2-}" = "--hard" ]; then
  printf '%s' "\${3-}" > "\${STATE_DIR}/current_commit"
  exit 0
fi

echo "unsupported git args: $*" >&2
exit 64
`;
}

function buildFakeNpmScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="\${THEMIS_FAKE_UPDATE_STATE_DIR:?}"
echo "npm $*" >> "\${STATE_DIR}/commands.log"

if [ "\${1-}" = "--version" ]; then
  echo "10.9.7"
  exit 0
fi

if [ "\${1-}" = "ci" ]; then
  exit 0
fi

if [ "\${1-}" = "run" ] && [ "\${2-}" = "build" ]; then
  exit 0
fi

echo "unsupported npm args: $*" >&2
exit 64
`;
}

function buildFakeSystemctlScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="\${THEMIS_FAKE_UPDATE_STATE_DIR:?}"
echo "systemctl $*" >> "\${STATE_DIR}/commands.log"
service_exists="$(cat "\${STATE_DIR}/service_exists")"

if [ "\${1-}" = "--user" ] && [ "\${2-}" = "show" ] && [ "\${3-}" = "--property" ] && [ "\${4-}" = "LoadState" ] && [ "\${5-}" = "--value" ]; then
  if [ "\${service_exists}" = "1" ]; then
    echo "loaded"
  else
    echo "not-found"
  fi
  exit 0
fi

if [ "\${1-}" = "--user" ] && [ "\${2-}" = "restart" ]; then
  if [ "\${service_exists}" != "1" ]; then
    echo "service not found" >&2
    exit 4
  fi
  printf '%s' "\${3-}" > "\${STATE_DIR}/restarted_service"
  exit 0
fi

echo "unsupported systemctl args: $*" >&2
exit 64
`;
}

test("themis update apply 会按顺序完成 ff-only 升级并回写构建提交", () => {
  const fixture = createUpdateWorkspace();

  try {
    const result = runCliWithEnv(["update", "apply"], fixture.workspace, {
      PATH: `${fixture.binDir}:${process.env.PATH ?? ""}`,
      THEMIS_FAKE_UPDATE_STATE_DIR: fixture.stateDir,
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Themis 受控升级/);
    assert.match(result.stdout, /检查当前仓库是否满足受控升级前提/);
    assert.match(result.stdout, /执行 npm ci 安装依赖/);
    assert.match(result.stdout, /执行 npm run build 编译产物/);
    assert.match(result.stdout, /重启 systemd --user 服务 themis-prod\.service/);
    assert.match(result.stdout, /升级前提交：1111111/);
    assert.match(result.stdout, /升级后提交：2222222/);
    assert.match(result.stdout, /\.env\.local 构建提交回写：已完成/);
    assert.match(result.stdout, /systemd 自动重启：已重启 themis-prod\.service/);

    assert.equal(readStateFile(fixture.stateDir, "current_commit"), LATEST_COMMIT);
    assert.equal(readStateFile(fixture.stateDir, "restarted_service"), "themis-prod.service");
    assert.match(readFileSync(fixture.envPath, "utf8"), new RegExp(`THEMIS_BUILD_COMMIT=${LATEST_COMMIT}`));
    assert.match(readFileSync(fixture.envPath, "utf8"), /THEMIS_BUILD_BRANCH=main/);

    const commands = readFileSync(fixture.commandsLogPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
    assert.deepEqual(commands, [
      "git --version",
      "npm --version",
      "git rev-parse --git-dir",
      "git rev-parse --abbrev-ref HEAD",
      "git rev-parse HEAD",
      "git remote get-url origin",
      "git status --porcelain",
      "git fetch origin main",
      "git rev-parse origin/main",
      `git merge-base --is-ancestor ${CURRENT_COMMIT} ${LATEST_COMMIT}`,
      `git merge-base --is-ancestor ${LATEST_COMMIT} ${CURRENT_COMMIT}`,
      "git pull --ff-only origin main",
      "npm ci --include=dev",
      "npm run build",
      "git rev-parse HEAD",
      "systemctl --user show --property LoadState --value themis-prod.service",
      "systemctl --user restart themis-prod.service",
    ]);
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true });
  }
});

test("themis update apply 遇到脏工作区会拒绝继续", () => {
  const fixture = createUpdateWorkspace({ dirty: true });

  try {
    const result = runCliWithEnv(["update", "apply"], fixture.workspace, {
      PATH: `${fixture.binDir}:${process.env.PATH ?? ""}`,
      THEMIS_FAKE_UPDATE_STATE_DIR: fixture.stateDir,
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /当前工作区有未提交改动/);
    const commands = readFileSync(fixture.commandsLogPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
    assert.ok(commands.includes("git status --porcelain"));
    assert.equal(commands.some((line) => line === "git pull --ff-only origin main"), false);
    assert.equal(commands.some((line) => line === "npm ci --include=dev"), false);
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true });
  }
});

test("themis update worker apply 能接受 Web 后台升级元信息参数", () => {
  const fixture = createUpdateWorkspace();

  try {
    const result = runCliWithEnv([
      "update",
      "worker",
      "apply",
      "--channel",
      "web",
      "--user",
      "themis-web-owner",
      "--name",
      "Themis Web",
      "--chat",
      "oc_test_chat",
      "--no-restart",
    ], fixture.workspace, {
      PATH: `${fixture.binDir}:${process.env.PATH ?? ""}`,
      THEMIS_FAKE_UPDATE_STATE_DIR: fixture.stateDir,
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const operation = JSON.parse(readFileSync(
      resolve(fixture.workspace, "infra", "local", "themis-update-operation.json"),
      "utf8",
    )) as {
      action: string;
      status: string;
      progressStep: string;
      initiatedBy: {
        channel: string;
        channelUserId: string;
        displayName?: string;
        chatId?: string;
      };
      result: {
        restartStatus: string;
      };
    };

    assert.equal(operation.action, "apply");
    assert.equal(operation.status, "completed");
    assert.equal(operation.progressStep, "done");
    assert.equal(operation.initiatedBy.channel, "web");
    assert.equal(operation.initiatedBy.channelUserId, "themis-web-owner");
    assert.equal(operation.initiatedBy.displayName, "Themis Web");
    assert.equal(operation.initiatedBy.chatId, "oc_test_chat");
    assert.equal(operation.result.restartStatus, "skipped");

    const commands = readFileSync(fixture.commandsLogPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
    assert.equal(commands.some((line) => line === "systemctl --user restart themis-prod.service"), false);
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true });
  }
});

test("themis update bad-subcommand 会提示支持的子命令", () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-update-cli-invalid-"));

  try {
    const result = runCliWithEnv(["update", "bad"], workspace);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /update 子命令仅支持 check \/ apply/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis update apply 在 release 渠道下会对齐到 latest release tag 对应提交", async () => {
  const fixture = createUpdateWorkspace({
    updateChannel: "release",
    releaseTag: "v0.2.0",
  });
  let server: ReturnType<typeof createServer> | null = null;

  try {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/repos/gyyxs88/themis/releases/latest") {
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify({
          tag_name: "v0.2.0",
          name: "Themis 0.2.0",
          html_url: "https://github.com/gyyxs88/themis/releases/tag/v0.2.0",
          published_at: "2026-04-10T08:00:00Z",
        }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/repos/gyyxs88/themis/commits/v0.2.0") {
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

    const result = await runCliAsyncWithEnv(["update", "apply"], fixture.workspace, {
      PATH: `${fixture.binDir}:${process.env.PATH ?? ""}`,
      THEMIS_FAKE_UPDATE_STATE_DIR: fixture.stateDir,
      THEMIS_UPDATE_API_BASE_URL: `http://127.0.0.1:${address.port}`,
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /更新渠道：GitHub latest release/);
    assert.match(result.stdout, /从 origin 拉取 release tag v0\.2\.0/);
    assert.match(result.stdout, /执行 git merge --ff-only v0\.2\.0 对齐到最新正式 release/);
    assert.match(result.stdout, /对齐 release：v0\.2\.0/);
    assert.equal(readStateFile(fixture.stateDir, "current_commit"), LATEST_COMMIT);

    const commands = readFileSync(fixture.commandsLogPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
    assert.deepEqual(commands, [
      "git --version",
      "npm --version",
      "git rev-parse --git-dir",
      "git rev-parse --abbrev-ref HEAD",
      "git rev-parse HEAD",
      "git remote get-url origin",
      "git status --porcelain",
      "git fetch origin tag v0.2.0",
      "git rev-parse v0.2.0^{commit}",
      `git merge-base --is-ancestor ${CURRENT_COMMIT} ${LATEST_COMMIT}`,
      `git merge-base --is-ancestor ${LATEST_COMMIT} ${CURRENT_COMMIT}`,
      `git merge --ff-only ${LATEST_COMMIT}`,
      "npm ci --include=dev",
      "npm run build",
      "git rev-parse HEAD",
      "systemctl --user show --property LoadState --value themis-prod.service",
      "systemctl --user restart themis-prod.service",
    ]);
  } finally {
    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.unref();
      server.close();
    }

    rmSync(fixture.workspace, { recursive: true, force: true });
  }
});

test("themis update rollback 会回退最近一次成功升级并清理记录", async () => {
  const fixture = createUpdateWorkspace();
  const lastUpdatePath = resolve(fixture.workspace, "infra", "local", "themis-last-update.json");

  try {
    writeStateFile(fixture.stateDir, "current_commit", LATEST_COMMIT);
    writeLastUpdateRecord(fixture.workspace, {
      previousCommit: CURRENT_COMMIT,
      currentCommit: LATEST_COMMIT,
      updateChannel: "release",
      appliedReleaseTag: "v0.2.0",
    });

    const result = await runCliAsyncWithEnv(["update", "rollback"], fixture.workspace, {
      PATH: `${fixture.binDir}:${process.env.PATH ?? ""}`,
      THEMIS_FAKE_UPDATE_STATE_DIR: fixture.stateDir,
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Themis 受控回滚/);
    assert.match(result.stdout, /执行 git reset --hard 1111111 回退到最近一次升级前提交/);
    assert.match(result.stdout, /回滚前提交：2222222/);
    assert.match(result.stdout, /回滚后提交：1111111/);
    assert.match(result.stdout, /回退来源 release：v0\.2\.0/);
    assert.equal(readStateFile(fixture.stateDir, "current_commit"), CURRENT_COMMIT);
    assert.equal(existsSync(lastUpdatePath), false);

    const commands = readFileSync(fixture.commandsLogPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
    assert.deepEqual(commands, [
      "git --version",
      "npm --version",
      "git rev-parse --git-dir",
      "git rev-parse --abbrev-ref HEAD",
      "git rev-parse HEAD",
      "git status --porcelain",
      `git rev-parse ${CURRENT_COMMIT}^{commit}`,
      `git reset --hard ${CURRENT_COMMIT}`,
      "npm ci --include=dev",
      "npm run build",
      "systemctl --user show --property LoadState --value themis-prod.service",
      "systemctl --user restart themis-prod.service",
    ]);
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true });
  }
});
