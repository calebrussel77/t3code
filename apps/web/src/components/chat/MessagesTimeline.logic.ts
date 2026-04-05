import { type MessageId } from "@t3tools/contracts";
import { type TimelineEntry, type WorkLogEntry } from "../../session-logic";
import { buildTurnDiffTree, type TurnDiffTreeNode } from "../../lib/turnDiffTree";
import { type ChatMessage, type ProposedPlan, type TurnDiffSummary } from "../../types";
import { estimateTimelineMessageHeight } from "../timelineHeight";
import { normalizeCompactToolLabel, workEntryHasExpandableContent } from "../../workLogEntry";
import { groupWorkEntriesForTimeline } from "./workEntryGrouping";

const WORK_ROW_BOTTOM_PADDING_PX = 16;
const SIMPLE_WORK_ENTRY_HEIGHT_PX = 36;
const COLLAPSED_WORK_ENTRY_HEIGHT_PX = 40;
const EXPANDED_WORK_ENTRY_HEIGHT_PX = 240;
const WORK_ENTRY_GAP_PX = 6;
const REASONING_GROUP_COLLAPSED_HEIGHT_PX = 40;
const REASONING_GROUP_EXPANDED_BASE_HEIGHT_PX = 52;
const REASONING_GROUP_ITEM_HEIGHT_PX = 24;
const AGENT_GROUP_COLLAPSED_HEIGHT_PX = 56;
const AGENT_GROUP_EXPANDED_BASE_HEIGHT_PX = 188;
const AGENT_GROUP_TOOL_HEIGHT_PX = 40;
const AGENT_GROUP_EXPANDED_TOOL_HEIGHT_PX = 240;
const AGENT_GROUP_TOOL_LIST_LIMIT = 5;

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  completedAt?: string | undefined;
}

export type MessagesTimelineRow =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: WorkLogEntry[];
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      durationStart: string;
      showCompletionDivider: boolean;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | { kind: "working"; id: string; createdAt: string | null };

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

export { normalizeCompactToolLabel } from "../../workLogEntry";

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  completionDividerBeforeEntryId: string | null;
  isWorking: boolean;
  activeTurnStartedAt: string | null;
}): MessagesTimelineRow[] {
  const nextRows: MessagesTimelineRow[] = [];
  const durationStartByMessageId = computeMessageDurationStart(
    input.timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      const groupedEntries = [timelineEntry.entry];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (!nextEntry || nextEntry.kind !== "work") break;
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
      }
      nextRows.push({
        kind: "work",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        groupedEntries,
      });
      index = cursor - 1;
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      nextRows.push({
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      });
      continue;
    }

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart:
        durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt,
      showCompletionDivider:
        timelineEntry.message.role === "assistant" &&
        input.completionDividerBeforeEntryId === timelineEntry.id,
    });
  }

  if (input.isWorking) {
    nextRows.push({
      kind: "working",
      id: "working-indicator-row",
      createdAt: input.activeTurnStartedAt,
    });
  }

  return nextRows;
}

export function estimateMessagesTimelineRowHeight(
  row: MessagesTimelineRow,
  input: {
    timelineWidthPx: number | null;
    expandedWorkGroups?: Readonly<Record<string, boolean>>;
    expandedWorkEntries?: Readonly<Record<string, boolean>>;
    expandedAgentToolLists?: Readonly<Record<string, boolean>>;
    turnDiffSummaryByAssistantMessageId?: ReadonlyMap<MessageId, TurnDiffSummary>;
  },
): number {
  switch (row.kind) {
    case "work":
      return estimateWorkRowHeight(row, input);
    case "proposed-plan":
      return estimateTimelineProposedPlanHeight(row.proposedPlan);
    case "working":
      return 40;
    case "message": {
      let estimate = estimateTimelineMessageHeight(row.message, {
        timelineWidthPx: input.timelineWidthPx,
      });
      const turnDiffSummary = input.turnDiffSummaryByAssistantMessageId?.get(row.message.id);
      if (turnDiffSummary && turnDiffSummary.files.length > 0) {
        estimate += estimateChangedFilesCardHeight(turnDiffSummary);
      }
      return estimate;
    }
  }
}

