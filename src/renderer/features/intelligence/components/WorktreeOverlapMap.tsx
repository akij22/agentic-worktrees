import { ChevronLeft, ChevronRight, Network } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
	IntelligenceOverlapDto,
	IntelligenceSnapshotDto,
} from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import { IntelligenceWorktreeNode } from "./IntelligenceWorktreeNode";

interface Props {
	snapshot: IntelligenceSnapshotDto;
	onOpenChat?: (worktreeId: string, runId: string) => void;
}

const PAGE_SIZE = 4;
const riskRank: Record<IntelligenceOverlapDto["risk"], number> = {
	high: 0,
	medium: 1,
	low: 2,
};
const coordinates = [
	{ x: 22, y: 26 },
	{ x: 78, y: 26 },
	{ x: 22, y: 74 },
	{ x: 78, y: 74 },
];
const lineStyle: Record<
	IntelligenceOverlapDto["risk"],
	{ className: string; dash?: string }
> = {
	high: { className: "stroke-red-400" },
	medium: { className: "stroke-amber-400", dash: "8 6" },
	low: { className: "stroke-sky-400", dash: "2 7" },
};

const highestRiskFor = (
	worktreeId: string,
	overlaps: IntelligenceOverlapDto[],
): IntelligenceOverlapDto["risk"] | undefined =>
	overlaps
		.filter(
			({ leftWorktreeId, rightWorktreeId }) =>
				leftWorktreeId === worktreeId || rightWorktreeId === worktreeId,
		)
		.sort((left, right) => riskRank[left.risk] - riskRank[right.risk])[0]?.risk;

export const WorktreeOverlapMap = ({ snapshot, onOpenChat }: Props) => {
	const worktrees = useMemo(
		() => [...snapshot.worktrees].sort((left, right) => left.worktreeId.localeCompare(right.worktreeId)),
		[snapshot.worktrees],
	);
	const pageCount = Math.max(1, Math.ceil(worktrees.length / PAGE_SIZE));
	const [page, setPage] = useState(0);

	useEffect(() => {
		setPage((current) => Math.min(current, pageCount - 1));
	}, [pageCount]);

	const visible = worktrees.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
	const visibleIds = new Set(visible.map(({ worktreeId }) => worktreeId));
	const visibleOverlaps = snapshot.overlaps.filter(
		({ leftWorktreeId, rightWorktreeId }) =>
			visibleIds.has(leftWorktreeId) && visibleIds.has(rightWorktreeId),
	);
	const visibleIndex = new Map(
		visible.map(({ worktreeId }, index) => [worktreeId, index]),
	);
	const taskById = new Map(
		snapshot.worktrees.map(({ worktreeId, task }) => [worktreeId, task]),
	);

	return (
		<section className="surface-panel overflow-hidden" aria-labelledby="overlap-map-heading">
			<header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-3">
				<div>
					<h2 id="overlap-map-heading" className="text-sm font-semibold">Worktree overlap map</h2>
					<p className="mt-0.5 text-[10px] text-muted-foreground">Deterministic Git, path, and symbol relationships</p>
				</div>
				{pageCount > 1 ? (
					<div className="flex items-center gap-1.5">
						<span className="font-mono text-[9px] text-muted-foreground">{page + 1} / {pageCount}</span>
						<Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Previous worktrees" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
							<ChevronLeft aria-hidden="true" />
						</Button>
						<Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Next worktrees" disabled={page === pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>
							<ChevronRight aria-hidden="true" />
						</Button>
					</div>
				) : null}
			</header>

			<div className="relative min-h-[35rem] overflow-auto p-4">
				<div className="relative mx-auto grid min-w-[42rem] max-w-5xl grid-cols-[minmax(15rem,1fr)_9rem_minmax(15rem,1fr)] grid-rows-2 gap-x-5 gap-y-16 py-5">
					<svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
						{visibleOverlaps.map((overlap) => {
							const leftIndex = visibleIndex.get(overlap.leftWorktreeId);
							const rightIndex = visibleIndex.get(overlap.rightWorktreeId);
							if (leftIndex === undefined || rightIndex === undefined) return null;
							const left = coordinates[leftIndex];
							const right = coordinates[rightIndex];
							const style = lineStyle[overlap.risk];
							return (
								<g key={overlap.id}>
									<line x1={left.x} y1={left.y} x2={right.x} y2={right.y} className={style.className} strokeWidth="0.45" strokeDasharray={style.dash} vectorEffect="non-scaling-stroke" />
									<text x={(left.x + right.x) / 2} y={(left.y + right.y) / 2 - 1.5} textAnchor="middle" className="fill-muted-foreground text-[2.4px] font-mono uppercase">{overlap.risk}</text>
								</g>
							);
						})}
					</svg>

					<div className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex size-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-primary/20 bg-background/95 text-center shadow-[0_0_50px_rgba(138,180,248,0.08)]">
						<Network className="size-5 text-primary" aria-hidden="true" />
						<strong className="mt-1 text-[10px]">Overlap engine</strong>
						<span className="mt-0.5 font-mono text-[8px] text-muted-foreground">LOCAL · DETERMINISTIC</span>
					</div>

					{visible.map((worktree, index) => {
						const placement = ["col-start-1 row-start-1", "col-start-3 row-start-1", "col-start-1 row-start-2", "col-start-3 row-start-2"][index];
						return (
							<IntelligenceWorktreeNode key={worktree.worktreeId} worktree={worktree} risk={highestRiskFor(worktree.worktreeId, visibleOverlaps)} onOpenChat={onOpenChat} className={`z-20 ${placement}`} />
						);
					})}
				</div>

				<ul className="sr-only" aria-label="Visible worktree relationships">
					{visibleOverlaps.map((overlap) => (
						<li key={overlap.id}>
							{`${overlap.risk[0].toUpperCase()}${overlap.risk.slice(1)} risk connection between ${taskById.get(overlap.leftWorktreeId) ?? overlap.leftWorktreeId} and ${taskById.get(overlap.rightWorktreeId) ?? overlap.rightWorktreeId}: ${overlap.summary}`}
						</li>
					))}
				</ul>
			</div>
		</section>
	);
};
