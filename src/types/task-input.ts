import type { ChannelId } from "./channel.js";

export type TaskInputPart =
  | {
      partId: string;
      type: "text";
      role: "user";
      order: number;
      text: string;
    }
  | {
      partId: string;
      type: "image";
      role: "user";
      order: number;
      assetId: string;
      caption?: string;
    }
  | {
      partId: string;
      type: "document";
      role: "user";
      order: number;
      assetId: string;
      caption?: string;
    };

export interface TaskInputAsset {
  assetId: string;
  kind: "image" | "document";
  name?: string;
  mimeType: string;
  sizeBytes?: number;
  localPath: string;
  sourceChannel: ChannelId;
  sourceMessageId?: string;
  ingestionStatus: "ready" | "processing" | "failed";
  textExtraction?: {
    status: "not_started" | "completed" | "failed";
    textPath?: string;
    textPreview?: string;
  };
  metadata?: {
    width?: number;
    height?: number;
    pageCount?: number;
    languageHint?: string;
  };
}

export interface TaskInputEnvelope {
  envelopeId: string;
  sourceChannel: ChannelId;
  sourceSessionId?: string;
  sourceMessageId?: string;
  parts: TaskInputPart[];
  assets: TaskInputAsset[];
  createdAt: string;
}

export interface RuntimeInputCapabilities {
  nativeTextInput: boolean;
  nativeImageInput: boolean;
  nativeDocumentInput: boolean;
  supportedDocumentMimeTypes: string[];
  supportsPdfTextExtraction: boolean;
  supportsDocumentPageRasterization: boolean;
}
