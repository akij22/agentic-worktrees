import { z } from "zod";
import type { Repository, Worktree } from "../db/schema";

export const githubAuthStateSchema = z.enum([
	"loading",
	"signed_out",
	"authorizing",
	"installation_required",
	"authenticated",
	"error",
]);

export const githubAuthProfileSchema = z.object({
	id: z.number().int(),
	login: z.string(),
	name: z.string().nullable(),
	avatarUrl: z.string().url(),
});

export const githubAuthErrorCodeSchema = z.enum([
	"network",
	"session_expired",
	"saml_required",
	"organization_approval_required",
	"insufficient_permissions",
	"publisher_configuration",
	"unknown",
]);

export type GitHubAuthErrorCode = z.infer<typeof githubAuthErrorCodeSchema>;

export const githubAuthStatusSchema = z.object({
	state: githubAuthStateSchema,
	profile: githubAuthProfileSchema.nullable(),
	installationCount: z.number().int().nonnegative(),
	persistent: z.boolean(),
	message: z.string().nullable().default(null),
	errorCode: githubAuthErrorCodeSchema.nullable().default(null),
	recoverable: z.boolean().default(false),
});

export type GitHubAuthStatusDto = z.infer<typeof githubAuthStatusSchema>;

export const githubDeviceChallengeSchema = z.object({
	userCode: z.string(),
	verificationUri: z.string().url(),
	expiresAt: z.number(),
});

export type GitHubDeviceChallengeDto = z.infer<
	typeof githubDeviceChallengeSchema
>;

export const githubListReposRequestSchema = z.object({
	refresh: z.boolean().optional().default(false),
});

export const githubListReposResponseSchema = z.array(z.custom<Repository>());

export const remoteRepositorySchema = z.object({
	githubRepoId: z.number().int(),
	ownerLogin: z.string(),
	name: z.string(),
	fullName: z.string(),
	defaultBranch: z.string().nullable(),
	isPrivate: z.boolean(),
	isArchived: z.boolean(),
	cloneUrl: z.string(),
	sshUrl: z.string().nullable(),
	htmlUrl: z.string(),
});

export type RemoteRepositoryDto = z.infer<typeof remoteRepositorySchema>;

export const githubListRemoteReposResponseSchema = z.array(
	remoteRepositorySchema,
);

export const repositoryImportRemoteRequestSchema = z.object({
	repositoryIds: z.array(z.number().int()).min(1),
});

export const githubListBranchesRequestSchema = z.object({
	repositoryId: z.string().min(1),
});

export const branchSchema = z.object({
	name: z.string(),
	protected: z.boolean(),
	headCommitSha: z.string().nullable(),
});

export type BranchDto = z.infer<typeof branchSchema>;

export const githubListBranchesResponseSchema = z.array(branchSchema);

export const repositoryImportLocalResponseSchema = z
	.custom<Repository>()
	.nullable();

export const createLocalBranchRequestSchema = z.object({
	repositoryId: z.string().min(1),
	branchName: z
		.string()
		.min(1)
		.regex(
			/^[a-zA-Z0-9._/-]+$/,
			'Branch name may only contain letters, numbers, ".", "/", and "-"',
		),
});

export const createLocalBranchResponseSchema = branchSchema;

export type CreateLocalBranchRequest = z.infer<
	typeof createLocalBranchRequestSchema
>;

export const worktreeCreateRequestSchema = z.object({
	repositoryId: z.string().min(1),
	baseBranch: z.string().min(1),
	newBranchName: z
		.string()
		.min(1)
		.regex(
			/^[a-zA-Z0-9._/-]+$/,
			'Branch name may only contain letters, numbers, ".", "/", and "-"',
		),
	worktreeName: z.string().min(1),
});

export const worktreeCreateResponseSchema = z.object({
	worktree: z.custom<Worktree>(),
	repository: z.custom<Repository>(),
});

export const worktreeListRequestSchema = z.object({
	repositoryId: z.string().min(1),
});

export const worktreeListResponseSchema = z.array(z.custom<Worktree>());