function estimateWorkRowHeight(
  row: Extract<MessagesTimelineRow, { kind: "work" }>,
  input: {
    expandedWorkGroups?: Readonly<Record<string, boolean>>;
    expandedWorkEntries?: Readonly<Record<string, boolean>>;
    expandedAgentToolLists?: Readonly<Record<string, boolean>>;
  },
): number {
  const visibleItems = groupWorkEntriesForTimeline(row.groupedEntries);

  const visibleEntryHeight = visibleItems.reduce((total, item) => {
    if (item.kind === "reasoning-group") {
      const isExpanded = input.expandedWorkEntries?.[item.collapseKey] ?? false;
      if (!isExpanded) {
        return total + REASONING_GROUP_COLLAPSED_HEIGHT_PX;
      }
      return (
        total +
        REASONING_GROUP_EXPANDED_BASE_HEIGHT_PX +
        item.entries.length * REASONING_GROUP_ITEM_HEIGHT_PX
      );
    }

    if (item.kind === "agent-group") {
      const isExpanded = input.expandedWorkEntries?.[item.collapseKey] ?? false;
      if (!isExpanded) {
        return total + AGENT_GROUP_COLLAPSED_HEIGHT_PX;
      }
      const showAllTools = input.expandedAgentToolLists?.[item.collapseKey] ?? false;
      const visibleToolCount = showAllTools
        ? item.toolEntries.length
        : Math.min(item.toolEntries.length, AGENT_GROUP_TOOL_LIST_LIMIT);
      const toolHeight = item.toolEntries.reduce((toolTotal, toolEntry, index) => {
        if (index >= visibleToolCount) {
          return toolTotal;
        }
        const isToolExpanded = input.expandedWorkEntries?.[toolEntry.id] ?? false;
        if (!workEntryHasExpandableContent(toolEntry) || !isToolExpanded) {
          return toolTotal + AGENT_GROUP_TOOL_HEIGHT_PX;
        }
        return toolTotal + AGENT_GROUP_EXPANDED_TOOL_HEIGHT_PX;
      }, 0);
      const showMoreHeight = item.toolEntries.length > AGENT_GROUP_TOOL_LIST_LIMIT ? 36 : 0;
      return total + AGENT_GROUP_EXPANDED_BASE_HEIGHT_PX + toolHeight + showMoreHeight;
    }

    const isEntryExpanded = input.expandedWorkEntries?.[item.entry.id] ?? false;
    if (!workEntryHasExpandableContent(item.entry)) {
      return total + SIMPLE_WORK_ENTRY_HEIGHT_PX;
    }
    return (
      total + (isEntryExpanded ? EXPANDED_WORK_ENTRY_HEIGHT_PX : COLLAPSED_WORK_ENTRY_HEIGHT_PX)
    );
  }, 0);

  return (
    visibleEntryHeight +
    Math.max(0, visibleItems.length - 1) * WORK_ENTRY_GAP_PX +
    WORK_ROW_BOTTOM_PADDING_PX
  );
}

function estimateTimelineProposedPlanHeight(proposedPlan: ProposedPlan): number {
  const estimatedLines = Math.max(1, Math.ceil(proposedPlan.planMarkdown.length / 72));
  return 120 + Math.min(estimatedLines * 22, 880);
}

function estimateChangedFilesCardHeight(turnDiffSummary: TurnDiffSummary): number {
  const treeNodes = buildTurnDiffTree(turnDiffSummary.files);
  const visibleNodeCount = countTurnDiffTreeNodes(treeNodes);

  // Card chrome: top/bottom padding, header row, and tree spacing.
  return 60 + visibleNodeCount * 25;
}

function countTurnDiffTreeNodes(nodes: ReadonlyArray<TurnDiffTreeNode>): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (node.kind === "directory") {
      count += countTurnDiffTreeNodes(node.children);
    }
  }
  return count;
}
