import type { SqliteCodexSessionRegistry, StoredPrincipalRecord } from "../storage/index.js";
import type {
  AgentMessageType,
  ManagedAgentPriority,
  ManagedAgentWorkItemSourceType,
  StoredAgentHandoffRecord,
  StoredAgentMailboxEntryRecord,
  StoredAgentMessageRecord,
  StoredAgentRunRecord,
  StoredAgentWorkItemRecord,
  StoredManagedAgentRecord,
  StoredOrganizationRecord,
} from "../types/index.js";

const DEFAULT_MAILBOX_LEASE_TTL_MS = 5 * 60 * 1000;
const ACTIVE_AGENT_RUN_STATUSES = new Set<string>(["created", "starting", "running", "waiting_action"]);

export interface ManagedAgentCoordinationServiceOptions {
  registry: SqliteCodexSessionRegistry;
  mailboxLeaseTtlMs?: number;
}

export interface DispatchWorkItemInput {
  ownerPrincipalId: string;
  targetAgentId: string;
  sourceType?: ManagedAgentWorkItemSourceType;
  sourcePrincipalId?: string;
  sourceAgentId?: string;
  parentWorkItemId?: string;
  dispatchReason: string;
  goal: string;
  contextPacket?: unknown;
  priority?: ManagedAgentPriority;
  workspacePolicySnapshot?: unknown;
  runtimeProfileSnapshot?: unknown;
  scheduledAt?: string;
  now?: string;
}

export interface DispatchWorkItemResult {
  organization: StoredOrganizationRecord;
  targetAgent: StoredManagedAgentRecord;
  workItem: StoredAgentWorkItemRecord;
  dispatchMessage?: StoredAgentMessageRecord;
  mailboxEntry?: StoredAgentMailboxEntryRecord;
}

export interface SendAgentMessageInput {
  ownerPrincipalId: string;
  fromAgentId: string;
  toAgentId: string;
  workItemId?: string;
  runId?: string;
  parentMessageId?: string;
  messageType: AgentMessageType;
  payload?: unknown;
  artifactRefs?: string[];
  priority?: ManagedAgentPriority;
  requiresAck?: boolean;
  now?: string;
}

export interface SendAgentMessageResult {
  organization: StoredOrganizationRecord;
  message: StoredAgentMessageRecord;
  mailboxEntry: StoredAgentMailboxEntryRecord;
}

export interface CreateAgentHandoffInput {
  ownerPrincipalId: string;
  fromAgentId: string;
  toAgentId: string;
  workItemId: string;
  sourceMessageId?: string;
  sourceRunId?: string;
  summary: string;
  blockers?: string[];
  recommendedNextActions?: string[];
  attachedArtifacts?: string[];
  payload?: unknown;
  now?: string;
}

export interface CreateAgentHandoffResult {
  organization: StoredOrganizationRecord;
  handoff: StoredAgentHandoffRecord;
}

export interface ManagedAgentTimelineEntry {
  entryId: string;
  kind: "handoff" | "dispatch" | "waiting" | "response" | "governance" | "delivery" | "cancellation";
  title: string;
  summary: string;
  at: string;
  workItemId?: string;
  handoffId?: string;
  messageId?: string;
  counterpartyAgentId?: string;
  counterpartyDisplayName?: string;
}

export interface ManagedAgentChildWorkItemSummary {
  totalCount: number;
  openCount: number;
  waitingCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
}

export interface ManagedAgentChildWorkItemView {
  workItem: StoredAgentWorkItemRecord;
  targetAgent: StoredManagedAgentRecord | null;
  latestHandoff: StoredAgentHandoffRecord | null;
}

export interface ManagedAgentWorkItemCollaborationView {
  parentWorkItem: StoredAgentWorkItemRecord | null;
  parentTargetAgent: StoredManagedAgentRecord | null;
  childSummary: ManagedAgentChildWorkItemSummary;
  childWorkItems: ManagedAgentChildWorkItemView[];
}

export interface ManagedAgentMailboxItem {
  entry: StoredAgentMailboxEntryRecord;
  message: StoredAgentMessageRecord;
}

export interface PullMailboxEntryResult {
  agent: StoredManagedAgentRecord;
  item: ManagedAgentMailboxItem | null;
}

export interface RespondToMailboxEntryInput {
  ownerPrincipalId: string;
  agentId: string;
  mailboxEntryId: string;
  decision?: "approve" | "deny";
  inputText?: string;
  payload?: unknown;
  artifactRefs?: string[];
  priority?: ManagedAgentPriority;
  now?: string;
}

export interface RespondToMailboxEntryResult {
  organization: StoredOrganizationRecord;
  agent: StoredManagedAgentRecord;
  sourceMailboxEntry: StoredAgentMailboxEntryRecord;
  sourceMessage: StoredAgentMessageRecord;
  responseMessage: StoredAgentMessageRecord;
  responseMailboxEntry: StoredAgentMailboxEntryRecord;
  resumedWorkItem?: StoredAgentWorkItemRecord;
  resumedRuns: StoredAgentRunRecord[];
}

export interface RespondToHumanWaitingWorkItemInput {
  ownerPrincipalId: string;
  workItemId: string;
  decision?: "approve" | "deny";
  inputText?: string;
  payload?: unknown;
  artifactRefs?: string[];
  now?: string;
}

export interface RespondToHumanWaitingWorkItemResult {
  organization: StoredOrganizationRecord;
  targetAgent: StoredManagedAgentRecord;
  workItem: StoredAgentWorkItemRecord;
  resumedRuns: StoredAgentRunRecord[];
}

export interface EscalateWaitingAgentWorkItemToHumanInput {
  ownerPrincipalId: string;
  workItemId: string;
  inputText?: string;
  now?: string;
}

export interface EscalateWaitingAgentWorkItemToHumanResult {
  organization: StoredOrganizationRecord;
  targetAgent: StoredManagedAgentRecord;
  workItem: StoredAgentWorkItemRecord;
  latestWaitingMessage: StoredAgentMessageRecord | null;
  ackedMailboxEntries: StoredAgentMailboxEntryRecord[];
}

export interface CancelWorkItemInput {
  ownerPrincipalId: string;
  workItemId: string;
  reason?: string;
  now?: string;
}

export interface CancelWorkItemResult {
  organization: StoredOrganizationRecord;
  targetAgent: StoredManagedAgentRecord;
  workItem: StoredAgentWorkItemRecord;
  ackedMailboxEntries: StoredAgentMailboxEntryRecord[];
  notificationMessage?: StoredAgentMessageRecord;
  notificationMailboxEntry?: StoredAgentMailboxEntryRecord;
}

export interface OrganizationWaitingQueueSummary {
  totalCount: number;
  waitingHumanCount: number;
  waitingAgentCount: number;
  escalationCount: number;
}

export interface OrganizationWaitingQueueItem {
  workItem: StoredAgentWorkItemRecord;
  organization: StoredOrganizationRecord;
  targetAgent: StoredManagedAgentRecord;
  sourceAgent: StoredManagedAgentRecord | null;
  sourcePrincipal: StoredPrincipalRecord | null;
  latestWaitingMessage: StoredAgentMessageRecord | null;
}

export interface OrganizationWaitingQueueResult {
  summary: OrganizationWaitingQueueSummary;
  items: OrganizationWaitingQueueItem[];
}

export class ManagedAgentCoordinationService {
  private readonly registry: SqliteCodexSessionRegistry;
  private readonly mailboxLeaseTtlMs: number;

  constructor(options: ManagedAgentCoordinationServiceOptions) {
    this.registry = options.registry;
    this.mailboxLeaseTtlMs = Number.isFinite(options.mailboxLeaseTtlMs) && (options.mailboxLeaseTtlMs as number) > 0
      ? Math.floor(options.mailboxLeaseTtlMs as number)
      : DEFAULT_MAILBOX_LEASE_TTL_MS;
  }

