import { SqliteCodexSessionRegistry } from "../storage/index.js";

export interface ChannelIdentityInput {
  channel: string;
  channelUserId: string;
  displayName?: string;
}

export interface IdentityStatusSnapshot {
  channel: string;
  channelUserId: string;
  principalId: string;
  principalDisplayName?: string;
}

export interface IdentityLinkCodeSnapshot {
  code: string;
  expiresAt: string;
  principalId: string;
}

export interface IdentityLinkClaimResult {
  principalId: string;
  targetChannel: string;
  targetChannelUserId: string;
  sourceChannel: string;
  sourceChannelUserId: string;
  alreadyLinked: boolean;
}

const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PRIVATE_ASSISTANT_PRINCIPAL_ID = "principal-local-owner";

export class IdentityLinkService {
  private readonly store: SqliteCodexSessionRegistry;

  constructor(store: SqliteCodexSessionRegistry) {
    this.store = store;
  }

  ensureIdentity(input: ChannelIdentityInput): IdentityStatusSnapshot {
    const channel = input.channel.trim();
    const channelUserId = input.channelUserId.trim();

    if (!channel || !channelUserId) {
      throw new Error("渠道身份缺少必要字段。");
    }

    const now = new Date().toISOString();
    const principal = this.ensureDefaultPrincipal(input.displayName, now);
    const existingIdentity = this.store.getChannelIdentity(channel, channelUserId);

    if (existingIdentity) {
      if (existingIdentity.principalId !== principal.principalId) {
        this.store.mergePrincipals(existingIdentity.principalId, principal.principalId, now);
      }

      this.store.saveChannelIdentity({
        channel,
        channelUserId,
        principalId: principal.principalId,
        createdAt: existingIdentity.createdAt,
        updatedAt: now,
      });

      return {
        channel,
        channelUserId,
        principalId: principal.principalId,
        ...(principal.displayName ? { principalDisplayName: principal.displayName } : {}),
      };
    }

    this.store.saveChannelIdentity({
      channel,
      channelUserId,
      principalId: principal.principalId,
      createdAt: now,
      updatedAt: now,
    });

    return {
      channel,
      channelUserId,
      principalId: principal.principalId,
      ...(principal.displayName ? { principalDisplayName: principal.displayName } : {}),
    };
  }

  issueLinkCode(input: ChannelIdentityInput): IdentityLinkCodeSnapshot {
    const identity = this.ensureIdentity(input);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();
    const code = createLinkCode();

    this.store.deleteExpiredIdentityLinkCodes(now);
    this.store.saveIdentityLinkCode({
      code,
      sourceChannel: identity.channel,
      sourceChannelUserId: identity.channelUserId,
      sourcePrincipalId: identity.principalId,
      createdAt: now,
      expiresAt,
    });

    return {
      code,
      expiresAt,
      principalId: identity.principalId,
    };
  }

  claimLinkCode(code: string, targetInput: ChannelIdentityInput): IdentityLinkClaimResult {
    const normalizedCode = code.trim().toUpperCase();

    if (!normalizedCode) {
      throw new Error("绑定码不能为空。");
    }

    const now = new Date().toISOString();
    this.store.deleteExpiredIdentityLinkCodes(now);

    const linkCode = this.store.getIdentityLinkCode(normalizedCode);

    if (!linkCode) {
      throw new Error("绑定码不存在，或已经过期。");
    }

    if (linkCode.consumedAt) {
      throw new Error("这个绑定码已经被使用过了。");
    }

    if (new Date(linkCode.expiresAt).getTime() <= Date.now()) {
      throw new Error("绑定码已经过期。");
    }

    const targetIdentity = this.ensureIdentity(targetInput);
    const alreadyLinked = linkCode.sourcePrincipalId === targetIdentity.principalId;

    if (!alreadyLinked) {
      this.store.mergePrincipals(linkCode.sourcePrincipalId, targetIdentity.principalId, now);
    }

    const consumed = this.store.consumeIdentityLinkCode(
      normalizedCode,
      targetIdentity.channel,
      targetIdentity.channelUserId,
      now,
    );

    if (!consumed) {
      throw new Error("绑定码状态更新失败，请重试。");
    }

    return {
      principalId: targetIdentity.principalId,
      targetChannel: targetIdentity.channel,
      targetChannelUserId: targetIdentity.channelUserId,
      sourceChannel: linkCode.sourceChannel,
      sourceChannelUserId: linkCode.sourceChannelUserId,
      alreadyLinked,
    };
  }

  private ensureDefaultPrincipal(displayName: string | undefined, now: string): {
    principalId: string;
    displayName?: string;
    createdAt: string;
    updatedAt: string;
  } {
    const existing = this.store.getPrincipal(DEFAULT_PRIVATE_ASSISTANT_PRINCIPAL_ID);

    if (existing) {
      if (displayName?.trim() && !existing.displayName) {
        this.store.savePrincipal({
          principalId: existing.principalId,
          displayName: displayName.trim(),
          createdAt: existing.createdAt,
          updatedAt: now,
        });

        return {
          principalId: existing.principalId,
          displayName: displayName.trim(),
          createdAt: existing.createdAt,
          updatedAt: now,
        };
      }

      return existing;
    }

    const created = {
      principalId: DEFAULT_PRIVATE_ASSISTANT_PRINCIPAL_ID,
      ...(displayName?.trim() ? { displayName: displayName.trim() } : {}),
      createdAt: now,
      updatedAt: now,
    };

    this.store.savePrincipal(created);
    return created;
  }
}

function createLinkCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const first = randomCodePart(alphabet, 4);
  const second = randomCodePart(alphabet, 4);
  return `${first}-${second}`;
}

function randomCodePart(alphabet: string, length: number): string {
  let result = "";

  for (let index = 0; index < length; index += 1) {
    const randomIndex = Math.floor(Math.random() * alphabet.length);
    result += alphabet[randomIndex];
  }

  return result;
}
