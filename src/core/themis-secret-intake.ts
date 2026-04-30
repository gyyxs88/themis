const DEFAULT_SECRET_VALUE_MIN_LENGTH = 20;

export interface ThemisSecretIntakeMatch {
  secretRef: string;
  value: string;
  label: string;
  source: "known-alias" | "explicit-secret-ref" | "generic-provider";
}

interface KnownSecretAlias {
  secretRef: string;
  label: string;
  match: (lowerText: string) => boolean;
}

const KNOWN_SECRET_ALIASES: KnownSecretAlias[] = [
  {
    secretRef: "feishu-app-secret",
    label: "飞书 App Secret",
    match: (lowerText) =>
      /(?:飞书|feishu|lark)/i.test(lowerText)
      && /(?:feishu_app_secret|lark_app_secret|app[_\s-]*secret|client[_\s-]*secret|应用\s*(?:secret|密钥))/i.test(lowerText),
  },
  {
    secretRef: "feishu-app-id",
    label: "飞书 App ID",
    match: (lowerText) =>
      /(?:飞书|feishu|lark)/i.test(lowerText)
      && /(?:feishu_app_id|lark_app_id|app[_\s-]*id|client[_\s-]*id|应用\s*id)/i.test(lowerText),
  },
  {
    secretRef: "cloudflare-management-token",
    label: "Cloudflare 管理 token",
    match: (lowerText) =>
      /\b(?:cloudflare|cf)\b/.test(lowerText)
      && /(管理|management|manager|admin|api\s*tokens?\s*write|token)/i.test(lowerText),
  },
];

const SECRET_WORD_PATTERN =
  /\b(?:token|secret|app[_\s-]*id|api[_\s-]*key|access[_\s-]*key|access[_\s-]*token|client[_\s-]*id|client[_\s-]*secret|private[_\s-]*key|key|credential|password|bearer)\b|应用\s*id|令牌|密钥|凭据|密码/i;
const SECRET_INTAKE_INTENT_PATTERN =
  /(保存|存一下|记住|记一下|收好|给你|交给你|配置|写入|使用|用这个|这是|这个是|如下|is|=|：|:)/i;
const SECRET_REF_PATTERN =
  /(?:secretRef|secret\s*ref|secret引用|引用名|保存(?:为|到)|记为|命名为)\s*[=:：]?\s*([A-Za-z0-9][A-Za-z0-9_.-]{1,159})/i;
const SECRET_VALUE_PATTERN = /[A-Za-z0-9][A-Za-z0-9_.~+/=_-]{19,}/g;
const GENERIC_PROVIDER_SECRET_PATTERNS: Array<{
  pattern: RegExp;
  providerGroup: number;
}> = [
  {
    pattern:
      /\b([A-Za-z][A-Za-z0-9_-]{1,40})\b\s*(?:管理|management|manager|admin)?\s*(?:api[_\s-]*key|access[_\s-]*key|access[_\s-]*token|client[_\s-]*secret|private[_\s-]*key|token|secret|credential|password|key)\b/i,
    providerGroup: 1,
  },
  {
    pattern:
      /\b(?:api[_\s-]*key|access[_\s-]*key|access[_\s-]*token|client[_\s-]*secret|private[_\s-]*key|token|secret|credential|password|key)\b\s*(?:for|of|给|用于|属于)?\s*\b([A-Za-z][A-Za-z0-9_-]{1,40})\b/i,
    providerGroup: 1,
  },
];
const GENERIC_PROVIDER_STOP_WORDS = new Set([
  "access",
  "admin",
  "api",
  "bearer",
  "client",
  "credential",
  "for",
  "is",
  "key",
  "management",
  "manager",
  "of",
  "password",
  "private",
  "secret",
  "this",
  "token",
]);

