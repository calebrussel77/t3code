import { type MessageId, ThreadId, type TurnId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
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
import { VscodeEntryIcon } from "./VscodeEntryIcon";
import { basenameOfPath } from "../../vscode-icons";
import { MessageCopyButton } from "./MessageCopyButton";
import {
    deriveMessagesTimelineRows,
    estimateMessagesTimelineRowHeight,
    type MessagesTimelineRow,
} from "./MessagesTimeline.logic";
import { SkillInlineChip } from "./SkillInlineChip";
import { TerminalContextInlineChip } from "./TerminalContextInlineChip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { groupWorkEntriesForTimeline, isReasoningUpdateWorkEntry } from "./workEntryGrouping";
import {
    deriveDisplayedUserMessageState,
    type ParsedTerminalContextEntry,
} from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useTheme } from "~/hooks/useTheme";
import { checkpointDiffQueryOptions } from "~/lib/providerReactQuery";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import {
    buildInlineTerminalContextText,
    formatInlineTerminalContextLabel,
    textContainsInlineTerminalContextLabels,
} from "./userMessageTerminalContexts";
import {
    mcpServerLabel,
    simplifyShellCommand,
    toolWorkEntryHeading,
    workEntryHasExpandableContent,
    workEntryPanelLabel,
    workEntryOutputBody,
    workEntryPreview,
    workEntryStatusLabel,
    workEntrySummary,
} from "../../workLogEntry";
import { APP_STAGE_LABEL } from "~/branding";
import { T3Wordmark } from "../Icons";

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

  /** Flat lookup of relative file path → accurate diff stats + checkpoint info. */
  const checkpointFileStatMap = useMemo(() => {
    const map = new Map<
      string,
      { additions: number; deletions: number; checkpointTurnCount: number | undefined }
    >();
    for (const summary of turnDiffSummaryByAssistantMessageId.values()) {
      for (const file of summary.files) {
        const normalized = file.path.replace(/\\/g, "/");
        map.set(normalized, {
          additions: file.additions ?? 0,
          deletions: file.deletions ?? 0,
          checkpointTurnCount: summary.checkpointTurnCount,
        });
        // Also index by basename-suffix so absolute-path lookups hit directly
        const lastSlash = normalized.lastIndexOf("/");
        if (lastSlash >= 0) {
          const suffix = normalized.slice(lastSlash);
          if (!map.has(suffix)) {
            map.set(suffix, {
              additions: file.additions ?? 0,
              deletions: file.deletions ?? 0,
              checkpointTurnCount: summary.checkpointTurnCount,
            });
          }
        }
      }
    }
    return map;
  }, [turnDiffSummaryByAssistantMessageId]);

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
            <div className="space-y-1">
              {renderItems.map((item) => {
                if (item.kind === "reasoning-group") {
                  return (
                    <ReasoningGroupRow
                      key={item.collapseKey}
                      collapseKey={item.collapseKey}
                      entries={item.entries}
                      isExpanded={expandedWorkEntries[item.collapseKey] ?? false}
                      areAllToolsVisible={expandedAgentToolLists[item.collapseKey] ?? false}
                      onExpandedChange={(open) => onSetWorkEntryExpanded(item.collapseKey, open)}
                      onToolListExpandedChange={(open) =>
                        onSetAgentToolListExpanded(item.collapseKey, open)
                      }
                      expandedWorkEntries={expandedWorkEntries}
                      onSetWorkEntryExpanded={onSetWorkEntryExpanded}
                      markdownCwd={markdownCwd}
                      checkpointFileStatMap={checkpointFileStatMap}
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
                      checkpointFileStatMap={checkpointFileStatMap}
                    />
                  );
                }
                return (
                  <WorkEntryRow
                    key={`work-row:${item.entry.id}`}
                    workEntry={item.entry}
                    isExpanded={expandedWorkEntries[item.entry.id] ?? false}
                    onExpandedChange={(open) => onSetWorkEntryExpanded(item.entry.id, open)}
                    checkpointFileStatMap={checkpointFileStatMap}
                    markdownCwd={markdownCwd}
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
                <div className="relative rounded-xl border border-border bg-secondary px-3 py-2">
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
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs uppercase text-muted-foreground/65">
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
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="flex items-center gap-2">
          <T3Wordmark className="h-10 w-auto shrink-0 text-foreground/20" />
          <span className="text-3xl font-medium tracking-tight text-foreground/20">Code</span>
          <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
            {APP_STAGE_LABEL}
          </span>
        </div>
        <p className="text-lg text-muted-foreground/30">Let's build</p>
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

const SKILL_TOKEN_RE = /(^|\s)\$([a-zA-Z0-9_:.-][a-zA-Z0-9_:./-]*)/g;

function renderTextWithSkillChips(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(SKILL_TOKEN_RE)) {
    const fullMatch = match[0];
    const leadingSpace = match[1]!;
    const skillName = match[2]!;
    const matchStart = match.index!;

    // Text before this match (including the leading whitespace that's part of the regex)
    const beforeEnd = matchStart + leadingSpace.length;
    if (beforeEnd > lastIndex) {
      nodes.push(
        <span key={`${keyPrefix}-text-${lastIndex}`}>{text.slice(lastIndex, beforeEnd)}</span>,
      );
    }

    nodes.push(<SkillInlineChip key={`${keyPrefix}-skill-${matchStart}`} name={skillName} />);
    lastIndex = matchStart + fullMatch.length;
  }

  if (lastIndex === 0) {
    // No skill tokens found — return text as-is
    return [text];
  }

  if (lastIndex < text.length) {
    nodes.push(<span key={`${keyPrefix}-text-${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }

  return nodes;
}

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
            ...renderTextWithSkillChips(
              props.text.slice(cursor, matchIndex),
              `user-tc-before:${context.header}:${cursor}`,
            ),
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
            ...renderTextWithSkillChips(props.text.slice(cursor), `user-tc-rest:${cursor}`),
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
      inlineNodes.push(...renderTextWithSkillChips(props.text, "user-tc-text"));
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

  const rendered = renderTextWithSkillChips(props.text, "user-msg");
  return (
    <pre className="whitespace-pre-wrap wrap-break-word font-mono text-sm leading-relaxed text-foreground">
      {rendered}
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
  const isMcp = workEntry.itemType === "mcp_tool_call";
  const mcpServer = isMcp ? mcpServerLabel(workEntry) : null;

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
            {mcpServer && <span className="ml-1.5 text-muted-foreground/40">{mcpServer}</span>}
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

function isFileChangeEntry(
  workEntry: Pick<TimelineWorkEntry, "itemType" | "requestKind">,
): boolean {
  return workEntry.itemType === "file_change" || workEntry.requestKind === "file-change";
}

interface ParsedFileChangeInput {
  filePath: string;
  kind: "write" | "edit" | "other";
  content?: string;
  oldString?: string;
  newString?: string;
}

function parseFileChangeInput(toolInput: string | null): ParsedFileChangeInput | null {
  if (!toolInput) return null;
  try {
    const parsed = JSON.parse(toolInput) as Record<string, unknown>;
    if (typeof parsed !== "object" || !parsed) return null;
    const filePath = (parsed.file_path ?? parsed.filePath) as string | undefined;
    if (typeof filePath !== "string") return null;

    if (typeof parsed.old_string === "string" && typeof parsed.new_string === "string") {
      return {
        filePath,
        kind: "edit",
        oldString: parsed.old_string,
        newString: parsed.new_string,
      };
    }
    if (typeof parsed.content === "string") {
      return { filePath, kind: "write", content: parsed.content };
    }
    return { filePath, kind: "other" };
  } catch {
    return null;
  }
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  return count;
}

function computeFileChangeStat(parsed: ParsedFileChangeInput): {
  additions: number;
  deletions: number;
} {
  if (parsed.kind === "edit") {
    return {
      additions: countLines(parsed.newString ?? ""),
      deletions: countLines(parsed.oldString ?? ""),
    };
  }
  if (parsed.kind === "write") {
    return { additions: countLines(parsed.content ?? ""), deletions: 0 };
  }
  return { additions: 0, deletions: 0 };
}

/** Look up the checkpoint file entry by matching the tool input path against relative git paths. */
function lookupCheckpointFileStat(
  filePath: string,
  checkpointFileStatMap: FileStatMap,
): FileStatEntry | null {
  const normalized = filePath.replace(/\\/g, "/");

  const direct = checkpointFileStatMap.get(normalized);
  if (direct) return direct;

  // Tool inputs use absolute paths; try suffix key populated at build time
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash >= 0) {
    const suffix = normalized.slice(lastSlash);
    const bySuffix = checkpointFileStatMap.get(suffix);
    if (bySuffix) return bySuffix;
  }

  return null;
}

function resolveFileChangeStat(
  parsed: ParsedFileChangeInput,
  checkpointFileStatMap: FileStatMap,
): { additions: number; deletions: number } {
  return lookupCheckpointFileStat(parsed.filePath, checkpointFileStatMap) ??
    computeFileChangeStat(parsed);
}

/** Extract a single file's unified diff hunk lines from a full patch string. */
function extractFileDiffLines(fullPatch: string, filePath: string): string[] | null {
  const normalized = filePath.replace(/\\/g, "/");
  const basename = basenameOfPath(normalized);

  const sections = fullPatch.split(/^(?=diff --git )/m);
  for (const section of sections) {
    if (section.length === 0) continue;
    const firstLine = section.slice(0, section.indexOf("\n"));
    // Prefer full-path match (handles same-basename files in different dirs)
    const matchesFull =
      firstLine.includes(`a/${normalized}`) || firstLine.includes(`b/${normalized}`);
    const matchesBasename =
      firstLine.includes(`/${basename}`) || firstLine.includes(` ${basename}`);
    if (matchesFull || matchesBasename) {
      // Only keep hunk headers and content lines (skip diff/---/+++ headers)
      return section
        .split("\n")
        .filter(
          (line) =>
            !line.startsWith("diff ") &&
            !line.startsWith("index ") &&
            !line.startsWith("--- ") &&
            !line.startsWith("+++ ") &&
            !line.startsWith("new file") &&
            !line.startsWith("old mode") &&
            !line.startsWith("new mode") &&
            !line.startsWith("deleted file") &&
            !line.startsWith("similarity") &&
            !line.startsWith("rename "),
        );
    }
  }
  return null;
}

const FileChangeRow = memo(function FileChangeRow(props: {
  workEntry: TimelineWorkEntry;
  parsed: ParsedFileChangeInput;
  isExpanded: boolean;
  onExpandedChange: (open: boolean) => void;
  checkpointFileStatMap: FileStatMap;
}) {
  const { workEntry, parsed, isExpanded, onExpandedChange, checkpointFileStatMap } = props;
  const { resolvedTheme } = useTheme();
  const actionLabel = parsed.kind === "write" ? "Write" : "Edited";
  const fileName = basenameOfPath(parsed.filePath);
  const fontSize = "calc(var(--app-code-font-size) - 2px)";
  const isError = workEntry.tone === "error";
  const stat = useMemo(
    () => resolveFileChangeStat(parsed, checkpointFileStatMap),
    [parsed, checkpointFileStatMap],
  );

  const checkpointEntry = useMemo(
    () => lookupCheckpointFileStat(parsed.filePath, checkpointFileStatMap),
    [parsed.filePath, checkpointFileStatMap],
  );
  const routeThreadId = useParams({
    strict: false,
    select: (params) =>
      params.threadId ? ThreadId.makeUnsafe(params.threadId as string) : null,
  });
  const turnCount = checkpointEntry?.checkpointTurnCount;
  const diffQuery = useQuery(
    checkpointDiffQueryOptions({
      threadId: routeThreadId,
      fromTurnCount: typeof turnCount === "number" ? Math.max(0, turnCount - 1) : null,
      toTurnCount: turnCount ?? null,
      cacheScope: `file-change-row:turn-${turnCount}`,
      enabled: isExpanded && typeof turnCount === "number",
    }),
  );
  const diffLines = useMemo(() => {
    const patch = diffQuery.data?.diff;
    if (typeof patch !== "string" || patch.length === 0) return null;
    return extractFileDiffLines(patch, parsed.filePath);
  }, [diffQuery.data, parsed.filePath]);

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={onExpandedChange}
      className="rounded-lg px-1 py-0.5"
      data-work-entry-id={workEntry.id}
    >
      <CollapsibleTrigger
        data-work-entry-toggle={workEntry.id}
        className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-1 text-left transition-colors duration-150 hover:text-foreground"
      >
        <span
          className={cn(
            "shrink-0 text-sm",
            isError ? "text-rose-400/80" : "text-muted-foreground/55",
          )}
        >
          {actionLabel}
        </span>
        <VscodeEntryIcon
          pathValue={parsed.filePath}
          kind="file"
          theme={resolvedTheme as "light" | "dark"}
          className="size-3.5"
        />
        <span
          className="min-w-0 flex-1 truncate font-mono text-white transition-colors duration-150 group-hover:text-foreground/90"
          style={{ fontSize }}
          title={parsed.filePath}
        >
          {fileName}
        </span>
        {hasNonZeroStat(stat) && (
          <span className="ml-auto shrink-0 font-mono text-xs tabular-nums">
            <DiffStatLabel additions={stat.additions} deletions={stat.deletions} />
          </span>
        )}
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-muted-foreground/42 transition-transform duration-200 group-hover:text-foreground",
            isExpanded ? "rotate-180" : "rotate-0",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          className="mt-1 max-h-72 overflow-auto rounded-lg border border-border/30 bg-background/30 font-mono"
          style={{ fontSize }}
        >
          {diffLines ? (
            diffLines.map((line, i) => {
              if (line.startsWith("@@")) {
                return (
                  <div
                    key={i}
                    className="whitespace-pre px-2.5 py-px text-primary/50"
                    style={{
                      backgroundColor:
                        "color-mix(in srgb, var(--background) 94%, var(--primary))",
                    }}
                  >
                    {line}
                  </div>
                );
              }
              if (line.startsWith("+")) {
                return (
                  <div
                    key={i}
                    className="whitespace-pre px-2.5 py-px"
                    style={{
                      backgroundColor:
                        "color-mix(in srgb, var(--background) 92%, var(--success))",
                      color:
                        "color-mix(in srgb, var(--foreground) 65%, var(--success))",
                    }}
                  >
                    {line}
                  </div>
                );
              }
              if (line.startsWith("-")) {
                return (
                  <div
                    key={i}
                    className="whitespace-pre px-2.5 py-px"
                    style={{
                      backgroundColor:
                        "color-mix(in srgb, var(--background) 92%, var(--destructive))",
                      color:
                        "color-mix(in srgb, var(--foreground) 65%, var(--destructive))",
                    }}
                  >
                    {line}
                  </div>
                );
              }
              return (
                <div key={i} className="whitespace-pre px-2.5 py-px text-foreground/50">
                  {line}
                </div>
              );
            })
          ) : diffQuery.isLoading ? (
            <div className="flex items-center gap-2 px-2.5 py-2 text-muted-foreground/50">
              <Loader2Icon className="size-3 animate-spin" />
              Loading diff…
            </div>
          ) : (
            <div className="px-2.5 py-2 text-muted-foreground/50">
              No diff available.
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

const WorkEntryPanel = memo(function WorkEntryPanel(props: {
  workEntry: TimelineWorkEntry;
  className?: string;
}) {
  const { workEntry, className } = props;
  const panelLabel = workEntryPanelLabel(workEntry);
  const commandText = workEntry.command ? simplifyShellCommand(workEntry.command) : null;
  const inputBody = workEntry.toolInput ?? null;
  const outputBody = workEntryOutputBody(workEntry);
  const statusLabel = workEntryStatusLabel(workEntry);
  const statusToneClass =
    workEntry.tone === "error" ? "text-rose-300/75 dark:text-rose-300/80" : "text-foreground/52";
  const isMcp = workEntry.itemType === "mcp_tool_call";

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
      {inputBody && (
        <div className="group/section relative">
          <HoverCopyButton text={inputBody} />
          {isMcp && (
            <div className="px-4 pt-2">
              <p
                className="font-medium text-muted-foreground/48"
                style={{ fontSize: "calc(var(--app-code-font-size) - 3px)" }}
              >
                Input
              </p>
            </div>
          )}
          <div
            className="max-h-36 overflow-auto px-4 py-2"
            style={{
              maskImage:
                "linear-gradient(to bottom, transparent, black 0.75rem, black calc(100% - 0.75rem), transparent)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent, black 0.75rem, black calc(100% - 0.75rem), transparent)",
            }}
          >
            <pre
              className="whitespace-pre font-mono text-foreground/58"
              style={{ fontSize: "calc(var(--app-code-font-size) - 2px)" }}
            >
              {inputBody}
            </pre>
          </div>
        </div>
      )}
      {outputBody && (
        <div className="group/section relative">
          <HoverCopyButton text={outputBody} />
          {(isMcp || inputBody) && (
            <div className="px-4 pt-1">
              <p
                className="font-medium text-muted-foreground/48"
                style={{ fontSize: "calc(var(--app-code-font-size) - 3px)" }}
              >
                Output
              </p>
            </div>
          )}
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

type FileStatEntry = {
  additions: number;
  deletions: number;
  checkpointTurnCount: number | undefined;
};
type FileStatMap = ReadonlyMap<string, FileStatEntry>;
const EMPTY_FILE_STAT_MAP: FileStatMap = new Map();

const WorkEntryRow = memo(function WorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  isExpanded: boolean;
  onExpandedChange: (open: boolean) => void;
  checkpointFileStatMap?: FileStatMap | undefined;
  markdownCwd?: string | undefined;
}) {
  const { workEntry, isExpanded, onExpandedChange, checkpointFileStatMap, markdownCwd } = props;
  if (
    !workEntryHasExpandableContent(workEntry) &&
    !(isReasoningUpdateWorkEntry(workEntry) && workEntry.detail)
  ) {
    return <SimpleWorkEntryRow workEntry={workEntry} />;
  }

  if (isReasoningUpdateWorkEntry(workEntry)) {
    return (
      <SingleReasoningRow
        workEntry={workEntry}
        isExpanded={isExpanded}
        onExpandedChange={onExpandedChange}
        markdownCwd={markdownCwd}
      />
    );
  }

  // Top-level agent entries render via InlineAgentGroupRow or AgentWidget.
  if (workEntry.itemType === "collab_agent_tool_call") {
    return <SimpleWorkEntryRow workEntry={workEntry} />;
  }

  if (isFileChangeEntry(workEntry)) {
    const parsed = parseFileChangeInput(workEntry.toolInput ?? null);
    if (parsed) {
      return (
        <FileChangeRow
          workEntry={workEntry}
          parsed={parsed}
          isExpanded={isExpanded}
          onExpandedChange={onExpandedChange}
          checkpointFileStatMap={checkpointFileStatMap ?? EMPTY_FILE_STAT_MAP}
        />
      );
    }
  }

  const summary = workEntrySummary(workEntry);
  const isMcp = workEntry.itemType === "mcp_tool_call";
  const isDynamicTool = workEntry.itemType === "dynamic_tool_call";
  const EntryIcon = workEntryIcon(workEntry);

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={onExpandedChange}
      className="rounded-lg px-1 py-0.5"
      data-work-entry-id={workEntry.id}
    >
      <CollapsibleTrigger
        data-work-entry-toggle={workEntry.id}
        className="group flex w-full items-center gap-1.5 rounded-md py-1 text-left transition-colors duration-150 hover:text-foreground"
        style={{ fontSize: "var(--app-ui-font-size)" }}
        title={summary}
      >
        {(isMcp || isDynamicTool) && (
          <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground/50 transition-colors duration-150 group-hover:text-foreground">
            <EntryIcon className="size-4" />
          </span>
        )}
        <span className="min-w-0 flex-1 text-sm truncate text-muted-foreground/70 transition-colors duration-150 group-hover:text-foreground">
          {summary}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-muted-foreground/42 transition-transform duration-200 group-hover:text-white",
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
      return toolWorkEntryHeading({
        ...workEntry,
        toolTitle: lastToolName,
        label: lastToolName,
      });
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
  checkpointFileStatMap?: FileStatMap | undefined;
}) {
  const { workEntry, isExpanded, onExpandedChange, checkpointFileStatMap } = props;
  const hasExpandableContent = workEntryHasExpandableContent(workEntry);

  if (isFileChangeEntry(workEntry)) {
    const parsed = parseFileChangeInput(workEntry.toolInput ?? null);
    if (parsed) {
      return (
        <FileChangeRow
          workEntry={workEntry}
          parsed={parsed}
          isExpanded={isExpanded}
          onExpandedChange={onExpandedChange}
          checkpointFileStatMap={checkpointFileStatMap ?? EMPTY_FILE_STAT_MAP}
        />
      );
    }
  }

  const heading = inlineAgentToolHeading(workEntry);
  const summary = inlineAgentToolSummary(workEntry);
  const ToolIcon = isReasoningUpdateWorkEntry(workEntry)
    ? reasoningToolIcon(workEntry.lastToolName)
    : workEntryIcon(workEntry);
  const displayText = summary ? `${heading} - ${summary}` : heading;

  if (!hasExpandableContent) {
    return (
      <div className="rounded-lg px-1 py-0.5" data-inline-agent-tool-row={workEntry.id}>
        <div className="flex items-center gap-2 py-0.5">
          <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground/50">
            <ToolIcon className="size-3" />
          </span>
          <p
            className="min-w-0 flex-1 truncate text-[11px] leading-5 text-muted-foreground/60"
            title={displayText}
          >
            <span className="text-foreground/70">{heading}</span>
            {summary && <span className="text-muted-foreground/45"> - {summary}</span>}
          </p>
        </div>
      </div>
    );
  }

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={onExpandedChange}
      className="rounded-lg px-1 py-0.5"
      data-inline-agent-tool-row={workEntry.id}
    >
      <CollapsibleTrigger
        data-inline-agent-tool-toggle={workEntry.id}
        className="group flex w-full items-center gap-1.5 rounded-md py-1 text-left transition-colors duration-150 hover:text-foreground"
        title={displayText}
      >
        <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground/50 transition-colors duration-150 group-hover:text-foreground">
          <ToolIcon className="size-3" />
        </span>
        <span
          className="min-w-0 flex-1 truncate text-muted-foreground/50 transition-colors duration-150 group-hover:text-foreground"
          style={{ fontSize: "var(--app-ui-font-size)" }}
        >
          {displayText}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-muted-foreground/42 transition-transform duration-200",
            isExpanded ? "rotate-180" : "rotate-0",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent data-inline-agent-tool-panel={workEntry.id}>
        <WorkEntryPanel workEntry={workEntry} className="mt-1 ml-6" />
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
  checkpointFileStatMap?: FileStatMap | undefined;
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
    checkpointFileStatMap,
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

          <div className="space-y-0">
            {visibleTools.length > 0 ? (
              visibleTools.map((toolEntry) => (
                <InlineAgentToolRow
                  key={`inline-agent-tool:${toolEntry.id}`}
                  workEntry={toolEntry}
                  isExpanded={expandedWorkEntries[toolEntry.id] ?? false}
                  onExpandedChange={(open) => onSetWorkEntryExpanded(toolEntry.id, open)}
                  checkpointFileStatMap={checkpointFileStatMap}
                />
              ))
            ) : (
              <div className="rounded-lg px-3 py-2 text-[12px] text-muted-foreground/50">
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

function formatReasoningDuration(entries: ReadonlyArray<TimelineWorkEntry>): string | null {
  if (entries.length === 0) return null;
  const firstCreatedAt = entries[0]!.createdAt;
  const lastCreatedAt = entries[entries.length - 1]!.createdAt;
  return formatWorkingTimer(firstCreatedAt, lastCreatedAt);
}

/** A single reasoning entry rendered as a collapsible "Thought for Xs" row. */
const SingleReasoningRow = memo(function SingleReasoningRow(props: {
  workEntry: TimelineWorkEntry;
  isExpanded: boolean;
  onExpandedChange: (open: boolean) => void;
  markdownCwd?: string | undefined;
}) {
  const { workEntry, isExpanded, onExpandedChange, markdownCwd } = props;
  const detail = workEntry.detail?.trim() || "";
  const Icon = BrainIcon;

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={onExpandedChange}
      className="rounded-lg px-1 py-0.5"
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md py-1 text-left transition-colors duration-150 hover:text-foreground">
        <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground/50 transition-colors duration-150 group-hover:text-foreground">
          <Icon className="size-3.5" />
        </span>
        <span
          className="min-w-0 flex-1 truncate text-muted-foreground/60 transition-colors duration-150 group-hover:text-foreground"
          style={{ fontSize: "var(--app-ui-font-size)" }}
        >
          Thought
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-muted-foreground/42 transition-transform duration-200 group-hover:text-foreground",
            isExpanded ? "rotate-180" : "rotate-0",
          )}
        />
      </CollapsibleTrigger>
      {detail && (
        <CollapsibleContent>
          <div className="mt-1 ml-6 max-h-72 overflow-auto rounded-lg border border-border/30 bg-background/30 px-3 py-2">
            <ChatMarkdown text={detail} cwd={markdownCwd} isStreaming={false} />
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
});

const REASONING_GROUP_VISIBLE_LIMIT = 5;

const ReasoningGroupRow = memo(function ReasoningGroupRow(props: {
  collapseKey: string;
  entries: TimelineWorkEntry[];
  isExpanded: boolean;
  areAllToolsVisible: boolean;
  onExpandedChange: (open: boolean) => void;
  onToolListExpandedChange: (open: boolean) => void;
  expandedWorkEntries: Record<string, boolean>;
  onSetWorkEntryExpanded: (workEntryId: string, open: boolean) => void;
  markdownCwd?: string | undefined;
  checkpointFileStatMap?: FileStatMap | undefined;
}) {
  const {
    entries,
    isExpanded,
    areAllToolsVisible,
    onExpandedChange,
    onToolListExpandedChange,
    expandedWorkEntries,
    onSetWorkEntryExpanded,
    markdownCwd,
    checkpointFileStatMap,
  } = props;
  const duration = formatReasoningDuration(entries);
  const durationLabel = duration ? `Thought for ${duration}` : "Thought";

  // Separate pure reasoning text from tool-like entries
  const { reasoningText, hasToolEntries } = useMemo(() => {
    const textParts: string[] = [];
    let tools = false;
    for (const e of entries) {
      if (e.lastToolName) {
        tools = true;
      } else {
        const text = e.detail?.trim();
        if (text) textParts.push(text);
      }
    }
    return { reasoningText: textParts.join("\n\n"), hasToolEntries: tools };
  }, [entries]);

  const visibleEntries = areAllToolsVisible
    ? entries
    : entries.slice(0, REASONING_GROUP_VISIBLE_LIMIT);
  const canToggleToolList = entries.length > REASONING_GROUP_VISIBLE_LIMIT;
  const hasContent = reasoningText.length > 0 || hasToolEntries;

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={onExpandedChange}
      className="rounded-lg px-1 py-0.5"
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md py-1 text-left transition-colors duration-150 hover:text-foreground">
        <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground/50 transition-colors duration-150 group-hover:text-foreground">
          <BrainIcon className="size-4" />
        </span>
        <span
          className="min-w-0 flex-1 truncate text-sm text-muted-foreground/70 transition-colors duration-150 group-hover:text-foreground"
          style={{ fontSize: "var(--app-ui-font-size)" }}
        >
          {durationLabel}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-muted-foreground/42 transition-transform duration-200 group-hover:text-foreground",
            isExpanded ? "rotate-180" : "rotate-0",
          )}
        />
      </CollapsibleTrigger>
      {hasContent && (
        <CollapsibleContent>
          {reasoningText.length > 0 && (
            <div className="mt-1 ml-6 max-h-72 overflow-auto rounded-lg border border-border/30 bg-background/30 px-3 py-2">
              <ChatMarkdown text={reasoningText} cwd={markdownCwd} isStreaming={false} />
            </div>
          )}
          {hasToolEntries && (
            <>
              <div className="mt-1 max-h-72 space-y-0 overflow-auto py-1">
                {visibleEntries
                  .filter((e) => e.lastToolName)
                  .map((entry) => (
                    <InlineAgentToolRow
                      key={`reasoning-tool:${entry.id}`}
                      workEntry={entry}
                      isExpanded={expandedWorkEntries[entry.id] ?? false}
                      onExpandedChange={(open) => onSetWorkEntryExpanded(entry.id, open)}
                      checkpointFileStatMap={checkpointFileStatMap}
                    />
                  ))}
              </div>
              {canToggleToolList && (
                <div className="flex justify-start px-1 pt-1">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToolListExpandedChange(!areAllToolsVisible);
                    }}
                  >
                    {areAllToolsVisible
                      ? "Show less"
                      : `Show ${entries.length - REASONING_GROUP_VISIBLE_LIMIT} more`}
                  </Button>
                </div>
              )}
            </>
          )}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
});
