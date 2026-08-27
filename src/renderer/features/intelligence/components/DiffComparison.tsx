import { ExternalLink, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { IntelligenceDiffComparisonDto } from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../../../components/ui/dialog";
import { cn } from "../../../lib/utils";

type Props = {
	overlapId: string | null;
	open: boolean;
	onClose: () => void;
	onOpenChat: (worktreeId: string, runId: string) => void;
};

const Patch = ({
	file,
}: {
	file: IntelligenceDiffComparisonDto["left"]["files"][number] | undefined;
}) => {
	if (!file)
		return (
			<p className="p-3 text-xs text-muted-foreground">
				File unchanged in this worktree
			</p>
		);
	if (file.binary)
		return (
			<p className="p-3 text-xs text-muted-foreground">Binary file changed</p>
		);
	if (!file.patch)
		return (
			<p className="p-3 text-xs text-muted-foreground">
				No textual patch stored
			</p>
		);
	return (
		<pre className="overflow-x-auto p-3 font-mono text-[10px] leading-5">
			{file.patch.split("\n").map((line, index) => (
				<span
					key={index}
					className={cn(
						"block",
						line.startsWith("+") && "bg-emerald-500/10 text-emerald-300",
						line.startsWith("-") && "bg-red-500/10 text-red-300",
					)}
				>
					{line || " "}
				</span>
			))}
		</pre>
	);
};

export const DiffComparison = ({
	overlapId,
	open,
	onClose,
	onOpenChat,
}: Props) => {
	const [comparison, setComparison] = useState<IntelligenceDiffComparisonDto>();
	const [error, setError] = useState<string>();
	const [selectedPath, setSelectedPath] = useState<string>();
	const leftPane = useRef<HTMLDivElement>(null);
	const rightPane = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open || !overlapId) return;
		let cancelled = false;
		setComparison(undefined);
		setError(undefined);
		void window.api.intelligence
			.compareDiffs({ overlapId })
			.then((value) => {
				if (!cancelled) {
					setComparison(value);
					setSelectedPath(value.left.files[0]?.path ?? value.right.files[0]?.path);
				}
			})
			.catch((cause: unknown) => {
				if (!cancelled)
					setError(cause instanceof Error ? cause.message : String(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [open, overlapId]);

	const paths = useMemo(() => {
		if (!comparison) return [];
		return Array.from(
			new Set([
				...comparison.left.files.map(({ path }) => path),
				...comparison.right.files.map(({ path }) => path),
			]),
		);
	}, [comparison]);

	const synchronize = (
		source: HTMLDivElement,
		target: HTMLDivElement | null,
	) => {
		if (!target) return;
		target.scrollTop = source.scrollTop;
		target.scrollLeft = source.scrollLeft;
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (!value) onClose();
			}}
			className="flex max-h-[88vh] max-w-6xl flex-col overflow-hidden p-0"
		>
			<DialogHeader className="shrink-0 px-5 py-4">
				<div className="flex items-start justify-between gap-4">
					<div>
						<DialogTitle>Diff comparison</DialogTitle>
						<DialogDescription className="mt-1">
							Two persisted worktree deltas against their merge base.
						</DialogDescription>
					</div>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="size-7"
						aria-label="Close diff comparison"
						onClick={onClose}
					>
						<X />
					</Button>
				</div>
			</DialogHeader>
			<div className="min-h-0 flex-1 overflow-auto p-4">
				{error ? (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				) : !comparison ? (
					<p className="text-sm text-muted-foreground">Loading patches…</p>
				) : (
					<div className="min-w-[720px]">
						<div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Changed files">
							{paths.map((path) => (
								<Button
									key={path}
									type="button"
									size="sm"
									variant={selectedPath === path ? "secondary" : "ghost"}
									className="h-7 shrink-0 px-2 font-mono text-[9px]"
									aria-label={`Select ${path}`}
									aria-selected={selectedPath === path}
									role="tab"
									onClick={() => setSelectedPath(path)}
								>
									{path}
								</Button>
							))}
						</div>
						<div className="grid grid-cols-2 gap-3">
							{[comparison.left, comparison.right].map((side) => {
								const file = side.files.find(({ path }) => path === selectedPath);
								return (
									<section
										key={side.worktreeId}
										className="min-w-0 overflow-hidden rounded-xl border border-white/[0.045] bg-background/55"
									>
										<header className="flex items-center justify-between px-3 py-2">
									<code className="text-[10px]">{side.worktreeId}</code>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										className="h-7 px-2"
										disabled={!side.runId}
										aria-label={`Open chat for ${side.worktreeId}`}
										onClick={() =>
											side.runId && onOpenChat(side.worktreeId, side.runId)
										}
									>
										<ExternalLink /> Chat
									</Button>
										</header>
										<div
									ref={side === comparison.left ? leftPane : rightPane}
									aria-label={side === comparison.left ? "Left diff pane" : "Right diff pane"}
									className="max-h-[58vh] overflow-auto border-t border-border"
									onScroll={(event) =>
										synchronize(
											event.currentTarget,
											side === comparison.left ? rightPane.current : leftPane.current,
										)
									}
										>
											<article>
										<div className="flex justify-between bg-muted/40 px-3 py-2 font-mono text-[10px]">
											<span>{selectedPath ?? "No file selected"}</span>
											{file ? (
												<span>
													<b className="text-emerald-400">+{file.additions}</b>{" "}
													<b className="text-red-400">−{file.deletions}</b>
												</span>
											) : null}
										</div>
										<Patch file={file} />
											</article>
										</div>
									</section>
								);
							})}
						</div>
					</div>
				)}
			</div>
		</Dialog>
	);
};