export function parseThemisSecretIntake(text: string): ThemisSecretIntakeMatch | null {
  const normalized = text.trim();

  if (!normalized || !SECRET_WORD_PATTERN.test(normalized) || !SECRET_INTAKE_INTENT_PATTERN.test(normalized)) {
    return null;
  }

  const explicitSecretRef = parseExplicitSecretRef(normalized);
  const value = extractSecretValueCandidate(
    normalized,
    explicitSecretRef ? new Set([explicitSecretRef]) : new Set(),
  );

  if (!value) {
    return null;
  }

  if (explicitSecretRef && explicitSecretRef !== value) {
    return {
      secretRef: explicitSecretRef,
      value,
      label: explicitSecretRef,
      source: "explicit-secret-ref",
    };
  }

  const lowerText = normalized.toLowerCase();
  const alias = KNOWN_SECRET_ALIASES.find((candidate) => candidate.match(lowerText));

  if (!alias) {
    const genericSecretRef = parseGenericProviderSecretRef(normalized, value);

    if (!genericSecretRef) {
      return null;
    }

    return {
      secretRef: genericSecretRef.secretRef,
      value,
      label: genericSecretRef.label,
      source: "generic-provider",
    };
  }

  return {
    secretRef: alias.secretRef,
    value,
    label: alias.label,
    source: "known-alias",
  };
}

export function redactThemisSecretIntakeText(text: string): string {
  const intake = parseThemisSecretIntake(text);

  if (!intake) {
    return text;
  }

  return text.split(intake.value).join("[REDACTED_SECRET]");
}

function parseExplicitSecretRef(text: string): string | null {
  const match = text.match(SECRET_REF_PATTERN);
  return match?.[1] ?? null;
}

function extractSecretValueCandidate(text: string, excludedValues: Set<string>): string | null {
  const codeCandidate = extractCodeSecretCandidate(text, excludedValues);

  if (codeCandidate) {
    return codeCandidate;
  }

  const candidates = [...text.matchAll(SECRET_VALUE_PATTERN)]
    .map((match) => match[0])
    .filter((candidate) => !excludedValues.has(candidate))
    .filter((candidate) => isLikelySecretValue(candidate));

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((left, right) => right.length - left.length)[0] ?? null;
}

function extractCodeSecretCandidate(text: string, excludedValues: Set<string>): string | null {
  const candidates: string[] = [];
  const fencedPattern = /```[\s\S]*?```|`([^`\r\n]+)`/g;

  for (const match of text.matchAll(fencedPattern)) {
    const raw = match[1] ?? match[0].replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
    const normalized = raw.trim();

    if (!excludedValues.has(normalized) && isLikelySecretValue(normalized)) {
      candidates.push(normalized);
    }
  }

  return candidates.sort((left, right) => right.length - left.length)[0] ?? null;
}

function parseGenericProviderSecretRef(text: string, value: string): { secretRef: string; label: string } | null {
  const textWithoutValue = text.split(value).join(" ");

  for (const { pattern, providerGroup } of GENERIC_PROVIDER_SECRET_PATTERNS) {
    const match = textWithoutValue.match(pattern);
    const provider = normalizeGenericProvider(match?.[providerGroup]);

    if (!provider) {
      continue;
    }

    const kind = inferGenericSecretKind(textWithoutValue);
    const scope = /(管理|management|manager|admin)/i.test(textWithoutValue) ? "management-" : "";
    const secretRef = `${provider}-${scope}${kind}`;

    return {
      secretRef,
      label: secretRef,
    };
  }

  return null;
}

function normalizeGenericProvider(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const provider = value
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

  if (!provider || provider.length < 2 || GENERIC_PROVIDER_STOP_WORDS.has(provider)) {
    return null;
  }

  return provider;
}

function inferGenericSecretKind(text: string): string {
  if (/client[_\s-]*secret/i.test(text)) {
    return "client-secret";
  }

  if (/private[_\s-]*key/i.test(text)) {
    return "private-key";
  }

  if (/access[_\s-]*key/i.test(text)) {
    return "access-key";
  }

  if (/api[_\s-]*key/i.test(text)) {
    return "api-key";
  }

  if (/password|密码/i.test(text)) {
    return "password";
  }

  if (/credential|凭据/i.test(text)) {
    return "credential";
  }

  if (/secret|密钥/i.test(text)) {
    return "secret";
  }

  return "token";
}

function isLikelySecretValue(value: string): boolean {
  if (value.length < DEFAULT_SECRET_VALUE_MIN_LENGTH || /\s/.test(value)) {
    return false;
  }

  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return false;
  }

  if (/^(?:cloudflare|management|secretRef)$/i.test(value)) {
    return false;
  }

  if (/^https?:\/\//i.test(value) || /^www\./i.test(value)) {
    return false;
  }

  return true;
}
