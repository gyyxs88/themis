import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_UPDATE_REPO = "gyyxs88/themis";
const DEFAULT_UPDATE_DEFAULT_BRANCH = "main";
const DEFAULT_UPDATE_API_BASE_URL = "https://api.github.com";
const DEFAULT_UPDATE_TIMEOUT_MS = 15000;

export type ThemisUpdateChannel = "branch" | "release";

export type ThemisUpdateOutcome =
  | "up_to_date"
  | "update_available"
  | "local_ahead"
  | "local_diverged"
  | "comparison_unavailable"
  | "check_failed";

export interface ThemisUpdateTarget {
  updateChannel: ThemisUpdateChannel;
  updateSourceRepo: string;
  updateSourceUrl: string;
  updateSourceDefaultBranch: string;
  latestCommit: string | null;
  latestCommitDate: string | null;
  latestCommitUrl: string | null;
  latestReleaseTag: string | null;
  latestReleaseName: string | null;
  latestReleasePublishedAt: string | null;
  latestReleaseUrl: string | null;
}

export interface ThemisUpdateCheckResult extends ThemisUpdateTarget {
  packageVersion: string | null;
  currentCommit: string | null;
  currentBranch: string | null;
  currentCommitSource: "git" | "env" | "unknown";
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

interface GitHubReleasePayload {
  tag_name?: unknown;
  html_url?: unknown;
  name?: unknown;
  published_at?: unknown;
}

export async function checkThemisUpdates(input: {
  workingDirectory: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<ThemisUpdateCheckResult> {
  const env = input.env ?? process.env;
  const packageVersion = readPackageVersion(input.workingDirectory);
  const localBuild = readLocalBuildSnapshot(input.workingDirectory, env);

  let target: ThemisUpdateTarget;

  try {
    target = await resolveThemisUpdateTarget(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const config = resolveThemisUpdateSourceConfig(env);

    return {
      packageVersion,
      currentCommit: localBuild.commit,
      currentBranch: localBuild.branch,
      currentCommitSource: localBuild.source,
      updateChannel: config.updateChannel,
      updateSourceRepo: config.updateSourceRepo,
      updateSourceUrl: config.updateSourceUrl,
      updateSourceDefaultBranch: config.updateSourceDefaultBranch,
      latestCommit: null,
      latestCommitDate: null,
      latestCommitUrl: null,
      latestReleaseTag: null,
      latestReleaseName: null,
      latestReleasePublishedAt: null,
      latestReleaseUrl: null,
      comparisonStatus: null,
      outcome: "check_failed",
      summary: buildTargetFetchFailedSummary(config.updateChannel, message),
      errorMessage: message,
    };
  }

  if (!target.latestCommit) {
    return {
      packageVersion,
      currentCommit: localBuild.commit,
      currentBranch: localBuild.branch,
      currentCommitSource: localBuild.source,
      ...target,
      comparisonStatus: null,
      outcome: "check_failed",
      summary: target.updateChannel === "release"
        ? "GitHub 已响应 latest release，但没有返回可比较的提交 SHA。"
        : "GitHub 已响应，但没有返回最新提交 SHA。",
      errorMessage: target.updateChannel === "release" ? "missing_release_commit_sha" : "missing_latest_commit_sha",
    };
  }

  if (!localBuild.commit) {
    return {
      packageVersion,
      currentCommit: null,
      currentBranch: localBuild.branch,
      currentCommitSource: localBuild.source,
      ...target,
      comparisonStatus: null,
      outcome: "comparison_unavailable",
      summary: buildMissingLocalCommitSummary(target.updateChannel),
      errorMessage: null,
    };
  }

  if (localBuild.commit === target.latestCommit) {
    return {
      packageVersion,
      currentCommit: localBuild.commit,
      currentBranch: localBuild.branch,
      currentCommitSource: localBuild.source,
      ...target,
      comparisonStatus: "identical",
      outcome: "up_to_date",
      summary: buildComparisonSummary(target.updateChannel, "identical"),
      errorMessage: null,
    };
  }

  try {
    const comparison = await readGitHubJson<GitHubComparePayload>({
      fetchImpl: input.fetchImpl ?? globalThis.fetch.bind(globalThis),
      url: buildGitHubApiUrl(
        normalizeApiBaseUrl(env.THEMIS_UPDATE_API_BASE_URL),
        `/repos/${target.updateSourceRepo}/compare/${encodeURIComponent(localBuild.commit)}...${encodeURIComponent(target.latestCommit)}`,
      ),
      headers: buildGitHubRequestHeaders(env),
    });
    const comparisonStatus = normalizeOptionalText(comparison.status);

    return {
      packageVersion,
      currentCommit: localBuild.commit,
      currentBranch: localBuild.branch,
      currentCommitSource: localBuild.source,
      ...target,
      comparisonStatus,
      outcome: mapComparisonStatusToOutcome(comparisonStatus),
      summary: buildComparisonSummary(target.updateChannel, comparisonStatus),
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
      ...target,
      comparisonStatus: null,
      outcome: "comparison_unavailable",
      summary: buildComparisonUnavailableSummary(target.updateChannel, isNotFound),
      errorMessage: message,
    };
  }
}

export async function resolveThemisUpdateTarget(input: {
  workingDirectory: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<ThemisUpdateTarget> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const config = resolveThemisUpdateSourceConfig(env);
  const requestHeaders = buildGitHubRequestHeaders(env);
  const apiBaseUrl = normalizeApiBaseUrl(env.THEMIS_UPDATE_API_BASE_URL);

  if (config.updateChannel === "release") {
    const latestRelease = await readGitHubJson<GitHubReleasePayload>({
      fetchImpl,
      url: buildGitHubApiUrl(apiBaseUrl, `/repos/${config.updateSourceRepo}/releases/latest`),
      headers: requestHeaders,
    });
    const latestReleaseTag = normalizeOptionalText(latestRelease.tag_name);
    const latestReleaseName = normalizeOptionalText(latestRelease.name);
    const latestReleasePublishedAt = normalizeOptionalText(latestRelease.published_at);
    const latestReleaseUrl = normalizeOptionalText(latestRelease.html_url);

    if (!latestReleaseTag) {
      throw new Error("GitHub latest release 缺少 tag_name。");
    }

    const latestCommit = await readGitHubJson<GitHubCommitPayload>({
      fetchImpl,
      url: buildGitHubApiUrl(apiBaseUrl, `/repos/${config.updateSourceRepo}/commits/${encodeURIComponent(latestReleaseTag)}`),
      headers: requestHeaders,
    });

    return {
      ...config,
      latestCommit: normalizeOptionalText(latestCommit.sha),
      latestCommitDate: normalizeOptionalText(latestCommit.commit?.author?.date),
      latestCommitUrl: normalizeOptionalText(latestCommit.html_url),
      latestReleaseTag,
      latestReleaseName,
      latestReleasePublishedAt,
      latestReleaseUrl,
    };
  }

  const latestCommit = await readGitHubJson<GitHubCommitPayload>({
    fetchImpl,
    url: buildGitHubApiUrl(apiBaseUrl, `/repos/${config.updateSourceRepo}/commits/${encodeURIComponent(config.updateSourceDefaultBranch)}`),
    headers: requestHeaders,
  });

  return {
    ...config,
    latestCommit: normalizeOptionalText(latestCommit.sha),
    latestCommitDate: normalizeOptionalText(latestCommit.commit?.author?.date),
    latestCommitUrl: normalizeOptionalText(latestCommit.html_url),
    latestReleaseTag: null,
    latestReleaseName: null,
    latestReleasePublishedAt: null,
    latestReleaseUrl: null,
  };
}

export function resolveThemisUpdateSourceConfig(env: NodeJS.ProcessEnv): {
  updateChannel: ThemisUpdateChannel;
  updateSourceRepo: string;
  updateSourceUrl: string;
  updateSourceDefaultBranch: string;
} {
  const updateSourceRepo = normalizeRepoSlug(env.THEMIS_UPDATE_REPO);

  return {
    updateChannel: normalizeUpdateChannel(env.THEMIS_UPDATE_CHANNEL),
    updateSourceRepo,
    updateSourceUrl: `https://github.com/${updateSourceRepo}`,
    updateSourceDefaultBranch: normalizeDefaultBranch(env.THEMIS_UPDATE_DEFAULT_BRANCH),
  };
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

function normalizeUpdateChannel(value: string | undefined): ThemisUpdateChannel {
  const normalized = normalizeOptionalText(value);

  if (!normalized || normalized === "branch") {
    return "branch";
  }

  if (normalized === "release") {
    return "release";
  }

  throw new Error("THEMIS_UPDATE_CHANNEL 仅支持 branch / release。");
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
    case "ahead":
      return "update_available";
    case "behind":
      return "local_ahead";
    case "diverged":
      return "local_diverged";
    default:
      return "comparison_unavailable";
  }
}

function buildTargetFetchFailedSummary(channel: ThemisUpdateChannel, message: string): string {
  if (channel === "release" && /\b404\b/.test(message)) {
    return "当前更新源还没有正式 release；release 渠道暂时无法使用。";
  }

  return channel === "release"
    ? "检查 release 更新失败，暂时无法确认 GitHub 是否有新的正式版本。"
    : "检查更新失败，暂时无法确认 GitHub 是否有新版本。";
}

function buildMissingLocalCommitSummary(channel: ThemisUpdateChannel): string {
  return channel === "release"
    ? "已读到 GitHub 最新正式 release 对应提交，但当前实例没有可比较的本地提交。"
    : "已读到 GitHub 最新提交，但当前实例没有可比较的本地提交。";
}

function buildComparisonUnavailableSummary(channel: ThemisUpdateChannel, isNotFound: boolean): string {
  if (!isNotFound) {
    return channel === "release"
      ? "GitHub 已返回最新正式 release，但当前本地提交无法直接和远端比较。"
      : "GitHub 已返回最新提交，但当前本地提交无法直接和远端比较。";
  }

  return channel === "release"
    ? "当前本地提交不在公开 release 轨道上；开发仓或手动推进到 release 之外的提交时出现这种情况是正常的。"
    : "当前本地提交不在公开更新源上；开发仓出现这种情况是正常的，正式部署建议使用公开仓 clone。";
}

function buildComparisonSummary(channel: ThemisUpdateChannel, status: string | null): string {
  if (channel === "release") {
    switch (status) {
      case "identical":
        return "当前已经是 GitHub 最新正式 release。";
      case "ahead":
        return "发现新的 GitHub 正式 release，可安排升级。";
      case "behind":
        return "当前实例比 GitHub 最新正式 release 更新，暂时不建议直接覆盖。";
      case "diverged":
        return "当前实例与 GitHub 最新正式 release 对应提交已经分叉，升级前需要先确认本地改动去留。";
      default:
        return "GitHub 已返回最新正式 release，但比较结果不明确。";
    }
  }

  switch (status) {
    case "identical":
      return "当前已经是 GitHub 默认分支的最新提交。";
    case "ahead":
      return "发现 GitHub 新提交，可安排升级。";
    case "behind":
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
