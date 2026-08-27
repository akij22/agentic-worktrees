import { FileSearch, GitCompareArrows, ScanSearch, TriangleAlert } from "lucide-react";
import type { IntelligenceOverlapDto } from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import { RiskBadge } from "./RiskBadge";

interface Props {
	overlaps: IntelligenceOverlapDto[];
	onReview?: (overlapId: string) => void;
	onCompare?: (overlapId: string) => void;
	onInspect?: (overlapId: string) => void;
}

export const AttentionPanel = ({
	overlaps,
	onReview,
	onCompare,
	onInspect,
}: Props) => {
	const actionable = overlaps.filter(({ actionable }) => actionable);

	return (
		<aside className="surface-panel flex min-h-0 flex-col overflow-hidden" aria-labelledby="attention-heading">
			<header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-3">
				<div>
					<h2 id="attention-heading" className="flex items-center gap-2 text-sm font-semibold">
						<TriangleAlert className="size-4 text-amber-400" aria-hidden="true" />
						Attention
					</h2>
					<p className="mt-0.5 text-[10px] text-muted-foreground">Actionable relationships across the repository</p>
				</div>
				<span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-mono text-[9px] text-amber-400">
					{actionable.length}
				</span>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto p-3">
				{actionable.length === 0 ? (
					<div className="rounded-xl bg-background/35 px-4 py-8 text-center">
						<p className="text-xs font-medium">No actionable overlaps</p>
						<p className="mt-1 text-[10px] text-muted-foreground">Low-risk and passive module relationships stay on the map.</p>
					</div>
				) : (
					<ol className="space-y-2">
						{actionable.map((overlap) => (
							<li key={overlap.id} className="rounded-xl border border-border bg-background/35 p-3">
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0">
										<p className="text-xs font-medium leading-5">{overlap.summary}</p>
										<code className="mt-1 block truncate text-[9px] text-muted-foreground" title={overlap.targets[0]?.path}>
											{overlap.targets[0]?.path ?? overlap.category}
										</code>
									</div>
									<RiskBadge risk={overlap.risk} />
								</div>
								{onReview || onCompare || onInspect ? (
									<div className="mt-3 grid grid-cols-3 gap-1.5">
										<Button type="button" size="sm" variant="secondary" className="h-7 px-1.5 text-[9px]" aria-label="Review overlap" onClick={() => onReview?.(overlap.id)}>
											<ScanSearch aria-hidden="true" /> Review
										</Button>
										<Button type="button" size="sm" variant="secondary" className="h-7 px-1.5 text-[9px]" aria-label="Compare diff" onClick={() => onCompare?.(overlap.id)}>
											<GitCompareArrows aria-hidden="true" /> Compare
										</Button>
										<Button type="button" size="sm" variant="secondary" className="h-7 px-1.5 text-[9px]" aria-label="Inspect files" onClick={() => onInspect?.(overlap.id)}>
											<FileSearch aria-hidden="true" /> Inspect
										</Button>
									</div>
								) : null}
							</li>
						))}
					</ol>
				)}
			</div>
		</aside>
	);
};
