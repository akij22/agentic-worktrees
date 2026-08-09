import { Bot, ExternalLink, GitBranch, ShieldCheck } from "lucide-react";
import type { IntelligenceWorktreeDto } from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import { RiskBadge } from "./RiskBadge";

type Props = {
	worktree: IntelligenceWorktreeDto;
	risk: "high" | "medium" | "low";
	onOpenChat: (worktreeId: string, runId: string) => void;
};

export const IntelligenceWorktreeNode = ({
	worktree,
	risk,
	onOpenChat,
}: Props) => (
	<article
		data-testid="intelligence-worktree-node"
		className={cn(
			"relative min-w-0 rounded-xl border bg-card/80 p-4 shadow-sm",
			risk === "high" && "border-red-500/40",
			risk === "medium" && "border-amber-500/35",
			risk === "low" && "border-border",
		)}
	>
		<div className="flex items-start justify-between gap-3">
			<div className="min-w-0">
				<div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
					<Bot className="size-3.5" aria-hidden="true" />
					{worktree.agentName ?? "Coding agent"}
				</div>
				<h3
					className="mt-2 truncate text-sm font-semibold"
					title={worktree.task}
				>
					{worktree.task}
				</h3>
				<p className="mt-1 flex items-center gap-1.5 truncate font-mono text-[10px] text-muted-foreground">
					<GitBranch className="size-3" aria-hidden="true" /> {worktree.branch}
				</p>
			</div>
			{worktree.independent ? (
				<span className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[9px] font-semibold uppercase text-emerald-400">
					<ShieldCheck className="size-3" /> Safely independent
				</span>
			) : (
				<RiskBadge risk={risk} />
			)}
		</div>

		<div className="mt-4 grid grid-cols-3 gap-2 border-y border-border/70 py-3 text-center font-mono text-[10px]">
			<div>
				<strong className="block text-sm text-foreground">
					{worktree.changedFileCount}
				</strong>
				<span className="text-muted-foreground">files</span>
			</div>
			<div>
				<strong className="block text-sm text-emerald-400">
					+{worktree.additions}
				</strong>
				<span className="text-muted-foreground">added</span>
			</div>
			<div>
				<strong className="block text-sm text-red-400">
					−{worktree.deletions}
				</strong>
				<span className="text-muted-foreground">removed</span>
			</div>
		</div>

		<div className="mt-3 flex items-end justify-between gap-2">
			<ul className="min-w-0 space-y-1 font-mono text-[9px] text-muted-foreground">
				{worktree.files.length === 0 ? (
					<li>Waiting for first edit</li>
				) : (
					worktree.files.slice(0, 3).map((file) => (
						<li key={file.path} className="truncate" title={file.path}>
							{file.path}
							{file.symbols[0] ? (
								<span className="text-foreground/70"> · {file.symbols[0]}</span>
							) : null}
						</li>
					))
				)}
			</ul>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				disabled={!worktree.runId}
				aria-label={`Open chat for ${worktree.task}`}
				onClick={() =>
					worktree.runId && onOpenChat(worktree.worktreeId, worktree.runId)
				}
				className="h-7 shrink-0 px-2"
			>
				<ExternalLink /> Chat
			</Button>
		</div>
	</article>
);
