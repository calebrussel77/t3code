import "../../index.css";

import { MessageId } from "@t3tools/contracts";
import { useState, type ComponentProps } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { deriveTimelineEntries, type WorkLogEntry } from "../../session-logic";
import { MessagesTimeline } from "./MessagesTimeline";

function isoAt(offsetSeconds: number): string {
  return new Date(Date.UTC(2026, 2, 17, 19, 12, 28) + offsetSeconds * 1_000).toISOString();
}

function MessagesTimelineBrowserHarness(
  props: Omit<ComponentProps<typeof MessagesTimeline>, "scrollContainer">,
) {
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);

  return (
    <div
      ref={setScrollContainer}
      data-testid="messages-timeline-scroll-container"
      className="h-[900px] overflow-y-auto"
    >
      <MessagesTimeline {...props} scrollContainer={scrollContainer} />
    </div>
  );
}

function createTimelineProps(workEntries: WorkLogEntry[]) {
  return {
    hasMessages: true,
    isWorking: false,
    activeTurnInProgress: false,
    activeTurnStartedAt: null,
    timelineEntries: deriveTimelineEntries(
      [
        {
          id: MessageId.makeUnsafe("assistant-message-1"),
          role: "assistant" as const,
          text: "Finished.",
          createdAt: isoAt(30),
          streaming: false,
        },
      ],
      [],
      workEntries,
    ),
    completionDividerBeforeEntryId: null,
    completionSummary: null,
    turnDiffSummaryByAssistantMessageId: new Map(),
    nowIso: isoAt(40),
    expandedWorkGroups: {},
    onToggleWorkGroup: () => {},
    onOpenTurnDiff: () => {},
    revertTurnCountByUserMessageId: new Map(),
    onRevertUserMessage: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    markdownCwd: "/repo/project",
    resolvedTheme: "light" as const,
    timestampFormat: "locale" as const,
    workspaceRoot: "/repo/project",
  };
}

async function mountTimeline(workEntries: WorkLogEntry[]) {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <MessagesTimelineBrowserHarness {...createTimelineProps(workEntries)} />,
    {
      container: host,
    },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
  };
}

describe("MessagesTimeline inline Claude agent tools", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("expands inline agent tool rows to reveal tool output", async () => {
    const workEntries: WorkLogEntry[] = [
      {
        id: "agent-1",
        createdAt: isoAt(0),
        label: "Agent",
        detail: "Review the route structure",
        subagentPrompt: "Inspect the route groups and summarize how pages are organized.",
        tone: "tool",
        toolTitle: "Agent",
        itemType: "collab_agent_tool_call",
        collabToolKind: "task",
        toolItemId: "tool-agent-1",
        itemStatus: "completed",
      },
      {
        id: "tool-1",
        createdAt: isoAt(1),
        label: "Running List agent pages",
        detail: "app/(agents)/page.tsx\napp/(agents)/[slug]/page.tsx",
        tone: "tool",
        toolTitle: "bash",
        parentToolUseId: "tool-agent-1",
        command: "ls app/(agents)",
        itemType: "command_execution",
      },
    ];

    await using _ = await mountTimeline(workEntries);

    await page.getByText("Review the route structure").click();

    const inlineToolRow = document.querySelector(
      '[data-inline-agent-tool-toggle="tool-1"]',
    ) as HTMLButtonElement | null;
    expect(inlineToolRow).not.toBeNull();
    await expect.element(page.getByText("Bash")).toBeVisible();

    inlineToolRow?.click();

    await vi.waitFor(() => {
      const toolPanel = document.querySelector('[data-inline-agent-tool-panel="tool-1"]');
      expect(toolPanel).not.toBeNull();
      expect(document.body.textContent ?? "").toContain("app/(agents)/page.tsx");
      expect(document.body.textContent ?? "").toContain("ls app/(agents)");
    });
  });
});
