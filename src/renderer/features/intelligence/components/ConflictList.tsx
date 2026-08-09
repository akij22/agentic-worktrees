import { Bot, Clock3, FileCode2 } from "lucide-react";
import type {
	ConflictResolutionSessionDto,
	IntelligenceOverlapDto,
	IntelligenceWorktreeDto,
} from "../../../../shared/ipc/schemas";
import { cn } from "../../../lib/utils";
import {
	conflictFileCount,
	conflictPresentation,
} from "./conflict-view-model";
import { RiskBadge } from "./RiskBadge";

type Props = {
	conflicts: IntelligenceOverlapDto[];
	selectedId: string | null;
	worktrees: IntelligenceWorktreeDto[];
	sessions?: ConflictResolutionSessionDto[];
	onSelect: (overlapId: string) => void;
};

const relativeUpdate = (timestamp: number): string => {
	const elapsedMinutes = Math.max(
		0,
		Math.floor((Date.now() - timestamp) / 60_000),
	);
	if (elapsedMinutes < 1) return "Updated now";
	if (elapsedMinutes < 60) return `Updated ${elapsedMinutes}m ago`;
	const elapsedHours = Math.floor(elapsedMinutes / 60);
	if (elapsedHours < 24) return `Updated ${elapsedHours}h ago`;
	return `Updated ${Math.floor(elapsedHours / 24)}d ago`;
};

const Agent = ({
	worktree,
}: {
	worktree: IntelligenceWorktreeDto | undefined;
}) => (
	<div className="flex min-w-0 items-center gap-2">
		<div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/60">
			<Bot className="size-4 text-muted-foreground" aria-hidden="true" />
		</div>
		<div className="min-w-0">
			<span className="block font-mono text-[8px] uppercase text-muted-foreground">
				{worktree?.agentName ?? "Agent"}
			</span>
			<strong className="block truncate text-[11px] font-medium">
				{worktree?.task ?? "Unavailable worktree"}
			</strong>
		</div>
	</div>
);

export const ConflictList = ({
	conflicts,
	selectedId,
	worktrees,
	sessions = [],
	onSelect,
}: Props) => (
	<section
		className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/80 bg-card/35"
		aria-labelledby="conflict-list-heading"
	>
		<header className="flex h-12 shrink-0 items-center justify-between border-b border-border/80 px-4">
			<h2 id="conflict-list-heading" className="text-sm font-semibold">
				Conflict list
			</h2>
			<span className="text-[10px] text-muted-foreground">
				Sort by: <b className="text-foreground">Severity</b>
			</span>
		</header>
		<div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
			{conflicts.map((conflict) => {
				const left = worktrees.find(
					({ worktreeId }) => worktreeId === conflict.leftWorktreeId,
				);
				const right = worktrees.find(
					({ worktreeId }) => worktreeId === conflict.rightWorktreeId,
				);
				const selected = selectedId === conflict.id;
				const session = sessions.find(({ overlapId }) => overlapId === conflict.id);
				const presentation = conflictPresentation(conflict, session);
				const updatedAt = Math.max(left?.updatedAt ?? 0, right?.updatedAt ?? 0);
				return (
					<button
						key={conflict.id}
						type="button"
						onClick={() => onSelect(conflict.id)}
						aria-pressed={selected}
						className={cn(
							"w-full rounded-lg border bg-background/45 p-3 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							conflict.risk === "high"
								? "border-red-500/35"
								: "border-amber-500/30",
							selected &&
								conflict.risk === "high" &&
								"border-red-500 bg-red-500/[0.06] shadow-[inset_3px_0_0_rgb(239_68_68)]",
							selected &&
								conflict.risk === "medium" &&
								"border-amber-500 bg-amber-500/[0.05] shadow-[inset_3px_0_0_rgb(245_158_11)]",
						)}
					>
						<div className="flex items-center gap-2">
							<RiskBadge risk={conflict.risk} />
							<h3 className="min-w-0 truncate text-xs font-semibold">
								{left?.task ?? conflict.leftWorktreeId}{" "}
								<span className="px-1 text-muted-foreground">↔</span>{" "}
								{right?.task ?? conflict.rightWorktreeId}
							</h3>
						</div>
						<div className="mt-2 flex items-center justify-between gap-2">
							<p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{conflict.summary}</p>
							<span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase ${
								presentation.kind === "conflict" ? "border-red-500/40 text-red-400" :
								presentation.kind === "review_required" ? "border-amber-500/40 text-amber-400" :
								"border-border text-muted-foreground"
							}`}>{presentation.label} · {presentation.confirmation}</span>
						</div>
						{conflict.targets[0]?.path ? (
							<p className="mt-1 truncate font-mono text-[9px] text-foreground/70">
								{conflict.targets[0].path}
							</p>
						) : null}
						<div className="mt-3 grid grid-cols-2 gap-3">
							<Agent worktree={left} />
							<Agent worktree={right} />
						</div>
						<div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2 font-mono text-[9px] text-muted-foreground">
							<span className="flex items-center gap-1">
								<Clock3 className="size-3" />
								{relativeUpdate(updatedAt)}
							</span>
							<span className="flex items-center gap-1">
								<FileCode2 className="size-3" />
								{conflictFileCount(conflict)} files
							</span>
						</div>
					</button>
				);
			})}
		</div>
		<footer className="shrink-0 border-t border-border/80 px-4 py-3 font-mono text-[9px] text-muted-foreground">
			Showing {conflicts.length} attention finding{conflicts.length === 1 ? "" : "s"}
		</footer>
	</section>
);
