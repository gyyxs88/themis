import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_UPDATE_REPO = "gyyxs88/themis";
const DEFAULT_UPDATE_DEFAULT_BRANCH = "main";
const DEFAULT_UPDATE_API_BASE_URL = "https://api.github.com";
const DEFAULT_UPDATE_TIMEOUT_MS = 15000;

export type ThemisUpdateOutcome =
  | "up_to_date"
  | "update_available"
  | "local_ahead"
  | "local_diverged"
  | "comparison_unavailable"
  | "check_failed";

export interface ThemisUpdateCheckResult {
  packageVersion: string | null;
  currentCommit: string | null;
  currentBranch: string | null;
  currentCommitSource: "git" | "env" | "unknown";
  updateSourceRepo: string;
  updateSourceUrl: string;
  updateSourceDefaultBranch: string | null;
  latestCommit: string | null;
  latestCommitDate: string | null;
  latestCommitUrl: string | null;
  comparisonStatus: string | null;
  outcome: ThemisUpdateOutcome;
  summary: string;
  errorMessage: string | null;
}

interface GitHubCommitPayload {
  sha?: unknown;
  html_url?: unknown;
  commit?: {
    author?: {
      date?: unknown;
    };
  };
}

interface GitHubComparePayload {
  status?: unknown;
}