export const editorIdSchema = z.enum([
	"vscode",
	"cursor",
	"zed",
	"webstorm",
	"intellij-idea",
	"sublime-text",
	"android-studio",
]);

export type EditorId = z.infer<typeof editorIdSchema>;

export const availableEditorSchema = z.object({
	id: editorIdSchema,
	name: z.string(),
});

export type AvailableEditorDto = z.infer<typeof availableEditorSchema>;

export const editorOpenRequestSchema = z.object({
	editorId: editorIdSchema,
	worktreeId: z.string().trim().min(1),
});

export type EditorOpenRequest = z.infer<typeof editorOpenRequestSchema>;

const workspaceIdSchema = z.string().trim().min(1).max(256);
const workspaceRelativePathSchema = z
	.string()
	.max(4096)
	.refine(
		(value) => !/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(value),
		"Path must be relative to the worktree.",
	)
	.refine(
		(value) => !value.split(/[\\/]+/).includes(".."),
		"Path must stay inside the worktree.",
	);

export const workspaceDirectoryRequestSchema = z.object({
	worktreeId: workspaceIdSchema,
	relativePath: workspaceRelativePathSchema.default(""),
});

export const workspaceFileReadRequestSchema = z.object({
	worktreeId: workspaceIdSchema,
	relativePath: workspaceRelativePathSchema.min(1),
});

export const workspaceFileSearchRequestSchema = z.object({
	worktreeId: workspaceIdSchema,
	query: z.string().max(512),
	limit: z.number().int().min(1).max(100).default(20),
});

export const workspaceFileSearchResponseSchema = z.array(
	workspaceRelativePathSchema.min(1),
);

export type WorkspaceFileSearchResultDto = z.infer<
	typeof workspaceFileSearchResponseSchema
>;

export const workspaceEntrySchema = z.object({
	name: z.string(),
	relativePath: z.string(),
	kind: z.enum(["file", "directory"]),
	size: z.number().int().nonnegative().nullable(),
	hidden: z.boolean(),
});

export type WorkspaceEntryDto = z.infer<typeof workspaceEntrySchema>;

export const workspaceDirectoryResponseSchema = z.array(workspaceEntrySchema);

export const workspaceFilePreviewSchema = z.object({
	relativePath: z.string(),
	size: z.number().int().nonnegative(),
	kind: z.enum(["text", "empty", "binary", "too_large"]),
	content: z.string().optional(),
});

export type WorkspaceFilePreviewDto = z.infer<
	typeof workspaceFilePreviewSchema
>;

const workspaceTerminalIdentitySchema = z.object({
	worktreeId: workspaceIdSchema,
	terminalId: z.string().trim().min(1).max(256),
});

const terminalDimensionsSchema = z.object({
	cols: z.number().int().min(1).max(500),
	rows: z.number().int().min(1).max(300),
});

export const workspaceTerminalCreateRequestSchema = z
	.object({ worktreeId: workspaceIdSchema })
	.extend(terminalDimensionsSchema.shape);

export const workspaceTerminalCreateResponseSchema = z.object({
	terminalId: z.string().min(1),
});

export const workspaceTerminalWriteRequestSchema =
	workspaceTerminalIdentitySchema.extend({
		data: z.string().max(65_536),
	});

export const workspaceTerminalResizeRequestSchema =
	workspaceTerminalIdentitySchema.extend(terminalDimensionsSchema.shape);

export const workspaceTerminalRestartRequestSchema =
	workspaceTerminalIdentitySchema.extend(terminalDimensionsSchema.shape);

export const workspaceTerminalDisposeRequestSchema =
	workspaceTerminalIdentitySchema;

export const workspaceTerminalEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("data"),
		worktreeId: workspaceIdSchema,
		terminalId: z.string().min(1),
		data: z.string(),
	}),
	z.object({
		type: z.literal("exit"),
		worktreeId: workspaceIdSchema,
		terminalId: z.string().min(1),
		exitCode: z.number().int(),
	}),
	z.object({
		type: z.literal("error"),
		worktreeId: workspaceIdSchema,
		terminalId: z.string().min(1),
		message: z.string(),
	}),
]);

