import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const CODEX_SESSION_ROOT = resolve(homedir(), ".codex/sessions");
const THEMIS_PROMPT_PREFIX = "You are running inside Themis";
const MAX_FORK_TURNS = 24;
const MAX_FORK_CHARS = 24000;

export interface CodexForkContext {
  historyContext: string;
  sourceThreadId: string;
  strategy: "session-transcript";
  totalTurns: number;
  includedTurns: number;
  truncated: boolean;
}

interface ParsedSessionTurn {
  rawUserText: string;
  goal?: string;
  inputText?: string;
  assistantText?: string;
}

interface BuildForkContextOptions {
  sessionRoot?: string;
}

export async function buildForkContextFromThread(
  threadId: string,
  options: BuildForkContextOptions = {},
): Promise<CodexForkContext | null> {
  const normalizedThreadId = threadId.trim();

  if (!normalizedThreadId) {
    return null;
  }

  const sessionFile = await findThreadSessionFile(
    normalizedThreadId,
    options.sessionRoot ?? CODEX_SESSION_ROOT,
  );

  if (!sessionFile) {
    return null;
  }

  const raw = await readFile(sessionFile, "utf8");
  const turns = extractThemisSessionTurns(raw);

  if (!turns.length) {
    return null;
  }

  const transcript = renderForkTranscript(normalizedThreadId, turns);

  return {
    historyContext: transcript.text,
    sourceThreadId: normalizedThreadId,
    strategy: "session-transcript",
    totalTurns: turns.length,
    includedTurns: transcript.includedTurns,
    truncated: transcript.truncated,
  };
}

async function findThreadSessionFile(threadId: string, sessionRoot: string): Promise<string | null> {
  return walkForThreadFile(sessionRoot, threadId, 0);
}

async function walkForThreadFile(directory: string, threadId: string, depth: number): Promise<string | null> {
  if (depth > 4) {
    return null;
  }

  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return null;
    }

    throw error;
  }

  const matchingFile = entries.find((entry) => entry.isFile() && entry.name.includes(threadId));

  if (matchingFile) {
    return resolve(directory, matchingFile.name);
  }

  const nestedDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(directory, entry.name))
    .sort();

  for (const nestedDirectory of nestedDirectories) {
    const nestedMatch = await walkForThreadFile(nestedDirectory, threadId, depth + 1);

    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return null;
}

function extractThemisSessionTurns(raw: string): ParsedSessionTurn[] {
  const turns: ParsedSessionTurn[] = [];
  const lines = raw.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (parsed.type !== "response_item") {
      continue;
    }

    const payload = isRecord(parsed.payload) ? parsed.payload : null;

    if (!payload || payload.type !== "message") {
      continue;
    }

    const role = typeof payload.role === "string" ? payload.role : "";
    const text = extractMessageText(payload.content);

    if (!text) {
      continue;
    }

    if (role === "user") {
      if (!text.startsWith(THEMIS_PROMPT_PREFIX)) {
        continue;
      }

      turns.push({
        rawUserText: text,
        ...parseThemisPrompt(text),
      });
      continue;
    }

    if (role === "assistant") {
      const currentTurn = turns.at(-1);

      if (currentTurn && !currentTurn.assistantText) {
        currentTurn.assistantText = text;
      }
    }
  }

  return turns;
}

function extractMessageText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!isRecord(part)) {
        return "";
      }

      if (part.type === "input_text" || part.type === "output_text") {
        return typeof part.text === "string" ? part.text : "";
      }

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseThemisPrompt(prompt: string): Omit<ParsedSessionTurn, "rawUserText" | "assistantText"> {
  const goal = extractBlock(prompt, "Goal:\n", [
    "\n\nAdditional context:\n",
    "\n\nPrior conversation transcript for this forked session:\n",
    "\n\nConversation history to preserve for this session:\n",
    "\n\nAttachments:\n",
    "\n\nResponse guidance:\n",
  ]);
  const inputText = extractBlock(prompt, "Additional context:\n", [
    "\n\nPrior conversation transcript for this forked session:\n",
    "\n\nConversation history to preserve for this session:\n",
    "\n\nAttachments:\n",
    "\n\nResponse guidance:\n",
  ]);

  return {
    ...(goal ? { goal } : {}),
    ...(inputText ? { inputText } : {}),
  };
}

function renderForkTranscript(
  threadId: string,
  turns: ParsedSessionTurn[],
): { text: string; includedTurns: number; truncated: boolean } {
  const header = [
    "Imported conversation transcript from an existing Themis Codex session.",
    "Treat the following turns as conversation history that already happened.",
    "Do not answer these turns again. Use them as authoritative prior context for the next user request.",
    `Source Codex thread: ${threadId}`,
  ].join("\n");

  const renderedTurns = turns.map((turn, index) => renderTurnBlock(turn, index + 1));
  const selected = selectTranscriptBlocks(renderedTurns);
  const omittedTurns = turns.length - selected.blocks.length;
  const lines = [header];

  if (omittedTurns > 0) {
    lines.push(`[Older ${omittedTurns} turns were omitted to stay within the context budget.]`);
  }

  lines.push(...selected.blocks);

  return {
    text: lines.join("\n\n").trim(),
    includedTurns: selected.blocks.length,
    truncated: omittedTurns > 0 || selected.truncatedByLength,
  };
}

function renderTurnBlock(turn: ParsedSessionTurn, index: number): string {
  const lines = [`[Turn ${index}]`];

  if (turn.goal) {
    lines.push("User goal:");
    lines.push(turn.goal);
  } else {
    lines.push("User message:");
    lines.push(turn.rawUserText);
  }

  if (turn.inputText) {
    lines.push("User context:");
    lines.push(turn.inputText);
  }

  if (turn.assistantText) {
    lines.push("Assistant reply:");
    lines.push(turn.assistantText);
  }

  return lines.join("\n");
}

function selectTranscriptBlocks(
  renderedTurns: string[],
): { blocks: string[]; truncatedByLength: boolean } {
  const blocks: string[] = [];
  let totalChars = 0;
  let truncatedByLength = false;

  for (let index = renderedTurns.length - 1; index >= 0; index -= 1) {
    const block = renderedTurns[index];

    if (!block) {
      continue;
    }

    const nextLength = totalChars + block.length;

    if (blocks.length >= MAX_FORK_TURNS || (blocks.length > 0 && nextLength > MAX_FORK_CHARS)) {
      truncatedByLength = index >= 0;
      break;
    }

    blocks.unshift(block);
    totalChars = nextLength;
  }

  return {
    blocks,
    truncatedByLength,
  };
}

function extractBlock(prompt: string, startMarker: string, endMarkers: string[]): string | undefined {
  const startIndex = prompt.indexOf(startMarker);

  if (startIndex === -1) {
    return undefined;
  }

  const contentStart = startIndex + startMarker.length;
  let contentEnd = prompt.length;

  for (const marker of endMarkers) {
    const markerIndex = prompt.indexOf(marker, contentStart);

    if (markerIndex !== -1 && markerIndex < contentEnd) {
      contentEnd = markerIndex;
    }
  }

  const value = prompt.slice(contentStart, contentEnd).trim();
  return value ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
