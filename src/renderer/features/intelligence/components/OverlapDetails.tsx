import { ExternalLink, GitCompareArrows, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { IntelligenceOverlapDetailsDto } from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../../../components/ui/dialog";
import { RiskBadge } from "./RiskBadge";

type Props = {
	overlapId: string | null;
	open: boolean;
	onClose: () => void;
	onCompare: (overlapId: string) => void;
	onOpenChat: (worktreeId: string, runId: string) => void;
};

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
				if (!cancelled)
					setError(cause instanceof Error ? cause.message : String(cause));
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
			className="max-h-[82vh] max-w-3xl overflow-y-auto p-0"
		>
			<DialogHeader className="border-b border-border px-5 py-4">
				<div className="flex items-start justify-between gap-4">
					<div>
						<DialogTitle>Overlap inspection</DialogTitle>
						<DialogDescription className="mt-1">
							Evidence from local Git deltas and source symbols.
						</DialogDescription>
					</div>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="size-7"
						aria-label="Close overlap inspection"
						onClick={onClose}
					>
						<X />
					</Button>
				</div>
			</DialogHeader>
			<div className="p-5">
				{error ? (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				) : !details ? (
					<p className="text-sm text-muted-foreground">Loading evidence…</p>
				) : (
					<>
						<div className="flex items-start justify-between gap-3">
							<div>
								<RiskBadge risk={details.overlap.risk} />
								<p className="mt-2 text-sm font-medium">
									{details.overlap.summary}
								</p>
							</div>
							<span className="font-mono text-[10px] uppercase text-muted-foreground">
								{details.overlap.reasonCode}
							</span>
						</div>
						<div className="mt-5 grid gap-3 sm:grid-cols-2">
							{[details.left, details.right].map((worktree) => (
								<article
									key={worktree.worktreeId}
									className="rounded-lg border border-border bg-background/50 p-3"
								>
									<h3 className="text-xs font-semibold">{worktree.task}</h3>
									<p className="mt-1 font-mono text-[10px] text-muted-foreground">
										{worktree.branch}
									</p>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="mt-2 h-7 px-2"
										disabled={!worktree.runId}
										aria-label={`Open chat for ${worktree.task}`}
										onClick={() =>
											worktree.runId &&
											onOpenChat(worktree.worktreeId, worktree.runId)
										}
									>
										<ExternalLink /> Open chat
									</Button>
								</article>
							))}
						</div>
						<div className="mt-5 space-y-2">
							<h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
								Evidence
							</h3>
							{details.overlap.targets.map((target, index) => (
								<div
									key={target.id ?? `${target.path}-${index}`}
									className="rounded-md border border-border px-3 py-2"
								>
									<div className="flex items-center justify-between gap-3">
										<code className="text-xs">
											{target.symbol ?? target.path}
										</code>
										<span className="font-mono text-[9px] uppercase text-muted-foreground">
											{target.type}
										</span>
									</div>
									{target.symbol ? (
										<p className="mt-1 font-mono text-[10px] text-muted-foreground">
											{target.path}
										</p>
									) : null}
								</div>
							))}
						</div>
					</>
				)}
			</div>
			{details && overlapId ? (
				<DialogFooter className="border-t border-border px-5 py-3">
					<Button type="button" size="sm" onClick={() => onCompare(overlapId)}>
						<GitCompareArrows /> Compare diffs
					</Button>
				</DialogFooter>
			) : null}
		</Dialog>
	);
};
