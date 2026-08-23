import {
	GitBranch,
	ShieldCheck,
	ShieldAlert,
	TriangleAlert,
} from "lucide-react";
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
			valueTone: "text-foreground",
			iconTone: "bg-blue-500/10 text-blue-400",
		},
		{
			label: "High-risk conflicts",
			value: snapshot.overlaps.filter(({ risk }) => risk === "high").length,
			icon: ShieldAlert,
			valueTone: "text-red-400",
			iconTone: "bg-red-500/10 text-red-400",
		},
		{
			label: "Medium overlaps",
			value: snapshot.overlaps.filter(({ risk }) => risk === "medium").length,
			icon: TriangleAlert,
			valueTone: "text-amber-400",
			iconTone: "bg-amber-500/10 text-amber-400",
		},
		{
			label: "Independent worktrees",
			value: snapshot.worktrees.filter(({ independent }) => independent).length,
			icon: ShieldCheck,
			valueTone: "text-emerald-400",
			iconTone: "bg-emerald-500/10 text-emerald-400",
		},
	];
	return (
		<section
			className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
			aria-label="Conflict summary"
		>
			{metrics.map(({ label, value, icon: Icon, valueTone, iconTone }) => (
				<article
					key={label}
					className="surface-panel flex min-h-20 items-center gap-4 px-4 py-3"
				>
					<div
						className={`flex size-11 shrink-0 items-center justify-center rounded-full ${iconTone}`}
					>
						<Icon className="size-5" aria-hidden="true" />
					</div>
					<div>
						<strong
							className={`block font-mono text-2xl leading-none ${valueTone}`}
						>
							{value}
						</strong>
						<span className="mt-1 block text-xs text-muted-foreground">
							{label}
						</span>
					</div>
				</article>
			))}
		</section>
	);
};
