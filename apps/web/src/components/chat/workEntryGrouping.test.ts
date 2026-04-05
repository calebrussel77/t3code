import { describe, expect, it } from "vitest";

import type { WorkLogEntry } from "../../session-logic";
import { groupWorkEntriesForTimeline } from "./workEntryGrouping";

function makeWorkEntry(
  overrides: Partial<WorkLogEntry> & Pick<WorkLogEntry, "id" | "createdAt" | "label" | "tone">,
): WorkLogEntry {
  return overrides;
}

describe("groupWorkEntriesForTimeline", () => {
  it("groups Claude agent tool calls with their nested tools", () => {
    const items = groupWorkEntriesForTimeline([
      makeWorkEntry({
        id: "agent-1",
        createdAt: "2026-04-05T10:00:00.000Z",
        label: "Agent",
        tone: "tool",
        itemType: "collab_agent_tool_call",
        collabToolKind: "task",
        toolItemId: "tool-agent-1",
        detail: "Review the routing layer",
        subagentPrompt: "Inspect the route loaders and edge cases",
      }),
      makeWorkEntry({
        id: "tool-1",
        createdAt: "2026-04-05T10:00:01.000Z",
        label: "Ran command",
        tone: "tool",
        parentToolUseId: "tool-agent-1",
        command: "ls src/routes",
      }),
      makeWorkEntry({
        id: "tool-2",
        createdAt: "2026-04-05T10:00:02.000Z",
        label: "Read file",
        tone: "tool",
        parentToolUseId: "tool-agent-1",
        detail: "routes/chat.tsx",
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "agent-group",
      entry: { id: "agent-1" },
    });
    if (items[0]?.kind !== "agent-group") {
      throw new Error("expected an agent group");
    }
    expect(items[0].toolEntries.map((entry) => entry.id)).toEqual(["tool-1", "tool-2"]);
  });

  it("folds reasoning updates immediately before an agent into that agent card", () => {
    const items = groupWorkEntriesForTimeline([
      makeWorkEntry({
        id: "reasoning-1",
        createdAt: "2026-04-05T10:00:00.000Z",
        label: "Reasoning update",
        tone: "info",
        detail: "Running Read schema.prisma",
      }),
      makeWorkEntry({
        id: "reasoning-2",
        createdAt: "2026-04-05T10:00:01.000Z",
        label: "Reasoning update",
        tone: "info",
        detail: "Running Grep ConversationAnalysis",
      }),
      makeWorkEntry({
        id: "agent-1",
        createdAt: "2026-04-05T10:00:02.000Z",
        label: "Agent",
        tone: "tool",
        itemType: "collab_agent_tool_call",
        collabToolKind: "task",
        toolItemId: "tool-agent-1",
        detail: "Review the routing layer",
        subagentPrompt: "Inspect the route loaders and edge cases",
      }),
    ]);

    expect(items).toHaveLength(1);
    if (items[0]?.kind !== "agent-group") {
      throw new Error("expected an agent group");
    }
    expect(items[0].toolEntries.map((entry) => entry.id)).toEqual(["reasoning-1", "reasoning-2"]);
  });

  it("keeps Codex spawn-agent entries out of the timeline grouping", () => {
    const items = groupWorkEntriesForTimeline([
      makeWorkEntry({
        id: "spawn-agent",
        createdAt: "2026-04-05T10:00:00.000Z",
        label: "SpawnAgent",
        tone: "tool",
        itemType: "collab_agent_tool_call",
        collabToolKind: "spawn_agent",
        toolItemId: "codex-agent-1",
        detail: "Explore the routing layer",
      }),
      makeWorkEntry({
        id: "tool-1",
        createdAt: "2026-04-05T10:00:01.000Z",
        label: "Ran command",
        tone: "tool",
        command: "bun lint",
      }),
    ]);

    expect(items).toEqual([{ kind: "single", entry: expect.objectContaining({ id: "tool-1" }) }]);
  });

  it("does not render unknown collab agent entries as inline agent cards", () => {
    const items = groupWorkEntriesForTimeline([
      makeWorkEntry({
        id: "codex-agent-finish",
        createdAt: "2026-04-05T10:00:00.000Z",
        label: "Agent",
        tone: "tool",
        itemType: "collab_agent_tool_call",
        toolItemId: "codex-agent-1",
        detail: "Background teammate",
      }),
    ]);

    expect(items).toEqual([
      { kind: "single", entry: expect.objectContaining({ id: "codex-agent-finish" }) },
    ]);
  });
});
