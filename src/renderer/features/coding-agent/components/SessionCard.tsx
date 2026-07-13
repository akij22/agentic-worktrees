import type {
  CodingAgentSessionDto,
  CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";
import {
  compactActivity,
  formatDate,
  formatElapsedTime,
} from "../lib/formatters";
import type { SessionGridDetail } from "../types";
import { GridIcon } from "./GridIcon";

type Props = {
  session: CodingAgentSessionDto;
  context: CodingAgentWorktreeContextDto | undefined;
  detail: SessionGridDetail | undefined;
  onOpen: () => void;
};

export const SessionCard = ({ session, context, detail, onOpen }: Props) => {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-h-72 flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border bg-muted/30 px-4 py-3.5">
        <div className="min-w-0 space-y-1.5">
          <h3 className="truncate text-base font-semibold tracking-tight">
            {session.title}
          </h3>
          <div className="flex items-center gap-1.5 font-mono text-xs text-primary">
            <GridIcon name="branch" />
            <span className="truncate">
              {context?.worktree.branchName ?? "missing worktree"}
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 px-4 py-4">
        <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5 font-mono">
            <GridIcon name="bot" />
            <span className="truncate">
              {session.providerId}/{session.modelId}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 font-mono">
            <GridIcon name="clock" />
            {formatElapsedTime(session.createdAt)}
          </span>
        </div>
        <div className="min-h-16 rounded-lg border border-border bg-background/70 px-3 py-2.5 font-mono text-xs leading-5 text-muted-foreground shadow-inner">
          <span className="mr-2 text-primary">&gt;</span>
          <span className="line-clamp-2">
            {compactActivity(detail?.lastActivity)}
          </span>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground">
            <GridIcon name="files" />
            {detail?.changedFiles ?? 0} file
            {(detail?.changedFiles ?? 0) === 1 ? "" : "s"}
          </span>
          {(detail?.additions ?? 0) > 0 || (detail?.deletions ?? 0) > 0 ? (
            <span className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground">
              <span className="text-chart-3">+{detail?.additions ?? 0}</span>{" "}
              <span className="text-destructive">
                −{detail?.deletions ?? 0}
              </span>
            </span>
          ) : null}
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            updated {formatDate(session.updatedAt)}
          </span>
        </div>
      </div>
      <div className="h-px w-full bg-primary" aria-hidden="true" />
      <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-2.5">
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {context?.worktree.name ?? "Unavailable worktree"}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-primary transition-transform group-hover:translate-x-0.5">
          Open session
          <GridIcon name="arrow" />
        </span>
      </div>
    </button>
  );
};
