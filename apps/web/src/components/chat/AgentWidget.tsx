import { memo, useState } from "react";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  Loader2Icon,
  UsersIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import type { CodexAgentEntry } from "../../session-logic";

interface AgentWidgetProps {
  agents: CodexAgentEntry[];
  className?: string;
  /** Whether the prompt execution is still in progress */
  isStreaming?: boolean;
  /** Callback to dismiss the widget */
  onClose?: () => void;
}

/**
 * Collapsible widget displaying Codex multi-agent status.
 * Shown above the composer when Codex spawns sub-agents (SpawnAgent).
 */
export const AgentWidget = memo(function AgentWidget({
  agents,
  className,
  isStreaming = false,
  onClose,
}: AgentWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);

  const completedCount = agents.filter((a) => a.status === "completed").length;
  const totalCount = agents.length;
  const allCompleted = completedCount === totalCount && totalCount > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <div className="rounded-md border border-border bg-sidebar">
        <div className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
          <CollapsibleTrigger className="flex flex-1 cursor-pointer select-none items-center gap-2 rounded-l-md py-2 pl-3 -ml-3 -my-2 hover:bg-muted/50">
            <ChevronRightIcon
              className={cn(
                "size-3.5 shrink-0 transition-transform duration-200",
                isOpen && "rotate-90",
              )}
            />
            {!isOpen &&
            !allCompleted &&
            (isStreaming || agents.some((a) => a.status === "in_progress")) ? (
              <Loader2Icon className="size-4 shrink-0 animate-spin text-primary" />
            ) : (
              <UsersIcon className="size-4 shrink-0" />
            )}
            <span className="font-medium">Agents</span>
            <span
              className={cn(
                "rounded bg-muted/50 px-1.5 py-0.5 text-xs",
                allCompleted && "bg-green-500/20 text-green-600 dark:text-green-400",
              )}
            >
              {completedCount}/{totalCount}
            </span>
          </CollapsibleTrigger>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-0.5 transition-colors hover:bg-muted"
              aria-label="Dismiss agents"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
        <CollapsibleContent>
          <div className="border-t border-border/50 px-3 py-2">
            <ul className="space-y-1">
              {agents.map((agent) => (
                <AgentItem key={agent.id} agent={agent} />
              ))}
            </ul>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
});

const AgentItem = memo(function AgentItem({ agent }: { agent: CodexAgentEntry }) {
  return (
    <li className="flex items-start gap-2 py-0.5 text-xs">
      <span className="mt-0.5 shrink-0">
        {agent.status === "completed" ? (
          <CheckCircle2Icon className="size-4 text-green-500" />
        ) : agent.status === "errored" ? (
          <XCircleIcon className="size-4 text-amber-500" />
        ) : (
          <Loader2Icon className="size-4 animate-spin text-primary" />
        )}
      </span>
      <span
        className={cn(
          "text-muted-foreground",
          agent.status === "completed" && "text-muted-foreground/60 line-through",
          agent.status === "errored" && "text-muted-foreground/60",
        )}
      >
        {agent.prompt}
      </span>
    </li>
  );
});
