import { type MessageId, type TurnId } from "@t3tools/contracts";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  measureElement as measureVirtualElement,
  type VirtualItem,
  useVirtualizer,
} from "@tanstack/react-virtual";
import { deriveTimelineEntries } from "../../session-logic";
import { AUTO_SCROLL_BOTTOM_THRESHOLD_PX } from "../../chat-scroll";
import { type TurnDiffSummary } from "../../types";
import { summarizeTurnDiffStats } from "../../lib/turnDiffTree";
import ChatMarkdown from "../ChatMarkdown";
import {
  BotIcon,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CopyIcon,
  EyeIcon,
  GlobeIcon,
  HammerIcon,
  Loader2Icon,
  type LucideIcon,
  SquarePenIcon,
  TerminalIcon,
  Undo2Icon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { clamp } from "effect/Number";
import { buildExpandedImagePreview, ExpandedImagePreview } from "./ExpandedImagePreview";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { ChangedFilesTree } from "./ChangedFilesTree";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { MessageCopyButton } from "./MessageCopyButton";
import {
  deriveMessagesTimelineRows,
  estimateMessagesTimelineRowHeight,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";
import { TerminalContextInlineChip } from "./TerminalContextInlineChip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { groupWorkEntriesForTimeline, isReasoningUpdateWorkEntry } from "./workEntryGrouping";
import {
  deriveDisplayedUserMessageState,
  type ParsedTerminalContextEntry,
} from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import {
  buildInlineTerminalContextText,
  formatInlineTerminalContextLabel,
  textContainsInlineTerminalContextLabels,
} from "./userMessageTerminalContexts";
import {
  simplifyShellCommand,
  toolWorkEntryHeading,
  workEntryHasExpandableContent,
  workEntryPanelLabel,
  workEntryOutputBody,
  workEntryPreview,
  workEntryStatusLabel,
  workEntrySummary,
} from "../../workLogEntry";

const ALWAYS_UNVIRTUALIZED_TAIL_ROWS = 8;

interface MessagesTimelineProps {
  hasMessages: boolean;
  isWorking: boolean;
  activeTurnInProgress: boolean;
  activeTurnStartedAt: string | null;
  scrollContainer: HTMLDivElement | null;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  completionDividerBeforeEntryId: string | null;
  completionSummary: string | null;
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>;
  nowIso: string;
  expandedWorkGroups: Record<string, boolean>;
  onToggleWorkGroup: (groupId: string) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  revertTurnCountByUserMessageId: Map<MessageId, number>;
  onRevertUserMessage: (messageId: MessageId) => void;
  isRevertingCheckpoint: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
  onVirtualizerSnapshot?: (snapshot: {
    totalSize: number;
    measurements: ReadonlyArray<{
      id: string;
      kind: MessagesTimelineRow["kind"];
      index: number;
      size: number;
      start: number;
      end: number;
    }>;
  }) => void;
}

export const MessagesTimeline = memo(function MessagesTimeline({
  hasMessages,
  isWorking,
  activeTurnInProgress,
  activeTurnStartedAt,
  scrollContainer,
  timelineEntries,
  completionDividerBeforeEntryId,
  completionSummary,
  turnDiffSummaryByAssistantMessageId,
  nowIso,
  expandedWorkGroups,
  onToggleWorkGroup: _onToggleWorkGroup,
  onOpenTurnDiff,
  revertTurnCountByUserMessageId,
  onRevertUserMessage,
  isRevertingCheckpoint,
  onImageExpand,
  markdownCwd,
  resolvedTheme,
  timestampFormat: _timestampFormat,
  workspaceRoot,
  onVirtualizerSnapshot,
}: MessagesTimelineProps) {
  const timelineRootRef = useRef<HTMLDivElement | null>(null);
  const [timelineWidthPx, setTimelineWidthPx] = useState<number | null>(null);
  const [expandedWorkEntries, setExpandedWorkEntries] = useState<Record<string, boolean>>({});
  const [expandedAgentToolLists, setExpandedAgentToolLists] = useState<Record<string, boolean>>({});

  useLayoutEffect(() => {
    const timelineRoot = timelineRootRef.current;
    if (!timelineRoot) return;

    const updateWidth = (nextWidth: number) => {
      setTimelineWidthPx((previousWidth) => {
        if (previousWidth !== null && Math.abs(previousWidth - nextWidth) < 0.5) {
          return previousWidth;
        }
        return nextWidth;
      });
    };

    updateWidth(timelineRoot.getBoundingClientRect().width);

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      updateWidth(timelineRoot.getBoundingClientRect().width);
    });
    observer.observe(timelineRoot);
    return () => {
      observer.disconnect();
    };
  }, [hasMessages, isWorking]);

  const rows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        completionDividerBeforeEntryId,
        isWorking,
        activeTurnStartedAt,
      }),
    [timelineEntries, completionDividerBeforeEntryId, isWorking, activeTurnStartedAt],
  );

  const firstUnvirtualizedRowIndex = useMemo(() => {
    const firstTailRowIndex = Math.max(rows.length - ALWAYS_UNVIRTUALIZED_TAIL_ROWS, 0);
    const latestUserRowIndex = (() => {
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        const row = rows[index];
        if (row?.kind === "message" && row.message.role === "user") {
          return index;
        }
      }
      return -1;
    })();

    if (!activeTurnInProgress) {
      return latestUserRowIndex >= 0
        ? Math.min(latestUserRowIndex, firstTailRowIndex)
        : firstTailRowIndex;
    }

    const turnStartedAtMs =
      typeof activeTurnStartedAt === "string" ? Date.parse(activeTurnStartedAt) : Number.NaN;
    let firstCurrentTurnRowIndex = -1;
    if (!Number.isNaN(turnStartedAtMs)) {
      firstCurrentTurnRowIndex = rows.findIndex((row) => {
        if (row.kind === "working") return true;
        if (!row.createdAt) return false;
        const rowCreatedAtMs = Date.parse(row.createdAt);
        return !Number.isNaN(rowCreatedAtMs) && rowCreatedAtMs >= turnStartedAtMs;
      });
    }

    if (firstCurrentTurnRowIndex < 0) {
      firstCurrentTurnRowIndex = rows.findIndex(
        (row) => row.kind === "message" && row.message.streaming,
      );
    }

    if (firstCurrentTurnRowIndex < 0) return firstTailRowIndex;

    for (let index = firstCurrentTurnRowIndex - 1; index >= 0; index -= 1) {
      const previousRow = rows[index];
      if (!previousRow || previousRow.kind !== "message") continue;
      if (previousRow.message.role === "user") {
        return Math.min(index, firstTailRowIndex);
      }
      if (previousRow.message.role === "assistant" && !previousRow.message.streaming) {
        break;
      }
    }

    return Math.min(firstCurrentTurnRowIndex, firstTailRowIndex);
  }, [activeTurnInProgress, activeTurnStartedAt, rows]);

  const virtualizedRowCount = clamp(firstUnvirtualizedRowIndex, {
    minimum: 0,
    maximum: rows.length,
  });
  const virtualMeasurementScopeKey =
    timelineWidthPx === null ? "width:unknown" : `width:${Math.round(timelineWidthPx)}`;

  const rowVirtualizer = useVirtualizer({
    count: virtualizedRowCount,
    getScrollElement: () => scrollContainer,
    // Scope cached row measurements to the current timeline width so offscreen
    // rows do not keep stale heights after wrapping changes.
    getItemKey: (index: number) => {
      const rowId = rows[index]?.id ?? String(index);
      return `${virtualMeasurementScopeKey}:${rowId}`;
    },
    estimateSize: (index: number) => {
      const row = rows[index];
      if (!row) return 96;
      return estimateMessagesTimelineRowHeight(row, {
        expandedWorkGroups,
        expandedWorkEntries,
        expandedAgentToolLists,
        timelineWidthPx,
        turnDiffSummaryByAssistantMessageId,
      });
    },
    measureElement: measureVirtualElement,
    useAnimationFrameWithResizeObserver: true,
    overscan: 8,
  });
  useEffect(() => {
    if (timelineWidthPx === null) return;
    rowVirtualizer.measure();
  }, [rowVirtualizer, timelineWidthPx]);
  useEffect(() => {
    const measureAfterTransition = window.setTimeout(() => {
      rowVirtualizer.measure();
    }, 220);
    rowVirtualizer.measure();
    return () => {
      window.clearTimeout(measureAfterTransition);
    };
  }, [expandedAgentToolLists, expandedWorkEntries, expandedWorkGroups, rowVirtualizer]);
  useEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
      const viewportHeight = instance.scrollRect?.height ?? 0;
      const scrollOffset = instance.scrollOffset ?? 0;
      const itemIntersectsViewport =
        item.end > scrollOffset && item.start < scrollOffset + viewportHeight;
      if (itemIntersectsViewport) {
        return false;
      }
      const remainingDistance = instance.getTotalSize() - (scrollOffset + viewportHeight);
      return remainingDistance > AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
    };
    return () => {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    };
  }, [rowVirtualizer]);
  const pendingMeasureFrameRef = useRef<number | null>(null);
  const onTimelineImageLoad = useCallback(() => {
    if (pendingMeasureFrameRef.current !== null) return;
    pendingMeasureFrameRef.current = window.requestAnimationFrame(() => {
      pendingMeasureFrameRef.current = null;
      rowVirtualizer.measure();
    });
  }, [rowVirtualizer]);
  useEffect(() => {
    return () => {
      const frame = pendingMeasureFrameRef.current;
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);
  useLayoutEffect(() => {
    if (!onVirtualizerSnapshot) {
      return;
    }
    onVirtualizerSnapshot({
      totalSize: rowVirtualizer.getTotalSize(),
      measurements: rowVirtualizer.measurementsCache
        .slice(0, virtualizedRowCount)
        .flatMap((measurement) => {
          const row = rows[measurement.index];
          if (!row) {
            return [];
          }
          return [
            {
              id: row.id,
              kind: row.kind,
              index: measurement.index,
              size: measurement.size,
              start: measurement.start,
              end: measurement.end,
            },
          ];
        }),
    });
  }, [onVirtualizerSnapshot, rowVirtualizer, rows, virtualizedRowCount]);

  const virtualRows = rowVirtualizer.getVirtualItems();
  const nonVirtualizedRows = rows.slice(virtualizedRowCount);
  const [allDirectoriesExpandedByTurnId, setAllDirectoriesExpandedByTurnId] = useState<
    Record<string, boolean>
  >({});
  const onSetWorkEntryExpanded = useCallback((workEntryId: string, open: boolean) => {
    setExpandedWorkEntries((current) => ({
      ...current,
      [workEntryId]: open,
    }));
  }, []);
  const onSetAgentToolListExpanded = useCallback((agentGroupId: string, open: boolean) => {
    setExpandedAgentToolLists((current) => ({
      ...current,
      [agentGroupId]: open,
    }));
  }, []);
  const onToggleAllDirectories = useCallback((turnId: TurnId) => {
    setAllDirectoriesExpandedByTurnId((current) => ({
      ...current,
      [turnId]: !(current[turnId] ?? true),
    }));
  }, []);

  const renderRowContent = (row: TimelineRow) => (
    <div
      className="pb-4"
      data-timeline-row-id={row.id}
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {row.kind === "work" &&
        (() => {
          const groupedEntries = row.groupedEntries;

          // Group all entries so subagent cards get the full tool count
          const renderItems = groupWorkEntriesForTimeline(groupedEntries);

          return (
            <div className="space-y-0.5">
              {renderItems.map((item) => {
                if (item.kind === "reasoning-group") {
                  return (
                    <ReasoningGroupRow
                      key={item.collapseKey}
                      entries={item.entries}
                      isExpanded={expandedWorkEntries[item.collapseKey] ?? false}
                      onExpandedChange={(open) => onSetWorkEntryExpanded(item.collapseKey, open)}
                    />
                  );
                }
                if (item.kind === "agent-group") {
                  return (
                    <InlineAgentGroupRow
                      key={item.collapseKey}
                      agentEntry={item.entry}
                      toolEntries={item.toolEntries}
                      isExpanded={expandedWorkEntries[item.collapseKey] ?? false}
                      areAllToolsVisible={expandedAgentToolLists[item.collapseKey] ?? false}
                      isConversationRunning={isWorking}
                      onExpandedChange={(open) => onSetWorkEntryExpanded(item.collapseKey, open)}
                      onToolListExpandedChange={(open) =>
                        onSetAgentToolListExpanded(item.collapseKey, open)
                      }
                      expandedWorkEntries={expandedWorkEntries}
                      onSetWorkEntryExpanded={onSetWorkEntryExpanded}
                    />
                  );
                }
                return (
                  <WorkEntryRow
                    key={`work-row:${item.entry.id}`}
                    workEntry={item.entry}
                    isExpanded={expandedWorkEntries[item.entry.id] ?? false}
                    onExpandedChange={(open) => onSetWorkEntryExpanded(item.entry.id, open)}
                  />
                );
              })}
            </div>
          );
        })()}

      {row.kind === "message" &&
        row.message.role === "user" &&
        (() => {
          const userImages = row.message.attachments ?? [];
          const displayedUserMessage = deriveDisplayedUserMessageState(row.message.text);
          const terminalContexts = displayedUserMessage.contexts;
          const canRevertAgentWork = revertTurnCountByUserMessageId.has(row.message.id);
          const hasUserActions = Boolean(displayedUserMessage.copyText) || canRevertAgentWork;
          return (
            <div className="flex justify-end">
              <div className="group flex max-w-[80%] flex-col items-end">
                <div className="relative rounded-2xl rounded-br-sm border border-border bg-secondary px-4 py-3">
                  {userImages.length > 0 && (
                    <div className="mb-2 grid max-w-[420px] grid-cols-2 gap-2">
                      {userImages.map(
                        (image: NonNullable<TimelineMessage["attachments"]>[number]) => (
                          <div
                            key={image.id}
                            className="overflow-hidden rounded-lg border border-border/80 bg-background/70"
                          >
                            {image.previewUrl ? (
                              <button
                                type="button"
                                className="h-full w-full cursor-zoom-in"
                                aria-label={`Preview ${image.name}`}
                                onClick={() => {
                                  const preview = buildExpandedImagePreview(userImages, image.id);
                                  if (!preview) return;
                                  onImageExpand(preview);
                                }}
                              >
                                <img
                                  src={image.previewUrl}
                                  alt={image.name}
                                  className="h-full max-h-[220px] w-full object-cover"
                                  onLoad={onTimelineImageLoad}
                                  onError={onTimelineImageLoad}
                                />
                              </button>
                            ) : (
                              <div className="flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-[11px] text-muted-foreground/70">
                                {image.name}
                              </div>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  )}
                  {(displayedUserMessage.visibleText.trim().length > 0 ||
                    terminalContexts.length > 0) && (
                    <UserMessageBody
                      text={displayedUserMessage.visibleText}
                      terminalContexts={terminalContexts}
                    />
                  )}
                </div>
                {hasUserActions && (
                  <div className="mt-1 flex items-center gap-1.5 pr-1 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
                    {displayedUserMessage.copyText && (
                      <MessageCopyButton text={displayedUserMessage.copyText} />
                    )}
                    {canRevertAgentWork && (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={isRevertingCheckpoint || isWorking}
                        onClick={() => onRevertUserMessage(row.message.id)}
                        title="Revert to this message"
                      >
                        <Undo2Icon className="size-3" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {row.kind === "message" &&
        row.message.role === "assistant" &&
        (() => {
          const messageText = row.message.text || (row.message.streaming ? "" : "(empty response)");
          return (
            <>
              {row.showCompletionDivider && (
                <div className="my-3 flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
                    {completionSummary ? `Response • ${completionSummary}` : "Response"}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <div className="min-w-0 px-1 py-0.5">
                <ChatMarkdown
                  text={messageText}
                  cwd={markdownCwd}
                  isStreaming={Boolean(row.message.streaming)}
                />
                {(() => {
                  const turnSummary = turnDiffSummaryByAssistantMessageId.get(row.message.id);
                  if (!turnSummary) return null;
                  const checkpointFiles = turnSummary.files;
                  if (checkpointFiles.length === 0) return null;
                  const summaryStat = summarizeTurnDiffStats(checkpointFiles);
                  const changedFileCountLabel = String(checkpointFiles.length);
                  const allDirectoriesExpanded =
                    allDirectoriesExpandedByTurnId[turnSummary.turnId] ?? true;
                  return (
                    <div className="mt-2 rounded-lg border border-border/80 bg-card/45 p-2.5">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/65">
                          <span>Changed files ({changedFileCountLabel})</span>
                          {hasNonZeroStat(summaryStat) && (
                            <>
                              <span className="mx-1">•</span>
                              <DiffStatLabel
                                additions={summaryStat.additions}
                                deletions={summaryStat.deletions}
                              />
                            </>
                          )}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            data-scroll-anchor-ignore
                            onClick={() => onToggleAllDirectories(turnSummary.turnId)}
                          >
                            {allDirectoriesExpanded ? "Collapse all" : "Expand all"}
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() =>
                              onOpenTurnDiff(turnSummary.turnId, checkpointFiles[0]?.path)
                            }
                          >
                            View diff
                          </Button>
                        </div>
                      </div>
                      <ChangedFilesTree
                        key={`changed-files-tree:${turnSummary.turnId}`}
                        turnId={turnSummary.turnId}
                        files={checkpointFiles}
                        allDirectoriesExpanded={allDirectoriesExpanded}
                        resolvedTheme={resolvedTheme}
                        onOpenTurnDiff={onOpenTurnDiff}
                      />
                    </div>
                  );
                })()}
              </div>
            </>
          );
        })()}

      {row.kind === "proposed-plan" && (
        <div className="min-w-0 px-1 py-0.5">
          <ProposedPlanCard
            planMarkdown={row.proposedPlan.planMarkdown}
            cwd={markdownCwd}
            workspaceRoot={workspaceRoot}
          />
        </div>
      )}

      {row.kind === "working" && (
        <div className="py-0.5 pl-1.5">
          <div className="flex items-center gap-2 pt-1 text-sm text-muted-foreground/70">
            <span className="inline-flex items-center gap-[3px]">
              <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse" />
              <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:200ms]" />
              <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:400ms]" />
            </span>
            <span>
              {row.createdAt
                ? `Working for ${formatWorkingTimer(row.createdAt, nowIso) ?? "0s"}`
                : "Working..."}
            </span>
          </div>
        </div>
      )}
    </div>
  );

  if (!hasMessages && !isWorking) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground/30">
          Send a message to start the conversation.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={timelineRootRef}
      data-timeline-root="true"
      className="mx-auto w-full min-w-0 max-w-3xl overflow-x-hidden"
    >
      {virtualizedRowCount > 0 && (
        <div className="relative" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
          {virtualRows.map((virtualRow: VirtualItem) => {
            const row = rows[virtualRow.index];
            if (!row) return null;

            return (
              <div
                key={`virtual-row:${row.id}`}
                data-index={virtualRow.index}
                data-virtual-row-id={row.id}
                data-virtual-row-kind={row.kind}
                data-virtual-row-size={virtualRow.size}
                data-virtual-row-start={virtualRow.start}
                ref={rowVirtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {renderRowContent(row)}
              </div>
            );
          })}
        </div>
      )}

      {nonVirtualizedRows.map((row) => (
        <div key={`non-virtual-row:${row.id}`}>{renderRowContent(row)}</div>
      ))}
    </div>
  );
});

type TimelineEntry = ReturnType<typeof deriveTimelineEntries>[number];
type TimelineMessage = Extract<TimelineEntry, { kind: "message" }>["message"];
type TimelineWorkEntry = Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"][number];
type TimelineRow = MessagesTimelineRow;

function formatWorkingTimer(startIso: string, endIso: string): string | null {
  const startedAtMs = Date.parse(startIso);
  const endedAtMs = Date.parse(endIso);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

const UserMessageTerminalContextInlineLabel = memo(
  function UserMessageTerminalContextInlineLabel(props: { context: ParsedTerminalContextEntry }) {
    const tooltipText =
      props.context.body.length > 0
        ? `${props.context.header}\n${props.context.body}`
        : props.context.header;

    return <TerminalContextInlineChip label={props.context.header} tooltipText={tooltipText} />;
  },
);

const UserMessageBody = memo(function UserMessageBody(props: {
  text: string;
  terminalContexts: ParsedTerminalContextEntry[];
}) {
  if (props.terminalContexts.length > 0) {
    const hasEmbeddedInlineLabels = textContainsInlineTerminalContextLabels(
      props.text,
      props.terminalContexts,
    );
    const inlinePrefix = buildInlineTerminalContextText(props.terminalContexts);
    const inlineNodes: ReactNode[] = [];

    if (hasEmbeddedInlineLabels) {
      let cursor = 0;

      for (const context of props.terminalContexts) {
        const label = formatInlineTerminalContextLabel(context.header);
        const matchIndex = props.text.indexOf(label, cursor);
        if (matchIndex === -1) {
          inlineNodes.length = 0;
          break;
        }
        if (matchIndex > cursor) {
          inlineNodes.push(
            <span key={`user-terminal-context-inline-before:${context.header}:${cursor}`}>
              {props.text.slice(cursor, matchIndex)}
            </span>,
          );
        }
        inlineNodes.push(
          <UserMessageTerminalContextInlineLabel
            key={`user-terminal-context-inline:${context.header}`}
            context={context}
          />,
        );
        cursor = matchIndex + label.length;
      }

      if (inlineNodes.length > 0) {
        if (cursor < props.text.length) {
          inlineNodes.push(
            <span key={`user-message-terminal-context-inline-rest:${cursor}`}>
              {props.text.slice(cursor)}
            </span>,
          );
        }

        return (
          <div className="wrap-break-word whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground">
            {inlineNodes}
          </div>
        );
      }
    }

    for (const context of props.terminalContexts) {
      inlineNodes.push(
        <UserMessageTerminalContextInlineLabel
          key={`user-terminal-context-inline:${context.header}`}
          context={context}
        />,
      );
      inlineNodes.push(
        <span key={`user-terminal-context-inline-space:${context.header}`} aria-hidden="true">
          {" "}
        </span>,
      );
    }

    if (props.text.length > 0) {
      inlineNodes.push(<span key="user-message-terminal-context-inline-text">{props.text}</span>);
    } else if (inlinePrefix.length === 0) {
      return null;
    }

    return (
      <div className="wrap-break-word whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground">
        {inlineNodes}
      </div>
    );
  }

  if (props.text.length === 0) {
    return null;
  }

  return (
    <pre className="whitespace-pre-wrap wrap-break-word font-mono text-sm leading-relaxed text-foreground">
      {props.text}
    </pre>
  );
});

function workToneIcon(tone: TimelineWorkEntry["tone"]): {
  icon: LucideIcon;
  className: string;
} {
  if (tone === "error") {
    return {
      icon: CircleAlertIcon,
      className: "text-foreground/92",
    };
  }
  if (tone === "thinking") {
    return {
      icon: BotIcon,
      className: "text-foreground/92",
    };
  }
  if (tone === "info") {
    return {
      icon: CheckIcon,
      className: "text-foreground/92",
    };
  }
  return {
    icon: ZapIcon,
    className: "text-foreground/92",
  };
}

function workToneClass(tone: "thinking" | "tool" | "info" | "error"): string {
  if (tone === "error") return "text-rose-300/50 dark:text-rose-300/50";
  if (tone === "tool") return "text-muted-foreground/70";
  if (tone === "thinking") return "text-muted-foreground/50";
  return "text-muted-foreground/40";
}

function workEntryIcon(workEntry: TimelineWorkEntry): LucideIcon {
  if (isReasoningUpdateWorkEntry(workEntry)) return BrainIcon;
  if (workEntry.itemType === "collab_agent_tool_call") return BotIcon;

  if (workEntry.requestKind === "command") return TerminalIcon;
  if (workEntry.requestKind === "file-read") return EyeIcon;
  if (workEntry.requestKind === "file-change") return SquarePenIcon;

  if (workEntry.itemType === "command_execution" || workEntry.command) {
    return TerminalIcon;
  }
  if (workEntry.itemType === "file_change" || (workEntry.changedFiles?.length ?? 0) > 0) {
    return SquarePenIcon;
  }
  if (workEntry.itemType === "web_search") return GlobeIcon;
  if (workEntry.itemType === "image_view") return EyeIcon;

  switch (workEntry.itemType) {
    case "mcp_tool_call":
      return WrenchIcon;
    case "dynamic_tool_call":
      return HammerIcon;
  }

  return workToneIcon(workEntry.tone).icon;
}

const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
}) {
  const { workEntry } = props;
  const iconConfig = workToneIcon(workEntry.tone);
  const EntryIcon = workEntryIcon(workEntry);
  const heading = toolWorkEntryHeading(workEntry);
  const preview = workEntryPreview(workEntry);
  const isReasoning = isReasoningUpdateWorkEntry(workEntry);

  // For reasoning: show detail as the main text, skip the heading
  const displayHeading = isReasoning && preview ? preview : heading;
  const displayPreview = isReasoning ? null : preview;
  const displayText = displayPreview ? `${displayHeading} - ${displayPreview}` : displayHeading;

  const hasChangedFiles = (workEntry.changedFiles?.length ?? 0) > 0;
  const previewIsChangedFiles = hasChangedFiles && !workEntry.command && !workEntry.detail;

  return (
    <div className="rounded-lg px-1 py-1">
      <div className="flex items-center gap-2 transition-[opacity,translate] duration-200">
        <span
          className={cn("flex size-5 shrink-0 items-center justify-center", iconConfig.className)}
        >
          <EntryIcon className="size-3" />
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <p
            className={cn(
              "truncate text-[11px] leading-5",
              workToneClass(workEntry.tone),
              displayPreview ? "text-muted-foreground/70" : "",
            )}
            title={displayText}
          >
            <span className={cn("text-foreground/80", workToneClass(workEntry.tone))}>
              {displayHeading}
            </span>
            {displayPreview && (
              <span className="text-muted-foreground/55"> - {displayPreview}</span>
            )}
          </p>
        </div>
      </div>
      {hasChangedFiles && !previewIsChangedFiles && (
        <div className="mt-1 flex flex-wrap gap-1 pl-6">
          {workEntry.changedFiles?.slice(0, 4).map((filePath) => (
            <span
              key={`${workEntry.id}:${filePath}`}
              className="rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/75"
              title={filePath}
            >
              {filePath}
            </span>
          ))}
          {(workEntry.changedFiles?.length ?? 0) > 4 && (
            <span className="px-1 text-[10px] text-muted-foreground/55">
              +{(workEntry.changedFiles?.length ?? 0) - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

const HoverCopyButton = memo(function HoverCopyButton({ text }: { text: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        copyToClipboard(text);
      }}
      className="absolute right-2 top-2 z-10 rounded-md border border-border/50 bg-card/90 p-1 opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-150 group-hover/section:opacity-100"
      title="Copy"
    >
      {isCopied ? (
        <CheckIcon className="size-3.5 text-success" />
      ) : (
        <CopyIcon className="size-3.5 text-muted-foreground/70" />
      )}
    </button>
  );
});

const WorkEntryPanel = memo(function WorkEntryPanel(props: {
  workEntry: TimelineWorkEntry;
  className?: string;
}) {
  const { workEntry, className } = props;
  const panelLabel = workEntryPanelLabel(workEntry);
  const commandText = workEntry.command ? simplifyShellCommand(workEntry.command) : null;
  const outputBody = workEntryOutputBody(workEntry);
  const statusLabel = workEntryStatusLabel(workEntry);
  const statusToneClass =
    workEntry.tone === "error" ? "text-rose-300/75 dark:text-rose-300/80" : "text-foreground/52";

  return (
    <div
      data-work-entry-panel={workEntry.id}
      className={cn(
        "overflow-hidden rounded-2xl border border-border/40 bg-muted/50 font-mono",
        className,
      )}
    >
      <div className="px-4 pb-1 pt-3">
        <p
          className="font-medium text-muted-foreground/70"
          style={{ fontSize: "calc(var(--app-code-font-size) - 2px)" }}
        >
          {panelLabel}
        </p>
      </div>
      {commandText && (
        <div className="group/section relative px-4 py-2.5">
          <HoverCopyButton text={commandText} />
          <pre
            className="overflow-hidden whitespace-pre-wrap break-words font-mono font-semibold text-foreground/90"
            style={{
              fontSize: "calc(var(--app-code-font-size) - 1px)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            <span className="font-normal text-muted-foreground/50">$ </span>
            {commandText}
          </pre>
        </div>
      )}
      {outputBody && (
        <div className="group/section relative">
          <HoverCopyButton text={outputBody} />
          <div
            className="max-h-48 overflow-auto px-4 py-3"
            style={{
              maskImage:
                "linear-gradient(to bottom, transparent, black 1.25rem, black calc(100% - 1.25rem), transparent)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent, black 1.25rem, black calc(100% - 1.25rem), transparent)",
            }}
          >
            <pre
              className="whitespace-pre font-mono text-foreground/68"
              style={{ fontSize: "calc(var(--app-code-font-size) - 2px)" }}
            >
              {outputBody}
            </pre>
          </div>
        </div>
      )}
      <div
        className={cn("flex items-center justify-end gap-1.5 px-4 pb-2.5 pt-0.5", statusToneClass)}
        style={{ fontSize: "calc(var(--app-code-font-size) - 2px)" }}
      >
        {workEntry.tone !== "error" && <CheckIcon className="size-3" />}
        <span>{statusLabel}</span>
      </div>
    </div>
  );
});

const WorkEntryRow = memo(function WorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  isExpanded: boolean;
  onExpandedChange: (open: boolean) => void;
}) {
  const { workEntry, isExpanded, onExpandedChange } = props;
  if (!workEntryHasExpandableContent(workEntry)) {
    return <SimpleWorkEntryRow workEntry={workEntry} />;
  }

  // Reasoning updates render as compact simple rows (no expandable panel)
  if (isReasoningUpdateWorkEntry(workEntry)) {
    return <SimpleWorkEntryRow workEntry={workEntry} />;
  }

  // Top-level agent entries render via InlineAgentGroupRow or AgentWidget.
  if (workEntry.itemType === "collab_agent_tool_call") {
    return <SimpleWorkEntryRow workEntry={workEntry} />;
  }

  const summary = workEntrySummary(workEntry);

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={onExpandedChange}
      className="rounded-lg px-1 py-0.5"
      data-work-entry-id={workEntry.id}
    >
      <CollapsibleTrigger
        data-work-entry-toggle={workEntry.id}
        className="group flex w-full items-center gap-1.5 rounded-md py-1 text-left transition-colors duration-150 hover:text-foreground/82"
        style={{ fontSize: "var(--app-ui-font-size)" }}
        title={summary}
      >
        <span className="min-w-0 flex-1 truncate text-foreground/68">{summary}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-muted-foreground/42 transition-transform duration-200",
            isExpanded ? "rotate-180" : "rotate-0",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <WorkEntryPanel workEntry={workEntry} className="mt-1" />
      </CollapsibleContent>
    </Collapsible>
  );
});

function inlineAgentToolHeading(workEntry: TimelineWorkEntry): string {
  if (isReasoningUpdateWorkEntry(workEntry)) {
    const lastToolName = workEntry.lastToolName?.trim();
    if (lastToolName) {
      return toolWorkEntryHeading({ toolTitle: lastToolName, label: lastToolName });
    }
  }
  return toolWorkEntryHeading(workEntry);
}

function inlineAgentToolSummary(workEntry: TimelineWorkEntry): string | null {
  const detail = workEntry.detail?.trim() || null;
  if (isReasoningUpdateWorkEntry(workEntry)) {
    return detail ?? "Thinking...";
  }

  const summary = workEntrySummary(workEntry);
  if (summary.trim().length === 0) {
    return detail;
  }

  return summary === inlineAgentToolHeading(workEntry) ? detail : summary;
}

const InlineAgentToolRow = memo(function InlineAgentToolRow(props: {
  workEntry: TimelineWorkEntry;
  isExpanded: boolean;
  onExpandedChange: (open: boolean) => void;
}) {
  const { workEntry, isExpanded, onExpandedChange } = props;
  const hasExpandableContent = workEntryHasExpandableContent(workEntry);
  const heading = inlineAgentToolHeading(workEntry);
  const summary = inlineAgentToolSummary(workEntry);
  const ToolIcon = isReasoningUpdateWorkEntry(workEntry)
    ? reasoningToolIcon(workEntry.lastToolName)
    : workEntryIcon(workEntry);
  const titleText = [heading, summary].filter(Boolean).join(" ");

  if (!hasExpandableContent) {
    return (
      <div
        className="rounded-xl border border-border/35 bg-background/10"
        data-inline-agent-tool-row={workEntry.id}
      >
        <div className="flex items-center gap-2 px-3 py-2.5">
          <ChevronDownIcon className="-rotate-90 size-3 shrink-0 text-muted-foreground/28" />
          <div
            className="min-w-0 flex-1 truncate font-mono text-[12px] leading-6"
            title={titleText || heading}
          >
            <span className="font-semibold text-foreground/88">{heading}</span>
            {summary && <span className="ml-2 text-muted-foreground/60">{summary}</span>}
          </div>
          <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/38">
            <ToolIcon className="size-3" />
          </span>
        </div>
      </div>
    );
  }

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={onExpandedChange}
      className="overflow-hidden rounded-xl border border-border/35 bg-background/10"
      data-inline-agent-tool-row={workEntry.id}
    >
      <CollapsibleTrigger
        data-inline-agent-tool-toggle={workEntry.id}
        className="group flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted/20"
        title={titleText || heading}
      >
        <ChevronDownIcon
          className={cn(
            "size-3 shrink-0 text-muted-foreground/28 transition-transform duration-200",
            isExpanded ? "rotate-0" : "-rotate-90",
          )}
        />
        <div className="min-w-0 flex-1 truncate font-mono text-[12px] leading-6">
          <span className="font-semibold text-foreground/88">{heading}</span>
          {summary && <span className="ml-2 text-muted-foreground/60">{summary}</span>}
        </div>
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/38">
          <ToolIcon className="size-3" />
        </span>
        <ChevronDownIcon
          className={cn(
            "size-3 shrink-0 text-muted-foreground/25 transition-transform duration-200",
            isExpanded ? "rotate-180" : "-rotate-90",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent data-inline-agent-tool-panel={workEntry.id}>
        <div className="border-t border-border/30 bg-muted/18 px-3 pb-3 pt-2">
          <WorkEntryPanel workEntry={workEntry} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

const INLINE_AGENT_VISIBLE_TOOL_LIMIT = 5;

const InlineAgentGroupRow = memo(function InlineAgentGroupRow(props: {
  agentEntry: TimelineWorkEntry;
  toolEntries: TimelineWorkEntry[];
  isExpanded: boolean;
  areAllToolsVisible: boolean;
  isConversationRunning: boolean;
  onExpandedChange: (open: boolean) => void;
  onToolListExpandedChange: (open: boolean) => void;
  expandedWorkEntries: Record<string, boolean>;
  onSetWorkEntryExpanded: (workEntryId: string, open: boolean) => void;
}) {
  const {
    agentEntry,
    toolEntries,
    isExpanded,
    areAllToolsVisible,
    isConversationRunning,
    onExpandedChange,
    onToolListExpandedChange,
    expandedWorkEntries,
    onSetWorkEntryExpanded,
  } = props;

  const promptText = agentEntry.subagentPrompt ?? agentEntry.detail ?? "No instructions captured";
  const previewText = agentEntry.detail ?? agentEntry.subagentPrompt ?? "Background teammate";
  const toolCount = toolEntries.length;
  const visibleTools = areAllToolsVisible
    ? toolEntries
    : toolEntries.slice(0, INLINE_AGENT_VISIBLE_TOOL_LIMIT);
  const hiddenToolCount = Math.max(0, toolCount - visibleTools.length);
  const heading = agentEntry.toolTitle ?? "Agent";
  const status =
    agentEntry.tone === "error" || agentEntry.itemStatus === "failed"
      ? {
          icon: CircleAlertIcon,
          label: "Failed",
          className: "border-rose-500/25 bg-rose-500/10 text-rose-200/80",
        }
      : agentEntry.itemStatus === "inProgress" && isConversationRunning
        ? {
            icon: Loader2Icon,
            label: "Running",
            className: "border-primary/25 bg-primary/10 text-primary/80",
          }
        : {
            icon: CheckIcon,
            label: "Success",
            className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200/80",
          };
  const StatusIcon = status.icon;

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={onExpandedChange}
      className="rounded-lg border border-border/50 bg-card/70 px-2 py-1 shadow-[0_10px_30px_-26px_rgba(0,0,0,0.8)] backdrop-blur-sm"
      data-inline-agent-card={agentEntry.id}
    >
      <CollapsibleTrigger className="group flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-muted/25">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/55 bg-muted/35 text-foreground/80">
          <BotIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground/88">{heading}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground/55">
              {toolCount === 1 ? "1 tool" : `${toolCount} tools`}
            </span>
          </div>
          <p className="line-clamp-2 text-[12px] leading-5 text-muted-foreground/72">
            {previewText}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.14em]",
              status.className,
            )}
          >
            <StatusIcon className={cn("size-3", status.label === "Running" && "animate-spin")} />
            {status.label}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/42 transition-transform duration-200",
              isExpanded ? "rotate-180" : "rotate-0",
            )}
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 border-t border-border/40 px-2 pb-2 pt-3">
          <div className="overflow-hidden rounded-2xl border border-border/40 bg-muted/30">
            <div className="border-b border-border/35 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/55">
              Instructions
            </div>
            <div className="max-h-40 overflow-auto px-3 py-3">
              <pre className="whitespace-pre-wrap font-mono text-[12px] leading-6 text-muted-foreground/78">
                {promptText}
              </pre>
            </div>
          </div>

          <div className="space-y-1">
            {visibleTools.length > 0 ? (
              visibleTools.map((toolEntry) => (
                <InlineAgentToolRow
                  key={`inline-agent-tool:${toolEntry.id}`}
                  workEntry={toolEntry}
                  isExpanded={expandedWorkEntries[toolEntry.id] ?? false}
                  onExpandedChange={(open) => onSetWorkEntryExpanded(toolEntry.id, open)}
                />
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-border/45 px-3 py-2 text-[12px] text-muted-foreground/60">
                Tool calls will appear here as the sub-agent works.
              </div>
            )}
          </div>

          {toolCount > INLINE_AGENT_VISIBLE_TOOL_LIMIT && (
            <div className="flex justify-start px-1">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  onToolListExpandedChange(!areAllToolsVisible);
                }}
              >
                {areAllToolsVisible ? "Show less" : `Show ${hiddenToolCount} more`}
              </Button>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

/** Derive a tool icon for a reasoning step based on lastToolName */
function reasoningToolIcon(lastToolName: string | undefined): LucideIcon {
  if (!lastToolName) return BrainIcon;
  const normalized = lastToolName.toLowerCase();
  if (
    normalized.includes("bash") ||
    normalized.includes("command") ||
    normalized.includes("shell") ||
    normalized.includes("terminal")
  )
    return TerminalIcon;
  if (normalized.includes("glob") || normalized.includes("find")) return GlobeIcon;
  if (normalized.includes("read") || normalized.includes("view") || normalized.includes("grep"))
    return EyeIcon;
  if (normalized.includes("edit") || normalized.includes("write") || normalized.includes("patch"))
    return SquarePenIcon;
  if (normalized.includes("mcp")) return WrenchIcon;
  if (normalized.includes("web") || normalized.includes("search")) return GlobeIcon;
  if (normalized.includes("agent") || normalized.includes("task")) return BotIcon;
  return ZapIcon;
}

const ReasoningGroupRow = memo(function ReasoningGroupRow(props: {
  entries: TimelineWorkEntry[];
  isExpanded: boolean;
  onExpandedChange: (open: boolean) => void;
}) {
  const { entries, isExpanded, onExpandedChange } = props;
  const lastEntry = entries[entries.length - 1]!;
  const lastDetail = lastEntry.detail?.trim() || "Thinking...";
  const stepCount = entries.length;

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={onExpandedChange}
      className="rounded-lg px-1 py-0.5"
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md py-1 text-left transition-colors duration-150 hover:text-foreground/72">
        <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground/50">
          <BrainIcon className="size-3" />
        </span>
        <span
          className="min-w-0 flex-1 truncate text-muted-foreground/55"
          style={{ fontSize: "var(--app-ui-font-size)" }}
        >
          {lastDetail}
        </span>
        <span className="shrink-0 rounded-full bg-muted/80 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground/45">
          {stepCount}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-muted-foreground/42 transition-transform duration-200",
            isExpanded ? "rotate-180" : "rotate-0",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 space-y-px rounded-xl border border-border/30 bg-muted/20 py-1">
          {entries.map((entry) => {
            const detail = entry.detail?.trim() || "Thinking...";
            const ToolIcon = reasoningToolIcon(entry.lastToolName);
            return (
              <div key={`reasoning-item:${entry.id}`} className="flex items-center gap-2 px-3 py-1">
                <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/35">
                  <ToolIcon className="size-2.5" />
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-muted-foreground/50"
                  style={{ fontSize: "calc(var(--app-ui-font-size) - 1px)" }}
                  title={detail}
                >
                  {detail}
                </span>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
