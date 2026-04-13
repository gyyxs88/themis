import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const scriptPath = resolve(__dirname, "bootstrap-split-repos.sh");

test("bootstrap-split-repos.sh 会初始化四个拆仓 sibling repo 骨架", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "themis-split-bootstrap-"));
  const targetRoot = join(tempRoot, "repos");

  try {
    const result = spawnSync("bash", [scriptPath, targetRoot], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);

    assertRepoSkeleton(targetRoot, "themis-platform", "themis-platform", "src/server/platform-main.ts");
    assertRepoSkeleton(targetRoot, "themis-main", "themis-main", "src/server/main.ts");
    assertRepoSkeleton(targetRoot, "themis-worker-node", "themis-worker-node", "src/cli/worker-node-main.ts");
    assertRepoSkeleton(targetRoot, "themis-contracts", "themis-contracts", "src/index.ts");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("bootstrap-split-repos.sh 遇到非空目标目录会拒绝覆盖", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "themis-split-bootstrap-"));
  const targetRoot = join(tempRoot, "repos");
  const existingRepoRoot = join(targetRoot, "themis-platform");

  mkdirSync(existingRepoRoot, { recursive: true });
  writeFileSync(join(existingRepoRoot, "README.md"), "existing\n");

  try {
    const result = spawnSync("bash", [scriptPath, targetRoot], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /非空|refuse|拒绝/i);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

function assertRepoSkeleton(targetRoot: string, repoName: string, expectedPackageName: string, entrypoint: string): void {
  const repoRoot = join(targetRoot, repoName);
  assert.equal(existsSync(repoRoot), true, `${repoName} 未创建`);
  assert.equal(existsSync(join(repoRoot, ".git")), true, `${repoName} 未初始化 git`);
  assert.equal(existsSync(join(repoRoot, "README.md")), true, `${repoName} 缺少 README.md`);
  assert.equal(existsSync(join(repoRoot, ".gitignore")), true, `${repoName} 缺少 .gitignore`);
  assert.equal(existsSync(join(repoRoot, "tsconfig.json")), true, `${repoName} 缺少 tsconfig.json`);
  assert.equal(existsSync(join(repoRoot, entrypoint)), true, `${repoName} 缺少入口文件 ${entrypoint}`);
  assert.equal(existsSync(join(repoRoot, ".github/workflows/ci.yml")), true, `${repoName} 缺少 CI workflow`);

  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    name?: string;
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.name, expectedPackageName);
  assert.equal(typeof packageJson.scripts?.typecheck, "string");
  assert.equal(typeof packageJson.scripts?.build, "string");
}
