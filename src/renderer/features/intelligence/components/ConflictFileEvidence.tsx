import { Code2, FileWarning } from "lucide-react";
import type {
	ConflictResolutionSessionDto,
	IntelligenceOverlapDto,
} from "../../../../shared/ipc/schemas";

interface Props {
	overlap: IntelligenceOverlapDto;
	session: ConflictResolutionSessionDto | undefined;
	leftTask: string;
	rightTask: string;
}

const rangeLabel = (start: number, lines: number): string =>
	lines <= 1 ? `Line ${start}` : `Lines ${start}–${start + lines - 1}`;

export const ConflictFileEvidence = ({
	overlap,
	session,
	leftTask,
	rightTask,
}: Props) => {
	const files = session?.files.length
		? session.files
		: overlap.targets.map((target) => ({
			path: target.path,
			kind: "semantic_overlap" as const,
			risk: target.risk,
			reasonCode: target.reasonCode,
			leftPath: target.leftFilePath,
			rightPath: target.rightFilePath,
			symbol: target.symbol,
			staticRanges: [],
			gitStages: [],
			markerRanges: [],
		}));

	return (
		<section aria-labelledby="conflict-files-heading">
			<div className="mb-2 flex items-center justify-between gap-3">
				<h3 id="conflict-files-heading" className="flex items-center gap-2 text-xs font-semibold">
					<FileWarning className="size-4" /> Affected files
				</h3>
				<span className="font-mono text-[8px] uppercase text-muted-foreground">
					{session?.classification === "conflict" ? "Git confirmed" : session?.classification === "review_required" ? "Git mergeable · review" : "Not confirmed"}
				</span>
			</div>
			<div className="overflow-hidden rounded-lg border border-border/80">
				<div className="grid grid-cols-[minmax(10rem,1.5fr)_minmax(6rem,0.7fr)_minmax(6rem,0.7fr)_minmax(8rem,0.8fr)] gap-2 bg-muted/30 px-3 py-2 font-mono text-[8px] uppercase tracking-wide text-muted-foreground">
					<span>File</span><span>{leftTask}</span><span>{rightTask}</span><span>Evidence</span>
				</div>
				{files.map((file, index) => (
					<article key={`${file.path}-${index}`} className="border-t border-border/70 px-3 py-2.5 first:border-t-0">
						<div className="grid grid-cols-[minmax(10rem,1.5fr)_minmax(6rem,0.7fr)_minmax(6rem,0.7fr)_minmax(8rem,0.8fr)] items-center gap-2 text-[10px]">
							<code className="truncate" title={file.path}>{file.path}</code>
							<span className={file.leftPath ? "text-emerald-400" : "text-muted-foreground"}>{file.leftPath ? "● Modified" : "—"}</span>
							<span className={file.rightPath ? "text-emerald-400" : "text-muted-foreground"}>{file.rightPath ? "● Modified" : "—"}</span>
							<span className={`w-fit rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase ${file.kind === "git_conflict" ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-amber-500/30 bg-amber-500/10 text-amber-400"}`}>
								{file.kind === "git_conflict" ? "Git conflict" : file.reasonCode.replaceAll("-", " ")}
							</span>
						</div>
						{file.symbol || file.gitStages.length > 0 || file.markerRanges.length > 0 ? (
							<div className="mt-2 flex flex-wrap gap-2 border-t border-border/50 pt-2 font-mono text-[8px] text-muted-foreground">
								{file.symbol ? <span className="flex items-center gap-1"><Code2 className="size-3" />{file.symbol}</span> : null}
								{file.gitStages.length > 0 ? <span>Stages {file.gitStages.map(({ stage }) => stage).join(", ")}</span> : null}
								{file.markerRanges.map((range, rangeIndex) => <span key={rangeIndex}>{rangeLabel(range.newStart, range.newLines)}</span>)}
							</div>
						) : null}
					</article>
				))}
			</div>
		</section>
	);
};