export type WorkspaceTerminalEventDto = z.infer<
	typeof workspaceTerminalEventSchema
>;

export const workspaceGitRequestSchema = z.object({
	worktreeId: workspaceIdSchema,
});

export const workspaceCommitRequestSchema = workspaceGitRequestSchema.extend({
	message: z.string().trim().min(1).max(10_000),
});

export const workspacePullRequestRequestSchema =
	workspaceGitRequestSchema.extend({
		title: z.string().trim().min(1).max(256),
		body: z.string().max(65_536),
		baseBranch: z.string().trim().min(1).max(256),
	});

export const workspaceGitStatusSchema = z.object({
	hasChanges: z.boolean(),
	hasOrigin: z.boolean(),
	hasUpstream: z.boolean(),
	ahead: z.number().int().nonnegative(),
	behind: z.number().int().nonnegative(),
	hasUnpushedCommits: z.boolean(),
	currentBranch: z.string(),
	baseBranch: z.string().nullable(),
	githubLinked: z.boolean(),
	pullRequestEligible: z.boolean(),
	suggestedPullRequestTitle: z.string(),
});

export type WorkspaceGitStatusDto = z.infer<typeof workspaceGitStatusSchema>;

export const workspacePullRequestResultSchema = z.object({
	number: z.number().int().positive(),
	url: z.string().url(),
});

export type WorkspacePullRequestResultDto = z.infer<
	typeof workspacePullRequestResultSchema
>;

export const codingAgentWorktreeContextSchema = z.object({
	worktree: z.custom<Worktree>(),
	repository: z.custom<Repository>(),
});

export type CodingAgentWorktreeContextDto = z.infer<
	typeof codingAgentWorktreeContextSchema
>;

export const codingAgentKindSchema = z.enum(["opencode", "codex"]);

export type CodingAgentKindDto = z.infer<typeof codingAgentKindSchema>;

export const codingAgentInstallationStatusSchema = z.object({
	kind: codingAgentKindSchema,
	name: z.string(),
	configured: z.boolean(),
	executablePath: z.string().nullable(),
	version: z.string().nullable(),
	running: z.boolean(),
	error: z.string().nullable(),
});

export type CodingAgentInstallationStatusDto = z.infer<
	typeof codingAgentInstallationStatusSchema
>;

export const codingAgentStatusSchema = z.object({
	installations: z.array(codingAgentInstallationStatusSchema),
});

export type CodingAgentStatusDto = z.infer<typeof codingAgentStatusSchema>;

export const codingAgentModelSchema = z.object({
	providerId: z.string(),
	providerName: z.string(),
	modelId: z.string(),
	modelName: z.string(),
	reasoningVariants: z.array(z.string()),
	isDefault: z.boolean(),
});

export type CodingAgentModelDto = z.infer<typeof codingAgentModelSchema>;

