import {
	GitMerge,
	LoaderCircle,
	MonitorUp,
	ShieldCheck,
	TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
	AvailableEditorDto,
	BranchDto,
	ConflictResolutionSessionDto,
	EditorId,
} from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";

interface Props {
	branches: BranchDto[];
	targetBranch: string;
	selectTargetBranch: (branch: string) => void;
	session: ConflictResolutionSessionDto | undefined;
	loading: boolean;
	preparing: boolean;
	error: string | undefined;
	onPrepare: () => void;
}

const transient = new Set([
	"requested",
	"capturing",
	"simulating",
	"preparing_sandbox",
]);

export const ConflictPreparation = ({
	branches,
	targetBranch,
	selectTargetBranch,
	session,
	loading,
	preparing,
	error,
	onPrepare,
}: Props) => {
	const [editors, setEditors] = useState<AvailableEditorDto[]>([]);
	const [editorId, setEditorId] = useState<EditorId>();
	const [editorError, setEditorError] = useState<string>();
	const retained = Boolean(session?.retained && session.integrationPath);

	useEffect(() => {
		if (!retained) return;
		let cancelled = false;
		void window.api.editors
			.listAvailable()
			.then((values) => {
				if (cancelled) return;
				setEditors(values);
				setEditorId((current) => current ?? values[0]?.id);
			})
			.catch((cause: unknown) => {
				if (!cancelled)
					setEditorError(
						cause instanceof Error ? cause.message : String(cause),
					);
			});
		return () => {
			cancelled = true;
		};
	}, [retained]);

	const openIntegration = async () => {
		if (!session || !editorId) return;
		setEditorError(undefined);
		try {
			await window.api.intelligence.openIntegrationWorktree({
				sessionId: session.id,
				editorId,
			});
		} catch (cause) {
			setEditorError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	return (
		<section
			className="rounded-xl bg-background/35 p-3"
			aria-labelledby="prepare-conflict-heading"
		>
			<div className="flex items-start justify-between gap-3">
				<div>
					<h3
						id="prepare-conflict-heading"
						className="flex items-center gap-2 text-xs font-semibold"
					>
						<GitMerge className="size-3.5" /> Git confirmation
					</h3>
					<p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
						Simulates both complete deltas without modifying the original
						worktrees.
					</p>
				</div>
				{session?.classification ? (
					<span
						className={`rounded-full bg-muted/70 px-2 py-0.5 font-mono text-[8px] uppercase ${
							session.classification === "conflict"
								? "text-red-400"
								: session.classification === "review_required"
									? "text-amber-400"
									: "text-emerald-400"
						}`}
					>
						{session.classification.replaceAll("_", " ")}
					</span>
				) : null}
			</div>

			{session && transient.has(session.state) ? (
				<div
					className="mt-3 flex items-center gap-2 rounded-xl bg-blue-500/[0.08] px-3 py-2 text-[10px] text-blue-300"
					role="status"
				>
					<LoaderCircle className="size-3.5 animate-spin" />{" "}
					{session.currentStage}
				</div>
			) : session?.state === "safe" ? (
				<div className="mt-3 flex items-center gap-2 text-[10px] text-emerald-400">
					<ShieldCheck className="size-3.5" /> Git proved this pair
					auto-mergeable.
				</div>
			) : session?.state === "failed" ? (
				<div
					className="mt-3 flex items-start gap-2 rounded-xl bg-error-surface px-3 py-2 text-[10px] text-error-foreground"
					role="alert"
				>
					<TriangleAlert className="mt-0.5 size-3.5" />
					<span>{session.errorMessage ?? "Preparation failed."}</span>
				</div>
			) : null}

			{retained && session ? (
				<div className="mt-3 space-y-2">
					<p
						className="truncate font-mono text-[8px] text-muted-foreground"
						title={session.integrationPath ?? undefined}
					>
						{session.integrationBranch}
					</p>
					<div className="flex gap-2">
						<label className="sr-only" htmlFor="integration-editor">
							Editor
						</label>
						<select
							id="integration-editor"
							value={editorId ?? ""}
							onChange={(event) => setEditorId(event.target.value as EditorId)}
							className="h-8 min-w-0 flex-1 rounded-xl border border-transparent bg-muted/65 px-2 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							{editors.map((editor) => (
								<option key={editor.id} value={editor.id}>
									{editor.name}
								</option>
							))}
						</select>
						<Button
							type="button"
							size="sm"
							disabled={!editorId}
							onClick={() => void openIntegration()}
						>
							<MonitorUp /> Open Integration Worktree
						</Button>
					</div>
				</div>
			) : !session || session.state === "failed" ? (
				<div className="mt-3 space-y-2">
					<label
						htmlFor="conflict-target-branch"
						className="font-mono text-[8px] uppercase text-muted-foreground"
					>
						Target branch
					</label>
					<select
						id="conflict-target-branch"
						aria-label="Target branch"
						value={targetBranch}
						onChange={(event) => selectTargetBranch(event.target.value)}
						disabled={loading || preparing || branches.length === 0}
						className="h-8 w-full rounded-xl border border-transparent bg-muted/65 px-2 font-mono text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						{branches.length === 0 ? (
							<option value="">No branches available</option>
						) : (
							branches.map((branch) => (
								<option key={branch.name} value={branch.name}>
									{branch.name}
								</option>
							))
						)}
					</select>
					<Button
						type="button"
						className="w-full"
						size="sm"
						disabled={!targetBranch || loading || preparing}
						onClick={onPrepare}
					>
						{preparing ? (
							<LoaderCircle className="animate-spin" />
						) : (
							<GitMerge />
						)}{" "}
						Confirm with Git
					</Button>
				</div>
			) : null}
			{error || editorError ? (
				<p className="mt-2 text-[9px] text-destructive" role="alert">
					{error ?? editorError}
				</p>
			) : null}
		</section>
	);
};
