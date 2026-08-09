import { Activity, Clock3, FolderGit2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { AttentionPanel } from "../features/intelligence/components/AttentionPanel";
import { DiffComparison } from "../features/intelligence/components/DiffComparison";
import { IntelligenceSummary } from "../features/intelligence/components/IntelligenceSummary";
import { OverlapDetails } from "../features/intelligence/components/OverlapDetails";
import { WorktreeOverlapMap } from "../features/intelligence/components/WorktreeOverlapMap";
import { Skeleton } from "../components/ui/skeleton";
import { useIntelligence } from "../features/intelligence/hooks/use-intelligence";

export const Intelligence = () => {
	const navigate = useNavigate();
	const [reviewOverlapId, setReviewOverlapId] = useState<string | null>(null);
	const [compareOverlapId, setCompareOverlapId] = useState<string | null>(null);
	const {
		repositories,
		selectedRepositoryId,
		selectRepository,
		snapshot,
		loading,
		refreshing,
		error,
		refresh,
	} = useIntelligence();
	const openChat = (worktreeId: string, runId: string) => {
		navigate(
			`/coding-agent/${encodeURIComponent(worktreeId)}/${encodeURIComponent(runId)}`,
		);
	};
	const compare = (overlapId: string) => {
		setReviewOverlapId(null);
		setCompareOverlapId(overlapId);
	};

	return (
		<section className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
			<header className="flex min-h-24 shrink-0 items-start justify-between gap-6 border-b border-border bg-card/20 px-6 py-5">
				<div className="flex min-w-0 items-start gap-3">
					<div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground shadow-sm">
						<Activity aria-hidden="true" className="size-4.5" />
					</div>
					<div>
						<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
							Parallel execution
						</p>
						<h1 className="mt-1 text-xl font-semibold tracking-tight">
							Cross-worktree intelligence
						</h1>
						<p className="mt-1 text-xs text-muted-foreground">
							Understand how concurrent agent changes interact before merge.
						</p>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<label htmlFor="intelligence-repository" className="sr-only">
						Repository
					</label>
					<select
						id="intelligence-repository"
						value={selectedRepositoryId ?? ""}
						onChange={(event) => selectRepository(event.target.value)}
						disabled={repositories.length === 0}
						className="h-8 min-w-48 rounded-md border border-input bg-background px-3 font-mono text-xs shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
					>
						{repositories.map((repository) => (
							<option key={repository.id} value={repository.id}>
								{repository.fullName}
							</option>
						))}
					</select>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={!selectedRepositoryId || refreshing}
						onClick={() => void refresh()}
					>
						<RefreshCw
							aria-hidden="true"
							className={refreshing ? "animate-spin" : undefined}
						/>
						{refreshing ? "Analyzing…" : "Refresh"}
					</Button>
				</div>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto p-6">
				{error ? (
					<div
						className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
						role="alert"
					>
						{error}
						{snapshot ? " The last successful snapshot remains visible." : ""}
					</div>
				) : snapshot?.stale ? (
					<div
						className="mb-4 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
						role="status"
					>
						<Clock3 className="size-3.5" aria-hidden="true" /> Showing the last
						successful snapshot.
					</div>
				) : null}

				{loading && !snapshot ? (
					<div className="space-y-4" aria-label="Loading intelligence">
						<div className="grid gap-3 md:grid-cols-4">
							{Array.from({ length: 4 }).map((_, index) => (
								<Skeleton key={index} className="h-20 rounded-xl" />
							))}
						</div>
						<Skeleton className="h-[34rem] rounded-xl" />
					</div>
				) : repositories.length === 0 ? (
					<div className="flex min-h-80 items-center justify-center rounded-xl border border-dashed border-border bg-card/20 px-8 text-center">
						<div>
							<FolderGit2
								aria-hidden="true"
								className="mx-auto size-8 text-muted-foreground"
							/>
							<h2 className="mt-3 text-sm font-semibold">
								No repositories available
							</h2>
							<p className="mt-1 text-xs text-muted-foreground">
								Add a repository and create coding-agent worktrees first.
							</p>
						</div>
					</div>
				) : snapshot && snapshot.worktrees.length === 0 ? (
					<div className="flex min-h-80 items-center justify-center rounded-xl border border-dashed border-border bg-card/20 px-8 text-center">
						<div>
							<Activity
								aria-hidden="true"
								className="mx-auto size-8 text-muted-foreground"
							/>
							<h2 className="mt-3 text-sm font-semibold">
								No agent changes to compare
							</h2>
							<p className="mt-1 text-xs text-muted-foreground">
								Intelligence appears after coding agents begin changing
								worktrees.
							</p>
						</div>
					</div>
				) : snapshot ? (
					<div className="space-y-4" aria-label="Worktree intelligence results">
						<IntelligenceSummary snapshot={snapshot} />
						{snapshot.warnings.length > 0 ? (
							<ul className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-[11px] text-amber-300">
								{snapshot.warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						) : null}
						<div className="grid min-h-[34rem] gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(17rem,1fr)]">
							<WorktreeOverlapMap
								snapshot={snapshot}
								onReview={setReviewOverlapId}
								onCompare={compare}
								onOpenChat={openChat}
							/>
							<AttentionPanel
								overlaps={snapshot.overlaps}
								onReview={setReviewOverlapId}
								onCompare={compare}
							/>
						</div>
					</div>
				) : null}
			</div>

			<OverlapDetails
				overlapId={reviewOverlapId}
				open={reviewOverlapId !== null}
				onClose={() => setReviewOverlapId(null)}
				onCompare={compare}
				onOpenChat={openChat}
			/>
			<DiffComparison
				overlapId={compareOverlapId}
				open={compareOverlapId !== null}
				onClose={() => setCompareOverlapId(null)}
				onOpenChat={openChat}
			/>
		</section>
	);
};
