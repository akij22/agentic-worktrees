import { GitCompareArrows, Search, ShieldCheck } from "lucide-react";
import type { IntelligenceOverlapDto } from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import { RiskBadge } from "./RiskBadge";

type Props = {
	overlaps: IntelligenceOverlapDto[];
	onReview: (overlapId: string) => void;
	onCompare: (overlapId: string) => void;
};

export const AttentionPanel = ({ overlaps, onReview, onCompare }: Props) => {
	const actionable = overlaps.filter(({ actionable }) => actionable);
	return (
		<aside
			className="flex min-h-0 flex-col rounded-xl border border-border bg-card/50"
			aria-labelledby="attention-heading"
		>
			<div className="border-b border-border px-4 py-3">
				<div className="flex items-center justify-between gap-3">
					<h2 id="attention-heading" className="text-sm font-semibold">
						Attention
					</h2>
					<span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
						{actionable.length}
					</span>
				</div>
				<p className="mt-1 text-[11px] text-muted-foreground">
					Deterministic overlaps worth reviewing.
				</p>
			</div>
			<div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
				{actionable.length === 0 ? (
					<div className="flex min-h-40 flex-col items-center justify-center text-center">
						<ShieldCheck
							className="size-7 text-emerald-400"
							aria-hidden="true"
						/>
						<p className="mt-2 text-xs font-medium">No actionable overlaps</p>
						<p className="mt-1 text-[10px] text-muted-foreground">
							Current changes can proceed independently.
						</p>
					</div>
				) : (
					actionable.map((overlap) => (
						<article
							key={overlap.id}
							className="rounded-lg border border-border bg-background/60 p-3"
						>
							<div className="flex items-center justify-between gap-2">
								<RiskBadge risk={overlap.risk} />
								<span className="font-mono text-[9px] uppercase text-muted-foreground">
									{overlap.category}
								</span>
							</div>
							<p className="mt-2 text-xs font-medium leading-relaxed">
								{overlap.summary}
							</p>
							<p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
								{overlap.targets[0]?.path ?? overlap.reasonCode}
							</p>
							<div className="mt-3 flex gap-1">
								<Button
									type="button"
									size="sm"
									variant="ghost"
									className="h-7 px-2"
									onClick={() => onReview(overlap.id)}
								>
									<Search /> Review
								</Button>
								<Button
									type="button"
									size="sm"
									variant="outline"
									className="h-7 px-2"
									aria-label="Compare diff"
									onClick={() => onCompare(overlap.id)}
								>
									<GitCompareArrows /> Compare
								</Button>
							</div>
						</article>
					))
				)}
			</div>
		</aside>
	);
};
