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
  return <Icon aria-hidden="true" className="size-3.5 shrink-0" />;
};

const statusLabel = (status: CodingAgentToolCallDto["status"]) => {
  if (status === "completed") return "Completed";
  if (status === "error") return "Failed";
  return status === "pending" ? "Pending" : "Running";
};

const StatusIcon = ({
  status,
}: {
  status: CodingAgentToolCallDto["status"];
}) => {
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
  const isCapability = tool.tool === "mcp";

  return (
    <li className="min-w-0 px-2 pb-2 last:pb-2">
      <button
        type="button"
        aria-expanded={expanded}
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        className={cn(
          "group flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left transition-colors",
          hasDetail &&
            "cursor-pointer hover:border-border/80 hover:bg-background/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          !hasDetail && "cursor-default",
        )}
      >
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg border",
            tool.status === "error"
              ? "border-destructive/20 bg-destructive/10 text-destructive"
              : tool.status === "completed"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                : "border-primary/20 bg-primary/10 text-primary",
          )}
        >
          <ToolIcon tool={tool.tool} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-xs font-medium text-foreground/90">
              {tool.title}
            </span>
            {hasDetail ? (
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  "size-3 shrink-0 text-muted-foreground/60 transition-transform duration-200",
                  expanded && "rotate-90",
                )}
              />
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/65">
            <span>{isCapability ? "Capability" : tool.tool}</span>
            <span aria-hidden="true" className="text-border">
              ·
            </span>
            <span>{statusLabel(tool.status)}</span>
          </span>
        </span>
        <StatusIcon status={tool.status} />
      </button>
      {expanded && hasDetail ? (
        <pre className="mx-2.5 mb-1 max-h-48 overflow-auto rounded-lg border border-border/50 bg-background/70 p-3 font-mono text-[11px] leading-4 whitespace-pre-wrap text-muted-foreground">
          {tool.detail}
        </pre>
      ) : null}
    </li>
  );
};

export const ToolCallGroup = ({ tools }: Props) => (
  <section
    aria-label="Tool calls"
    className="max-w-[48rem] overflow-hidden rounded-2xl border border-border/70 bg-muted/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
  >
    <header className="flex items-center justify-between border-b border-border/50 px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Plug aria-hidden="true" className="size-3" />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Tool activity
        </span>
      </div>
      <span className="font-mono text-[10px] text-muted-foreground/60">
        {tools.length} {tools.length === 1 ? "call" : "calls"}
      </span>
    </header>
    <ul className="pt-2">
      {tools.map((tool) => (
        <ToolRow key={tool.id} tool={tool} />
      ))}
    </ul>
  </section>
);
