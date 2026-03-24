import { IdentityLinkService } from "./identity-link-service.js";
import type { TaskRequest } from "../types/index.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

export interface ResolvedConversationRequest {
  request: TaskRequest;
  conversationId?: string;
  principalId?: string;
  channelSessionKey?: string;
}

export class ConversationService {
  private readonly store: SqliteCodexSessionRegistry;
  private readonly identityLinkService: IdentityLinkService;

  constructor(store: SqliteCodexSessionRegistry, identityLinkService: IdentityLinkService) {
    this.store = store;
    this.identityLinkService = identityLinkService;
  }

  resolveRequest(request: TaskRequest): ResolvedConversationRequest {
    const sourceChannel = request.sourceChannel.trim();
    const channelUserId = request.user.userId.trim();
    const channelSessionKey = normalizeText(request.channelContext.channelSessionKey)
      ?? normalizeText(request.channelContext.sessionId);

    if (!sourceChannel || !channelUserId || !channelSessionKey) {
      return {
        request,
      };
    }

    const now = request.createdAt || new Date().toISOString();
    let principalId = this.identityLinkService.ensureIdentity({
      channel: sourceChannel,
      channelUserId,
      ...(request.user.displayName?.trim() ? { displayName: request.user.displayName.trim() } : {}),
    }).principalId;
    const existingBinding = this.store.getChannelConversationBinding(sourceChannel, principalId, channelSessionKey);

    if (existingBinding) {
      return {
        request: injectConversation(request, existingBinding.conversationId, channelSessionKey),
        conversationId: existingBinding.conversationId,
        principalId,
        channelSessionKey,
      };
    }

    const existingConversation = this.store.getConversation(channelSessionKey);

    if (existingConversation) {
      this.store.saveChannelConversationBinding({
        channel: sourceChannel,
        principalId,
        channelSessionKey,
        conversationId: existingConversation.conversationId,
        createdAt: now,
        updatedAt: now,
      });

      this.store.touchConversation(existingConversation.conversationId, now, buildConversationTitle(request.goal));

      return {
        request: injectConversation(request, existingConversation.conversationId, channelSessionKey),
        conversationId: existingConversation.conversationId,
        principalId,
        channelSessionKey,
      };
    }

    const conversationId = channelSessionKey;
    this.store.saveConversation({
      conversationId,
      principalId,
      title: buildConversationTitle(request.goal),
      createdAt: now,
      updatedAt: now,
    });
    this.store.saveChannelConversationBinding({
      channel: sourceChannel,
      principalId,
      channelSessionKey,
      conversationId,
      createdAt: now,
      updatedAt: now,
    });

    return {
      request: injectConversation(request, conversationId, channelSessionKey),
      conversationId,
      principalId,
      channelSessionKey,
    };
  }
}

function injectConversation(
  request: TaskRequest,
  conversationId: string,
  channelSessionKey: string,
): TaskRequest {
  return {
    ...request,
    channelContext: {
      ...request.channelContext,
      sessionId: conversationId,
      channelSessionKey,
    },
  };
}

function buildConversationTitle(goal: string): string {
  const normalized = goal.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 80) : "新对话";
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
