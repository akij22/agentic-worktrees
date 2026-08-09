import { Bot, GitBranch, GitCompareArrows, MessageCircle, ShieldCheck } from "lucide-react";
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

const WorktreeCard = ({ worktree, compact = false }: { worktree: IntelligenceWorktreeDto; compact?: boolean }) => (
	<article className="rounded-lg border border-border/80 bg-background/35 p-3">
		<div className="flex items-center justify-between gap-3">
			<div className="flex min-w-0 items-center gap-2">
				<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60"><Bot className="size-4 text-muted-foreground" /></div>
				<div className="min-w-0"><h4 className="truncate text-xs font-semibold">{worktree.task}</h4><span className="font-mono text-[8px] uppercase text-muted-foreground">{worktree.agentName ?? "Agent"}</span></div>
			</div>
			<div className="flex shrink-0 gap-3 font-mono text-[9px]">
				<span className="text-center"><b className="block text-foreground">{worktree.changedFileCount}</b><small className="text-[8px] text-muted-foreground">files</small></span>
				<span className="text-center"><b className="block text-emerald-400">+{number.format(worktree.additions)}</b><small className="text-[8px] text-muted-foreground">added</small></span>
				<span className="text-center"><b className="block text-red-400">−{number.format(worktree.deletions)}</b><small className="text-[8px] text-muted-foreground">removed</small></span>
			</div>
		</div>
		<p className="mt-2 flex items-center gap-1.5 truncate font-mono text-[9px] text-muted-foreground"><GitBranch className="size-3" />{worktree.branch}</p>
		{!compact && worktree.files[0] ? <p className="mt-1 truncate font-mono text-[8px] text-foreground/55">{worktree.files[0].path}</p> : null}
	</article>
);

export const ConflictActions = ({ overlap, left, right, independentWorktrees, onOpenChat, onCompare }: Props) => (
	<aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/80 bg-card/35" aria-labelledby="conflict-actions-heading">
		<header className="flex h-12 shrink-0 items-center border-b border-border/80 px-4"><h2 id="conflict-actions-heading" className="text-sm font-semibold">Actions and quick context</h2></header>
		<div className="min-h-0 flex-1 overflow-y-auto p-3">
			<h3 className="mb-2 text-xs font-medium">Involved worktrees</h3>
			<div className="space-y-2"><WorktreeCard worktree={left} /><WorktreeCard worktree={right} /></div>
			<div className="mt-3 space-y-2">
				{[left, right].map((worktree) => (
					<Button key={worktree.worktreeId} type="button" className="w-full bg-red-600/80 text-white hover:bg-red-600" disabled={!worktree.runId} aria-label={`Open ${worktree.task} chat`} onClick={() => worktree.runId && onOpenChat(worktree.worktreeId, worktree.runId)}><MessageCircle />Open {worktree.task} chat</Button>
				))}
				<Button type="button" variant="outline" className="w-full" aria-label="Compare diffs" onClick={() => onCompare(overlap.id)}><GitCompareArrows />Compare diffs</Button>
			</div>

			<div className="my-4 border-t border-border/80" />
			<div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-medium">Independent worktrees</h3><span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] text-emerald-400">{independentWorktrees.length}</span></div>
			{independentWorktrees.length > 0 ? (
				<div className="space-y-2">{independentWorktrees.map((worktree) => <WorktreeCard key={worktree.worktreeId} worktree={worktree} compact />)}</div>
			) : (
				<div className="rounded-lg border border-dashed border-border p-4 text-center"><ShieldCheck className="mx-auto size-5 text-muted-foreground" /><p className="mt-2 text-[10px] text-muted-foreground">Every active worktree has a detected relationship.</p></div>
			)}
		</div>
	</aside>
);
