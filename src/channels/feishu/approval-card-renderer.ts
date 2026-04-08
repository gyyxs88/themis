import type { InteractiveCard } from "@larksuiteoapi/node-sdk";
import type { FeishuRenderedMessageDraft } from "./message-renderer.js";

export type FeishuApprovalCardStatus = "pending" | "approved" | "denied" | "failed";

export interface RenderFeishuApprovalCardInput {
  cardKey: string;
  actionId: string;
  prompt: string;
  status: FeishuApprovalCardStatus;
  message?: string | null;
}

export function renderFeishuApprovalCard(input: RenderFeishuApprovalCardInput): FeishuRenderedMessageDraft {
  const card = buildFeishuApprovalInteractiveCard(input);
  return {
    msgType: "interactive",
    content: JSON.stringify(card),
  };
}

export function buildFeishuApprovalInteractiveCard(input: RenderFeishuApprovalCardInput): InteractiveCard {
  const prompt = normalizeText(input.prompt) ?? "等待审批";
  const actionId = normalizeText(input.actionId) ?? "unknown-action";
  const statusCopy = resolveStatusCopy(input.status, input.message);
  const fallbackCommandText = `也可用文本命令：/approve ${actionId} 或 /deny ${actionId}`;
  const elements: NonNullable<InteractiveCard["elements"]> = [
    {
      tag: "div",
      text: {
        tag: "plain_text",
        content: prompt,
        lines: 4,
      },
    },
    {
      tag: "note",
      elements: [
        {
          tag: "plain_text",
          content: `actionId: ${actionId}`,
        },
      ],
    },
    {
      tag: "note",
      elements: [
        {
          tag: "plain_text",
          content: statusCopy.body,
        },
      ],
    },
  ];

  if (input.status === "pending") {
    elements.push({
      tag: "note",
      elements: [
        {
          tag: "plain_text",
          content: fallbackCommandText,
        },
      ],
    });
    elements.push({
      tag: "action",
      layout: "bisected",
      actions: [
        {
          tag: "button",
          type: "primary",
          text: {
            tag: "plain_text",
            content: "批准",
          },
          value: {
            actionKind: "approval",
            cardKey: input.cardKey,
            actionId,
            decision: "approve",
          },
        },
        {
          tag: "button",
          type: "danger",
          text: {
            tag: "plain_text",
            content: "拒绝",
          },
          value: {
            actionKind: "approval",
            cardKey: input.cardKey,
            actionId,
            decision: "deny",
          },
        },
      ],
    });
  } else {
    elements.push({
      tag: "note",
      elements: [
        {
          tag: "plain_text",
          content: "这张审批卡已经收口，后续如有新的审批请求会再生成新卡片。",
        },
      ],
    });
  }

  return {
    config: {
      wide_screen_mode: true,
      update_multi: false,
      enable_forward: true,
    },
    header: {
      title: {
        tag: "plain_text",
        content: statusCopy.title,
      },
      template: statusCopy.template,
    },
    elements,
  };
}

function resolveStatusCopy(
  status: FeishuApprovalCardStatus,
  message: string | null | undefined,
): {
  title: string;
  body: string;
  template: "blue" | "green" | "red" | "orange";
} {
  const normalizedMessage = normalizeText(message);

  switch (status) {
    case "approved":
      return {
        title: "审批已批准",
        body: normalizedMessage ?? "审批已经提交为批准，卡片按钮已失效。",
        template: "green",
      };
    case "denied":
      return {
        title: "审批已拒绝",
        body: normalizedMessage ?? "审批已经提交为拒绝，卡片按钮已失效。",
        template: "red",
      };
    case "failed":
      return {
        title: "审批提交失败",
        body: normalizedMessage ?? "审批卡暂时无法提交，请改用文本命令重试。",
        template: "orange",
      };
    case "pending":
    default:
      return {
        title: "审批待处理",
        body: normalizedMessage ?? "请在卡片内完成本次审批，或使用下方文本命令降级处理。",
        template: "blue",
      };
  }
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
