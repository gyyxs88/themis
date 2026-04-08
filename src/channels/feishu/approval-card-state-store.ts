import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type FeishuApprovalCardRecordStatus = "pending" | "approved" | "denied" | "failed";

export interface FeishuApprovalCardRecord {
  cardKey: string;
  chatId: string;
  messageId: string;
  sessionId: string;
  taskId: string;
  requestId: string;
  actionId: string;
  prompt: string;
  status: FeishuApprovalCardRecordStatus;
  actionSourceChannel?: string;
  actionOwnerUserId?: string;
  actionPrincipalId?: string;
  callbackToken?: string;
  openMessageId?: string;
  actorUserId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

interface FeishuApprovalCardStoreData {
  version: 1;
  cards: FeishuApprovalCardRecord[];
}

export interface FeishuApprovalCardStateStoreOptions {
  filePath?: string;
}

const DEFAULT_FILE_PATH = resolve(process.cwd(), "infra/local/feishu-approval-cards.json");
const EMPTY_STORE: FeishuApprovalCardStoreData = {
  version: 1,
  cards: [],
};

export class FeishuApprovalCardStateStore {
  private readonly filePath: string;

  constructor(options: FeishuApprovalCardStateStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_FILE_PATH;
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  get(cardKey: string): FeishuApprovalCardRecord | null {
    const normalizedCardKey = normalizeRequiredText(cardKey);
    if (!normalizedCardKey) {
      return null;
    }

    const store = this.readStore();
    const record = store.cards.find((entry) => entry.cardKey === normalizedCardKey);
    return record ? cloneRecord(record) : null;
  }

  save(record: FeishuApprovalCardRecord): FeishuApprovalCardRecord {
    const normalized = normalizeRecord(record);
    const store = this.readStore();
    const index = store.cards.findIndex((entry) => entry.cardKey === normalized.cardKey);

    if (index >= 0) {
      store.cards[index] = normalized;
    } else {
      store.cards.push(normalized);
    }

    store.cards.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    this.writeStore(store);
    return cloneRecord(normalized);
  }

  readSnapshot(): FeishuApprovalCardRecord[] {
    return this.readStore().cards.map(cloneRecord);
  }

  private readStore(): FeishuApprovalCardStoreData {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<FeishuApprovalCardStoreData> | null;

      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.cards)) {
        return cloneEmptyStore();
      }

      return {
        version: 1,
        cards: parsed.cards.map(normalizeRecord),
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return cloneEmptyStore();
      }

      return cloneEmptyStore();
    }
  }

  private writeStore(store: FeishuApprovalCardStoreData): void {
    writeFileSync(this.filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }
}

function normalizeRecord(record: FeishuApprovalCardRecord): FeishuApprovalCardRecord {
  const actionSourceChannel = normalizeOptionalText(record.actionSourceChannel);
  const actionOwnerUserId = normalizeOptionalText(record.actionOwnerUserId);
  const actionPrincipalId = normalizeOptionalText(record.actionPrincipalId);
  const callbackToken = normalizeOptionalText(record.callbackToken);
  const openMessageId = normalizeOptionalText(record.openMessageId);
  const actorUserId = normalizeOptionalText(record.actorUserId);
  const lastError = normalizeOptionalText(record.lastError);
  const resolvedAt = normalizeOptionalText(record.resolvedAt);

  return {
    cardKey: normalizeRequiredText(record.cardKey, "审批卡缺少 cardKey。"),
    chatId: normalizeRequiredText(record.chatId, "审批卡缺少 chatId。"),
    messageId: normalizeRequiredText(record.messageId, "审批卡缺少 messageId。"),
    sessionId: normalizeRequiredText(record.sessionId, "审批卡缺少 sessionId。"),
    taskId: normalizeRequiredText(record.taskId, "审批卡缺少 taskId。"),
    requestId: normalizeRequiredText(record.requestId, "审批卡缺少 requestId。"),
    actionId: normalizeRequiredText(record.actionId, "审批卡缺少 actionId。"),
    prompt: normalizeRequiredText(record.prompt, "审批卡缺少 prompt。"),
    status: normalizeStatus(record.status),
    ...(actionSourceChannel ? { actionSourceChannel } : {}),
    ...(actionOwnerUserId ? { actionOwnerUserId } : {}),
    ...(actionPrincipalId ? { actionPrincipalId } : {}),
    ...(callbackToken ? { callbackToken } : {}),
    ...(openMessageId ? { openMessageId } : {}),
    ...(actorUserId ? { actorUserId } : {}),
    ...(lastError ? { lastError } : {}),
    createdAt: normalizeTimestamp(record.createdAt),
    updatedAt: normalizeTimestamp(record.updatedAt),
    ...(resolvedAt ? { resolvedAt: normalizeTimestamp(resolvedAt) } : {}),
  };
}

function normalizeStatus(status: FeishuApprovalCardRecordStatus): FeishuApprovalCardRecordStatus {
  return status === "approved" || status === "denied" || status === "failed" ? status : "pending";
}

function normalizeRequiredText(value: string, message = "审批卡状态缺少必要字段。"): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("审批卡状态包含非法时间字段。");
  }

  return new Date(parsed).toISOString();
}

function cloneRecord(record: FeishuApprovalCardRecord): FeishuApprovalCardRecord {
  return {
    ...record,
  };
}

function cloneEmptyStore(): FeishuApprovalCardStoreData {
  return {
    version: 1,
    cards: [],
  };
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "ENOENT";
}
