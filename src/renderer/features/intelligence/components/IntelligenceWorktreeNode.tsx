import {
	AlertTriangle,
	Bot,
	GitBranch,
	MessageCircle,
	ShieldCheck,
} from "lucide-react";
import type {
	IntelligenceOverlapDto,
	IntelligenceWorktreeDto,
} from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import { RiskBadge } from "./RiskBadge";

interface Props {
	worktree: IntelligenceWorktreeDto;
	risk?: IntelligenceOverlapDto["risk"];
	onOpenChat?: (worktreeId: string, runId: string) => void;
	className?: string;
}

const number = new Intl.NumberFormat("en-US");

export const IntelligenceWorktreeNode = ({
	worktree,
	risk,
	onOpenChat,
	className,
}: Props) => {
	const runId = worktree.runId;

	return (
		<article
			data-testid="intelligence-worktree-node"
			className={cn(
				"relative min-w-0 rounded-xl border border-border bg-card/40 p-3 shadow-[0_18px_45px_-32px_rgba(0,0,0,0.85)] backdrop-blur-sm",
				className,
			)}
		>
		<header className="flex items-start justify-between gap-3">
			<div className="flex min-w-0 items-start gap-2.5">
				<div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
					<Bot className="size-4" aria-hidden="true" />
				</div>
				<div className="min-w-0">
					<h3 className="truncate text-xs font-semibold" title={worktree.task}>
						{worktree.task}
					</h3>
					<p className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
						{worktree.agentName ?? worktree.agentKind ?? "Unassigned agent"} · {worktree.status}
					</p>
				</div>
			</div>
			{risk ? <RiskBadge risk={risk} /> : null}
		</header>

		<p className="mt-3 flex min-w-0 items-center gap-1.5 truncate font-mono text-[9px] text-muted-foreground">
			<GitBranch className="size-3 shrink-0" aria-hidden="true" />
			<span className="truncate">{worktree.branch}</span>
		</p>

		<ul className="mt-2 space-y-1" aria-label={`Changed files for ${worktree.task}`}>
			{worktree.files.slice(0, 3).map((file) => (
				<li key={file.path} className="min-w-0 rounded-md bg-background/35 px-2 py-1.5">
					<code className="block truncate text-[9px] text-foreground/80" title={file.path}>
						{file.path}
					</code>
					{file.symbols.length > 0 ? (
						<span className="mt-0.5 block truncate font-mono text-[8px] text-muted-foreground">
							{file.symbols.slice(0, 2).join(" · ")}
						</span>
					) : null}
				</li>
			))}
		</ul>

		<div className="mt-3 flex items-end justify-between gap-3 border-t border-border/70 pt-2.5">
			<div className="flex gap-3 font-mono text-[9px]">
				<span>{worktree.changedFileCount} files</span>
				<span className="text-chart-3">+{number.format(worktree.additions)}</span>
				<span className="text-destructive">−{number.format(worktree.deletions)}</span>
			</div>
			{runId && onOpenChat ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-6 px-2 text-[9px]"
					aria-label={`Open ${worktree.task} chat`}
					onClick={() => onOpenChat(worktree.worktreeId, runId)}
				>
					<MessageCircle aria-hidden="true" /> Chat
				</Button>
			) : null}
		</div>

		{worktree.independent ? (
			<p className="mt-2 flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1.5 text-[9px] text-emerald-400">
				<ShieldCheck className="size-3" aria-hidden="true" /> Safely independent
			</p>
		) : null}
		{worktree.warning ? (
			<p className="mt-2 flex items-start gap-1.5 rounded-md bg-warning-surface px-2 py-1.5 text-[9px] text-warning-foreground">
				<AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
				<span>{worktree.warning}</span>
			</p>
		) : null}
		</article>
	);
};
