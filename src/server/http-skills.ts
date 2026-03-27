import type { IncomingMessage, ServerResponse } from "node:http";
import type { CodexTaskRuntime } from "../core/codex-runtime.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeRequiredText(value: unknown, errorMessage: string): string {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new Error(errorMessage);
  }

  return normalized;
}

function normalizeSkillsIdentityPayload(value: unknown): {
  channel: string;
  channelUserId: string;
  displayName?: string;
} {
  if (!isRecord(value)) {
    throw new Error("身份请求缺少必要字段。");
  }

  const channel = normalizeText(value.channel);
  const channelUserId = normalizeText(value.channelUserId);
  const displayName = normalizeText(value.displayName);

  if (!channel || !channelUserId) {
    throw new Error("身份请求缺少必要字段。");
  }

  return {
    channel,
    channelUserId,
    ...(displayName ? { displayName } : {}),
  };
}

function normalizeSkillsInstallPayload(value: unknown): {
  channel: string;
  channelUserId: string;
  displayName?: string;
  replace: boolean;
  source:
    | { type: "local-path"; absolutePath: string }
    | { type: "curated"; skillName: string }
    | { type: "github-url"; url: string; ref?: string }
    | { type: "github-repo-path"; repo: string; path: string; ref?: string };
} {
  if (!isRecord(value)) {
    throw new Error("skills 安装请求缺少必要字段。");
  }

  const identity = normalizeSkillsIdentityPayload(value);
  const replace = value.replace === true;
  const source = isRecord(value.source) ? value.source : null;

  if (!source || typeof source.type !== "string") {
    throw new Error("skills 安装请求缺少来源配置。");
  }

  switch (source.type) {
    case "local-path":
      return {
        ...identity,
        replace,
        source: {
          type: "local-path",
          absolutePath: normalizeRequiredText(source.absolutePath, "本机路径不能为空。"),
        },
      };
    case "curated": {
      return {
        ...identity,
        replace,
        source: {
          type: "curated",
          skillName: normalizeRequiredText(source.skillName, "curated skill 名称不能为空。"),
        },
      };
    }
    case "github-url": {
      const ref = normalizeText(source.ref);

      return {
        ...identity,
        replace,
        source: {
          type: "github-url",
          url: normalizeRequiredText(source.url, "GitHub URL 不能为空。"),
          ...(ref ? { ref } : {}),
        },
      };
    }
    case "github-repo-path": {
      const ref = normalizeText(source.ref);

      return {
        ...identity,
        replace,
        source: {
          type: "github-repo-path",
          repo: normalizeRequiredText(source.repo, "repo 不能为空。"),
          path: normalizeRequiredText(source.path, "repo path 不能为空。"),
          ...(ref ? { ref } : {}),
        },
      };
    }
    default:
      throw new Error("不支持的 skills 来源类型。");
  }
}

function normalizeSkillNamePayload(value: unknown, missingRequestMessage: string): {
  channel: string;
  channelUserId: string;
  displayName?: string;
  skillName: string;
  force: boolean;
} {
  if (!isRecord(value)) {
    throw new Error(missingRequestMessage);
  }

  const identity = normalizeSkillsIdentityPayload(value);

  return {
    ...identity,
    skillName: normalizeRequiredText(value.skillName, "skill 名称不能为空。"),
    force: value.force === true,
  };
}

export async function handleSkillsList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  try {
    const payload = normalizeSkillsIdentityPayload(await readJsonBody(request));
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const service = runtime.getPrincipalSkillsService();

    writeJson(response, 200, {
      identity,
      skills: service.listPrincipalSkills(identity.principalId),
    });
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}

export async function handleSkillsInstall(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  try {
    const payload = normalizeSkillsInstallPayload(await readJsonBody(request));
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const service = runtime.getPrincipalSkillsService();

    const result = payload.source.type === "local-path"
      ? await service.installFromLocalPath({
        principalId: identity.principalId,
        absolutePath: payload.source.absolutePath,
        replace: payload.replace,
      })
      : payload.source.type === "curated"
        ? await service.installFromCurated({
          principalId: identity.principalId,
          skillName: payload.source.skillName,
          replace: payload.replace,
        })
        : await service.installFromGithub({
          principalId: identity.principalId,
          ...payload.source,
          replace: payload.replace,
        });

    writeJson(response, 200, {
      identity,
      result,
    });
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}

export async function handleSkillsRemove(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  try {
    const payload = normalizeSkillNamePayload(await readJsonBody(request), "skills 删除请求缺少必要字段。");
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const result = runtime.getPrincipalSkillsService().removeSkill(identity.principalId, payload.skillName);

    writeJson(response, 200, {
      identity,
      result,
    });
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}

export async function handleSkillsSync(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  try {
    const payload = normalizeSkillNamePayload(await readJsonBody(request), "skills 重同步请求缺少必要字段。");
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const result = await runtime.getPrincipalSkillsService().syncSkill(identity.principalId, payload.skillName, {
      force: payload.force,
    });

    writeJson(response, 200, {
      identity,
      result,
    });
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}

export async function handleSkillsCuratedCatalog(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  try {
    const payload = normalizeSkillsIdentityPayload(await readJsonBody(request));
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const curated = await runtime.getPrincipalSkillsService().listCuratedSkills(identity.principalId);

    writeJson(response, 200, {
      identity,
      curated,
    });
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}
