import type { WorkLogEntry } from "./session-logic";
import { basenameOfPath } from "./vscode-icons";

type MinimalWorkEntry = Pick<
  WorkLogEntry,
  | "label"
  | "toolTitle"
  | "detail"
  | "command"
  | "changedFiles"
  | "tone"
  | "requestKind"
  | "itemType"
  | "toolName"
  | "toolInput"
>;

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

/** Parse an MCP tool name like "mcp__server__action" into server + action parts. */
export function parseMcpToolName(toolName: string): {
  serverName: string;
  actionName: string;
} | null {
  const match = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(toolName);
  if (!match?.[1] || !match[2]) return null;
  return {
    serverName: humanizeMcpServerName(match[1]),
    actionName: match[2].replace(/_/g, "-"),
  };
}

/** Humanize an MCP server name segment (e.g. "claude_ai_Canva" → "Canva"). */
function humanizeMcpServerName(raw: string): string {
  // Strip common prefixes like "claude_ai_"
  const stripped = raw.replace(/^claude_ai_/i, "");
  if (stripped.length > 0) return stripped;
  return raw.replace(/_/g, " ");
}

function parseMcpFields(workEntry: Pick<MinimalWorkEntry, "toolName" | "toolTitle" | "label">): {
  serverName: string;
  actionName: string;
} | null {
  if (workEntry.toolName) {
    const parsed = parseMcpToolName(workEntry.toolName);
    if (parsed) return parsed;
  }
  const raw = workEntry.toolTitle ?? workEntry.label;
  return parseMcpToolName(raw);
}

function mcpToolHeading(
  workEntry: Pick<MinimalWorkEntry, "toolName" | "toolTitle" | "label">,
): string {
  return parseMcpFields(workEntry)?.actionName ?? "MCP tool";
}

export function mcpServerLabel(
  workEntry: Pick<MinimalWorkEntry, "toolName" | "toolTitle" | "label">,
): string | null {
  return parseMcpFields(workEntry)?.serverName ?? null;
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function humanizeToolLabel(value: string): string {
  const normalized = normalizeCompactToolLabel(value).replace(/[_-]+/g, " ").trim();
  switch (normalized.toLowerCase()) {
    case "exec command":
    case "bash":
      return "Shell";
    case "read file":
    case "read":
      return "Read";
    case "apply patch":
    case "edit":
      return "Edit";
    case "write":
      return "Write";
    case "web search":
    case "websearch":
      return "Web";
    case "image view":
      return "Image";
    case "subagent task":
    case "agent":
      return "Agent";
    case "glob":
      return "Glob";
    case "grep":
      return "Grep";
    case "skill":
      return "Skill";
    default:
      return capitalizePhrase(normalized);
  }
}

export function toolWorkEntryHeading(
  workEntry: Pick<MinimalWorkEntry, "toolTitle" | "label" | "toolName" | "itemType">,
): string {
  if (workEntry.itemType === "mcp_tool_call") {
    return mcpToolHeading(workEntry);
  }
  if (workEntry.toolTitle) {
    const heading = humanizeToolLabel(workEntry.toolTitle);
    // If toolTitle produced a generic label, try toolName as a better source
    if (heading.toLowerCase() === "tool call" && workEntry.toolName) {
      return humanizeToolLabel(workEntry.toolName);
    }
    return heading;
  }
  const heading = humanizeToolLabel(workEntry.label);
  if (heading.toLowerCase() === "tool call" && workEntry.toolName) {
    return humanizeToolLabel(workEntry.toolName);
  }
  return heading;
}

/**
 * Simplify shell wrapper commands for display.
 * Handles powershell/pwsh -Command, cmd /c, quoted exe paths,
 * and nested wrappers emitted by the terminal bridge on Windows.
 */
export function simplifyShellCommand(command: string): string {
  let simplified = normalizeShellDisplayText(command);

  for (let depth = 0; depth < 4; depth += 1) {
    const unwrapped = unwrapShellWrapper(simplified);
    if (unwrapped === simplified) {
      return simplified;
    }
    simplified = normalizeShellDisplayText(unwrapped);
  }

  return simplified;
}

function unwrapShellWrapper(command: string): string {
  const pwshMatch =
    /^(?:"[^"]*?(?:pwsh|powershell)(?:\.exe)?"|'[^']*?(?:pwsh|powershell)(?:\.exe)?'|(?:[^\s"']*?(?:pwsh|powershell)(?:\.exe)?))(?:\s+-[A-Za-z]+(?:\s+(?:"[^"]*"|'[^']*'|[^\s]+))?)*\s+-Command\s+([\s\S]+)$/i.exec(
      command,
    );
  if (pwshMatch?.[1]) {
    return stripOuterShellArgumentQuotes(pwshMatch[1].trim());
  }

  const cmdMatch =
    /^(?:"[^"]*?cmd(?:\.exe)?"|'[^']*?cmd(?:\.exe)?'|(?:[^\s"']*?cmd(?:\.exe)?))(?:\s+\/[A-Za-z]+)*\s+\/[cCkK]\s+([\s\S]+)$/i.exec(
      command,
    );
  if (cmdMatch?.[1]) {
    return stripOuterShellArgumentQuotes(cmdMatch[1].trim());
  }

  return command;
}

function stripOuterShellArgumentQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeShellDisplayText(value: string): string {
  let normalized = value.trim();
  for (let depth = 0; depth < 4; depth += 1) {
    const stripped = stripSurroundingQuotes(normalized);
    const unescaped = stripped.replace(/\\"/g, '"').replace(/\\'/g, "'");
    if (unescaped === normalized) {
      return normalized;
    }
    normalized = unescaped.trim();
  }
  return normalized;
}

function stripSurroundingQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (
      ((first === '"' && last === '"') || (first === "'" && last === "'")) &&
      !value.slice(1, -1).includes(first)
    ) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Safely extract a string field from a JSON toolInput blob. */
function extractJsonField(toolInput: string, key: string): string | null {
  try {
    const parsed = JSON.parse(toolInput) as Record<string, unknown>;
    if (typeof parsed !== "object" || !parsed) return null;
    const value = parsed[key];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Derive a short contextual hint from toolInput to append to the summary line.
 * Returns null when nothing useful can be extracted.
 */
function extractToolHint(summary: string, toolInput: string | undefined | null): string | null {
  if (!toolInput) return null;
  const key = summary.toLowerCase();

  // File-oriented tools: show the filename
  if (key === "read" || key === "edit" || key === "write") {
    const filePath = extractJsonField(toolInput, "file_path");
    return filePath ? basenameOfPath(filePath) : null;
  }

  // Glob: show the pattern
  if (key === "glob") {
    return extractJsonField(toolInput, "pattern");
  }

  // Grep: show the search pattern
  if (key === "grep") {
    return extractJsonField(toolInput, "pattern");
  }

  // Agent: show the short description
  if (key === "agent") {
    return extractJsonField(toolInput, "description");
  }

  // Skill: show the skill name
  if (key === "skill") {
    return extractJsonField(toolInput, "skill");
  }

  // Bash/Shell: show the command (truncated)
  if (key === "shell" || key === "bash") {
    const cmd = extractJsonField(toolInput, "command");
    if (!cmd) return null;
    const simplified = simplifyShellCommand(cmd);
    return simplified.length > 60 ? `${simplified.slice(0, 57)}...` : simplified;
  }

  return null;
}

export function workEntrySummary(
  workEntry: Pick<
    MinimalWorkEntry,
    "label" | "toolTitle" | "command" | "requestKind" | "itemType" | "toolName" | "toolInput"
  >,
): string {
  if (
    workEntry.command &&
    (workEntry.requestKind === "command" || workEntry.itemType === "command_execution")
  ) {
    return `Ran ${simplifyShellCommand(workEntry.command)}`;
  }

  if (workEntry.itemType === "mcp_tool_call") {
    const parsed = parseMcpFields(workEntry);
    if (parsed) return `${parsed.actionName} (${parsed.serverName})`;
    return "MCP tool";
  }

  const normalizedLabel = normalizeCompactToolLabel(workEntry.label).replace(/[_-]+/g, " ").trim();
  if (normalizedLabel.length === 0) {
    return toolWorkEntryHeading(workEntry);
  }
  let summary = simplifyRanLabel(capitalizePhrase(normalizedLabel));
  // If the label is generic "Tool call", fall back to toolName for a better summary
  if (summary.toLowerCase() === "tool call" && workEntry.toolName) {
    summary = humanizeToolLabel(workEntry.toolName);
  }
  // Append a contextual hint for tools that only show a generic verb
  const hint = extractToolHint(summary, workEntry.toolInput);
  if (hint) {
    return `${summary} ${hint}`;
  }
  return summary;
}

/** If a label starts with "Ran " and contains a shell wrapper, simplify it. */
export function simplifyRanLabel(label: string): string {
  const ranMatch = /^Ran\s+(.+?)(?:\s+for\s+.+)?$/i.exec(label);
  if (!ranMatch?.[1]) return label;
  const simplified = simplifyShellCommand(ranMatch[1]);
  if (simplified === ranMatch[1]) return label;
  return `Ran ${simplified}`;
}

export function workEntryPreview(
  workEntry: Pick<MinimalWorkEntry, "detail" | "command" | "changedFiles">,
): string | null {
  if (workEntry.command) return simplifyShellCommand(workEntry.command);
  if (workEntry.detail) return workEntry.detail;
  const files = workEntry.changedFiles;
  if (!files || files.length === 0) return null;
  return files.length === 1 ? files[0]! : `${files[0]} +${files.length - 1} more`;
}

export function workEntryHasExpandableContent(
  workEntry: Pick<MinimalWorkEntry, "detail" | "command" | "changedFiles" | "toolInput">,
): boolean {
  return workEntryPreview(workEntry) !== null || Boolean(workEntry.toolInput);
}

export function workEntryPanelLabel(workEntry: MinimalWorkEntry): string {
  if (
    workEntry.requestKind === "command" ||
    workEntry.itemType === "command_execution" ||
    workEntry.command
  ) {
    return "Shell";
  }
  if (workEntry.requestKind === "file-read") {
    return "Read";
  }
  if (
    workEntry.requestKind === "file-change" ||
    workEntry.itemType === "file_change" ||
    (workEntry.changedFiles?.length ?? 0) > 0
  ) {
    return "Files";
  }
  if (workEntry.itemType === "web_search") {
    return "Web";
  }
  if (workEntry.itemType === "image_view") {
    return "Image";
  }
  if (workEntry.itemType === "mcp_tool_call") {
    const server = mcpServerLabel(workEntry);
    return server ? `MCP · ${server}` : "MCP";
  }
  if (workEntry.itemType === "dynamic_tool_call") {
    return toolWorkEntryHeading(workEntry);
  }
  return toolWorkEntryHeading(workEntry);
}

export function workEntryOutputBody(
  workEntry: Pick<MinimalWorkEntry, "detail" | "changedFiles">,
): string | null {
  if (workEntry.detail) {
    return workEntry.detail;
  }
  if ((workEntry.changedFiles?.length ?? 0) > 0) {
    return workEntry.changedFiles!.join("\n");
  }
  return null;
}

export function workEntryStatusLabel(workEntry: Pick<MinimalWorkEntry, "tone">): string {
  return workEntry.tone === "error" ? "Error" : "Success";
}
