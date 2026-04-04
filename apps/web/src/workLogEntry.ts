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

function summaryLabelWithCommand(label: string, command: string): string {
  const normalizedCommand = command.trim();
  if (normalizedCommand.length === 0) {
    return label;
  }
  if (/^ran command\b/i.test(label)) {
    return label.replace(/^ran command\b/i, `Ran ${normalizedCommand}`);
  }
  if (/^(?:command|exec command)\b/i.test(label)) {
    return `Ran ${normalizedCommand}`;
  }
  return label;
}

export function workEntrySummary(
  workEntry: Pick<MinimalWorkEntry, "label" | "toolTitle" | "command" | "requestKind" | "itemType">,
): string {
  const normalizedLabel = normalizeCompactToolLabel(workEntry.label).replace(/[_-]+/g, " ").trim();
  if (normalizedLabel.length === 0) {
    if (
      workEntry.command &&
      (workEntry.requestKind === "command" || workEntry.itemType === "command_execution")
    ) {
      return `Ran ${workEntry.command}`;
    }
    return toolWorkEntryHeading(workEntry);
  }
  if (
    workEntry.command &&
    (workEntry.requestKind === "command" || workEntry.itemType === "command_execution")
  ) {
    return summaryLabelWithCommand(capitalizePhrase(normalizedLabel), workEntry.command);
  }
  return capitalizePhrase(normalizedLabel);
}

export function workEntryPreview(
  workEntry: Pick<MinimalWorkEntry, "detail" | "command" | "changedFiles">,
): string | null {
  if (workEntry.command) return workEntry.command;
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
