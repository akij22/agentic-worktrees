import { useState } from "react";
import {
  Check,
  ChevronRight,
  FilePen,
  Globe,
  Loader2,
  Plug,
  SquareTerminal,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type { CodingAgentToolCallDto } from "../../../../shared/ipc/schemas";
import { cn } from "../../../lib/utils";

type Props = {
  tools: CodingAgentToolCallDto[];
};

const TOOL_ICONS: Record<string, typeof Wrench> = {
  bash: SquareTerminal,
  edit: FilePen,
  write: FilePen,
  patch: FilePen,
  read: FilePen,
  web_search: Globe,
  mcp: Plug,
};

const ToolIcon = ({ tool }: { tool: string }) => {
  const Icon = TOOL_ICONS[tool] ?? Wrench;
  return <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />;
};

const StatusIcon = ({ status }: { status: CodingAgentToolCallDto["status"] }) => {
  if (status === "completed") {
    return (
      <Check
        aria-label="Completed"
        className="size-3.5 shrink-0 text-emerald-500"
      />
    );
  }
  if (status === "error") {
    return (
      <TriangleAlert
        aria-label="Failed"
        className="size-3.5 shrink-0 text-destructive"
      />
    );
  }
  return (
    <Loader2
      aria-label={status === "pending" ? "Pending" : "Running"}
      className="size-3.5 shrink-0 animate-spin text-primary"
    />
  );
};

const ToolRow = ({ tool }: { tool: CodingAgentToolCallDto }) => {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = tool.detail.trim().length > 0;

  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-expanded={expanded}
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        className={cn(
          "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
          hasDetail && "hover:bg-muted/40",
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-muted-foreground/60 transition-transform duration-200",
            expanded && "rotate-90",
            !hasDetail && "invisible",
          )}
        />
        <StatusIcon status={tool.status} />
        <ToolIcon tool={tool.tool} />
        <span className="shrink-0 font-mono text-[11px] uppercase tracking-wide text-muted-foreground/80">
          {tool.tool}
        </span>
        <span className="min-w-0 truncate font-mono text-xs text-foreground/90">
          {tool.title}
        </span>
      </button>
      {expanded && hasDetail ? (
        <pre className="mx-2 mb-1.5 ml-[3.25rem] max-h-48 overflow-auto rounded-md bg-muted/45 p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-muted-foreground">
          {tool.detail}
        </pre>
      ) : null}
    </li>
  );
};

export const ToolCallGroup = ({ tools }: Props) => (
  <div
    aria-label="Tool calls"
    className="max-w-[48rem] overflow-hidden rounded-xl border border-border/70 bg-muted/20"
  >
    <ul className="divide-y divide-border/50">
      {tools.map((tool) => (
        <ToolRow key={tool.id} tool={tool} />
      ))}
    </ul>
  </div>
);
