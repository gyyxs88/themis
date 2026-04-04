import { statSync } from "node:fs";
import { basename } from "node:path";

import type { RuntimeInputCapabilities, TaskInputAsset, TaskInputEnvelope } from "../types/index.js";

export type RuntimeInputDegradationLevel = "native" | "lossless_textualization" | "controlled_fallback" | "blocked";

export interface RuntimeCompileTarget {
  runtimeId: string;
  capabilities: RuntimeInputCapabilities;
  modelCapabilities?: RuntimeInputCapabilities | null;
  transportCapabilities?: RuntimeInputCapabilities | null;
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

export interface RuntimeCompileCapabilitySnapshot {
  nativeTextInput: boolean;
  nativeImageInput: boolean;
  nativeDocumentInput: boolean;
  supportedDocumentMimeTypes: string[];
}

export interface RuntimeCompileAssetFact {
  assetId: string;
  kind: "image" | "document";
  mimeType: string;
  localPathStatus: "ready" | "unavailable";
  modelNativeSupport: boolean | null;
  transportNativeSupport: boolean | null;
  effectiveNativeSupport: boolean;
  modelMimeTypeSupported: boolean | null;
  transportMimeTypeSupported: boolean | null;
  effectiveMimeTypeSupported: boolean | null;
  handling: "native" | "path_fallback" | "blocked";
}

export interface RuntimeCompileCapabilityMatrix {
  modelCapabilities: RuntimeCompileCapabilitySnapshot | null;
  transportCapabilities: RuntimeCompileCapabilitySnapshot | null;
  effectiveCapabilities: RuntimeCompileCapabilitySnapshot;
  assetFacts: RuntimeCompileAssetFact[];
}

export interface CompiledTaskInput {
  nativeInputParts: CompiledTaskInputPart[];
  fallbackPromptSections: string[];
  compileWarnings: RuntimeCompileWarning[];
  degradationLevel: RuntimeInputDegradationLevel;
  capabilityMatrix: RuntimeCompileCapabilityMatrix;
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
  const capabilityMatrix = createCapabilityMatrix(input.target);
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
      const localPathStatus = resolveLocalPathStatus(asset.localPath);
      const assetFact = buildCompileAssetFact({
        target: input.target,
        asset,
        localPathStatus,
      });

      if (!input.target.capabilities.nativeImageInput) {
        capabilityMatrix.assetFacts.push({
          ...assetFact,
          handling: "blocked",
        });
        return blocked({
          code: "IMAGE_NATIVE_INPUT_REQUIRED",
          message: "当前 runtime 未声明支持图片原生输入，任务已阻止。",
          assetId: asset.assetId,
        });
      }

      if (localPathStatus !== "ready") {
        capabilityMatrix.assetFacts.push({
          ...assetFact,
          handling: "blocked",
        });
        return blocked({
          code: "IMAGE_PATH_UNAVAILABLE",
          message: "当前图片缺少可信本地路径，无法作为原生图片输入发送。",
          assetId: asset.assetId,
        });
      }

      capabilityMatrix.assetFacts.push({
        ...assetFact,
        handling: "native",
      });
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
      const localPathStatus = resolveLocalPathStatus(asset.localPath);
      const assetFact = buildCompileAssetFact({
        target: input.target,
        asset,
        localPathStatus,
      });

      if (supportsNativeDocumentMimeType(input.target.capabilities, asset.mimeType)) {
        if (localPathStatus !== "ready") {
          capabilityMatrix.assetFacts.push({
            ...assetFact,
            handling: "blocked",
          });
          return blocked({
            code: "DOCUMENT_PATH_UNAVAILABLE",
            message: "当前文档缺少可信本地路径，无法作为原生文档输入发送。",
            assetId: asset.assetId,
          });
        }

        capabilityMatrix.assetFacts.push({
          ...assetFact,
          handling: "native",
        });
        nativeInputParts.push({
          type: "document",
          assetPath: asset.localPath,
          mimeType: asset.mimeType,
          sourcePartId: part.partId,
          assetId: asset.assetId,
        });
        continue;
      }

      if (localPathStatus !== "ready") {
        capabilityMatrix.assetFacts.push({
          ...assetFact,
          handling: "blocked",
        });
        return blocked({
          code: "DOCUMENT_PATH_UNAVAILABLE",
          message: "当前文档缺少可信本地路径，无法生成路径提示块。",
          assetId: asset.assetId,
        });
      }

      capabilityMatrix.assetFacts.push({
        ...assetFact,
        handling: "path_fallback",
      });
      compileWarnings.push(createDocumentFallbackWarning(input.target.capabilities, asset));
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
    capabilityMatrix,
  };