  dispatchWorkItem(input: DispatchWorkItemInput): DispatchWorkItemResult {
    const owner = this.requirePrincipal(input.ownerPrincipalId);
    const now = normalizeNow(input.now);
    const targetAgent = this.requireOwnedAgent(owner.principalId, input.targetAgentId);

    if (targetAgent.status !== "active") {
      throw new Error("Managed agent is not active.");
    }

    const organization = this.requireOwnedOrganization(owner.principalId, targetAgent.organizationId);
    const sourceType = input.sourceType ?? (normalizeOptionalText(input.sourceAgentId) ? "agent" : "human");
    const sourceAgent = sourceType === "agent"
      ? this.requireAgentInOrganization(
        normalizeRequiredText(input.sourceAgentId, "Source agent id is required."),
        organization.organizationId,
      )
      : null;

    if (sourceType !== "agent" && normalizeOptionalText(input.sourceAgentId)) {
      throw new Error("Only agent-sourced work items may set sourceAgentId.");
    }

    const sourcePrincipalId = normalizeOptionalText(input.sourcePrincipalId)
      ?? sourceAgent?.principalId
      ?? owner.principalId;

    if (sourceAgent && sourcePrincipalId !== sourceAgent.principalId) {
      throw new Error("Source principal id must match the source agent principal.");
    }

    this.requirePrincipal(sourcePrincipalId);

    const parentWorkItem = normalizeOptionalText(input.parentWorkItemId)
      ? this.requireWorkItemInOrganization(input.parentWorkItemId as string, organization.organizationId)
      : null;
    const workItemId = createId("work-item");
    const workItem: StoredAgentWorkItemRecord = {
      workItemId,
      organizationId: organization.organizationId,
      targetAgentId: targetAgent.agentId,
      sourceType,
      sourcePrincipalId,
      ...(sourceAgent ? { sourceAgentId: sourceAgent.agentId } : {}),
      ...(parentWorkItem ? { parentWorkItemId: parentWorkItem.workItemId } : {}),
      dispatchReason: normalizeRequiredText(input.dispatchReason, "Dispatch reason is required."),
      goal: normalizeRequiredText(input.goal, "Goal is required."),
      ...(input.contextPacket !== undefined ? { contextPacket: input.contextPacket } : {}),
      priority: input.priority ?? "normal",
      status: "queued",
      ...(input.workspacePolicySnapshot !== undefined
        ? { workspacePolicySnapshot: input.workspacePolicySnapshot }
        : {}),
      ...(input.runtimeProfileSnapshot !== undefined
        ? { runtimeProfileSnapshot: input.runtimeProfileSnapshot }
        : {}),
      createdAt: now,
      ...(normalizeOptionalText(input.scheduledAt) ? { scheduledAt: input.scheduledAt } : {}),
      updatedAt: now,
    };
    this.registry.saveAgentWorkItem(workItem);

    if (!sourceAgent) {
      return {
        organization,
        targetAgent,
        workItem,
      };
    }

    const dispatch = this.createMessageEnvelope({
      organization,
      fromAgent: sourceAgent,
      toAgent: targetAgent,
      workItem,
      messageType: "dispatch",
      payload: {
        dispatchReason: workItem.dispatchReason,
        goal: workItem.goal,
        ...(input.contextPacket !== undefined ? { contextPacket: input.contextPacket } : {}),
      },
      priority: workItem.priority,
      requiresAck: true,
      now,
    });

    return {
      organization,
      targetAgent,
      workItem,
      dispatchMessage: dispatch.message,
      mailboxEntry: dispatch.mailboxEntry,
    };
  }

  listWorkItems(ownerPrincipalId: string, targetAgentId?: string): StoredAgentWorkItemRecord[] {
    const owner = this.requirePrincipal(ownerPrincipalId);

    if (normalizeOptionalText(targetAgentId)) {
      const agent = this.requireOwnedAgent(owner.principalId, targetAgentId as string);
      return this.registry.listAgentWorkItemsByTargetAgent(agent.agentId);
    }

    return this.registry.listAgentWorkItemsByOwnerPrincipal(owner.principalId);
  }

  getWorkItem(ownerPrincipalId: string, workItemId: string): StoredAgentWorkItemRecord | null {
    const owner = this.requirePrincipal(ownerPrincipalId);
    const workItem = this.registry.getAgentWorkItem(normalizeRequiredText(workItemId, "Work item id is required."));

    if (!workItem) {
      return null;
    }

    return this.isOrganizationOwnedBy(workItem.organizationId, owner.principalId) ? workItem : null;
  }

  getWorkItemCollaboration(
    ownerPrincipalId: string,
    workItemId: string,
  ): ManagedAgentWorkItemCollaborationView {
    const workItem = this.requireOwnedWorkItem(ownerPrincipalId, workItemId);
    const parentWorkItem = normalizeOptionalText(workItem.parentWorkItemId)
      ? this.requireWorkItemInOrganization(workItem.parentWorkItemId as string, workItem.organizationId)
      : null;
    const parentTargetAgent = parentWorkItem
      ? this.registry.getManagedAgent(parentWorkItem.targetAgentId)
      : null;
    const childWorkItems = this.registry
      .listAgentWorkItemsByParentWorkItem(workItem.workItemId)
      .map((childWorkItem) => {
        const handoffs = this.registry.listAgentHandoffsByWorkItem(childWorkItem.workItemId);
        const latestHandoff = handoffs.find((handoff) => handoff.toAgentId === workItem.targetAgentId)
          ?? handoffs[0]
          ?? null;

        return {
          workItem: childWorkItem,
          targetAgent: this.registry.getManagedAgent(childWorkItem.targetAgentId),
          latestHandoff,
        };
      });

    return {
      parentWorkItem,
      parentTargetAgent,
      childSummary: summarizeChildWorkItems(childWorkItems.map((entry) => entry.workItem)),
      childWorkItems,
    };
  }

  listMessagesForWorkItem(ownerPrincipalId: string, workItemId: string): StoredAgentMessageRecord[] {
    const workItem = this.requireOwnedWorkItem(ownerPrincipalId, workItemId);
    return this.registry.listAgentMessagesByWorkItem(workItem.workItemId);
  }

