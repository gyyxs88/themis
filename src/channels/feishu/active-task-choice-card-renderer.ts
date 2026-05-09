import type { InteractiveCard } from "@larksuiteoapi/node-sdk";
import type { FeishuRenderedMessageDraft } from "./message-renderer.js";

export type FeishuActiveTaskChoiceDecision = "interrupt" | "queue" | "cancel";
export type FeishuActiveTaskChoiceStatus = "pending" | "interrupted" | "queued" | "cancelled" | "failed";

export interface RenderFeishuActiveTaskChoiceCardInput {
  cardKey: string;
  incomingText: string;
  status: FeishuActiveTaskChoiceStatus;
  message?: string | null;
}

export function renderFeishuActiveTaskChoiceCard(input: RenderFeishuActiveTaskChoiceCardInput): FeishuRenderedMessageDraft {
  const card = buildFeishuActiveTaskChoiceInteractiveCard(input);
  return {
    msgType: "interactive",
    content: JSON.stringify(card),
  };
}

export function buildFeishuActiveTaskChoiceInteractiveCard(
  input: RenderFeishuActiveTaskChoiceCardInput,
): InteractiveCard {
  const preview = normalizeText(input.incomingText) ?? "这条新消息没有可展示文本。";
  const statusCopy = resolveStatusCopy(input.status, input.message);
  const elements: NonNullable<InteractiveCard["elements"]> = [
    {
      tag: "div",
      text: {
        tag: "plain_text",
        content: "当前会话已有任务正在运行。请为这条新消息选择处理方式。",
        lines: 3,
      },
    },
    {
      tag: "note",
      elements: [
        {
          tag: "plain_text",
          content: `新消息：${truncateText(preview, 120)}`,
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
      tag: "action",
      layout: "bisected",
      actions: [
        {
          tag: "button",
          type: "danger",
          text: {
            tag: "plain_text",
            content: "打断并处理",
          },
          value: {
            actionKind: "active_task_choice",
            cardKey: input.cardKey,
            decision: "interrupt",
          },
        },
        {
          tag: "button",
          type: "primary",
          text: {
            tag: "plain_text",
            content: "排队处理",
          },
          value: {
            actionKind: "active_task_choice",
            cardKey: input.cardKey,
            decision: "queue",
          },
        },
      ],
    });
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          type: "default",
          text: {
            tag: "plain_text",
            content: "取消新消息",
          },
          value: {
            actionKind: "active_task_choice",
            cardKey: input.cardKey,
            decision: "cancel",
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
          content: "这张选择卡已经收口。",
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
  status: FeishuActiveTaskChoiceStatus,
  message?: string | null,
): { title: string; body: string; template: "yellow" | "blue" | "red" | "grey" } {
  const normalizedMessage = normalizeText(message);

  switch (status) {
    case "interrupted":
      return {
        title: "已选择打断",
        body: normalizedMessage ?? "正在打断当前任务，并立即处理这条新消息。",
        template: "red",
      };
    case "queued":
      return {
        title: "已排队",
        body: normalizedMessage ?? "当前任务完成后，会继续处理这条新消息。",
        template: "blue",
      };
    case "cancelled":
      return {
        title: "已取消新消息",
        body: normalizedMessage ?? "这条新消息不会进入任务链，当前任务继续运行。",
        template: "grey",
      };
    case "failed":
      return {
        title: "处理失败",
        body: normalizedMessage ?? "选择卡处理失败，请重新发送消息或使用 /stop。",
        template: "red",
      };
    case "pending":
    default:
      return {
        title: "任务运行中",
        body: normalizedMessage ?? "不会自动打断当前任务。",
        template: "yellow",
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

function truncateText(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
}
