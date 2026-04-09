const DEFAULT_THEMIS_BASE_URL = "http://127.0.0.1:3100";

export function resolveThemisBaseUrl(
  env: NodeJS.ProcessEnv | undefined,
  explicitBaseUrl?: string,
): string {
  const directBaseUrl = normalizeText(explicitBaseUrl) ?? normalizeText(env?.THEMIS_BASE_URL);

  if (directBaseUrl) {
    return stripTrailingSlashes(directBaseUrl);
  }

  const host = formatBaseUrlHost(normalizeText(env?.THEMIS_HOST) ?? "127.0.0.1");
  const port = normalizePort(env?.THEMIS_PORT) ?? 3100;
  return `${inferProtocol(directBaseUrl ?? env?.THEMIS_BASE_URL)}://${host}:${port}`;
}

export function defaultThemisBaseUrl(): string {
  return DEFAULT_THEMIS_BASE_URL;
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizePort(value: string | undefined): number | null {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed);
}

function formatBaseUrlHost(host: string): string {
  const normalizedHost = host.trim();

  if (!normalizedHost || normalizedHost === "0.0.0.0" || normalizedHost === "::" || normalizedHost === "[::]") {
    return "127.0.0.1";
  }

  if (normalizedHost.startsWith("[") && normalizedHost.endsWith("]")) {
    return normalizedHost;
  }

  if (normalizedHost.includes(":")) {
    return `[${normalizedHost}]`;
  }

  return normalizedHost;
}

function inferProtocol(baseUrl: string | undefined): string {
  const normalized = normalizeText(baseUrl);

  if (!normalized) {
    return "http";
  }

  const schemeMatch = normalized.match(/^([a-zA-Z][a-zA-Z\d+\-.]*):\/\//);
  return schemeMatch?.[1] ?? "http";
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "") || DEFAULT_THEMIS_BASE_URL;
}