  function blocked(warning: RuntimeCompileWarning): CompiledTaskInput {
    return {
      nativeInputParts: [],
      fallbackPromptSections: [],
      compileWarnings: [...compileWarnings, warning],
      degradationLevel: "blocked",
      capabilityMatrix,
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

function supportsNativeDocumentMimeType(capabilities: RuntimeInputCapabilities, mimeType: string): boolean {
  if (!capabilities.nativeDocumentInput) {
    return false;
  }

  const normalizedMimeType = normalizeMimeType(mimeType);

  if (!normalizedMimeType) {
    return false;
  }

  const supportedMimeTypes = capabilities.supportedDocumentMimeTypes
    .map((entry) => normalizeMimeType(entry))
    .filter((entry) => entry.length > 0);

  if (supportedMimeTypes.length === 0) {
    return true;
  }

  const [majorType] = normalizedMimeType.split("/", 1);

  return supportedMimeTypes.some((entry) => entry === "*/*"
    || entry === normalizedMimeType
    || entry === `${majorType}/*`);
}

function isTrustedLocalAssetPath(localPath: string): boolean {
  if (localPath.trim().length === 0) {
    return false;
  }

  try {
    return statSync(localPath).isFile();
  } catch {
    return false;
  }
}

function resolveLocalPathStatus(localPath: string): RuntimeCompileAssetFact["localPathStatus"] {
  return isTrustedLocalAssetPath(localPath) ? "ready" : "unavailable";
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function createCapabilityMatrix(target: RuntimeCompileTarget): RuntimeCompileCapabilityMatrix {
  return {
    modelCapabilities: target.modelCapabilities ? snapshotCapabilities(target.modelCapabilities) : null,
    transportCapabilities: target.transportCapabilities ? snapshotCapabilities(target.transportCapabilities) : null,
    effectiveCapabilities: snapshotCapabilities(target.capabilities),
    assetFacts: [],
  };
}

function snapshotCapabilities(capabilities: RuntimeInputCapabilities): RuntimeCompileCapabilitySnapshot {
  return {
    nativeTextInput: capabilities.nativeTextInput,
    nativeImageInput: capabilities.nativeImageInput,
    nativeDocumentInput: capabilities.nativeDocumentInput,
    supportedDocumentMimeTypes: [...capabilities.supportedDocumentMimeTypes],
  };
}

function buildCompileAssetFact(input: {
  target: RuntimeCompileTarget;
  asset: TaskInputAsset;
  localPathStatus: RuntimeCompileAssetFact["localPathStatus"];
}): Omit<RuntimeCompileAssetFact, "handling"> {
  if (input.asset.kind === "image") {
    return {
      assetId: input.asset.assetId,
      kind: input.asset.kind,
      mimeType: input.asset.mimeType,
      localPathStatus: input.localPathStatus,
      modelNativeSupport: input.target.modelCapabilities?.nativeImageInput ?? null,
      transportNativeSupport: input.target.transportCapabilities?.nativeImageInput ?? null,
      effectiveNativeSupport: input.target.capabilities.nativeImageInput,
      modelMimeTypeSupported: null,
      transportMimeTypeSupported: null,
      effectiveMimeTypeSupported: null,
    };
  }

  const modelDocumentFacts = describeDocumentSupport(input.target.modelCapabilities, input.asset.mimeType);
  const transportDocumentFacts = describeDocumentSupport(input.target.transportCapabilities, input.asset.mimeType);
  const effectiveDocumentFacts = describeDocumentSupport(input.target.capabilities, input.asset.mimeType);

  return {
    assetId: input.asset.assetId,
    kind: input.asset.kind,
    mimeType: input.asset.mimeType,
    localPathStatus: input.localPathStatus,
    modelNativeSupport: modelDocumentFacts.nativeSupported,
    transportNativeSupport: transportDocumentFacts.nativeSupported,
    effectiveNativeSupport: effectiveDocumentFacts.nativeSupported ?? false,
    modelMimeTypeSupported: modelDocumentFacts.mimeTypeSupported,
    transportMimeTypeSupported: transportDocumentFacts.mimeTypeSupported,
    effectiveMimeTypeSupported: effectiveDocumentFacts.mimeTypeSupported,
  };
}

function describeDocumentSupport(
  capabilities: RuntimeInputCapabilities | null | undefined,
  mimeType: string,
): {
  nativeSupported: boolean | null;
  mimeTypeSupported: boolean | null;
} {
  if (!capabilities) {
    return {
      nativeSupported: null,
      mimeTypeSupported: null,
    };
  }

  if (!capabilities.nativeDocumentInput) {
    return {
      nativeSupported: false,
      mimeTypeSupported: null,
    };
  }

  const mimeTypeSupported = supportsNativeDocumentMimeType(capabilities, mimeType);
  return {
    nativeSupported: mimeTypeSupported,
    mimeTypeSupported,
  };
}

function createDocumentFallbackWarning(
  capabilities: RuntimeInputCapabilities,
  asset: TaskInputAsset,
): RuntimeCompileWarning {
  if (!capabilities.nativeDocumentInput) {
    return {
      code: "DOCUMENT_NATIVE_INPUT_FALLBACK",
      message: "当前 runtime 未声明支持原生文档输入，文档已退化为路径提示。",
      assetId: asset.assetId,
    };
  }

  const normalizedMimeType = normalizeMimeType(asset.mimeType) || asset.mimeType || "<unknown>";
  return {
    code: "DOCUMENT_MIME_TYPE_FALLBACK",
    message: `当前 runtime 未声明支持文档 MIME 类型 ${normalizedMimeType}，文档已退化为路径提示。`,
    assetId: asset.assetId,
  };
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
