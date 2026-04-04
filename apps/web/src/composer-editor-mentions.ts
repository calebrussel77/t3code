import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  type TerminalContextDraft,
} from "./lib/terminalContext";

export type ComposerPromptSegment =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "mention";
      path: string;
    }
  | {
      type: "skill-mention";
      skillName: string;
    }
  | {
      type: "terminal-context";
      context: TerminalContextDraft | null;
    };

const MENTION_TOKEN_REGEX = /(^|\s)@([^\s@]+)(?=\s)/g;
const SKILL_MENTION_TOKEN_REGEX = /(^|\s)\$([^\s$]+)(?=\s)/g;

function pushTextSegment(segments: ComposerPromptSegment[], text: string): void {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.type === "text") {
    last.text += text;
    return;
  }
  segments.push({ type: "text", text });
}

interface TokenMatch {
  kind: "mention" | "skill-mention";
  value: string;
  start: number;
  end: number;
}

function collectTokenMatches(text: string): TokenMatch[] {
  const matches: TokenMatch[] = [];

  for (const match of text.matchAll(MENTION_TOKEN_REGEX)) {
    const prefix = match[1] ?? "";
    const path = match[2] ?? "";
    const matchIndex = match.index ?? 0;
    const start = matchIndex + prefix.length;
    const end = start + match[0].length - prefix.length;
    if (path.length > 0) {
      matches.push({ kind: "mention", value: path, start, end });
    }
  }

  for (const match of text.matchAll(SKILL_MENTION_TOKEN_REGEX)) {
    const prefix = match[1] ?? "";
    const skillName = match[2] ?? "";
    const matchIndex = match.index ?? 0;
    const start = matchIndex + prefix.length;
    const end = start + match[0].length - prefix.length;
    if (skillName.length > 0) {
      matches.push({ kind: "skill-mention", value: skillName, start, end });
    }
  }

  matches.sort((a, b) => a.start - b.start);
  return matches;
}

function splitPromptTextIntoComposerSegments(text: string): ComposerPromptSegment[] {
  const segments: ComposerPromptSegment[] = [];
  if (!text) {
    return segments;
  }

  let cursor = 0;
  for (const token of collectTokenMatches(text)) {
    if (token.start < cursor) continue; // overlapping match, skip
    if (token.start > cursor) {
      pushTextSegment(segments, text.slice(cursor, token.start));
    }

    if (token.kind === "mention") {
      segments.push({ type: "mention", path: token.value });
    } else {
      segments.push({ type: "skill-mention", skillName: token.value });
    }

    cursor = token.end;
  }

  if (cursor < text.length) {
    pushTextSegment(segments, text.slice(cursor));
  }

  return segments;
}

export function splitPromptIntoComposerSegments(
  prompt: string,
  terminalContexts: ReadonlyArray<TerminalContextDraft> = [],
): ComposerPromptSegment[] {
  if (!prompt) {
    return [];
  }

  const segments: ComposerPromptSegment[] = [];
  let textCursor = 0;
  let terminalContextIndex = 0;

  for (let index = 0; index < prompt.length; index += 1) {
    if (prompt[index] !== INLINE_TERMINAL_CONTEXT_PLACEHOLDER) {
      continue;
    }

    if (index > textCursor) {
      segments.push(...splitPromptTextIntoComposerSegments(prompt.slice(textCursor, index)));
    }
    segments.push({
      type: "terminal-context",
      context: terminalContexts[terminalContextIndex] ?? null,
    });
    terminalContextIndex += 1;
    textCursor = index + 1;
  }

  if (textCursor < prompt.length) {
    segments.push(...splitPromptTextIntoComposerSegments(prompt.slice(textCursor)));
  }

  return segments;
}
