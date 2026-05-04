import { resolve } from "node:path";

const SOURCE_EDIT_POLICY_ENV = "THEMIS_SOURCE_EDIT_POLICY";
const UPDATE_SYSTEMD_SERVICE_ENV = "THEMIS_UPDATE_SYSTEMD_SERVICE";
const TODOIST_TASK_POLICY_VALUES = new Set([
  "1",
  "on",
  "true",
  "todoist",
  "todoist-task",
  "task",
]);
const OFF_POLICY_VALUES = new Set([
  "0",
  "allow",
  "disabled",
  "false",
  "off",
]);

export interface FormalSourceEditGuardPromptInput {
  workingDirectory: string;
  serviceName?: string | null;
}

export function shouldEnableFormalSourceEditGuard(
  workingDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const explicitPolicy = normalizeOptionalText(env[SOURCE_EDIT_POLICY_ENV])?.toLowerCase();

  if (explicitPolicy && OFF_POLICY_VALUES.has(explicitPolicy)) {
    return false;
  }

  if (explicitPolicy && TODOIST_TASK_POLICY_VALUES.has(explicitPolicy)) {
    return true;
  }

  return isFormalThemisServiceCheckout(workingDirectory)
    || isFormalThemisServiceName(env[UPDATE_SYSTEMD_SERVICE_ENV]);
}

export function buildFormalSourceEditGuardPromptSectionIfNeeded(
  workingDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!shouldEnableFormalSourceEditGuard(workingDirectory, env)) {
    return null;
  }

  return buildFormalSourceEditGuardPromptSection({
    workingDirectory,
    serviceName: normalizeOptionalText(env[UPDATE_SYSTEMD_SERVICE_ENV]),
  });
}

export function buildFormalSourceEditGuardPromptSection(
  input: FormalSourceEditGuardPromptInput,
): string {
  const serviceLine = input.serviceName
    ? `- Systemd service: ${input.serviceName}`
    : "- Systemd service: not configured in this prompt context";

  return [
    "Formal production source modification guard:",
    `- Themis service checkout: ${input.workingDirectory}`,
    serviceLine,
    "- This is a production/service checkout. Do not create, modify, delete, or generate repository source files here during an ordinary Web or Feishu task.",
    "- Treat files under src/, apps/, docs/, memory/, scripts/, tests, package files, lockfiles, config files, and public-export material as source-controlled repository files.",
    "- Read-only inspection is allowed: git status/diff, logs, database queries, file reads, diagnostics, and describing a proposed patch are fine.",
    "- If the correct next step requires changing repository files, create a Todoist task instead of applying the patch. Use the Themis development/maintenance project when available.",
    "- The Todoist task should include the problem, evidence, affected area or files, proposed change, validation and deploy notes, and priority.",
    "- If no Todoist tool is available in this turn, provide the exact Todoist title and description to create, then stop before editing.",
    "- User phrases such as 'continue', 'handle it directly', 'no need to ask me', or 'go ahead' do not override this guard for production source edits.",
    "- Repository source changes should be made from the development repo and deployed through the controlled update flow.",
  ].join("\n");
}

function isFormalThemisServiceCheckout(workingDirectory: string): boolean {
  const normalized = normalizePath(resolve(workingDirectory));

  return normalized.endsWith("/services/themis-prod")
    || normalized.includes("/services/themis-prod/");
}

function isFormalThemisServiceName(value: string | undefined): boolean {
  const normalized = normalizeOptionalText(value)?.toLowerCase();

  return normalized === "themis-prod.service"
    || normalized === "themis-prod";
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function normalizeOptionalText(value: string | undefined | null): string | null {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}
