import { GitBranch, GitMerge, ShieldCheck, TriangleAlert } from "lucide-react";
import type { IntelligenceSnapshotDto } from "../../../../shared/ipc/schemas";

export const IntelligenceSummary = ({
	snapshot,
}: {
	snapshot: IntelligenceSnapshotDto;
}) => {
	const metrics = [
		{
			label: "Active worktrees",
			value: snapshot.worktrees.length,
			icon: GitBranch,
			tone: "text-foreground",
		},
		{
			label: "Relationships",
			value: snapshot.overlaps.length,
			icon: GitMerge,
			tone: "text-sky-400",
		},
		{
			label: "High risk",
			value: snapshot.overlaps.filter(({ risk }) => risk === "high").length,
			icon: TriangleAlert,
			tone: "text-red-400",
		},
		{
			label: "Independent",
			value: snapshot.worktrees.filter(({ independent }) => independent).length,
			icon: ShieldCheck,
			tone: "text-emerald-400",
		},
	];
	return (
		<section
			className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
			aria-label="Intelligence summary"
		>
			{metrics.map(({ label, value, icon: Icon, tone }) => (
				<article
					key={label}
					className="rounded-xl border border-border bg-card/50 px-4 py-3 shadow-sm"
				>
					<div className="flex items-center justify-between">
						<span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
							{label}
						</span>
						<Icon className={`size-3.5 ${tone}`} aria-hidden="true" />
					</div>
					<strong className={`mt-2 block font-mono text-2xl ${tone}`}>
						{value}
					</strong>
				</article>
			))}
		</section>
	);
};
