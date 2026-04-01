import { existsSync, readFileSync } from "node:fs";

import type {
  RuntimeInputCapabilities,
  TaskInputAsset,
  TaskInputEnvelope,
} from "../types/index.js";

export type RuntimeInputDegradationLevel =
  | "native"
  | "lossless_textualization"
  | "controlled_fallback"
  | "blocked";

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

    if (isLosslessTextDocument(asset.mimeType)) {
      if (!input.target.capabilities.nativeTextInput) {
        return blocked({
          code: "TEXT_NATIVE_INPUT_REQUIRED",
          message: "当前 runtime 未声明支持文本原生输入，无法承载可文本化文档。",
          assetId: asset.assetId,
        });
      }

      const textualDocument = resolveTextualDocumentContent(asset);

      if (textualDocument.kind === "source_unavailable") {
        return blocked({
          code: "TEXTUAL_DOCUMENT_SOURCE_UNAVAILABLE",
          message: "当前可文本化文档缺少可读文本源，无法诚实地编译为文本输入。",
          assetId: asset.assetId,
        });
      }

      nativeInputParts.push({
        type: "text",
        text: textualDocument.text,
        sourcePartId: part.partId,
        assetId: asset.assetId,
      });

      if (textualDocument.kind === "preview_fallback") {
        compileWarnings.push({
          code: "TEXTUAL_DOCUMENT_PREVIEW_FALLBACK",
          message: "可文本化文档缺少真实文本源，当前退回 textPreview 作为受控降级输入。",
          assetId: asset.assetId,
        });
        degradationLevel = mergeDegradationLevel(degradationLevel, "controlled_fallback");
        continue;
      }

      degradationLevel = mergeDegradationLevel(degradationLevel, "lossless_textualization");
      continue;
    }

    if (supportsNativeDocumentInput(asset.mimeType, input.target.capabilities)) {
      nativeInputParts.push({
        type: "document",
        assetPath: asset.localPath,
        mimeType: asset.mimeType,
        sourcePartId: part.partId,
        assetId: asset.assetId,
      });
      continue;
    }

    if (asset.mimeType === "application/pdf" && input.target.capabilities.supportsPdfTextExtraction) {
      if (!input.target.capabilities.nativeTextInput) {
        return blocked({
          code: "TEXT_NATIVE_INPUT_REQUIRED",
          message: "PDF 受控降级依赖文本原生输入，当前 runtime 未声明支持。",
          assetId: asset.assetId,
        });
      }

      fallbackPromptSections.push(
        [
          "PDF fallback context:",
          `assetId: ${asset.assetId}`,
          `path: ${asset.localPath}`,
          resolvePdfFallbackText(asset),
        ].join("\n"),
      );
      compileWarnings.push({
        code: "PDF_CONTROLLED_FALLBACK",
        message: "PDF 当前通过受控降级进入 runtime。",
        assetId: asset.assetId,
      });
      degradationLevel = mergeDegradationLevel(degradationLevel, "controlled_fallback");
      continue;
    }

    return blocked({
      code: "DOCUMENT_INPUT_UNSUPPORTED",
      message: `当前 runtime 不支持文档输入：${asset.mimeType}`,
      assetId: asset.assetId,
    });
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

function supportsNativeDocumentInput(mimeType: string, capabilities: RuntimeInputCapabilities): boolean {
  if (!capabilities.nativeDocumentInput) {
    return false;
  }

  if (!capabilities.supportedDocumentMimeTypes.length) {
    return true;
  }

  return capabilities.supportedDocumentMimeTypes.includes(mimeType);
}

function isLosslessTextDocument(mimeType: string): boolean {
  return [
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    "application/json",
    "application/x-typescript",
    "text/typescript",
    "application/typescript",
    "text/javascript",
    "application/javascript",
  ].includes(mimeType);
}

function resolveTextualDocumentContent(asset: TaskInputAsset):
  | { kind: "lossless_source"; text: string }
  | { kind: "preview_fallback"; text: string }
  | { kind: "source_unavailable" } {
  const textPath = asset.textExtraction?.status === "completed" ? asset.textExtraction.textPath : undefined;

  if (textPath && existsSync(textPath)) {
    return {
      kind: "lossless_source",
      text: readFileSync(textPath, "utf8"),
    };
  }

  if (existsSync(asset.localPath)) {
    return {
      kind: "lossless_source",
      text: readFileSync(asset.localPath, "utf8"),
    };
  }

  if (asset.textExtraction?.textPreview) {
    return {
      kind: "preview_fallback",
      text: asset.textExtraction.textPreview,
    };
  }

  return { kind: "source_unavailable" };
}

function resolvePdfFallbackText(asset: TaskInputAsset): string {
  const textPath = asset.textExtraction?.status === "completed" ? asset.textExtraction.textPath : undefined;

  if (textPath && existsSync(textPath)) {
    return readFileSync(textPath, "utf8");
  }

  return asset.textExtraction?.textPreview ?? "[pdf text extraction unavailable]";
}

function requireAsset(assets: TaskInputAsset[], assetId: string): TaskInputAsset {
  const asset = assets.find((item) => item.assetId === assetId);

  if (!asset) {
    throw new Error(`Task input asset not found: ${assetId}`);
  }

  return asset;
}

function mergeDegradationLevel(
  current: RuntimeInputDegradationLevel,
  next: RuntimeInputDegradationLevel,
): RuntimeInputDegradationLevel {
  return DEGRADATION_LEVEL_PRIORITY[next] > DEGRADATION_LEVEL_PRIORITY[current] ? next : current;
}

const DEGRADATION_LEVEL_PRIORITY: Record<RuntimeInputDegradationLevel, number> = {
  native: 0,
  lossless_textualization: 1,
  controlled_fallback: 2,
  blocked: 3,
};
