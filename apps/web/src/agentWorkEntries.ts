import type { WorkLogEntry } from "./session-logic";

const CODEX_AGENT_WIDGET_TOOL_KINDS = new Set([
  "spawn_agent",
  "agent_tool_call",
  "resume_agent",
  "wait_for_agents",
  "close_agent",
]);

const INLINE_AGENT_TOOL_KINDS = new Set(["task"]);

export function isCodexAgentWidgetEntry(
  entry: Pick<WorkLogEntry, "itemType"> & { collabToolKind?: string | undefined },
): boolean {
  return (
    entry.itemType === "collab_agent_tool_call" &&
    entry.collabToolKind !== undefined &&
    CODEX_AGENT_WIDGET_TOOL_KINDS.has(entry.collabToolKind)
  );
}

export function isInlineAgentEntry(
  entry: Pick<WorkLogEntry, "itemType"> & { collabToolKind?: string | undefined },
): boolean {
  return (
    entry.itemType === "collab_agent_tool_call" &&
    entry.collabToolKind !== undefined &&
    INLINE_AGENT_TOOL_KINDS.has(entry.collabToolKind)
  );
}
