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
import { ConflictPreparation } from "../features/intelligence/components/ConflictPreparation";
import { DiffComparison } from "../features/intelligence/components/DiffComparison";
import { IntelligenceSummary } from "../features/intelligence/components/IntelligenceSummary";
import {
	selectConflicts,
	worktreeFor,
} from "../features/intelligence/components/conflict-view-model";
import { useConflictPreparation } from "../features/intelligence/hooks/use-conflict-preparation";
import { useIntelligence } from "../features/intelligence/hooks/use-intelligence";

export const Intelligence = () => {
	const navigate = useNavigate();
	const [selectedOverlapId, setSelectedOverlapId] = useState<string | null>(
		null,
	);
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
	const allConflicts = useMemo(
		() => (snapshot ? selectConflicts(snapshot) : []),
		[snapshot],
	);
	const selectedBeforeConfirmation =
		allConflicts.find(({ id }) => id === selectedOverlapId) ?? allConflicts[0];
	const selectedRepository = repositories.find(
		({ id }) => id === selectedRepositoryId,
	);
	const preparation = useConflictPreparation(
		selectedRepositoryId,
		selectedBeforeConfirmation?.id,
		selectedRepository?.defaultBranch,
	);
	const resolutionSessions = preparation.session ? [preparation.session] : [];
	const conflicts = useMemo(
		() => (snapshot ? selectConflicts(snapshot, resolutionSessions) : []),
		[snapshot, preparation.session],
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
	const selectedSession =
		preparation.session?.overlapId === selectedConflict?.id
			? preparation.session
			: undefined;
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
			<header className="flex min-h-24 shrink-0 items-start justify-between gap-6 px-6 py-5">
				<div className="flex min-w-0 items-start gap-3">
					<div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl bg-red-500/[0.09] text-red-400">
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
						className="h-9 min-w-52 rounded-xl border border-transparent bg-muted/65 px-3 font-mono text-xs outline-none transition-colors focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
						className="mb-3 rounded-xl bg-error-surface px-3 py-2 text-xs text-error-foreground"
						role="alert"
					>
						{error}
						{snapshot ? " The last successful snapshot remains visible." : ""}
					</div>
				) : snapshot?.stale ? (
					<div
						className="mb-3 flex items-center gap-2 rounded-xl bg-warning-surface px-3 py-2 text-xs text-warning-foreground"
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
								<Skeleton key={index} className="h-20 rounded-2xl" />
							))}
						</div>
						<div className="grid gap-3 xl:grid-cols-[0.9fr_1.45fr_0.95fr]">
							<Skeleton className="h-[35rem] rounded-2xl" />
							<Skeleton className="h-[35rem] rounded-2xl" />
							<Skeleton className="h-[35rem] rounded-2xl" />
						</div>
					</div>
				) : repositories.length === 0 ? (
					<div className="flex min-h-80 items-center justify-center rounded-2xl bg-card/35 px-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
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
					<div className="flex min-h-80 items-center justify-center rounded-2xl bg-card/35 px-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
						<div>
							<GitCompareArrows
								aria-hidden="true"
								className="mx-auto size-8 text-muted-foreground"
							/>
							<h2 className="mt-3 text-sm font-semibold">
								No agent changes to compare
							</h2>
							<p className="mt-1 text-xs text-muted-foreground">
								Conflicts appear after coding agents begin changing worktrees.
							</p>
						</div>
					</div>
				) : snapshot ? (
					<div
						className="space-y-3"
						aria-label="Cross-worktree conflict results"
					>
						<IntelligenceSummary snapshot={snapshot} />
						{snapshot.warnings.length > 0 ? (
							<ul className="rounded-xl bg-warning-surface px-4 py-2 text-[10px] text-warning-foreground">
								{snapshot.warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						) : null}
						{conflicts.length === 0 ? (
							<div className="flex min-h-[28rem] items-center justify-center rounded-2xl bg-card/35 px-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
								<div>
									<ShieldCheck
										className="mx-auto size-9 text-emerald-400"
										aria-hidden="true"
									/>
									<h2 className="mt-3 text-sm font-semibold">
										No high or medium conflicts
									</h2>
									<p className="mt-1 max-w-sm text-xs text-muted-foreground">
										Only low-risk relationships were detected. There is nothing
										requiring conflict review.
									</p>
								</div>
							</div>
						) : selectedConflict && left && right ? (
							<div className="grid min-h-[35rem] gap-3 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(28rem,1.45fr)_minmax(19rem,0.95fr)]">
								<ConflictList
									conflicts={conflicts}
									selectedId={selectedConflict.id}
									worktrees={snapshot.worktrees}
									sessions={resolutionSessions}
									onSelect={setSelectedOverlapId}
								/>
								<ConflictDetails
									overlap={selectedConflict}
									left={left}
									right={right}
									session={selectedSession}
								/>
								<ConflictActions
									overlap={selectedConflict}
									left={left}
									right={right}
									independentWorktrees={independentWorktrees}
									onOpenChat={openChat}
									onCompare={setCompareOverlapId}
									preparation={
										<ConflictPreparation
											branches={preparation.branches}
											targetBranch={preparation.targetBranch}
											selectTargetBranch={preparation.selectTargetBranch}
											session={selectedSession}
											loading={preparation.loading}
											preparing={preparation.preparing}
											error={preparation.error}
											onPrepare={() => void preparation.prepare()}
										/>
									}
								/>
							</div>
						) : (
							<div className="flex min-h-64 items-center justify-center rounded-2xl bg-error-surface/70 text-center">
								<div>
									<AlertTriangle className="mx-auto size-7 text-destructive" />
									<h2 className="mt-2 text-sm font-semibold">
										Conflict context unavailable
									</h2>
									<p className="mt-1 text-xs text-muted-foreground">
										One of the involved worktrees is missing from this snapshot.
									</p>
								</div>
							</div>
						)}
					</div>
				) : null}
			</div>

			<DiffComparison
				overlapId={compareOverlapId}
				open={compareOverlapId !== null}
				onClose={() => setCompareOverlapId(null)}
				onOpenChat={openChat}
			/>
		</section>
	);
};
