import type { WorkLogEntry } from "./session-logic";

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
>;

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
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
      return "Shell";
    case "read file":
      return "Read";
    case "apply patch":
      return "Edit";
    case "web search":
      return "Web";
    case "image view":
      return "Image";
    case "subagent task":
      return "Agent";
    default:
      return capitalizePhrase(normalized);
  }
}

export function toolWorkEntryHeading(
  workEntry: Pick<MinimalWorkEntry, "toolTitle" | "label">,
): string {
  if (workEntry.toolTitle) {
    return humanizeToolLabel(workEntry.toolTitle);
  }
  return humanizeToolLabel(workEntry.label);
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

export function workEntrySummary(
  workEntry: Pick<MinimalWorkEntry, "label" | "toolTitle" | "command" | "requestKind" | "itemType">,
): string {
  if (
    workEntry.command &&
    (workEntry.requestKind === "command" || workEntry.itemType === "command_execution")
  ) {
    return `Ran ${simplifyShellCommand(workEntry.command)}`;
  }

  const normalizedLabel = normalizeCompactToolLabel(workEntry.label).replace(/[_-]+/g, " ").trim();
  if (normalizedLabel.length === 0) {
    return toolWorkEntryHeading(workEntry);
  }
  return simplifyRanLabel(capitalizePhrase(normalizedLabel));
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
  workEntry: Pick<MinimalWorkEntry, "detail" | "command" | "changedFiles">,
): boolean {
  return workEntryPreview(workEntry) !== null;
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
