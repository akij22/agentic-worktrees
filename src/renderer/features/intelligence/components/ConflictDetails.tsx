import { Bot, Info } from "lucide-react";
import type {
	ConflictResolutionSessionDto,
	IntelligenceOverlapDto,
	IntelligenceWorktreeDto,
} from "../../../../shared/ipc/schemas";
import { ConflictFileEvidence } from "./ConflictFileEvidence";
import { RiskBadge } from "./RiskBadge";
import { conflictPresentation } from "./conflict-view-model";

type Props = {
	overlap: IntelligenceOverlapDto;
	left: IntelligenceWorktreeDto;
	right: IntelligenceWorktreeDto;
	session?: ConflictResolutionSessionDto;
};

const titleCase = (value: string): string => {
	const words = value.replaceAll("-", " ");
	return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

export const ConflictDetails = ({ overlap, left, right, session }: Props) => {
	const presentation = conflictPresentation(overlap, session);
	return (
		<section
			className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/80 bg-card/35"
			aria-labelledby="conflict-details-heading"
		>
			<header className="flex h-12 shrink-0 items-center justify-between border-b border-border/80 px-4">
				<h2 id="conflict-details-heading" className="text-sm font-semibold">
					Conflict details
				</h2>
				<div className="flex items-center gap-2">
					<span className="font-mono text-[8px] uppercase text-muted-foreground">
						{presentation.confirmation}
					</span>
					<RiskBadge risk={overlap.risk} />
				</div>
			</header>
			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
				<div>
					<h3 className="flex items-center gap-3 text-xl font-semibold tracking-tight">
						<span className="flex items-center gap-2">
							<Bot className="size-5 text-muted-foreground" />
							{left.task}
						</span>
						<span className="text-red-400">↔</span>
						<span className="flex items-center gap-2">
							<Bot className="size-5 text-muted-foreground" />
							{right.task}
						</span>
					</h3>
					<p className="mt-2 text-xs text-muted-foreground">
						{overlap.summary}
					</p>
				</div>

				<div className="grid gap-x-5 gap-y-2 rounded-lg border border-border/80 bg-background/25 p-3 text-[11px] sm:grid-cols-[9rem_1fr]">
					<span className="text-muted-foreground">Finding</span>
					<strong className="font-medium">
						{presentation.label} · {presentation.confirmation}
					</strong>
					<span className="text-muted-foreground">Static reason</span>
					<strong className="font-medium">
						{titleCase(overlap.reasonCode)}
					</strong>
					<span className="text-muted-foreground">Overlap category</span>
					<strong className="font-medium">{titleCase(overlap.category)}</strong>
					<span className="text-muted-foreground">Git result</span>
					<strong className="font-medium">
						{session?.currentStage ?? "Not simulated"}
					</strong>
					<span className="text-muted-foreground">Evidence source</span>
					<strong className="font-medium">
						Local Git delta, source analysis
						{session ? ", and merge simulation" : ""}
					</strong>
				</div>

				<ConflictFileEvidence
					overlap={overlap}
					session={session}
					leftTask={left.task}
					rightTask={right.task}
				/>
			</div>
			<footer className="flex shrink-0 items-center gap-2 border-t border-border/80 bg-blue-500/[0.04] px-4 py-3 text-[10px] text-blue-300">
				<Info className="size-3.5" /> Static predictions are not confirmed until
				Git simulation completes.
			</footer>
		</section>
	);
};
