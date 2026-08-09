import { Bot, Code2, FileCode2, Info } from "lucide-react";
import type {
	IntelligenceOverlapDto,
	IntelligenceWorktreeDto,
} from "../../../../shared/ipc/schemas";
import { RiskBadge } from "./RiskBadge";

type Props = {
	overlap: IntelligenceOverlapDto;
	left: IntelligenceWorktreeDto;
	right: IntelligenceWorktreeDto;
};

const titleCase = (value: string): string => {
	const words = value.replaceAll("-", " ");
	return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

const modifies = (
	worktree: IntelligenceWorktreeDto,
	path: string | null,
	fallback: string,
): boolean => worktree.files.some((file) => file.path === (path ?? fallback));

export const ConflictDetails = ({ overlap, left, right }: Props) => {
	const symbols = Array.from(
		new Set([
			...overlap.targets.flatMap(({ symbol }) => (symbol ? [symbol] : [])),
			...left.files.flatMap(({ symbols: names }) => names),
			...right.files.flatMap(({ symbols: names }) => names),
		]),
	);
	return (
		<section
			className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/80 bg-card/35"
			aria-labelledby="conflict-details-heading"
		>
			<header className="flex h-12 shrink-0 items-center justify-between border-b border-border/80 px-4">
				<h2 id="conflict-details-heading" className="text-sm font-semibold">
					Conflict details
				</h2>
				<RiskBadge risk={overlap.risk} />
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
					<span className="text-muted-foreground">Main conflict reason</span>
					<strong className="font-medium">
						{titleCase(overlap.reasonCode)}
					</strong>
					<span className="text-muted-foreground">Overlap category</span>
					<strong className="font-medium">{titleCase(overlap.category)}</strong>
					<span className="text-muted-foreground">Risk level</span>
					<div className="flex items-center gap-2">
						<RiskBadge risk={overlap.risk} />
						<span>
							{overlap.actionable ? "Requires review" : "Review before merge"}
						</span>
					</div>
					<span className="text-muted-foreground">Evidence source</span>
					<strong className="font-medium">
						Local Git delta and source analysis
					</strong>
				</div>

				<div>
					<h3 className="mb-2 flex items-center gap-2 text-xs font-semibold">
						<FileCode2 className="size-4" />
						Files involved
					</h3>
					<div className="overflow-hidden rounded-lg border border-border/80">
						<div className="grid grid-cols-[minmax(10rem,1.5fr)_minmax(6rem,0.7fr)_minmax(6rem,0.7fr)_minmax(7rem,0.75fr)] gap-2 bg-muted/30 px-3 py-2 font-mono text-[8px] uppercase tracking-wide text-muted-foreground">
							<span>File path</span>
							<span>{left.task}</span>
							<span>{right.task}</span>
							<span>Overlap type</span>
						</div>
						{overlap.targets.map((target, index) => {
							const leftModified = modifies(
								left,
								target.leftFilePath,
								target.path,
							);
							const rightModified = modifies(
								right,
								target.rightFilePath,
								target.path,
							);
							return (
								<div
									key={target.id ?? `${target.path}-${index}`}
									className="grid grid-cols-[minmax(10rem,1.5fr)_minmax(6rem,0.7fr)_minmax(6rem,0.7fr)_minmax(7rem,0.75fr)] items-center gap-2 border-t border-border/70 px-3 py-2.5 text-[10px] first:border-t-0"
								>
									<code className="truncate" title={target.path}>
										{target.path}
									</code>
									<span
										className={
											leftModified
												? "text-emerald-400"
												: "text-muted-foreground"
										}
									>
										{leftModified ? "● Modified" : "—"}
									</span>
									<span
										className={
											rightModified
												? "text-emerald-400"
												: "text-muted-foreground"
										}
									>
										{rightModified ? "● Modified" : "—"}
									</span>
									<span className="w-fit rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[8px] uppercase">
										{titleCase(target.type)}
									</span>
								</div>
							);
						})}
					</div>
				</div>

				{symbols.length > 0 ? (
					<div className="rounded-lg border border-border/80 bg-background/20 p-3">
						<h3 className="flex items-center gap-2 text-xs font-semibold">
							<Code2 className="size-4" />
							Shared symbols / functions
						</h3>
						<ul className="mt-2 grid gap-2 sm:grid-cols-2">
							{symbols.map((symbol) => (
								<li
									key={symbol}
									className="rounded border border-border/60 px-2.5 py-2 font-mono text-[10px]"
								>
									{symbol}
								</li>
							))}
						</ul>
					</div>
				) : null}
			</div>
			<footer className="flex shrink-0 items-center gap-2 border-t border-border/80 bg-blue-500/[0.04] px-4 py-3 text-[10px] text-blue-300">
				<Info className="size-3.5" /> Exact file and symbol overlaps can
				conflict during merge.
			</footer>
		</section>
	);
};
