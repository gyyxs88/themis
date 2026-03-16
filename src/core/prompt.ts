import type { TaskAttachment, TaskRequest } from "../types/index.js";

export function buildTaskPrompt(request: TaskRequest): string {
  const sections = [
    "You are running inside Themis, a LAN web UI built on top of the Codex SDK.",
    `Goal:\n${request.goal}`,
  ];

  if (request.inputText) {
    sections.push(`Additional context:\n${request.inputText}`);
  }

  if (request.historyContext) {
    sections.push(
      [
        "Prior conversation transcript for this forked session:",
        "Treat it as conversation history that already happened.",
        "Do not summarize or restate it unless the user asks.",
        request.historyContext,
      ].join("\n"),
    );
  }

  if (request.attachments?.length) {
    sections.push(`Attachments:\n${formatAttachments(request.attachments)}`);
  }

  sections.push(
    [
      "Response guidance:",
      "- Solve the requested task directly.",
      "- Keep the final answer practical and concise.",
      "- Mention touched files when relevant.",
    ].join("\n"),
  );

  return sections.join("\n\n");
}

function formatAttachments(attachments: TaskAttachment[]): string {
  return attachments
    .map((attachment) => {
      const namePart = attachment.name ? ` (${attachment.name})` : "";
      return `- [${attachment.type}]${namePart}: ${attachment.value}`;
    })
    .join("\n");
}
