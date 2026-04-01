import type { TaskAttachment, TaskInputAsset, TaskInputEnvelope, TaskInputPart } from "../types/index.js";

type TaskInputDraftPart =
  | Omit<Extract<TaskInputPart, { type: "text" }>, "partId">
  | Omit<Extract<TaskInputPart, { type: "image" }>, "partId">
  | Omit<Extract<TaskInputPart, { type: "document" }>, "partId">;

export function createTaskInputEnvelope(input: {
  sourceChannel: TaskInputEnvelope["sourceChannel"];
  sourceSessionId?: string;
  sourceMessageId?: string;
  createdAt: string;
  parts: TaskInputDraftPart[];
  assets: TaskInputAsset[];
}): TaskInputEnvelope {
  const parts: TaskInputPart[] = [...input.parts]
    .sort((left, right) => left.order - right.order)
    .map((part, index) => {
      const partId = `part-${index + 1}`;

      if (part.type === "text") {
        return {
          ...part,
          partId,
        };
      }

      return {
        ...part,
        partId,
      };
    });

  return {
    envelopeId: createId("input-envelope"),
    sourceChannel: input.sourceChannel,
    ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}),
    ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
    parts,
    assets: [...input.assets],
    createdAt: input.createdAt,
  };
}

export function listEnvelopeAssetsByOrder(envelope: TaskInputEnvelope): TaskInputAsset[] {
  const assetById = new Map(envelope.assets.map((asset) => [asset.assetId, asset]));

  return envelope.parts
    .filter((part): part is Extract<TaskInputPart, { type: "image" | "document" }> => part.type !== "text")
    .map((part) => assetById.get(part.assetId))
    .filter((asset): asset is TaskInputAsset => Boolean(asset));
}

export function buildLegacyAttachmentsFromEnvelope(envelope: TaskInputEnvelope): TaskAttachment[] {
  return listEnvelopeAssetsByOrder(envelope).map((asset) => ({
    id: asset.assetId,
    type: asset.kind === "image" ? "image" : "file",
    ...(asset.name ? { name: asset.name } : {}),
    value: asset.localPath,
  }));
}

function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}
