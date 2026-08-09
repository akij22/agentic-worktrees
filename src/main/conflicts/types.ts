import type { ChangedRange, OverlapTarget } from "../intelligence/types";

export type ConflictResolutionState =
	| "requested"
	| "capturing"
	| "simulating"
	| "preparing_sandbox"
	| "safe"
	| "review_required"
	| "conflict"
	| "failed";

export type ConflictClassification = "safe" | "review_required" | "conflict";
export type ConflictParticipantSide = "left" | "right";
export type ConflictFileKind = "semantic_overlap" | "git_conflict";
export type ConflictOperationStatus = "running" | "succeeded" | "failed";

export interface GitConflictStage {
	stage: 1 | 2 | 3;
	mode: string;
	objectId: string;
	path: string;
}

export interface GitConflictFile {
	path: string;
	stages: GitConflictStage[];
	markerRanges: ChangedRange[];
}

export type MergeSimulationResult =
	| { kind: "clean"; files: []; mergeCommitSha?: string }
	| { kind: "conflict"; files: GitConflictFile[] };

export interface SyntheticParticipant {
	side: ConflictParticipantSide;
	worktreeId: string;
	runId: string | null;
	task: string;
	agentName: string | null;
	branch: string;
	originalHeadSha: string;
	mergeBaseSha: string;
	syntheticCommitSha: string;
	syntheticRef: string;
	statusFingerprintBefore: string;
	statusFingerprintAfter: string;
}

export interface PreparedConflictFile {
	path: string;
	kind: ConflictFileKind;
	risk: "low" | "medium" | "high";
	reasonCode: string;
	leftPath: string | null;
	rightPath: string | null;
	symbol: string | null;
	staticRanges: ChangedRange[];
	gitStages: GitConflictStage[];
	markerRanges: ChangedRange[];
}

export interface ConflictResolutionOperation {
	id: string;
	sequence: number;
	stage: ConflictResolutionState;
	kind: string;
	commandSummary: string | null;
	status: ConflictOperationStatus;
	startedAt: number;
	completedAt: number | null;
	outputSummary: string | null;
	errorMessage: string | null;
}

export interface PreparedConflictSession {
	id: string;
	repositoryId: string;
	snapshotId: string;
	overlapId: string;
	targetBranch: string;
	targetCommitSha: string | null;
	state: ConflictResolutionState;
	classification: ConflictClassification | null;
	currentStage: string;
	integrationBranch: string | null;
	integrationPath: string | null;
	retained: boolean;
	cleanupPending: boolean;
	errorMessage: string | null;
	participants: SyntheticParticipant[];
	files: PreparedConflictFile[];
	operations: ConflictResolutionOperation[];
	createdAt: number;
	updatedAt: number;
	completedAt: number | null;
}

export interface ClassifyConfirmedConflictInput {
	git: MergeSimulationResult;
	targets: OverlapTarget[];
}
