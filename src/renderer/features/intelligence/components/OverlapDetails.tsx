import { Code2, ExternalLink, FileSearch, GitCompareArrows, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { IntelligenceOverlapDetailsDto } from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../../../components/ui/dialog";
import { RiskBadge } from "./RiskBadge";

interface Props {
	overlapId: string | null;
	open: boolean;
	onClose: () => void;
	onCompare: (overlapId: string) => void;
	onOpenChat?: (worktreeId: string, runId: string) => void;
}

const humanize = (value: string): string =>
	value[0]?.toUpperCase() + value.slice(1).replaceAll("-", " ");

type ChangedRangeDto = IntelligenceOverlapDetailsDto["overlap"]["targets"][number]["leftRanges"][number];

const formatRanges = (ranges: ChangedRangeDto[]): string =>
	ranges.length === 0
		? "No changed ranges"
		: ranges
			.map(({ oldStart, oldLines, newStart, newLines }) =>
				`Old ${oldStart},${oldLines} → new ${newStart},${newLines}`,
			)
			.join(" · ");

export const OverlapDetails = ({
	overlapId,
	open,
	onClose,
	onCompare,
	onOpenChat,
}: Props) => {
	const [details, setDetails] = useState<IntelligenceOverlapDetailsDto>();
	const [error, setError] = useState<string>();

	useEffect(() => {
		if (!open || !overlapId) return;
		let cancelled = false;
		setDetails(undefined);
		setError(undefined);
		void window.api.intelligence
			.getOverlap({ overlapId })
			.then((value) => {
				if (!cancelled) setDetails(value);
			})
			.catch((cause: unknown) => {
				if (!cancelled) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			});
		return () => {
			cancelled = true;
		};
	}, [open, overlapId]);

	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (!value) onClose();
			}}
			className="flex max-h-[88vh] max-w-4xl flex-col overflow-hidden p-0"
		>
			<DialogHeader className="shrink-0 border-b border-border px-5 py-4">
				<div className="flex items-start justify-between gap-4">
					<div>
						<DialogTitle>Overlap details</DialogTitle>
						<DialogDescription className="mt-1">
							Persisted paths, symbols, and deterministic classification evidence.
						</DialogDescription>
					</div>
					<Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Close overlap details" onClick={onClose}>
						<X aria-hidden="true" />
					</Button>
				</div>
			</DialogHeader>

			<div className="min-h-0 flex-1 overflow-y-auto p-4">
				{error ? (
					<p role="alert" className="rounded-xl bg-error-surface px-3 py-2 text-sm text-error-foreground">{error}</p>
				) : !details ? (
					<p className="text-sm text-muted-foreground">Loading overlap evidence…</p>
				) : (
					<div className="space-y-4">
						<section className="rounded-xl border border-border bg-background/35 p-4" aria-label="Overlap classification">
							<div className="flex items-start justify-between gap-3">
								<div>
									<p className="text-sm font-semibold">{details.overlap.summary}</p>
									<p className="mt-1 font-mono text-[10px] text-muted-foreground">{humanize(details.overlap.reasonCode)}</p>
								</div>
								<RiskBadge risk={details.overlap.risk} />
							</div>
						</section>

						<div className="grid gap-3 sm:grid-cols-2">
							{[details.left, details.right].map((worktree) => {
								const runId = worktree.runId;
								return (
									<section key={worktree.worktreeId} className="rounded-xl border border-border bg-card/35 p-3">
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0">
											<h3 className="truncate text-xs font-semibold">{worktree.task}</h3>
											<code className="mt-1 block truncate text-[9px] text-muted-foreground">{worktree.branch}</code>
										</div>
										{runId && onOpenChat ? (
											<Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[9px]" aria-label={`Open ${worktree.task} chat`} onClick={() => onOpenChat(worktree.worktreeId, runId)}>
												<ExternalLink aria-hidden="true" /> Chat
											</Button>
										) : null}
									</div>
									<ul className="mt-3 space-y-1">
										{worktree.files.slice(0, 4).map((file) => (
											<li key={file.path} className="truncate font-mono text-[9px] text-foreground/70">{file.path}</li>
										))}
									</ul>
									</section>
								);
							})}
						</div>

						<section aria-labelledby="overlap-targets-heading">
							<h3 id="overlap-targets-heading" className="mb-2 flex items-center gap-2 text-xs font-semibold">
								<FileSearch className="size-4" aria-hidden="true" /> Evidence targets
							</h3>
							<ul className="space-y-2">
								{details.overlap.targets.map((target, index) => (
									<li key={target.id ?? `${target.path}-${index}`} className="rounded-xl bg-background/35 p-3">
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<code className="block truncate text-[10px]" title={target.path}>{target.path}</code>
												<p className="mt-1 font-mono text-[9px] text-muted-foreground">{humanize(target.reasonCode)} · {target.type}</p>
											</div>
											<RiskBadge risk={target.risk} />
										</div>
										{target.symbol ? (
											<p className="mt-2 flex items-center gap-1.5 font-mono text-[9px] text-primary">
												<Code2 className="size-3" aria-hidden="true" /> {target.symbol}
											</p>
										) : null}
										<div className="mt-2 grid gap-1 font-mono text-[8px] text-muted-foreground sm:grid-cols-2">
											<span>{target.leftFilePath ?? "Not changed on left"}</span>
											<span>{target.rightFilePath ?? "Not changed on right"}</span>
										</div>
										<div className="mt-2 grid gap-2 border-t border-border/70 pt-2 text-[8px] sm:grid-cols-2">
											<div>
												<span className="font-semibold uppercase tracking-wide text-muted-foreground">Left changed ranges</span>
												<code className="mt-0.5 block text-foreground/75">{formatRanges(target.leftRanges)}</code>
											</div>
											<div>
												<span className="font-semibold uppercase tracking-wide text-muted-foreground">Right changed ranges</span>
												<code className="mt-0.5 block text-foreground/75">{formatRanges(target.rightRanges)}</code>
											</div>
										</div>
									</li>
								))}
							</ul>
						</section>
					</div>
				)}
			</div>

			{details ? (
				<footer className="flex shrink-0 justify-end border-t border-border px-4 py-3">
					<Button type="button" variant="outline" size="sm" aria-label="Compare diff" onClick={() => onCompare(details.overlap.id)}>
						<GitCompareArrows aria-hidden="true" /> Compare diff
					</Button>
				</footer>
			) : null}
		</Dialog>
	);
};