  createAgentHandoff(input: CreateAgentHandoffInput): CreateAgentHandoffResult {
    const owner = this.requirePrincipal(input.ownerPrincipalId);
    const now = normalizeNow(input.now);
    const fromAgent = this.requireOwnedAgent(owner.principalId, input.fromAgentId);
    const organization = this.requireOwnedOrganization(owner.principalId, fromAgent.organizationId);
    const toAgent = this.requireAgentInOrganization(input.toAgentId, organization.organizationId);
    const workItem = this.requireWorkItemInOrganization(input.workItemId, organization.organizationId);
    const sourceMessageId = normalizeOptionalText(input.sourceMessageId);
    const sourceRunId = normalizeOptionalText(input.sourceRunId);

    if (sourceMessageId) {
      this.requireMessageInOrganization(sourceMessageId, organization.organizationId);
    }

    const handoff: StoredAgentHandoffRecord = {
      handoffId: buildHandoffId(sourceMessageId, fromAgent.agentId, toAgent.agentId, workItem.workItemId),
      organizationId: organization.organizationId,
      fromAgentId: fromAgent.agentId,
      toAgentId: toAgent.agentId,
      workItemId: workItem.workItemId,
      ...(sourceMessageId ? { sourceMessageId } : {}),
      ...(sourceRunId ? { sourceRunId } : {}),
      summary: normalizeRequiredText(input.summary, "Handoff summary is required."),
      blockers: dedupeStrings(input.blockers ?? []),
      recommendedNextActions: dedupeStrings(input.recommendedNextActions ?? []),
      attachedArtifacts: dedupeStrings(input.attachedArtifacts ?? []),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.registry.saveAgentHandoff(handoff);

    return {
      organization,
      handoff: this.registry.getAgentHandoff(handoff.handoffId) ?? handoff,
    };
  }

  listHandoffs(
    ownerPrincipalId: string,
    input: {
      agentId: string;
      workItemId?: string;
      limit?: number;
    },
  ): StoredAgentHandoffRecord[] {
    const agent = this.requireOwnedAgent(ownerPrincipalId, input.agentId);
    const workItemId = normalizeOptionalText(input.workItemId);
    const limit = normalizePositiveLimit(input.limit, 20);
    const handoffs = workItemId
      ? this.registry.listAgentHandoffsByWorkItem(workItemId)
        .filter((handoff) => handoff.fromAgentId === agent.agentId || handoff.toAgentId === agent.agentId)
      : this.registry.listAgentHandoffsByAgent(agent.agentId);

    return handoffs.slice(0, limit);
  }

  listTimeline(
    ownerPrincipalId: string,
    input: {
      agentId: string;
      workItemId?: string;
      limit?: number;
    },
  ): ManagedAgentTimelineEntry[] {
    const agent = this.requireOwnedAgent(ownerPrincipalId, input.agentId);
    const limit = normalizePositiveLimit(input.limit, 30);
    const workItemId = normalizeOptionalText(input.workItemId);
    const allWorkItems = this.registry.listAgentWorkItemsByTargetAgent(agent.agentId);
    const workItems = workItemId
      ? allWorkItems.filter((workItem) => workItem.workItemId === workItemId)
      : allWorkItems;
    const relevantWorkItemIds = new Set(workItems.map((entry) => entry.workItemId));
    const handoffList = this.listHandoffs(ownerPrincipalId, input);
    const handoffMessageIds = new Set(
      handoffList
        .map((handoff) => normalizeOptionalText(handoff.sourceMessageId))
        .filter((value): value is string => Boolean(value)),
    );
    const entries: ManagedAgentTimelineEntry[] = handoffList.map((handoff) =>
      this.buildHandoffTimelineEntry(agent.agentId, handoff)
    );

    for (const workItem of workItems) {
      entries.push(this.buildWorkItemDispatchEntry(agent.agentId, workItem));

      const latestHumanResponse = asRecord(workItem.latestHumanResponse);
      const respondedAt = normalizeOptionalText(asString(latestHumanResponse?.respondedAt));

      if (respondedAt) {
        entries.push({
          entryId: `timeline-governance:${workItem.workItemId}:${respondedAt}`,
          kind: "governance",
          title: "收到顶层治理回复",
          summary: buildHumanGovernanceSummary(latestHumanResponse),
          at: respondedAt,
          workItemId: workItem.workItemId,
        });
      }

      if (workItem.status === "completed" || workItem.status === "failed" || workItem.status === "cancelled") {
        const at = normalizeOptionalText(workItem.completedAt) ?? workItem.updatedAt;
        entries.push({
          entryId: `timeline-delivery:${workItem.workItemId}:${at}`,
          kind: workItem.status === "cancelled" ? "cancellation" : "delivery",
          title: workItem.status === "completed"
            ? "work item 已收口"
            : workItem.status === "failed"
              ? "work item 执行失败"
              : "work item 已取消",
          summary: workItem.goal || workItem.dispatchReason,
          at,
          workItemId: workItem.workItemId,
        });
      }
    }

    for (const message of this.registry.listAgentMessagesByAgent(agent.agentId)) {
      if (handoffMessageIds.has(message.messageId)) {
        continue;
      }

      if (workItemId && message.workItemId !== workItemId) {
        continue;
      }

      if (!workItemId && message.workItemId && !relevantWorkItemIds.has(message.workItemId)) {
        continue;
      }

      const entry = this.buildMessageTimelineEntry(agent.agentId, message);

      if (entry) {
        entries.push(entry);
      }
    }

    return dedupeTimelineEntries(entries)
      .sort((left, right) => right.at.localeCompare(left.at) || left.entryId.localeCompare(right.entryId))
      .slice(0, limit);
  }

  listOrganizationWaitingQueue(ownerPrincipalId: string): OrganizationWaitingQueueResult {
    this.requirePrincipal(ownerPrincipalId);
    const workItems = this.registry
      .listAgentWorkItemsByOwnerPrincipal(ownerPrincipalId)
      .filter((workItem) => workItem.status === "waiting_human" || workItem.status === "waiting_agent");
    const items = workItems
      .map((workItem) => this.buildOrganizationWaitingQueueItem(ownerPrincipalId, workItem))
      .filter((item): item is OrganizationWaitingQueueItem => Boolean(item))
      .sort(compareOrganizationWaitingQueueItems);

    return {
      summary: {
        totalCount: items.length,
        waitingHumanCount: items.filter((item) => item.workItem.status === "waiting_human").length,
        waitingAgentCount: items.filter((item) => item.workItem.status === "waiting_agent").length,
        escalationCount: items.filter((item) =>
          item.workItem.status === "waiting_human"
          || item.latestWaitingMessage?.messageType === "escalation"
        ).length,
      },
      items,
    };
  }

  sendAgentMessage(input: SendAgentMessageInput): SendAgentMessageResult {
    const owner = this.requirePrincipal(input.ownerPrincipalId);
    const now = normalizeNow(input.now);
    const fromAgent = this.requireOwnedAgent(owner.principalId, input.fromAgentId);
    const organization = this.requireOwnedOrganization(owner.principalId, fromAgent.organizationId);
    const toAgent = this.requireAgentInOrganization(input.toAgentId, organization.organizationId);
    const workItem = normalizeOptionalText(input.workItemId)
      ? this.requireWorkItemInOrganization(input.workItemId as string, organization.organizationId)
      : null;

    if (workItem && workItem.targetAgentId !== toAgent.agentId && input.messageType === "dispatch") {
      throw new Error("Dispatch message target agent must match the work item target.");
    }

    if (normalizeOptionalText(input.parentMessageId)) {
      this.requireMessageInOrganization(input.parentMessageId as string, organization.organizationId);
    }

    const result = this.createMessageEnvelope({
      organization,
      fromAgent,
      toAgent,
      workItem,
      messageType: input.messageType,
      payload: input.payload,
      ...(input.artifactRefs ? { artifactRefs: input.artifactRefs } : {}),
      priority: input.priority ?? "normal",
      requiresAck: input.requiresAck ?? false,
      ...(normalizeOptionalText(input.parentMessageId) ? { parentMessageId: input.parentMessageId } : {}),
      ...(normalizeOptionalText(input.runId) ? { runId: input.runId } : {}),
      now,
    });

    if (input.messageType === "handoff" && workItem) {
      const payload = asRecord(input.payload);
      this.createAgentHandoff({
        ownerPrincipalId: owner.principalId,
        fromAgentId: fromAgent.agentId,
        toAgentId: toAgent.agentId,
        workItemId: workItem.workItemId,
        sourceMessageId: result.message.messageId,
        ...(normalizeOptionalText(input.runId) ? { sourceRunId: input.runId } : {}),
        summary: normalizeOptionalText(asString(payload?.summary))
          ?? renderMessageSummary(result.message),
        blockers: normalizeStringList(payload?.blockers),
        recommendedNextActions: normalizeStringList(payload?.recommendedNextActions),
        attachedArtifacts: dedupeStrings([
          ...normalizeStringList(payload?.attachedArtifacts),
          ...result.message.artifactRefs,
        ]),
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
        now,
      });
    }

    return result;
  }

  listMailbox(ownerPrincipalId: string, agentId: string): ManagedAgentMailboxItem[] {
    const agent = this.requireOwnedAgent(ownerPrincipalId, agentId);
    const entries = this.registry.listAgentMailboxEntriesByAgent(agent.agentId);
    const items: ManagedAgentMailboxItem[] = [];

    for (const entry of entries) {
      const message = this.registry.getAgentMessage(entry.messageId);

      if (!message) {
        continue;
      }

      items.push({
        entry,
        message,
      });
    }

    return items.sort(compareMailboxItems);
  }

  pullMailboxEntry(ownerPrincipalId: string, agentId: string, now?: string): PullMailboxEntryResult {
    const agent = this.requireOwnedAgent(ownerPrincipalId, agentId);
    const leasedAt = normalizeNow(now);
    const entry = this.registry.claimNextAgentMailboxEntry({
      ownerAgentId: agent.agentId,
      leaseToken: createId("mailbox-lease"),
      leasedAt,
      now: leasedAt,
      staleLeaseBefore: computeMailboxLeaseStaleBefore(leasedAt, this.mailboxLeaseTtlMs),
    });

    if (!entry) {
      return {
        agent,
        item: null,
      };
    }

    const message = this.registry.getAgentMessage(entry.messageId);

    if (!message) {
      throw new Error("Agent message does not exist.");
    }

    return {
      agent,
      item: {
        entry,
        message,
      },
    };
  }

  ackMailboxEntry(ownerPrincipalId: string, agentId: string, mailboxEntryId: string, now?: string): StoredAgentMailboxEntryRecord {
    const agent = this.requireOwnedAgent(ownerPrincipalId, agentId);
    const existing = this.registry.getAgentMailboxEntry(normalizeRequiredText(mailboxEntryId, "Mailbox entry id is required."));

    if (!existing || existing.ownerAgentId !== agent.agentId || existing.organizationId !== agent.organizationId) {
      throw new Error("Mailbox entry does not exist.");
    }

    const ackedAt = normalizeNow(now);
    const { leaseToken: _leaseToken, leasedAt: _leasedAt, ...rest } = existing;
    const updated: StoredAgentMailboxEntryRecord = {
      ...rest,
      status: "acked",
      ackedAt,
      updatedAt: ackedAt,
    };

    this.registry.saveAgentMailboxEntry(updated);
    return this.registry.getAgentMailboxEntry(existing.mailboxEntryId) ?? updated;
  }

  respondToMailboxEntry(input: RespondToMailboxEntryInput): RespondToMailboxEntryResult {
    const agent = this.requireOwnedAgent(input.ownerPrincipalId, input.agentId);
    const now = normalizeNow(input.now);
    const sourceMailboxEntry = this.requireMailboxEntryForAgent(agent, input.mailboxEntryId);
    const sourceMessage = this.requireMessageInOrganization(sourceMailboxEntry.messageId, agent.organizationId);
    const organization = this.requireOwnedOrganization(input.ownerPrincipalId, agent.organizationId);
    const responseMessageType = resolveMailboxResponseMessageType(sourceMessage.messageType);
    const responsePayload = buildMailboxResponsePayload({
      sourceMessageType: sourceMessage.messageType,
      ...(input.decision ? { decision: input.decision } : {}),
      ...(input.inputText ? { inputText: input.inputText } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
    });
    const response = this.createMessageEnvelope({
      organization,
      fromAgent: agent,
      toAgent: this.requireAgentInOrganization(sourceMessage.fromAgentId, organization.organizationId),
      workItem: sourceMessage.workItemId
        ? this.requireWorkItemInOrganization(sourceMessage.workItemId, organization.organizationId)
        : null,
      messageType: responseMessageType,
      payload: responsePayload,
      ...(input.artifactRefs ? { artifactRefs: input.artifactRefs } : {}),
      priority: input.priority ?? sourceMailboxEntry.priority,
      requiresAck: false,
      parentMessageId: sourceMessage.messageId,
      ...(sourceMessage.runId ? { runId: sourceMessage.runId } : {}),
      now,
    });
    const ackedEntry = this.ackMailboxEntry(
      input.ownerPrincipalId,
      agent.agentId,
      sourceMailboxEntry.mailboxEntryId,
      now,
    );

    const resumed = this.tryResumeWaitingWorkItem({
      organization,
      sourceMessage,
      responseMessage: response.message,
      now,
    });
    const responseMailboxEntry = resumed.workItem
      ? this.ackMailboxEntry(
        input.ownerPrincipalId,
        sourceMessage.fromAgentId,
        response.mailboxEntry.mailboxEntryId,
        now,
      )
      : response.mailboxEntry;

    return {
      organization,
      agent,
      sourceMailboxEntry: ackedEntry,
      sourceMessage,
      responseMessage: response.message,
      responseMailboxEntry,
      ...(resumed.workItem ? { resumedWorkItem: resumed.workItem } : {}),
      resumedRuns: resumed.runs,
    };
  }

  respondToHumanWaitingWorkItem(input: RespondToHumanWaitingWorkItemInput): RespondToHumanWaitingWorkItemResult {
    const workItem = this.requireOwnedWorkItem(input.ownerPrincipalId, input.workItemId);

    if (workItem.status !== "waiting_human") {
      throw new Error("Work item is not waiting for human input.");
    }

    const organization = this.requireOwnedOrganization(input.ownerPrincipalId, workItem.organizationId);
    const targetAgent = this.requireAgentInOrganization(workItem.targetAgentId, organization.organizationId);
    const now = normalizeNow(input.now);
    const responsePayload = buildHumanResumePayload({
      waitingActionRequest: workItem.waitingActionRequest,
      ...(input.decision ? { decision: input.decision } : {}),
      ...(input.inputText ? { inputText: input.inputText } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
      ...(input.artifactRefs ? { artifactRefs: input.artifactRefs } : {}),
      now,
    });
    const resumedRuns = interruptActiveRunsForWorkItem(this.registry, workItem.workItemId, now, {
      failureMessage: "Waiting run was superseded by a human governance response.",
    });
    const resumedWorkItem: StoredAgentWorkItemRecord = {
      ...workItem,
      status: "queued",
      latestHumanResponse: responsePayload,
      updatedAt: now,
    };
    this.registry.saveAgentWorkItem(resumedWorkItem);

    return {
      organization,
      targetAgent,
      workItem: this.registry.getAgentWorkItem(workItem.workItemId) ?? resumedWorkItem,
      resumedRuns,
    };
  }

  escalateWaitingAgentWorkItemToHuman(
    input: EscalateWaitingAgentWorkItemToHumanInput,
  ): EscalateWaitingAgentWorkItemToHumanResult {
    const workItem = this.requireOwnedWorkItem(input.ownerPrincipalId, input.workItemId);

    if (workItem.status !== "waiting_agent") {
      throw new Error("Work item is not waiting for agent input.");
    }

    const organization = this.requireOwnedOrganization(input.ownerPrincipalId, workItem.organizationId);
    const targetAgent = this.requireAgentInOrganization(workItem.targetAgentId, organization.organizationId);
    const now = normalizeNow(input.now);
    const latestWaitingMessage = resolveLatestWaitingMessage(
      this.registry.listAgentMessagesByWorkItem(workItem.workItemId),
      workItem,
    );
    const escalatedWaitingActionRequestInput: {
      workItem: StoredAgentWorkItemRecord;
      latestWaitingMessage: StoredAgentMessageRecord | null;
      inputText?: string;
      now: string;
    } = {
      workItem,
      latestWaitingMessage,
      now,
    };
    const escalationInputText = normalizeOptionalText(input.inputText);

    if (escalationInputText) {
      escalatedWaitingActionRequestInput.inputText = escalationInputText;
    }

    const ackedMailboxEntries = acknowledgeOutstandingWaitingMailboxEntries(
      this.registry,
      workItem,
      latestWaitingMessage,
      now,
    );
    const escalatedWorkItem: StoredAgentWorkItemRecord = {
      ...workItem,
      status: "waiting_human",
      waitingActionRequest: buildEscalatedHumanWaitingActionRequest(escalatedWaitingActionRequestInput),
      updatedAt: now,
    };
    this.registry.saveAgentWorkItem(escalatedWorkItem);

    return {
      organization,
      targetAgent,
      workItem: this.registry.getAgentWorkItem(workItem.workItemId) ?? escalatedWorkItem,
      latestWaitingMessage,
      ackedMailboxEntries,
    };
  }

  cancelWorkItem(input: CancelWorkItemInput): CancelWorkItemResult {
    const workItem = this.requireOwnedWorkItem(input.ownerPrincipalId, input.workItemId);
    const organization = this.requireOwnedOrganization(input.ownerPrincipalId, workItem.organizationId);
    const targetAgent = this.requireAgentInOrganization(workItem.targetAgentId, organization.organizationId);
    const now = normalizeNow(input.now);

    if (workItem.status === "cancelled") {
      return {
        organization,
        targetAgent,
        workItem,
        ackedMailboxEntries: [],
      };
    }

    if (workItem.status === "completed" || workItem.status === "failed") {
      throw new Error("Completed or failed work item cannot be cancelled.");
    }

    const runs = this.registry.listAgentRunsByWorkItem(workItem.workItemId);
    const hasUnsafeActiveRuns = runs.some((run) =>
      ACTIVE_AGENT_RUN_STATUSES.has(run.status)
      && run.status !== "waiting_action"
    );

    if (hasUnsafeActiveRuns) {
      throw new Error("Work item has active runs and cannot be cancelled yet.");
    }

    cancelWaitingActionRunsForWorkItem(this.registry, workItem.workItemId, now);

    const ackedMailboxEntries = acknowledgeOpenMailboxEntriesForWorkItem(
      this.registry,
      organization.organizationId,
      workItem.workItemId,
      now,
    );
    const cancelledWorkItem: StoredAgentWorkItemRecord = {
      ...workItem,
      status: "cancelled",
      waitingActionRequest: undefined,
      latestHumanResponse: undefined,
      completedAt: now,
      updatedAt: now,
    };
    this.registry.saveAgentWorkItem(cancelledWorkItem);
    const persistedWorkItem = this.registry.getAgentWorkItem(workItem.workItemId) ?? cancelledWorkItem;
    const sourceAgentId = normalizeOptionalText(workItem.sourceAgentId);

    if (!sourceAgentId || sourceAgentId === targetAgent.agentId) {
      return {
        organization,
        targetAgent,
        workItem: persistedWorkItem,
        ackedMailboxEntries,
      };
    }

    const sourceAgent = this.requireAgentInOrganization(sourceAgentId, organization.organizationId);
    const notification = this.createMessageEnvelope({
      organization,
      fromAgent: targetAgent,
      toAgent: sourceAgent,
      workItem: persistedWorkItem,
      messageType: "cancel",
      payload: {
        status: "cancelled",
        reason: normalizeOptionalText(input.reason) ?? "Cancelled by top-level governance.",
        cancelledAt: now,
        cancelledByPrincipalId: input.ownerPrincipalId,
      },
      priority: persistedWorkItem.priority,
      requiresAck: false,
      now,
    });

    return {
      organization,
      targetAgent,
      workItem: persistedWorkItem,
      ackedMailboxEntries,
      notificationMessage: notification.message,
      notificationMailboxEntry: notification.mailboxEntry,
    };
  }

  private createMessageEnvelope(input: {
    organization: StoredOrganizationRecord;
    fromAgent: StoredManagedAgentRecord;
    toAgent: StoredManagedAgentRecord;
    workItem: StoredAgentWorkItemRecord | null;
    messageType: AgentMessageType;
    payload?: unknown;
    artifactRefs?: string[];
    priority: ManagedAgentPriority;
    requiresAck: boolean;
    parentMessageId?: string;
    runId?: string;
    now: string;
  }): SendAgentMessageResult {
    const message: StoredAgentMessageRecord = {
      messageId: createId("msg"),
      organizationId: input.organization.organizationId,
      fromAgentId: input.fromAgent.agentId,
      toAgentId: input.toAgent.agentId,
      ...(input.workItem ? { workItemId: input.workItem.workItemId } : {}),
      ...(normalizeOptionalText(input.runId) ? { runId: input.runId } : {}),
      ...(normalizeOptionalText(input.parentMessageId) ? { parentMessageId: input.parentMessageId } : {}),
      messageType: input.messageType,
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
      artifactRefs: dedupeStrings(input.artifactRefs ?? []),
      priority: input.priority,
      requiresAck: input.requiresAck,
      createdAt: input.now,
    };
    this.registry.saveAgentMessage(message);

    const mailboxEntry: StoredAgentMailboxEntryRecord = {
      mailboxEntryId: createId("mailbox"),
      organizationId: input.organization.organizationId,
      ownerAgentId: input.toAgent.agentId,
      messageId: message.messageId,
      ...(input.workItem ? { workItemId: input.workItem.workItemId } : {}),
      priority: input.priority,
      status: "pending",
      requiresAck: input.requiresAck,
      availableAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.registry.saveAgentMailboxEntry(mailboxEntry);

    return {
      organization: input.organization,
      message,
      mailboxEntry,
    };
  }

  private buildHandoffTimelineEntry(
    selectedAgentId: string,
    handoff: StoredAgentHandoffRecord,
  ): ManagedAgentTimelineEntry {
    const outgoing = handoff.fromAgentId === selectedAgentId;
    const counterpartyAgentId = outgoing ? handoff.toAgentId : handoff.fromAgentId;
    const counterparty = this.registry.getManagedAgent(counterpartyAgentId);

    return {
      entryId: `timeline-handoff:${handoff.handoffId}`,
      kind: "handoff",
      title: outgoing ? "发起交接" : "收到交接",
      summary: buildHandoffSummaryText(handoff),
      at: handoff.createdAt,
      workItemId: handoff.workItemId,
      handoffId: handoff.handoffId,
      ...(handoff.sourceMessageId ? { messageId: handoff.sourceMessageId } : {}),
      counterpartyAgentId,
      counterpartyDisplayName: counterparty?.displayName ?? counterpartyAgentId,
    };
  }

  private buildWorkItemDispatchEntry(
    selectedAgentId: string,
    workItem: StoredAgentWorkItemRecord,
  ): ManagedAgentTimelineEntry {
    const sourceAgentId = normalizeOptionalText(workItem.sourceAgentId);
    const sourceAgent = sourceAgentId ? this.registry.getManagedAgent(sourceAgentId) : null;

    return {
      entryId: `timeline-dispatch:${workItem.workItemId}`,
      kind: "dispatch",
      title: "收到派工",
      summary: buildDispatchTimelineSummary(workItem, sourceAgent?.displayName),
      at: workItem.createdAt,
      workItemId: workItem.workItemId,
      ...(sourceAgentId ? { counterpartyAgentId: sourceAgentId } : {}),
      ...(sourceAgent?.displayName ? { counterpartyDisplayName: sourceAgent.displayName } : {}),
    };
  }

  private buildMessageTimelineEntry(
    selectedAgentId: string,
    message: StoredAgentMessageRecord,
  ): ManagedAgentTimelineEntry | null {
    const outgoing = message.fromAgentId === selectedAgentId;
    const counterpartyAgentId = outgoing ? message.toAgentId : message.fromAgentId;
    const counterparty = this.registry.getManagedAgent(counterpartyAgentId);
    const counterpartyDisplayName = counterparty?.displayName ?? counterpartyAgentId;
    const summary = renderMessageSummary(message);

    switch (message.messageType) {
      case "dispatch":
        return null;
      case "question":
        return {
          entryId: `timeline-message:${message.messageId}`,
          kind: "waiting",
          title: outgoing ? "向上游提问" : "收到问题",
          summary,
          at: message.createdAt,
          ...(message.workItemId ? { workItemId: message.workItemId } : {}),
          messageId: message.messageId,
          counterpartyAgentId,
          counterpartyDisplayName,
        };
      case "approval_request":
        return {
          entryId: `timeline-message:${message.messageId}`,
          kind: "waiting",
          title: outgoing ? "发起审批请求" : "收到审批请求",
          summary,
          at: message.createdAt,
          ...(message.workItemId ? { workItemId: message.workItemId } : {}),
          messageId: message.messageId,
          counterpartyAgentId,
          counterpartyDisplayName,
        };
      case "escalation":
        return {
          entryId: `timeline-message:${message.messageId}`,
          kind: "governance",
          title: outgoing ? "升级阻塞" : "收到升级阻塞",
          summary,
          at: message.createdAt,
          ...(message.workItemId ? { workItemId: message.workItemId } : {}),
          messageId: message.messageId,
          counterpartyAgentId,
          counterpartyDisplayName,
        };
      case "approval_result":
      case "answer":
      case "status_update":
        return {
          entryId: `timeline-message:${message.messageId}`,
          kind: "response",
          title: outgoing ? "发出回复" : "收到回复",
          summary,
          at: message.createdAt,
          ...(message.workItemId ? { workItemId: message.workItemId } : {}),
          messageId: message.messageId,
          counterpartyAgentId,
          counterpartyDisplayName,
        };
      case "cancel":
        return {
          entryId: `timeline-message:${message.messageId}`,
          kind: "cancellation",
          title: outgoing ? "通知取消" : "收到取消通知",
          summary,
          at: message.createdAt,
          ...(message.workItemId ? { workItemId: message.workItemId } : {}),
          messageId: message.messageId,
          counterpartyAgentId,
          counterpartyDisplayName,
        };
      default:
        return null;
    }
  }

  private requirePrincipal(principalId: string): StoredPrincipalRecord {
    const principal = this.registry.getPrincipal(normalizeRequiredText(principalId, "Principal id is required."));

    if (!principal) {
      throw new Error("Principal does not exist.");
    }

    return principal;
  }

  private requireOwnedOrganization(ownerPrincipalId: string, organizationId: string): StoredOrganizationRecord {
    const organization = this.registry.getOrganization(normalizeRequiredText(organizationId, "Organization id is required."));

    if (!organization || organization.ownerPrincipalId !== ownerPrincipalId) {
      throw new Error("Organization does not exist.");
    }

    return organization;
  }

  private requireOwnedAgent(ownerPrincipalId: string, agentId: string): StoredManagedAgentRecord {
    const agent = this.registry.getManagedAgent(normalizeRequiredText(agentId, "Agent id is required."));

    if (!agent || !this.isOrganizationOwnedBy(agent.organizationId, ownerPrincipalId)) {
      throw new Error("Managed agent does not exist.");
    }

    return agent;
  }

  private requireAgentInOrganization(agentId: string, organizationId: string): StoredManagedAgentRecord {
    const agent = this.registry.getManagedAgent(normalizeRequiredText(agentId, "Agent id is required."));

    if (!agent || agent.organizationId !== organizationId) {
      throw new Error("Managed agent does not exist.");
    }

    return agent;
  }

  private requireOwnedWorkItem(ownerPrincipalId: string, workItemId: string): StoredAgentWorkItemRecord {
    const workItem = this.registry.getAgentWorkItem(normalizeRequiredText(workItemId, "Work item id is required."));

    if (!workItem || !this.isOrganizationOwnedBy(workItem.organizationId, ownerPrincipalId)) {
      throw new Error("Work item does not exist.");
    }

    return workItem;
  }

  private requireWorkItemInOrganization(workItemId: string, organizationId: string): StoredAgentWorkItemRecord {
    const workItem = this.registry.getAgentWorkItem(normalizeRequiredText(workItemId, "Work item id is required."));

    if (!workItem || workItem.organizationId !== organizationId) {
      throw new Error("Work item does not exist.");
    }

    return workItem;
  }

  private requireMessageInOrganization(messageId: string, organizationId: string): StoredAgentMessageRecord {
    const message = this.registry.getAgentMessage(normalizeRequiredText(messageId, "Message id is required."));

    if (!message || message.organizationId !== organizationId) {
      throw new Error("Agent message does not exist.");
    }

    return message;
  }

  private isOrganizationOwnedBy(organizationId: string, ownerPrincipalId: string): boolean {
    const organization = this.registry.getOrganization(organizationId);
    return organization?.ownerPrincipalId === ownerPrincipalId;
  }

  private requireMailboxEntryForAgent(agent: StoredManagedAgentRecord, mailboxEntryId: string): StoredAgentMailboxEntryRecord {
    const existing = this.registry.getAgentMailboxEntry(normalizeRequiredText(mailboxEntryId, "Mailbox entry id is required."));

    if (!existing || existing.ownerAgentId !== agent.agentId || existing.organizationId !== agent.organizationId) {
      throw new Error("Mailbox entry does not exist.");
    }

    if (existing.status === "acked") {
      throw new Error("Mailbox entry is already acked.");
    }

    return existing;
  }

  private tryResumeWaitingWorkItem(input: {
    organization: StoredOrganizationRecord;
    sourceMessage: StoredAgentMessageRecord;
    responseMessage: StoredAgentMessageRecord;
    now: string;
  }): {
    workItem: StoredAgentWorkItemRecord | null;
    runs: StoredAgentRunRecord[];
  } {
    if (
      !input.sourceMessage.workItemId
      || !["approval_result", "answer"].includes(input.responseMessage.messageType)
    ) {
      return {
        workItem: null,
        runs: [],
      };
    }

    const workItem = this.registry.getAgentWorkItem(input.sourceMessage.workItemId);

    if (
      !workItem
      || workItem.organizationId !== input.organization.organizationId
      || workItem.status !== "waiting_agent"
      || workItem.targetAgentId !== input.responseMessage.toAgentId
      || input.sourceMessage.fromAgentId !== workItem.targetAgentId
    ) {
      return {
        workItem: null,
        runs: [],
      };
    }

    const interruptedRuns = interruptActiveRunsForWorkItem(this.registry, workItem.workItemId, input.now);
    const resumedWorkItem: StoredAgentWorkItemRecord = {
      ...workItem,
      status: "queued",
      updatedAt: input.now,
    };
    this.registry.saveAgentWorkItem(resumedWorkItem);

    return {
      workItem: this.registry.getAgentWorkItem(workItem.workItemId) ?? resumedWorkItem,
      runs: interruptedRuns,
    };
  }

  private buildOrganizationWaitingQueueItem(
    ownerPrincipalId: string,
    workItem: StoredAgentWorkItemRecord,
  ): OrganizationWaitingQueueItem | null {
    const organization = this.requireOwnedOrganization(ownerPrincipalId, workItem.organizationId);
    const targetAgent = this.requireAgentInOrganization(workItem.targetAgentId, organization.organizationId);
    const sourceAgent = normalizeOptionalText(workItem.sourceAgentId)
      ? this.requireAgentInOrganization(workItem.sourceAgentId as string, organization.organizationId)
      : null;
    const sourcePrincipal = this.registry.getPrincipal(workItem.sourcePrincipalId);
    const latestWaitingMessage = resolveLatestWaitingMessage(
      this.registry.listAgentMessagesByWorkItem(workItem.workItemId),
      workItem,
    );

    return {
      workItem,
      organization,
      targetAgent,
      sourceAgent,
      sourcePrincipal,
      latestWaitingMessage,
    };
  }
}

function compareMailboxItems(left: ManagedAgentMailboxItem, right: ManagedAgentMailboxItem): number {
  if (left.entry.status !== right.entry.status) {
    return rankMailboxStatus(left.entry.status) - rankMailboxStatus(right.entry.status);
  }

  if (left.entry.priority !== right.entry.priority) {
    return rankPriority(right.entry.priority) - rankPriority(left.entry.priority);
  }

  return left.entry.createdAt.localeCompare(right.entry.createdAt);
}

function rankMailboxStatus(status: StoredAgentMailboxEntryRecord["status"]): number {
  switch (status) {
    case "pending":
      return 0;
    case "leased":
      return 1;
    case "acked":
      return 2;
    default:
      return 9;
  }
}

function rankPriority(priority: ManagedAgentPriority): number {
  switch (priority) {
    case "urgent":
      return 4;
    case "high":
      return 3;
    case "normal":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function compareOrganizationWaitingQueueItems(
  left: OrganizationWaitingQueueItem,
  right: OrganizationWaitingQueueItem,
): number {
  const priorityDiff = rankPriority(right.workItem.priority) - rankPriority(left.workItem.priority);

  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  if (left.workItem.status !== right.workItem.status) {
    return left.workItem.status === "waiting_human" ? -1 : 1;
  }

  return left.workItem.updatedAt.localeCompare(right.workItem.updatedAt);
}

function dedupeTimelineEntries(entries: ManagedAgentTimelineEntry[]): ManagedAgentTimelineEntry[] {
  const seen = new Set<string>();
  const deduped: ManagedAgentTimelineEntry[] = [];

  for (const entry of entries) {
    if (seen.has(entry.entryId)) {
      continue;
    }

    seen.add(entry.entryId);
    deduped.push(entry);
  }

  return deduped;
}

function summarizeChildWorkItems(workItems: StoredAgentWorkItemRecord[]): ManagedAgentChildWorkItemSummary {
  const summary: ManagedAgentChildWorkItemSummary = {
    totalCount: workItems.length,
    openCount: 0,
    waitingCount: 0,
    completedCount: 0,
    failedCount: 0,
    cancelledCount: 0,
  };

  for (const workItem of workItems) {
    switch (workItem.status) {
      case "completed":
        summary.completedCount += 1;
        break;
      case "failed":
        summary.failedCount += 1;
        break;
      case "cancelled":
        summary.cancelledCount += 1;
        break;
      default:
        summary.openCount += 1;

        if (workItem.status === "waiting_human" || workItem.status === "waiting_agent") {
          summary.waitingCount += 1;
        }
        break;
    }
  }

  return summary;
}

function computeMailboxLeaseStaleBefore(now: string, mailboxLeaseTtlMs: number): string {
  const base = Date.parse(now);
  const timestamp = Number.isNaN(base) ? Date.now() : base;
  return new Date(timestamp - mailboxLeaseTtlMs).toISOString();
}

function resolveMailboxResponseMessageType(sourceMessageType: AgentMessageType): AgentMessageType {
  switch (sourceMessageType) {
    case "approval_request":
      return "approval_result";
    case "question":
      return "answer";
    default:
      return "status_update";
  }
}

function buildMailboxResponsePayload(input: {
  sourceMessageType: AgentMessageType;
  decision?: "approve" | "deny";
  inputText?: string;
  payload?: unknown;
}): unknown {
  const inputText = normalizeOptionalText(input.inputText);

  if (input.sourceMessageType === "approval_request") {
    if (!input.decision) {
      throw new Error("Mailbox response to approval_request requires decision.");
    }

    return {
      decision: input.decision,
      ...(inputText ? { inputText } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
    };
  }

  if (!inputText && input.payload === undefined) {
    throw new Error("Mailbox response requires inputText or payload.");
  }

  return {
    ...(inputText ? { inputText } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  };
}

function buildDispatchTimelineSummary(
  workItem: StoredAgentWorkItemRecord,
  sourceAgentDisplayName?: string,
): string {
  const parts = [
    sourceAgentDisplayName ? `来源 ${sourceAgentDisplayName}` : null,
    normalizeOptionalText(workItem.dispatchReason),
    normalizeOptionalText(workItem.goal),
  ].filter((value): value is string => Boolean(value));

  return parts.join(" · ") || "收到新的 work item。";
}

function buildHumanGovernanceSummary(response: Record<string, unknown> | null): string {
  if (!response) {
    return "顶层治理已提交回复。";
  }

  const decision = normalizeOptionalText(asString(response.decision));
  const inputText = normalizeOptionalText(asString(response.inputText));

  if (decision && inputText) {
    return `治理结论：${decision} · ${inputText}`;
  }

  if (decision) {
    return `治理结论：${decision}`;
  }

  if (inputText) {
    return inputText;
  }

  return "顶层治理已提交回复。";
}

function buildHandoffSummaryText(handoff: StoredAgentHandoffRecord): string {
  const parts = [handoff.summary];

  if (handoff.blockers.length > 0) {
    parts.push(`阻塞：${handoff.blockers.join("；")}`);
  }

  if (handoff.recommendedNextActions.length > 0) {
    parts.push(`下一步：${handoff.recommendedNextActions.join("；")}`);
  }

  return parts.join(" · ");
}

function buildHandoffId(
  sourceMessageId: string | null,
  _fromAgentId: string,
  _toAgentId: string,
  _workItemId: string,
): string {
  if (sourceMessageId) {
    return `handoff-${sourceMessageId}`;
  }

  return createId("handoff");
}

function normalizePositiveLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : fallback;
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    : [];
}

function buildHumanResumePayload(input: {
  waitingActionRequest?: unknown;
  decision?: "approve" | "deny";
  inputText?: string;
  payload?: unknown;
  artifactRefs?: string[];
  now?: string;
}): unknown {
  const waitingAction = asRecord(input.waitingActionRequest);
  const actionType = normalizeOptionalText(
    typeof waitingAction?.actionType === "string" ? waitingAction.actionType : null,
  );
  const inputText = normalizeOptionalText(input.inputText);
  const artifactRefs = dedupeStrings(input.artifactRefs ?? []);

  if (actionType === "approval" && !input.decision) {
    throw new Error("Human response to approval waiting requires decision.");
  }

  if (!input.decision && !inputText && input.payload === undefined && artifactRefs.length === 0) {
    throw new Error("Human response requires decision, inputText, payload, or artifactRefs.");
  }

  return {
    sourceType: "human",
    ...(actionType ? { actionType } : {}),
    ...(input.decision ? { decision: input.decision } : {}),
    ...(inputText ? { inputText } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
    ...(artifactRefs.length ? { artifactRefs } : {}),
    respondedAt: normalizeNow(input.now),
  };
}

function buildEscalatedHumanWaitingActionRequest(input: {
  workItem: StoredAgentWorkItemRecord;
  latestWaitingMessage: StoredAgentMessageRecord | null;
  inputText?: string;
  now: string;
}): unknown {
  const waitingAction = asRecord(input.workItem.waitingActionRequest);
  const latestPayload = asRecord(input.latestWaitingMessage?.payload);
  const escalationInputText = normalizeOptionalText(input.inputText);
  const actionType = normalizeOptionalText(asString(waitingAction?.actionType))
    ?? normalizeOptionalText(asString(latestPayload?.actionType));
  const prompt = normalizeOptionalText(asString(waitingAction?.prompt))
    ?? normalizeOptionalText(asString(latestPayload?.prompt))
    ?? normalizeOptionalText(asString(latestPayload?.question));
  const choices = Array.isArray(waitingAction?.choices)
    ? waitingAction.choices
    : Array.isArray(latestPayload?.choices)
      ? latestPayload.choices
      : null;
  const inputSchema = waitingAction?.inputSchema ?? latestPayload?.inputSchema;

  return {
    waitingFor: "human",
    sourceType: "agent_escalation",
    escalatedFrom: "waiting_agent",
    ...(actionType ? { actionType } : {}),
    ...(prompt ? { prompt } : {}),
    ...(choices ? { choices } : {}),
    ...(inputSchema !== undefined ? { inputSchema } : {}),
    ...(input.latestWaitingMessage?.messageType ? { originalMessageType: input.latestWaitingMessage.messageType } : {}),
    ...(input.latestWaitingMessage?.messageId ? { originalMessageId: input.latestWaitingMessage.messageId } : {}),
    ...(input.latestWaitingMessage?.fromAgentId ? { originalFromAgentId: input.latestWaitingMessage.fromAgentId } : {}),
    ...(input.latestWaitingMessage?.toAgentId ? { originalToAgentId: input.latestWaitingMessage.toAgentId } : {}),
    ...(escalationInputText ? { escalationInputText } : {}),
    escalatedAt: input.now,
  };
}

function acknowledgeOutstandingWaitingMailboxEntries(
  registry: SqliteCodexSessionRegistry,
  workItem: StoredAgentWorkItemRecord,
  latestWaitingMessage: StoredAgentMessageRecord | null,
  now: string,
): StoredAgentMailboxEntryRecord[] {
  const sourceAgentId = normalizeOptionalText(workItem.sourceAgentId);

  if (!sourceAgentId) {
    return [];
  }

  const ackedEntries: StoredAgentMailboxEntryRecord[] = [];
  const entries = registry.listAgentMailboxEntriesByAgent(sourceAgentId);

  for (const entry of entries) {
    if (entry.workItemId !== workItem.workItemId || entry.status === "acked") {
      continue;
    }

    const message = registry.getAgentMessage(entry.messageId);

    if (!message) {
      continue;
    }

    if (
      message.fromAgentId !== workItem.targetAgentId
      || message.toAgentId !== sourceAgentId
      || !["approval_request", "question", "escalation"].includes(message.messageType)
    ) {
      continue;
    }

    if (latestWaitingMessage && message.createdAt < latestWaitingMessage.createdAt) {
      continue;
    }

    const { leaseToken: _leaseToken, leasedAt: _leasedAt, ...rest } = entry;
    const ackedEntry: StoredAgentMailboxEntryRecord = {
      ...rest,
      status: "acked",
      ackedAt: now,
      updatedAt: now,
    };
    registry.saveAgentMailboxEntry(ackedEntry);
    ackedEntries.push(registry.getAgentMailboxEntry(entry.mailboxEntryId) ?? ackedEntry);
  }

  return ackedEntries;
}

function acknowledgeOpenMailboxEntriesForWorkItem(
  registry: SqliteCodexSessionRegistry,
  organizationId: string,
  workItemId: string,
  now: string,
): StoredAgentMailboxEntryRecord[] {
  const ackedEntries: StoredAgentMailboxEntryRecord[] = [];

  for (const agent of registry.listManagedAgentsByOrganization(organizationId)) {
    for (const entry of registry.listAgentMailboxEntriesByAgent(agent.agentId)) {
      if (entry.workItemId !== workItemId || entry.status === "acked") {
        continue;
      }

      const { leaseToken: _leaseToken, leasedAt: _leasedAt, ...rest } = entry;
      const ackedEntry: StoredAgentMailboxEntryRecord = {
        ...rest,
        status: "acked",
        ackedAt: now,
        updatedAt: now,
      };
      registry.saveAgentMailboxEntry(ackedEntry);
      ackedEntries.push(registry.getAgentMailboxEntry(entry.mailboxEntryId) ?? ackedEntry);
    }
  }

  return ackedEntries.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function cancelWaitingActionRunsForWorkItem(
  registry: SqliteCodexSessionRegistry,
  workItemId: string,
  now: string,
): StoredAgentRunRecord[] {
  const cancelledRuns: StoredAgentRunRecord[] = [];

  for (const run of registry.listAgentRunsByWorkItem(workItemId)) {
    if (run.status !== "waiting_action") {
      continue;
    }

    const nextRun: StoredAgentRunRecord = {
      ...run,
      status: "cancelled",
      leaseExpiresAt: now,
      completedAt: now,
      lastHeartbeatAt: now,
      failureCode: run.failureCode ?? "WORK_ITEM_CANCELLED",
      failureMessage: run.failureMessage ?? "Waiting run was cancelled by governance.",
      updatedAt: now,
    };
    registry.saveAgentRun(nextRun);
    cancelledRuns.push(registry.getAgentRun(run.runId) ?? nextRun);
  }

  return cancelledRuns;
}

function interruptActiveRunsForWorkItem(
  registry: SqliteCodexSessionRegistry,
  workItemId: string,
  now: string,
  options: {
    failureCode?: string;
    failureMessage?: string;
  } = {},
): StoredAgentRunRecord[] {
  const interruptedRuns: StoredAgentRunRecord[] = [];

  for (const run of registry.listAgentRunsByWorkItem(workItemId)) {
    if (!["created", "starting", "running", "waiting_action"].includes(run.status)) {
      continue;
    }

    const nextRun: StoredAgentRunRecord = {
      ...run,
      status: "interrupted",
      leaseExpiresAt: now,
      completedAt: now,
      lastHeartbeatAt: now,
      failureCode: run.failureCode ?? options.failureCode ?? "WAITING_RESUME_TRIGGERED",
      failureMessage: run.failureMessage ?? options.failureMessage ?? "Waiting run was superseded by a mailbox resume signal.",
      updatedAt: now,
    };
    registry.saveAgentRun(nextRun);
    interruptedRuns.push(registry.getAgentRun(run.runId) ?? nextRun);
  }

  return interruptedRuns;
}

function normalizeNow(value?: string): string {
  return normalizeOptionalText(value) ?? new Date().toISOString();
}

function normalizeOptionalText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeRequiredText(value: string | undefined | null, message: string): string {
  const trimmed = normalizeOptionalText(value);

  if (!trimmed) {
    throw new Error(message);
  }

  return trimmed;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function renderMessageSummary(message: StoredAgentMessageRecord): string {
  const payload = asRecord(message.payload);

  if (typeof message.payload === "string" && message.payload.trim()) {
    return message.payload.trim();
  }

  if (!payload) {
    return "没有额外摘要。";
  }

  const summaryCandidates = [
    asString(payload.summary),
    asString(payload.prompt),
    asString(payload.question),
    asString(payload.dispatchReason),
    asString(payload.inputText),
    asString(payload.failureMessage),
  ];

  for (const candidate of summaryCandidates) {
    const normalized = normalizeOptionalText(candidate);

    if (normalized) {
      return normalized;
    }
  }

  return "没有额外摘要。";
}

function resolveLatestWaitingMessage(
  messages: StoredAgentMessageRecord[],
  workItem: StoredAgentWorkItemRecord,
): StoredAgentMessageRecord | null {
  const sourceAgentId = normalizeOptionalText(workItem.sourceAgentId);

  if (!sourceAgentId) {
    return [...messages].reverse().find((message) => message.messageType === "escalation") ?? null;
  }

  return [...messages].reverse().find((message) =>
    message.fromAgentId === workItem.targetAgentId
    && message.toAgentId === sourceAgentId
    && ["approval_request", "question", "escalation"].includes(message.messageType)
  ) ?? null;
}

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
