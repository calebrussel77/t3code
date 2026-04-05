import type { WorkLogEntry } from "../../session-logic";
import { isCodexAgentWidgetEntry, isInlineAgentEntry } from "../../agentWorkEntries";

export type GroupedWorkEntryRenderItem =
  | { kind: "single"; entry: WorkLogEntry }
  | { kind: "reasoning-group"; entries: WorkLogEntry[]; collapseKey: string }
  | {
      kind: "agent-group";
      entry: WorkLogEntry;
      toolEntries: WorkLogEntry[];
      collapseKey: string;
    };

export function isReasoningUpdateWorkEntry(
  workEntry: Pick<WorkLogEntry, "tone" | "label" | "toolTitle">,
): boolean {
  return (
    workEntry.tone === "info" &&
    (workEntry.label === "Reasoning update" ||
      workEntry.toolTitle === "Reasoning update" ||
      workEntry.label.startsWith("Reasoning"))
  );
}

export function groupWorkEntriesForTimeline(
  entries: ReadonlyArray<WorkLogEntry>,
): GroupedWorkEntryRenderItem[] {
  const result: GroupedWorkEntryRenderItem[] = [];
  let reasoningBatch: WorkLogEntry[] = [];
  const agentGroupByToolUseId = new Map<
    string,
    Extract<GroupedWorkEntryRenderItem, { kind: "agent-group" }>
  >();

  const flushReasoning = () => {
    if (reasoningBatch.length === 0) return;
    if (reasoningBatch.length === 1) {
      result.push({ kind: "single", entry: reasoningBatch[0]! });
    } else {
      result.push({
        kind: "reasoning-group",
        entries: [...reasoningBatch],
        collapseKey: `rg:${reasoningBatch[0]!.id}`,
      });
    }
    reasoningBatch = [];
  };

  for (const entry of entries) {
    if (isCodexAgentWidgetEntry(entry)) {
      continue;
    }

    if (entry.parentToolUseId) {
      const agentGroup = agentGroupByToolUseId.get(entry.parentToolUseId);
      if (agentGroup) {
        agentGroup.toolEntries.push(entry);
        continue;
      }
    }

    if (isInlineAgentEntry(entry)) {
      const agentGroup: Extract<GroupedWorkEntryRenderItem, { kind: "agent-group" }> = {
        kind: "agent-group",
        entry,
        toolEntries: [...reasoningBatch],
        collapseKey: `ag:${entry.id}`,
      };
      reasoningBatch = [];
      result.push(agentGroup);
      if (entry.toolItemId) {
        agentGroupByToolUseId.set(entry.toolItemId, agentGroup);
      }
      continue;
    }

    if (isReasoningUpdateWorkEntry(entry)) {
      reasoningBatch.push(entry);
      continue;
    }

    flushReasoning();
    result.push({ kind: "single", entry });
  }

  flushReasoning();
  return result;
}
