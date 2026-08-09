import {
	Bot,
	GitBranch,
	GitCompareArrows,
	MessageCircle,
	ShieldCheck,
} from "lucide-react";
import type {
	IntelligenceOverlapDto,
	IntelligenceWorktreeDto,
} from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";

type Props = {
	overlap: IntelligenceOverlapDto;
	left: IntelligenceWorktreeDto;
	right: IntelligenceWorktreeDto;
	independentWorktrees: IntelligenceWorktreeDto[];
	onOpenChat: (worktreeId: string, runId: string) => void;
	onCompare: (overlapId: string) => void;
};

const number = new Intl.NumberFormat("en-US");

const WorktreeCard = ({
	worktree,
	compact = false,
	onOpenChat,
}: {
	worktree: IntelligenceWorktreeDto;
	compact?: boolean;
	onOpenChat?: (worktreeId: string, runId: string) => void;
}) => {
	const content = (
		<>
			<div className="flex items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2">
					<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60">
						<Bot className="size-4 text-muted-foreground" />
					</div>
					<div className="min-w-0">
						<h4 className="truncate text-xs font-semibold">{worktree.task}</h4>
						<span className="font-mono text-[8px] uppercase text-muted-foreground">
							{worktree.agentName ?? "Agent"}
						</span>
					</div>
				</div>
				<div className="flex shrink-0 gap-3 font-mono text-[9px]">
					<span className="text-center">
						<b className="block text-foreground">{worktree.changedFileCount}</b>
						<small className="text-[8px] text-muted-foreground">files</small>
					</span>
					<span className="text-center">
						<b className="block text-emerald-400">
							+{number.format(worktree.additions)}
						</b>
						<small className="text-[8px] text-muted-foreground">added</small>
					</span>
					<span className="text-center">
						<b className="block text-red-400">
							−{number.format(worktree.deletions)}
						</b>
						<small className="text-[8px] text-muted-foreground">removed</small>
					</span>
				</div>
			</div>
			<div className="mt-2 flex items-end justify-between gap-3">
				<div className="min-w-0">
					<p className="flex items-center gap-1.5 truncate font-mono text-[9px] text-muted-foreground">
						<GitBranch className="size-3" />
						{worktree.branch}
					</p>
					{!compact && worktree.files[0] ? (
						<p className="mt-1 truncate font-mono text-[8px] text-foreground/55">
							{worktree.files[0].path}
						</p>
					) : null}
				</div>
				{worktree.runId && onOpenChat ? (
					<span className="flex shrink-0 items-center gap-1 font-mono text-[8px] text-primary opacity-70 transition-opacity group-hover:opacity-100">
						<MessageCircle className="size-3" /> Open chat
					</span>
				) : null}
			</div>
		</>
	);
	const className =
		"w-full rounded-lg border border-border/80 bg-background/35 p-3 text-left";

	if (worktree.runId && onOpenChat) {
		const runId = worktree.runId;
		return (
			<button
				type="button"
				aria-label={`Open ${worktree.task} chat`}
				onClick={() => onOpenChat(worktree.worktreeId, runId)}
				className={`${className} group cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
			>
				{content}
			</button>
		);
	}

	return <article className={className}>{content}</article>;
};

export const ConflictActions = ({
	overlap,
	left,
	right,
	independentWorktrees,
	onOpenChat,
	onCompare,
}: Props) => (
	<aside
		className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/80 bg-card/35"
		aria-labelledby="conflict-actions-heading"
	>
		<header className="flex h-12 shrink-0 items-center border-b border-border/80 px-4">
			<h2 id="conflict-actions-heading" className="text-sm font-semibold">
				Actions and quick context
			</h2>
		</header>
		<div className="min-h-0 flex-1 overflow-y-auto p-3">
			<h3 className="mb-2 text-xs font-medium">Involved worktrees</h3>
			<div className="space-y-2">
				<WorktreeCard worktree={left} onOpenChat={onOpenChat} />
				<WorktreeCard worktree={right} onOpenChat={onOpenChat} />
			</div>
			<div className="mt-3">
				<Button
					type="button"
					variant="outline"
					className="w-full"
					aria-label="Compare diffs"
					onClick={() => onCompare(overlap.id)}
				>
					<GitCompareArrows />
					Compare diffs
				</Button>
			</div>

			<div className="my-4 border-t border-border/80" />
			<div className="mb-2 flex items-center justify-between">
				<h3 className="text-xs font-medium">Independent worktrees</h3>
				<span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] text-emerald-400">
					{independentWorktrees.length}
				</span>
			</div>
			{independentWorktrees.length > 0 ? (
				<div className="space-y-2">
					{independentWorktrees.map((worktree) => (
						<WorktreeCard
							key={worktree.worktreeId}
							worktree={worktree}
							compact
							onOpenChat={onOpenChat}
						/>
					))}
				</div>
			) : (
				<div className="rounded-lg border border-dashed border-border p-4 text-center">
					<ShieldCheck className="mx-auto size-5 text-muted-foreground" />
					<p className="mt-2 text-[10px] text-muted-foreground">
						Every active worktree has a detected relationship.
					</p>
				</div>
			)}
		</div>
	</aside>
);
