import { statSync } from "node:fs";
import { basename } from "node:path";

import type { RuntimeInputCapabilities, TaskInputAsset, TaskInputEnvelope } from "../types/index.js";

export type RuntimeInputDegradationLevel = "native" | "lossless_textualization" | "controlled_fallback" | "blocked";

export interface RuntimeCompileTarget {
  runtimeId: string;
  capabilities: RuntimeInputCapabilities;
}

export type CompiledTaskInputPart =
  | {
      type: "text";
      text: string;
      sourcePartId?: string;
      assetId?: string;
    }
  | {
      type: "image";
      assetPath: string;
      mimeType: string;
      sourcePartId?: string;
      assetId?: string;
    }
  | {
      type: "document";
      assetPath: string;
      mimeType: string;
      sourcePartId?: string;
      assetId?: string;
    };

export interface RuntimeCompileWarning {
  code: string;
  message: string;
  assetId?: string;
}

export interface CompiledTaskInput {
  nativeInputParts: CompiledTaskInputPart[];
  fallbackPromptSections: string[];
  compileWarnings: RuntimeCompileWarning[];
  degradationLevel: RuntimeInputDegradationLevel;
}

export function compileTaskInputForRuntime(input: {
  envelope: TaskInputEnvelope;
  target: RuntimeCompileTarget;
}): CompiledTaskInput {
  const nativeInputParts: CompiledTaskInputPart[] = [];
  const fallbackPromptSections: string[] = [];
  const compileWarnings: RuntimeCompileWarning[] = [];
  const documentPathEntries: Array<{
    assetId: string;
    name: string;
    mimeType: string;
    localPath: string;
  }> = [];
  let degradationLevel: RuntimeInputDegradationLevel = "native";

  for (const part of [...input.envelope.parts].sort((left, right) => left.order - right.order)) {
    if (part.type === "text") {
      if (!input.target.capabilities.nativeTextInput) {
        return blocked({
          code: "TEXT_NATIVE_INPUT_REQUIRED",
          message: "当前 runtime 未声明支持文本原生输入。",
        });
      }

      nativeInputParts.push({
        type: "text",
        text: part.text,
        sourcePartId: part.partId,
      });
      continue;
    }

    const asset = requireAsset(input.envelope.assets, part.assetId);

    if (part.type === "image") {
      if (!input.target.capabilities.nativeImageInput) {
        return blocked({
          code: "IMAGE_NATIVE_INPUT_REQUIRED",
          message: "当前 runtime 未声明支持图片原生输入，任务已阻止。",
          assetId: asset.assetId,
        });
      }

      nativeInputParts.push({
        type: "image",
        assetPath: asset.localPath,
        mimeType: asset.mimeType,
        sourcePartId: part.partId,
        assetId: asset.assetId,
      });
      continue;
    }

    if (part.type === "document") {
      if (!isTrustedDocumentPath(asset.localPath)) {
        return blocked({
          code: "DOCUMENT_PATH_UNAVAILABLE",
          message: "当前文档缺少可信本地路径，无法生成路径提示块。",
          assetId: asset.assetId,
        });
      }

      documentPathEntries.push({
        assetId: asset.assetId,
        name: asset.name ?? basename(asset.localPath),
        mimeType: asset.mimeType,
        localPath: asset.localPath,
      });
      degradationLevel = "controlled_fallback";
      continue;
    }

    return blocked({
      code: "DOCUMENT_INPUT_UNSUPPORTED",
      message: `当前 runtime 不支持文档输入：${asset.mimeType}`,
      assetId: asset.assetId,
    });
  }

  if (documentPathEntries.length) {
    fallbackPromptSections.push(formatDocumentPathSection(documentPathEntries));
  }

  return {
    nativeInputParts,
    fallbackPromptSections,
    compileWarnings,
    degradationLevel,
  };

  function blocked(warning: RuntimeCompileWarning): CompiledTaskInput {
    return {
      nativeInputParts: [],
      fallbackPromptSections: [],
      compileWarnings: [...compileWarnings, warning],
      degradationLevel: "blocked",
    };
  }
}

function requireAsset(assets: TaskInputAsset[], assetId: string): TaskInputAsset {
  const asset = assets.find((item) => item.assetId === assetId);

  if (!asset) {
    throw new Error(`Task input asset not found: ${assetId}`);
  }

  return asset;
}

function isTrustedDocumentPath(localPath: string): boolean {
  if (localPath.trim().length === 0) {
    return false;
  }

  try {
    return statSync(localPath).isFile();
  } catch {
    return false;
  }
}

function formatDocumentPathSection(
  entries: Array<{
    assetId: string;
    name: string;
    mimeType: string;
    localPath: string;
  }>,
): string {
  const lines = ["Attached document paths:"];

  for (const entry of entries) {
    lines.push("");
    lines.push(`- assetId: ${entry.assetId}`);
    lines.push(`  name: ${entry.name}`);
    lines.push(`  mimeType: ${entry.mimeType}`);
    lines.push(`  localPath: ${entry.localPath}`);
  }

  return lines.join("\n");
}