export async function checkThemisUpdates(input: {
  workingDirectory: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<ThemisUpdateCheckResult> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const packageVersion = readPackageVersion(input.workingDirectory);
  const localBuild = readLocalBuildSnapshot(input.workingDirectory, env);
  const updateSourceRepo = normalizeRepoSlug(env.THEMIS_UPDATE_REPO);
  const updateSourceUrl = `https://github.com/${updateSourceRepo}`;
  const updateSourceDefaultBranch = normalizeDefaultBranch(env.THEMIS_UPDATE_DEFAULT_BRANCH);
  const apiBaseUrl = normalizeApiBaseUrl(env.THEMIS_UPDATE_API_BASE_URL);
  const requestHeaders = buildGitHubRequestHeaders(env);

  try {
    const latestCommit = await readGitHubJson<GitHubCommitPayload>({
      fetchImpl,
      url: buildGitHubApiUrl(apiBaseUrl, `/repos/${updateSourceRepo}/commits/${encodeURIComponent(updateSourceDefaultBranch)}`),
      headers: requestHeaders,
    });
    const latestCommitSha = normalizeOptionalText(latestCommit.sha);
    const latestCommitUrl = normalizeOptionalText(latestCommit.html_url);
    const latestCommitDate = normalizeOptionalText(latestCommit.commit?.author?.date);

    if (!latestCommitSha) {
      return {
        packageVersion,
        currentCommit: localBuild.commit,
        currentBranch: localBuild.branch,
        currentCommitSource: localBuild.source,
        updateSourceRepo,
        updateSourceUrl,
        updateSourceDefaultBranch,
        latestCommit: null,
        latestCommitDate,
        latestCommitUrl,
        comparisonStatus: null,
        outcome: "check_failed",
        summary: "GitHub 已响应，但没有返回最新提交 SHA。",
        errorMessage: "missing_latest_commit_sha",
      };
    }

    if (!localBuild.commit) {
      return {
        packageVersion,
        currentCommit: null,
        currentBranch: localBuild.branch,
        currentCommitSource: localBuild.source,
        updateSourceRepo,
        updateSourceUrl,
        updateSourceDefaultBranch,
        latestCommit: latestCommitSha,
        latestCommitDate,
        latestCommitUrl,
        comparisonStatus: null,
        outcome: "comparison_unavailable",
        summary: "已读到 GitHub 最新提交，但当前实例没有可比较的本地提交。",
        errorMessage: null,
      };
    }

    if (localBuild.commit === latestCommitSha) {
      return {
        packageVersion,
        currentCommit: localBuild.commit,
        currentBranch: localBuild.branch,
        currentCommitSource: localBuild.source,
        updateSourceRepo,
        updateSourceUrl,
        updateSourceDefaultBranch,
        latestCommit: latestCommitSha,
        latestCommitDate,
        latestCommitUrl,
        comparisonStatus: "identical",
        outcome: "up_to_date",
        summary: "当前已经是 GitHub 默认分支的最新提交。",
        errorMessage: null,
      };
    }

    try {
      const comparison = await readGitHubJson<GitHubComparePayload>({
        fetchImpl,
        url: buildGitHubApiUrl(
          apiBaseUrl,
          `/repos/${updateSourceRepo}/compare/${encodeURIComponent(localBuild.commit)}...${encodeURIComponent(latestCommitSha)}`,
        ),
        headers: requestHeaders,
      });
      const comparisonStatus = normalizeOptionalText(comparison.status);

      return {
        packageVersion,
        currentCommit: localBuild.commit,
        currentBranch: localBuild.branch,
        currentCommitSource: localBuild.source,
        updateSourceRepo,
        updateSourceUrl,
        updateSourceDefaultBranch,
        latestCommit: latestCommitSha,
        latestCommitDate,
        latestCommitUrl,
        comparisonStatus,
        outcome: mapComparisonStatusToOutcome(comparisonStatus),
        summary: buildComparisonSummary(comparisonStatus),
        errorMessage: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isNotFound = /\b404\b/.test(message);

      return {
        packageVersion,
        currentCommit: localBuild.commit,
        currentBranch: localBuild.branch,
        currentCommitSource: localBuild.source,
        updateSourceRepo,
        updateSourceUrl,
        updateSourceDefaultBranch,
        latestCommit: latestCommitSha,
        latestCommitDate,
        latestCommitUrl,
        comparisonStatus: null,
        outcome: "comparison_unavailable",
        summary: isNotFound
          ? "当前本地提交不在公开更新源上；开发仓出现这种情况是正常的，正式部署建议使用公开仓 clone。"
          : "GitHub 已返回最新提交，但当前本地提交无法直接和远端比较。",
        errorMessage: message,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      packageVersion,
      currentCommit: localBuild.commit,
      currentBranch: localBuild.branch,
      currentCommitSource: localBuild.source,
      updateSourceRepo,
      updateSourceUrl,
      updateSourceDefaultBranch,
      latestCommit: null,
      latestCommitDate: null,
      latestCommitUrl: null,
      comparisonStatus: null,
      outcome: "check_failed",
      summary: "检查更新失败，暂时无法确认 GitHub 是否有新版本。",
      errorMessage: message,
    };
  }
}

export function formatShortCommitHash(commit: string | null): string {
  if (!commit) {
    return "未检测到";
  }

  return commit.slice(0, 7);
}

function readPackageVersion(workingDirectory: string): string | null {
  const packageJsonPath = resolve(workingDirectory, "package.json");

  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const payload = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      version?: unknown;
    };
    return normalizeOptionalText(payload.version);
  } catch {
    return null;
  }
}

function readLocalBuildSnapshot(
  workingDirectory: string,
  env: NodeJS.ProcessEnv,
): {
  commit: string | null;
  branch: string | null;
  source: "git" | "env" | "unknown";
} {
  const envCommit = normalizeOptionalText(env.THEMIS_BUILD_COMMIT);

  if (envCommit) {
    return {
      commit: envCommit,
      branch: normalizeOptionalText(env.THEMIS_BUILD_BRANCH),
      source: "env",
    };
  }

  const gitCommit = readGitOutput(workingDirectory, ["rev-parse", "HEAD"]);

  if (!gitCommit) {
    return {
      commit: null,
      branch: null,
      source: "unknown",
    };
  }

  return {
    commit: gitCommit,
    branch: readGitOutput(workingDirectory, ["rev-parse", "--abbrev-ref", "HEAD"]),
    source: "git",
  };
}

function readGitOutput(workingDirectory: string, args: string[]): string | null {
  try {
    const output = execFileSync("git", args, {
      cwd: workingDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return normalizeOptionalText(output);
  } catch {
    return null;
  }
}

function normalizeRepoSlug(value: string | undefined): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return DEFAULT_UPDATE_REPO;
  }

  const httpsMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
  if (httpsMatch?.[1]) {
    return httpsMatch[1];
  }

  const sshMatch = normalized.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (sshMatch?.[1]) {
    return sshMatch[1];
  }

  if (/^[^/\s]+\/[^/\s]+$/.test(normalized)) {
    return normalized.replace(/\.git$/i, "");
  }

  throw new Error("THEMIS_UPDATE_REPO 必须是 owner/repo、GitHub URL 或 git@github.com:owner/repo.git。");
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const normalized = normalizeOptionalText(value);
  return (normalized ?? DEFAULT_UPDATE_API_BASE_URL).replace(/\/+$/, "");
}

function normalizeDefaultBranch(value: string | undefined): string {
  return normalizeOptionalText(value) ?? DEFAULT_UPDATE_DEFAULT_BRANCH;
}

function buildGitHubApiUrl(apiBaseUrl: string, pathname: string): string {
  return `${apiBaseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function buildGitHubRequestHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const token = normalizeOptionalText(env.THEMIS_GITHUB_TOKEN)
    ?? normalizeOptionalText(env.GITHUB_TOKEN)
    ?? normalizeOptionalText(env.GH_TOKEN);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "themis-update-check",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function readGitHubJson<T>(input: {
  fetchImpl: typeof fetch;
  url: string;
  headers: Record<string, string>;
}): Promise<T> {
  const response = await input.fetchImpl(input.url, {
    headers: input.headers,
    signal: AbortSignal.timeout(DEFAULT_UPDATE_TIMEOUT_MS),
  });
  const text = await response.text();
  const payload = text ? safeParseJson(text) : null;

  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload
      ? normalizeOptionalText((payload as { message?: unknown }).message)
      : null;
    throw new Error(`GitHub API 返回 ${response.status}${message ? `：${message}` : ""}`);
  }

  return (payload ?? {}) as T;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mapComparisonStatusToOutcome(status: string | null): ThemisUpdateOutcome {
  switch (status) {
    case "identical":
      return "up_to_date";
    case "behind":
      return "update_available";
    case "ahead":
      return "local_ahead";
    case "diverged":
      return "local_diverged";
    default:
      return "comparison_unavailable";
  }
}

function buildComparisonSummary(status: string | null): string {
  switch (status) {
    case "identical":
      return "当前已经是 GitHub 默认分支的最新提交。";
    case "behind":
      return "发现 GitHub 新提交，可安排升级。";
    case "ahead":
      return "当前实例比 GitHub 默认分支更新，暂时不建议直接覆盖。";
    case "diverged":
      return "当前实例与 GitHub 默认分支已经分叉，升级前需要先确认本地改动去留。";
    default:
      return "GitHub 已返回最新提交，但比较结果不明确。";
  }
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}
