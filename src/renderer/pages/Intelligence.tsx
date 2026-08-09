import {
	AlertTriangle,
	Clock3,
	FolderGit2,
	GitCompareArrows,
	RefreshCw,
	ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { ConflictActions } from "../features/intelligence/components/ConflictActions";
import { ConflictDetails } from "../features/intelligence/components/ConflictDetails";
import { ConflictList } from "../features/intelligence/components/ConflictList";
import { DiffComparison } from "../features/intelligence/components/DiffComparison";
import { IntelligenceSummary } from "../features/intelligence/components/IntelligenceSummary";
import {
	selectConflicts,
	worktreeFor,
} from "../features/intelligence/components/conflict-view-model";
import { useIntelligence } from "../features/intelligence/hooks/use-intelligence";

export const Intelligence = () => {
	const navigate = useNavigate();
	const [selectedOverlapId, setSelectedOverlapId] = useState<string | null>(null);
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
	const conflicts = useMemo(
		() => (snapshot ? selectConflicts(snapshot) : []),
		[snapshot],
	);

	useEffect(() => {
		setSelectedOverlapId((current) =>
			current && conflicts.some(({ id }) => id === current)
				? current
				: (conflicts[0]?.id ?? null),
		);
	}, [conflicts]);

	const selectedConflict =
		conflicts.find(({ id }) => id === selectedOverlapId) ?? conflicts[0];
	const left =
		snapshot && selectedConflict
			? worktreeFor(snapshot, selectedConflict.leftWorktreeId)
			: undefined;
	const right =
		snapshot && selectedConflict
			? worktreeFor(snapshot, selectedConflict.rightWorktreeId)
			: undefined;
	const independentWorktrees =
		snapshot?.worktrees.filter(({ independent }) => independent) ?? [];

	const openChat = (worktreeId: string, runId: string) => {
		navigate(
			`/coding-agent/${encodeURIComponent(worktreeId)}/${encodeURIComponent(runId)}`,
		);
	};

	return (
		<section className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
			<header className="flex min-h-24 shrink-0 items-start justify-between gap-6 border-b border-border/80 bg-card/20 px-6 py-5">
				<div className="flex min-w-0 items-start gap-3">
					<div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-red-500/25 bg-red-500/[0.07] text-red-400">
						<GitCompareArrows aria-hidden="true" className="size-4" />
					</div>
					<div>
						<h1 className="text-xl font-semibold tracking-tight">
							Cross-worktree conflicts
						</h1>
						<p className="mt-1 text-xs text-muted-foreground">
							See the most important overlaps across active worktrees.
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
						className="h-9 min-w-52 rounded-md border border-input bg-background px-3 font-mono text-xs shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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

			<div className="min-h-0 flex-1 overflow-y-auto p-4 xl:p-5">
				{error ? (
					<div
						className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
						role="alert"
					>
						{error}
						{snapshot ? " The last successful snapshot remains visible." : ""}
					</div>
				) : snapshot?.stale ? (
					<div
						className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
						role="status"
					>
						<Clock3 className="size-3.5" aria-hidden="true" /> Showing the last
						successful snapshot.
					</div>
				) : null}

				{loading && !snapshot ? (
					<div className="space-y-3" aria-label="Loading conflicts">
						<div className="grid gap-3 md:grid-cols-4">
							{Array.from({ length: 4 }).map((_, index) => (
								<Skeleton key={index} className="h-20 rounded-lg" />
							))}
						</div>
						<div className="grid gap-3 xl:grid-cols-[0.9fr_1.45fr_0.95fr]">
							<Skeleton className="h-[35rem] rounded-lg" />
							<Skeleton className="h-[35rem] rounded-lg" />
							<Skeleton className="h-[35rem] rounded-lg" />
						</div>
					</div>
				) : repositories.length === 0 ? (
					<div className="flex min-h-80 items-center justify-center rounded-lg border border-dashed border-border bg-card/20 px-8 text-center">
						<div>
							<FolderGit2 aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
							<h2 className="mt-3 text-sm font-semibold">No repositories available</h2>
							<p className="mt-1 text-xs text-muted-foreground">Add a repository and create coding-agent worktrees first.</p>
						</div>
					</div>
				) : snapshot && snapshot.worktrees.length === 0 ? (
					<div className="flex min-h-80 items-center justify-center rounded-lg border border-dashed border-border bg-card/20 px-8 text-center">
						<div>
							<GitCompareArrows aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
							<h2 className="mt-3 text-sm font-semibold">No agent changes to compare</h2>
							<p className="mt-1 text-xs text-muted-foreground">Conflicts appear after coding agents begin changing worktrees.</p>
						</div>
					</div>
				) : snapshot ? (
					<div className="space-y-3" aria-label="Cross-worktree conflict results">
						<IntelligenceSummary snapshot={snapshot} />
						{snapshot.warnings.length > 0 ? (
							<ul className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-[10px] text-amber-300">
								{snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}
							</ul>
						) : null}
						{conflicts.length === 0 ? (
							<div className="flex min-h-[28rem] items-center justify-center rounded-lg border border-border/80 bg-card/30 px-8 text-center">
								<div>
									<ShieldCheck className="mx-auto size-9 text-emerald-400" aria-hidden="true" />
									<h2 className="mt-3 text-sm font-semibold">No high or medium conflicts</h2>
									<p className="mt-1 max-w-sm text-xs text-muted-foreground">Only low-risk relationships were detected. There is nothing requiring conflict review.</p>
								</div>
							</div>
						) : selectedConflict && left && right ? (
							<div className="grid min-h-[35rem] gap-3 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(28rem,1.45fr)_minmax(19rem,0.95fr)]">
								<ConflictList conflicts={conflicts} selectedId={selectedConflict.id} worktrees={snapshot.worktrees} onSelect={setSelectedOverlapId} />
								<ConflictDetails overlap={selectedConflict} left={left} right={right} />
								<ConflictActions overlap={selectedConflict} left={left} right={right} independentWorktrees={independentWorktrees} onOpenChat={openChat} onCompare={setCompareOverlapId} />
							</div>
						) : (
							<div className="flex min-h-64 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 text-center">
								<div><AlertTriangle className="mx-auto size-7 text-destructive" /><h2 className="mt-2 text-sm font-semibold">Conflict context unavailable</h2><p className="mt-1 text-xs text-muted-foreground">One of the involved worktrees is missing from this snapshot.</p></div>
							</div>
						)}
					</div>
				) : null}
			</div>

			<DiffComparison overlapId={compareOverlapId} open={compareOverlapId !== null} onClose={() => setCompareOverlapId(null)} onOpenChat={openChat} />
		</section>
	);
};
