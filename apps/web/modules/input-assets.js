import { createId } from "./utils.js";

export function createInputAssetsApi(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const createEnvelopeId = options.createId ?? (() => createId("input-envelope"));

  return {
    async uploadFile(file) {
      const formData = new FormData();
      formData.set("file", file);

      const response = await fetchImpl("/api/input-assets", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = await safeReadJson(response);
        throw new Error(payload?.error ?? "上传附件失败");
      }

      const payload = await response.json();
      return payload.asset;
    },

    async buildDraftEnvelope({
      sourceChannel,
      createdAt,
      draftGoal,
      draftAssets,
    }) {
      const assets = [];
      const parts = [];
      let nextOrder = 1;

      if (typeof draftGoal === "string" && draftGoal.trim()) {
        parts.push({
          partId: `part-${nextOrder}`,
          type: "text",
          role: "user",
          order: nextOrder,
          text: draftGoal.trim(),
        });
        nextOrder += 1;
      }

      for (const draftAsset of Array.isArray(draftAssets) ? draftAssets : []) {
        const asset = await resolveDraftAsset(draftAsset, this.uploadFile);
        assets.push(asset);
        parts.push({
          partId: `part-${nextOrder}`,
          type: asset.kind === "image" ? "image" : "document",
          role: "user",
          order: nextOrder,
          assetId: asset.assetId,
        });
        nextOrder += 1;
      }

      return {
        envelopeId: createEnvelopeId(),
        sourceChannel,
        parts,
        assets,
        createdAt,
      };
    },
  };
}

async function resolveDraftAsset(draftAsset, uploadFile) {
  if (draftAsset && typeof draftAsset === "object" && typeof draftAsset.assetId === "string" && typeof draftAsset.localPath === "string") {
    const { file: _file, ...asset } = draftAsset;
    return asset;
  }

  const file = draftAsset?.file;

  if (!(file instanceof File)) {
    throw new Error("草稿附件缺少已上传资产或可上传文件。");
  }

  return await uploadFile(file);
}

async function safeReadJson(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}
