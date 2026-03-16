export const KNOWN_CHANNEL_IDS = ["web", "feishu", "cli"] as const;

export type KnownChannelId = (typeof KNOWN_CHANNEL_IDS)[number];
export type ChannelId = KnownChannelId | (string & {});

export interface ChannelUser {
  userId: string;
  displayName?: string;
  tenantId?: string;
}

export interface ChannelContext {
  sessionId?: string;
  threadId?: string;
  messageId?: string;
  replyTarget?: string;
  callbackToken?: string;
  locale?: string;
  rawRef?: string;
}