export const codingAgentSessionSchema = z.object({
	id: z.string(),
	agentKind: codingAgentKindSchema,
	agentName: z.string(),
	worktreeId: z.string(),
	repositoryId: z.string(),
	title: z.string(),
	status: z.string(),
	errorMessage: z.string().nullable(),
	hasUnviewedChanges: z.boolean(),
	providerId: z.string(),
	modelId: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export type CodingAgentSessionDto = z.infer<typeof codingAgentSessionSchema>;

export const codingAgentMessageSchema = z.object({
	id: z.string(),
	role: z.enum(["user", "assistant"]),
	content: z.string(),
	reasoning: z.string(),
	createdAt: z.number(),
	completedAt: z.number().nullable(),
});

export type CodingAgentMessageDto = z.infer<typeof codingAgentMessageSchema>;

export const codingAgentDiffSchema = z.object({
	file: z.string(),
	before: z.string(),
	after: z.string(),
	additions: z.number(),
	deletions: z.number(),
});

export type CodingAgentDiffDto = z.infer<typeof codingAgentDiffSchema>;

export const codingAgentSessionSnapshotSchema = z.object({
	session: codingAgentSessionSchema,
	context: codingAgentWorktreeContextSchema,
	messages: z.array(codingAgentMessageSchema),
	diff: z.array(codingAgentDiffSchema),
	turnDiff: z.array(codingAgentDiffSchema),
});

export type CodingAgentSessionSnapshotDto = z.infer<
	typeof codingAgentSessionSnapshotSchema
>;

export const codingAgentSessionUsageSchema = z.object({
	contextTokens: z.number().nonnegative(),
	contextWindow: z.number().positive(),
	contextPercentage: z.number().min(0).max(100),
	totalCost: z.number().nonnegative().optional(),
	providerId: z.string(),
	modelId: z.string(),
});

export type CodingAgentSessionUsageDto = z.infer<
	typeof codingAgentSessionUsageSchema
>;

export const codingAgentModelsRequestSchema = z.object({
	runId: z.string().trim().min(1),
});

export const codingAgentSessionListRequestSchema = z
	.object({ worktreeId: z.string().min(1).optional() })
	.optional()
	.default({});

export const codingAgentSessionCreateRequestSchema = z.object({
	agentKind: codingAgentKindSchema,
	worktreeId: z.string().trim().min(1),
	title: z.string().trim().min(1).max(160),
});

export const codingAgentSelectExecutableRequestSchema = z.object({
	agentKind: codingAgentKindSchema,
});

export const codingAgentSessionModelUpdateSchema = z.object({
	runId: z.string().min(1),
	providerId: z.string().min(1),
	modelId: z.string().min(1),
});

export const codingAgentSessionGetRequestSchema = z.object({
	runId: z.string().min(1),
});

export const codingAgentSessionViewedRequestSchema = z.object({
	runId: z.string().trim().min(1),
});

export const codingAgentSessionUsageRequestSchema = z.object({
	runId: z.string().min(1),
});

export const codingAgentSessionSendRequestSchema = z.object({
	runId: z.string().min(1),
	content: z.string().trim().min(1).max(100_000),
	reasoningVariant: z.string().trim().min(1).max(80).optional(),
});

export const codingAgentSessionAbortRequestSchema = z.object({
	runId: z.string().min(1),
});

export const codingAgentSessionCompactRequestSchema = z.object({
	runId: z.string().min(1),
});

export const codingAgentPermissionResponseSchema = z.object({
	runId: z.string().min(1),
	permissionId: z.string().min(1),
	response: z.enum(["once", "always", "reject"]),
});

export const codingAgentUiEventSchema = z.object({
	runId: z.string().nullable(),
	type: z.string(),
	payload: z.unknown(),
});

export type CodingAgentUiEventDto = z.infer<typeof codingAgentUiEventSchema>;

export const intelligenceRiskSchema = z.enum(["low", "medium", "high"]);
export const intelligenceTargetTypeSchema = z.enum([
	"folder",
	"module",
	"file",
	"symbol",
]);

export const intelligenceRepositoryRequestSchema = z.object({
	repositoryId: z.string().trim().min(1),
});

export const intelligenceOverlapRequestSchema = z.object({
	overlapId: z.string().trim().min(1),
});

export const intelligenceDiffComparisonRequestSchema =
	intelligenceOverlapRequestSchema.extend({
		targetId: z.string().trim().min(1).optional(),
	});

export const intelligenceFileSummarySchema = z.object({
	path: z.string().min(1),
	modulePath: z.string(),
	additions: z.number().int().nonnegative(),
	deletions: z.number().int().nonnegative(),
	symbols: z.array(z.string()),
});

export const intelligenceWorktreeSchema = z.object({
	worktreeId: z.string().min(1),
	runId: z.string().min(1).nullable(),
	task: z.string(),
	branch: z.string(),
	baseBranch: z.string().nullable(),
	agentKind: codingAgentKindSchema.nullable(),
	agentName: z.string().nullable(),
	status: z.string(),
	changedFileCount: z.number().int().nonnegative(),
	additions: z.number().int().nonnegative(),
	deletions: z.number().int().nonnegative(),
	files: z.array(intelligenceFileSummarySchema),
	independent: z.boolean(),
	warning: z.string().nullable(),
	updatedAt: z.number().int().nonnegative(),
});

export const intelligenceOverlapTargetSchema = z.object({
	id: z.string().min(1).optional(),
	type: intelligenceTargetTypeSchema,
	path: z.string(),
	symbol: z.string().nullable(),
	leftFilePath: z.string().nullable(),
	rightFilePath: z.string().nullable(),
	reasonCode: z.string(),
	risk: intelligenceRiskSchema,
});

export const intelligenceOverlapSchema = z.object({
	id: z.string().min(1),
	leftWorktreeId: z.string().min(1),
	rightWorktreeId: z.string().min(1),
	risk: intelligenceRiskSchema,
	category: intelligenceTargetTypeSchema,
	reasonCode: z.string(),
	summary: z.string(),
	actionable: z.boolean(),
	targets: z.array(intelligenceOverlapTargetSchema),
});

export const intelligenceSnapshotSchema = z.object({
	id: z.string().min(1),
	repositoryId: z.string().min(1),
	startedAt: z.number().int().nonnegative(),
	completedAt: z.number().int().nonnegative(),
	stale: z.boolean(),
	refreshError: z.string().nullable(),
	warnings: z.array(z.string()),
	worktrees: z.array(intelligenceWorktreeSchema),
	overlaps: z.array(intelligenceOverlapSchema),
});

export const intelligenceOverlapDetailsSchema = z.object({
	overlap: intelligenceOverlapSchema,
	left: intelligenceWorktreeSchema,
	right: intelligenceWorktreeSchema,
});

export const intelligenceDiffFileSchema = z.object({
	path: z.string().min(1),
	modulePath: z.string(),
	additions: z.number().int().nonnegative(),
	deletions: z.number().int().nonnegative(),
	patch: z.string().nullable(),
	binary: z.boolean(),
});

export const intelligenceDiffSideSchema = z.object({
	worktreeId: z.string().min(1),
	runId: z.string().min(1).nullable(),
	files: z.array(intelligenceDiffFileSchema),
});

export const intelligenceDiffComparisonSchema = z.object({
	overlapId: z.string().min(1),
	left: intelligenceDiffSideSchema,
	right: intelligenceDiffSideSchema,
});

export const conflictPrepareRequestSchema = z.object({
	overlapId: z.string().trim().min(1),
	targetBranch: z
		.string()
		.trim()
		.min(1)
		.max(255)
		.refine(
			(value) =>
				!value.startsWith("-") &&
				!value.includes("..") &&
				!value.includes("@{") &&
				!/[\\~^:?*[\s]/.test(value),
			"Invalid target branch name.",
		),
});

export const conflictSessionRequestSchema = z.object({
	sessionId: z.string().trim().min(1),
});

export const conflictSessionListRequestSchema =
	intelligenceRepositoryRequestSchema.extend({
		overlapId: z.string().trim().min(1).optional(),
	});

export const conflictIntegrationOpenRequestSchema =
	conflictSessionRequestSchema.extend({
		editorId: editorIdSchema,
	});

export const conflictResolutionStateSchema = z.enum([
	"requested",
	"capturing",
	"simulating",
	"preparing_sandbox",
	"safe",
	"review_required",
	"conflict",
	"failed",
]);

export const conflictClassificationSchema = z.enum([
	"safe",
	"review_required",
	"conflict",
]);

const conflictRangeSchema = z.object({
	oldStart: z.number().int().nonnegative(),
	oldLines: z.number().int().nonnegative(),
	newStart: z.number().int().nonnegative(),
	newLines: z.number().int().nonnegative(),
});

const conflictGitStageSchema = z.object({
	stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
	mode: z.string(),
	objectId: z.string(),
	path: z.string(),
});

export const conflictParticipantSchema = z.object({
	side: z.enum(["left", "right"]),
	worktreeId: z.string(),
	runId: z.string().nullable(),
	task: z.string(),
	agentName: z.string().nullable(),
	branch: z.string(),
	originalHeadSha: z.string(),
	mergeBaseSha: z.string(),
	syntheticCommitSha: z.string(),
	syntheticRef: z.string(),
	statusFingerprintBefore: z.string(),
	statusFingerprintAfter: z.string(),
});

export const conflictFileEvidenceSchema = z.object({
	path: z.string(),
	kind: z.enum(["semantic_overlap", "git_conflict"]),
	risk: intelligenceRiskSchema,
	reasonCode: z.string(),
	leftPath: z.string().nullable(),
	rightPath: z.string().nullable(),
	symbol: z.string().nullable(),
	staticRanges: z.array(conflictRangeSchema),
	gitStages: z.array(conflictGitStageSchema),
	markerRanges: z.array(conflictRangeSchema),
});

export const conflictOperationSchema = z.object({
	id: z.string(),
	sequence: z.number().int().positive(),
	stage: conflictResolutionStateSchema,
	kind: z.string(),
	commandSummary: z.string().nullable(),
	status: z.enum(["running", "succeeded", "failed"]),
	startedAt: z.number().int().nonnegative(),
	completedAt: z.number().int().nonnegative().nullable(),
	outputSummary: z.string().nullable(),
	errorMessage: z.string().nullable(),
});

export const conflictResolutionSessionSchema = z.object({
	id: z.string().min(1),
	repositoryId: z.string().min(1),
	snapshotId: z.string().min(1),
	overlapId: z.string().min(1),
	targetBranch: z.string().min(1),
	targetCommitSha: z.string().nullable(),
	state: conflictResolutionStateSchema,
	classification: conflictClassificationSchema.nullable(),
	currentStage: z.string(),
	integrationBranch: z.string().nullable(),
	integrationPath: z.string().nullable(),
	retained: z.boolean(),
	cleanupPending: z.boolean(),
	errorMessage: z.string().nullable(),
	participants: z.array(conflictParticipantSchema),
	files: z.array(conflictFileEvidenceSchema),
	operations: z.array(conflictOperationSchema),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
	completedAt: z.number().int().nonnegative().nullable(),
});

export const conflictResolutionSessionEventSchema = z.object({
	sessionId: z.string().min(1),
	repositoryId: z.string().min(1),
	state: conflictResolutionStateSchema,
	updatedAt: z.number().int().nonnegative(),
});

export const intelligenceSnapshotEventSchema = z.object({
	repositoryId: z.string().min(1),
	snapshotId: z.string().min(1),
	completedAt: z.number().int().nonnegative(),
});

export type IntelligenceSnapshotDto = z.infer<
	typeof intelligenceSnapshotSchema
>;
export type IntelligenceWorktreeDto = z.infer<
	typeof intelligenceWorktreeSchema
>;
export type IntelligenceOverlapDto = z.infer<typeof intelligenceOverlapSchema>;
export type IntelligenceOverlapDetailsDto = z.infer<
	typeof intelligenceOverlapDetailsSchema
>;
export type IntelligenceDiffComparisonDto = z.infer<
	typeof intelligenceDiffComparisonSchema
>;
export type IntelligenceSnapshotEventDto = z.infer<
	typeof intelligenceSnapshotEventSchema
>;
export type ConflictResolutionSessionDto = z.infer<
	typeof conflictResolutionSessionSchema
>;
export type ConflictResolutionSessionEventDto = z.infer<
	typeof conflictResolutionSessionEventSchema
>;
export type ConflictPrepareRequest = z.infer<
	typeof conflictPrepareRequestSchema
>;
export type ConflictSessionRequest = z.infer<
	typeof conflictSessionRequestSchema
>;
export type ConflictSessionListRequest = z.infer<
	typeof conflictSessionListRequestSchema
>;
export type ConflictIntegrationOpenRequest = z.infer<
	typeof conflictIntegrationOpenRequestSchema
>;

export type GithubListReposRequest = z.infer<
	typeof githubListReposRequestSchema
>;
export type RepositoryImportRemoteRequest = z.infer<
	typeof repositoryImportRemoteRequestSchema
>;
export type GithubListBranchesRequest = z.infer<
	typeof githubListBranchesRequestSchema
>;
export type WorktreeCreateRequest = z.infer<typeof worktreeCreateRequestSchema>;
export type WorktreeCreateResponse = z.infer<
	typeof worktreeCreateResponseSchema
>;
export type WorktreeListRequest = z.infer<typeof worktreeListRequestSchema>;
