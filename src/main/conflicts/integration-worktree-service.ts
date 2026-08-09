import type { OverlapTarget } from "../intelligence/types";
import { classifyConfirmedConflict } from "./conflict-classifier";
import type {
	ConflictClassification,
	ConflictParticipantSide,
	PreparedConflictFile,
	SyntheticParticipant,
} from "./types";
import type {
	IntegrationGitAdapter,
	IntegrationWorktreeResult,
	SyntheticSnapshotResult,
} from "./integration-git-adapter";

export interface IntegrationParticipantInput {
	side: ConflictParticipantSide;
	repositoryId: string;
	worktreeId: string;
	runId: string | null;
	task: string;
	agentName: string | null;
	branch: string;
	path: string;
}

export interface IntegrationPreparationInput {
	sessionId: string;
	repository: { id: string; path: string };
	targetBranch: string;
	participants: readonly [
		IntegrationParticipantInput,
		IntegrationParticipantInput,
	];
	targets: OverlapTarget[];
	onStage?: (
		stage: "capturing" | "simulating" | "preparing_sandbox",
		label: string,
	) => void;
}

export interface IntegrationPreparationResult {
	targetCommitSha: string;
	classification: ConflictClassification;
	participants: SyntheticParticipant[];
	files: PreparedConflictFile[];
	integrationBranch: string | null;
	integrationPath: string | null;
	retained: boolean;
	cleanupPending: boolean;
}

export interface IntegrationWorktreeService {
	prepare(
		input: IntegrationPreparationInput,
	): Promise<IntegrationPreparationResult>;
}

const riskRank = { low: 0, medium: 1, high: 2 } as const;

const semanticFiles = (targets: OverlapTarget[]): PreparedConflictFile[] => {
	const byPath = new Map<string, PreparedConflictFile>();
	for (const target of targets) {
		const existing = byPath.get(target.path);
		if (existing && riskRank[existing.risk] >= riskRank[target.risk]) continue;
		byPath.set(target.path, {
			path: target.path,
			kind: "semantic_overlap",
			risk: target.risk,
			reasonCode: target.reasonCode,
			leftPath: target.leftFilePath,
			rightPath: target.rightFilePath,
			symbol: target.symbol,
			staticRanges: [],
			gitStages: [],
			markerRanges: [],
		});
	}
	return [...byPath.values()].sort((left, right) =>
		left.path.localeCompare(right.path),
	);
};

const mergeFiles = (
	targets: OverlapTarget[],
	gitFiles: Extract<
		Awaited<ReturnType<IntegrationGitAdapter["mergeSynthetic"]>>,
		{ kind: "conflict" }
	>["files"],
): PreparedConflictFile[] => {
	const files = new Map(
		semanticFiles(targets).map((file) => [file.path, file]),
	);
	for (const conflict of gitFiles) {
		const semantic = files.get(conflict.path);
		files.set(conflict.path, {
			path: conflict.path,
			kind: "git_conflict",
			risk: "high",
			reasonCode: "git-merge-conflict",
			leftPath: semantic?.leftPath ?? conflict.path,
			rightPath: semantic?.rightPath ?? conflict.path,
			symbol: semantic?.symbol ?? null,
			staticRanges: semantic?.staticRanges ?? [],
			gitStages: conflict.stages,
			markerRanges: conflict.markerRanges,
		});
	}
	return [...files.values()].sort((left, right) =>
		left.kind === right.kind
			? left.path.localeCompare(right.path)
			: left.kind === "git_conflict"
				? -1
				: 1,
	);
};

const participant = (
	input: IntegrationParticipantInput,
	snapshot: SyntheticSnapshotResult,
): SyntheticParticipant => ({
	side: input.side,
	worktreeId: input.worktreeId,
	runId: input.runId,
	task: input.task,
	agentName: input.agentName,
	branch: input.branch,
	...snapshot,
});

export const createIntegrationWorktreeService = ({
	git,
}: {
	git: IntegrationGitAdapter;
}): IntegrationWorktreeService => ({
	async prepare(input) {
		if (
			input.participants.some(
				({ repositoryId }) => repositoryId !== input.repository.id,
			)
		) {
			throw new Error(
				"Integration participants must belong to the same repository.",
			);
		}
		if (
			input.participants[0].side !== "left" ||
			input.participants[1].side !== "right"
		) {
			throw new Error(
				"Integration participants must be ordered left then right.",
			);
		}

		const snapshots: Array<{
			input: IntegrationParticipantInput;
			value: SyntheticSnapshotResult;
		}> = [];
		let integration: IntegrationWorktreeResult | null = null;
		try {
			const targetCommitSha = await git.resolveRef(
				input.repository.path,
				input.targetBranch,
			);
			input.onStage?.("capturing", "Capturing complete worktree deltas");
			for (const item of input.participants) {
				const value = await git.createSyntheticSnapshot({
					repositoryPath: input.repository.path,
					worktreePath: item.path,
					targetCommitSha,
					sessionId: input.sessionId,
					side: item.side,
				});
				if (value.statusFingerprintBefore !== value.statusFingerprintAfter) {
					throw new Error(
						`Original ${item.side} worktree changed during capture.`,
					);
				}
				snapshots.push({ input: item, value });
			}

			const [leftSnapshot, rightSnapshot] = snapshots;
			if (!leftSnapshot || !rightSnapshot) {
				throw new Error("Both synthetic participant snapshots are required.");
			}
			input.onStage?.("simulating", "Simulating merge with Git");
			integration = await git.createIntegrationWorktree({
				repositoryPath: input.repository.path,
				targetCommitSha,
				sessionId: input.sessionId,
			});
			let gitResult = await git.mergeSynthetic(
				integration.path,
				leftSnapshot.value.syntheticRef,
			);
			if (gitResult.kind === "clean") {
				gitResult = await git.mergeSynthetic(
					integration.path,
					rightSnapshot.value.syntheticRef,
				);
			}
			const classification = classifyConfirmedConflict({
				git: gitResult,
				targets: input.targets,
			});
			const retained = classification !== "safe";
			const files =
				gitResult.kind === "conflict"
					? mergeFiles(input.targets, gitResult.files)
					: semanticFiles(input.targets);

			if (!retained) {
				await git.removeIntegrationWorktree({
					repositoryPath: input.repository.path,
					path: integration.path,
					branch: integration.branch,
				});
				for (const snapshot of snapshots) {
					await git.deleteSyntheticRef(
						input.repository.path,
						snapshot.value.syntheticRef,
					);
				}
				integration = null;
			} else {
				input.onStage?.(
					"preparing_sandbox",
					"Preparing isolated integration sandbox",
				);
			}

			return {
				targetCommitSha,
				classification,
				participants: snapshots.map(({ input: item, value }) =>
					participant(item, value),
				),
				files,
				integrationBranch: integration?.branch ?? null,
				integrationPath: integration?.path ?? null,
				retained,
				cleanupPending: false,
			};
		} catch (error) {
			const cleanup: Promise<unknown>[] = [];
			if (integration) {
				cleanup.push(
					git.removeIntegrationWorktree({
						repositoryPath: input.repository.path,
						path: integration.path,
						branch: integration.branch,
					}),
				);
			}
			for (const snapshot of snapshots) {
				cleanup.push(
					git.deleteSyntheticRef(
						input.repository.path,
						snapshot.value.syntheticRef,
					),
				);
			}
			await Promise.allSettled(cleanup);
			throw error;
		}
	},
});
