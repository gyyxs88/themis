import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface FeishuDiagnosticFileStatus {
  path: string;
  status: "ok" | "missing" | "unreadable";
}

export interface FeishuDiagnosticStoreStatus extends FeishuDiagnosticFileStatus {
  count: number;
}

export interface FeishuDiagnosticsSummary {
  env: {
    appIdConfigured: boolean;
    appSecretConfigured: boolean;
    useEnvProxy: boolean;
    progressFlushTimeoutMs: number | null;
  };
  service: {
    serviceReachable: boolean;
    statusCode: number | null;
  };
  state: {
    sessionStore: FeishuDiagnosticStoreStatus;
    attachmentDraftStore: FeishuDiagnosticStoreStatus;
    sessionBindingCount: number;
    attachmentDraftCount: number;
  };
  docs: {
    smokeDocExists: boolean;
  };
}

export interface ReadFeishuDiagnosticsOptions {
  workingDirectory: string;
  env?: NodeJS.ProcessEnv;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const FEISHU_SMOKE_DOC_PATH = "docs/feishu/themis-feishu-real-journey-smoke.md";
const FEISHU_SESSION_STORE_PATH = "infra/local/feishu-sessions.json";
const FEISHU_ATTACHMENT_DRAFT_STORE_PATH = "infra/local/feishu-attachment-drafts.json";

export async function readFeishuDiagnosticsSnapshot(
  options: ReadFeishuDiagnosticsOptions,
): Promise<FeishuDiagnosticsSummary> {
  const env = options.env ?? process.env;
  const workingDirectory = options.workingDirectory;
  const baseUrl = normalizeText(options.baseUrl ?? env.THEMIS_BASE_URL ?? "http://127.0.0.1:3100") ?? "http://127.0.0.1:3100";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const sessionStorePath = join(workingDirectory, FEISHU_SESSION_STORE_PATH);
  const attachmentDraftStorePath = join(workingDirectory, FEISHU_ATTACHMENT_DRAFT_STORE_PATH);

  const [service, sessionStore, attachmentDraftStore] = await Promise.all([
    probeServiceReachability(baseUrl, fetchImpl),
    readFeishuFileStatus(sessionStorePath, FEISHU_SESSION_STORE_PATH, "bindings"),
    readFeishuFileStatus(attachmentDraftStorePath, FEISHU_ATTACHMENT_DRAFT_STORE_PATH, "drafts"),
  ]);

  return {
    env: {
      appIdConfigured: Boolean(normalizeText(env.FEISHU_APP_ID)),
      appSecretConfigured: Boolean(normalizeText(env.FEISHU_APP_SECRET)),
      useEnvProxy: parseBooleanEnv(env.FEISHU_USE_ENV_PROXY),
      progressFlushTimeoutMs: parseIntegerEnv(env.FEISHU_PROGRESS_FLUSH_TIMEOUT_MS) ?? null,
    },
    service,
    state: {
      sessionStore,
      attachmentDraftStore,
      sessionBindingCount: sessionStore.count,
      attachmentDraftCount: attachmentDraftStore.count,
    },
    docs: {
      smokeDocExists: existsSync(join(workingDirectory, FEISHU_SMOKE_DOC_PATH)),
    },
  };
}

async function probeServiceReachability(
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<FeishuDiagnosticsSummary["service"]> {
  try {
    const response = await fetchImpl(new URL("/", baseUrl), {
      method: "GET",
      redirect: "manual",
    });
    return {
      serviceReachable: response.status < 500,
      statusCode: response.status,
    };
  } catch {
    return {
      serviceReachable: false,
      statusCode: null,
    };
  }
}

async function readFeishuFileStatus(
  filePath: string,
  relativePath: string,
  arrayKey: "bindings" | "drafts",
): Promise<FeishuDiagnosticStoreStatus> {
  if (!existsSync(filePath)) {
    return {
      path: relativePath,
      status: "missing",
      count: 0,
    };
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    const entries = parsed && Array.isArray(parsed[arrayKey]) ? parsed[arrayKey] : [];

    return {
      path: relativePath,
      status: "ok",
      count: entries.length,
    };
  } catch {
    return {
      path: relativePath,
      status: "unreadable",
      count: 0,
    };
  }
}

function parseBooleanEnv(value: string | undefined): boolean {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseIntegerEnv(value: string | undefined): number | undefined {
  const normalized = normalizeText(value);

  if (!normalized) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
