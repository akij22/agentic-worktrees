import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const repositories = sqliteTable(
	"repositories",
	{
		id: text("id").primaryKey(),
		githubRepoId: integer("github_repo_id").notNull(),
		ownerLogin: text("owner_login").notNull(),
		name: text("name").notNull(),
		fullName: text("full_name").notNull(),
		defaultBranch: text("default_branch"),
		isPrivate: integer("is_private", { mode: "boolean" }).notNull(),
		isArchived: integer("is_archived", { mode: "boolean" })
			.notNull()
			.default(false),
		cloneUrl: text("clone_url").notNull(),
		sshUrl: text("ssh_url"),
		htmlUrl: text("html_url").notNull(),
		localRootPath: text("local_root_path"),
		localCloneStatus: text("local_clone_status").notNull(),
		lastLocalScanAt: integer("last_local_scan_at", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
		lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
	},
	(table) => ({
		githubRepoIdUnique: uniqueIndex("repositories_github_repo_id_unique").on(
			table.githubRepoId,
		),
		fullNameUnique: uniqueIndex("repositories_full_name_unique").on(
			table.fullName,
		),
		localRootPathUnique: uniqueIndex("repositories_local_root_path_unique").on(
			table.localRootPath,
		),
	}),
);

export const worktreeKinds = ["primary", "linked"] as const;
export type WorktreeKind = (typeof worktreeKinds)[number];

export const worktrees = sqliteTable(
	"worktrees",
	{
		id: text("id").primaryKey(),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "restrict" }),
		name: text("name").notNull(),
		path: text("path").notNull(),
		branchName: text("branch_name").notNull(),
		kind: text("kind").$type<WorktreeKind>().notNull().default("linked"),
		baseBranchName: text("base_branch_name"),
		headCommitSha: text("head_commit_sha"),
		status: text("status").notNull(),
		activeRunId: text("active_run_id"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
		lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
	},
	(table) => ({
		pathUnique: uniqueIndex("worktrees_path_unique").on(table.path),
		repositoryIdIdx: index("worktrees_repository_id_idx").on(
			table.repositoryId,
		),
	}),
);

export const runs = sqliteTable(
	"runs",
	{
		id: text("id").primaryKey(),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "restrict" }),
		worktreeId: text("worktree_id")
			.notNull()
			.references(() => worktrees.id, { onDelete: "restrict" }),
		title: text("title").notNull(),
		prompt: text("prompt").notNull(),
		status: text("status").notNull(),
		pid: integer("pid"),
		command: text("command"),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
		exitCode: integer("exit_code"),
		errorMessage: text("error_message"),
		outputStatus: text("output_status").notNull().default("idle"),
		lastOutputAt: integer("last_output_at", { mode: "timestamp_ms" }),
		lastSequence: integer("last_sequence").notNull().default(0),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => ({
		repositoryIdIdx: index("runs_repository_id_idx").on(table.repositoryId),
		worktreeIdIdx: index("runs_worktree_id_idx").on(table.worktreeId),
		statusIdx: index("runs_status_idx").on(table.status),
	}),
);

export const runOutputEvents = sqliteTable(
	"run_output_events",
	{
		id: text("id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => runs.id, { onDelete: "cascade" }),
		sequence: integer("sequence").notNull(),
		eventType: text("event_type").notNull(),
		stream: text("stream"),
		payload: text("payload").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => ({
		runSequenceUnique: uniqueIndex("run_output_events_run_sequence_unique").on(
			table.runId,
			table.sequence,
		),
		runSequenceIdx: index("run_output_events_run_sequence_idx").on(
			table.runId,
			table.sequence,
		),
	}),
);

export const runMessages = sqliteTable(
	"run_messages",
	{
		id: text("id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => runs.id, { onDelete: "cascade" }),
		role: text("role").notNull(),
		messageType: text("message_type").notNull(),
		content: text("content").notNull(),
		sequence: integer("sequence").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
	},
	(table) => ({
		runSequenceUnique: uniqueIndex("run_messages_run_sequence_unique").on(
			table.runId,
			table.sequence,
		),
		runSequenceIdx: index("run_messages_run_sequence_idx").on(
			table.runId,
			table.sequence,
		),
	}),
);

export const codingAgentInstallations = sqliteTable(
	"coding_agent_installations",
	{
		id: text("id").primaryKey(),
		kind: text("kind").notNull(),
		name: text("name").notNull(),
		executablePath: text("executable_path").notNull(),
		version: text("version").notNull(),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		lastVerifiedAt: integer("last_verified_at", {
			mode: "timestamp_ms",
		}).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => ({
		kindUnique: uniqueIndex("coding_agent_installations_kind_unique").on(
			table.kind,
		),
	}),
);

export const codingAgentSessions = sqliteTable(
	"coding_agent_sessions",
	{
		runId: text("run_id")
			.primaryKey()
			.references(() => runs.id, { onDelete: "cascade" }),
		installationId: text("installation_id")
			.notNull()
			.references(() => codingAgentInstallations.id, { onDelete: "restrict" }),
		externalSessionId: text("external_session_id").notNull(),
		providerId: text("provider_id").notNull(),
		modelId: text("model_id").notNull(),
		lastViewedAt: integer("last_viewed_at", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => ({
		externalSessionIdUnique: uniqueIndex(
			"coding_agent_sessions_external_session_id_unique",
		).on(table.externalSessionId),
		installationIdIdx: index("coding_agent_sessions_installation_id_idx").on(
			table.installationId,
		),
	}),
);

export const codingAgentSessionDiffs = sqliteTable(
	"coding_agent_session_diffs",
	{
		id: text("id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => runs.id, { onDelete: "cascade" }),
		file: text("file").notNull(),
		before: text("before").notNull(),
		after: text("after").notNull(),
		additions: integer("additions").notNull(),
		deletions: integer("deletions").notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => ({
		runIdIdx: index("coding_agent_session_diffs_run_id_idx").on(table.runId),
		runFileUnique: uniqueIndex("coding_agent_session_diffs_run_file_unique").on(
			table.runId,
			table.file,
		),
	}),
);

export const capabilityInstallations = sqliteTable("capability_installations", {
	capabilityId: text("capability_id").primaryKey(),
	version: text("version").notNull(),
	permissionDigest: text("permission_digest").notNull(),
	configured: integer("configured", { mode: "boolean" }).notNull().default(false),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const capabilitySettings = sqliteTable(
	"capability_settings",
	{
		id: text("id").primaryKey(),
		capabilityId: text("capability_id").notNull().references(() => capabilityInstallations.capabilityId, { onDelete: "cascade" }),
		key: text("key").notNull(),
		valueJson: text("value_json"),
		secretRef: text("secret_ref"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => ({
		capabilityKeyUnique: uniqueIndex("capability_settings_capability_key_unique").on(table.capabilityId, table.key),
		capabilityIdIdx: index("capability_settings_capability_id_idx").on(table.capabilityId),
	}),
);

export const sessionCapabilities = sqliteTable(
	"session_capabilities",
	{
		id: text("id").primaryKey(),
		runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
		capabilityId: text("capability_id").notNull(),
		version: text("version").notNull(),
		status: text("status").notNull(),
		errorCode: text("error_code"),
		activatedAt: integer("activated_at", { mode: "timestamp_ms" }),
		deactivatedAt: integer("deactivated_at", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => ({
		runCapabilityUnique: uniqueIndex("session_capabilities_run_capability_unique").on(table.runId, table.capabilityId),
		runIdIdx: index("session_capabilities_run_id_idx").on(table.runId),
		statusIdx: index("session_capabilities_status_idx").on(table.status),
	}),
);

export const skillInstallations = sqliteTable(
	"skill_installations",
	{
		skillId: text("skill_id").primaryKey(),
		version: text("version").notNull(),
		sourceKind: text("source_kind").notNull(),
		sourceRef: text("source_ref").notNull(),
		contentDigest: text("content_digest").notNull(),
		name: text("name").notNull(),
		description: text("description").notNull(),
		license: text("license"),
		codexCompatibility: text("codex_compatibility").notNull(),
		opencodeCompatibility: text("opencode_compatibility").notNull(),
		automaticInvocation: integer("automatic_invocation", { mode: "boolean" }).notNull(),
		state: text("state").notNull(),
		errorCode: text("error_code"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => ({ stateIdx: index("skill_installations_state_idx").on(table.state) }),
);

export const skillInvocations = sqliteTable(
	"skill_invocations",
	{
		id: text("id").primaryKey(),
		runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
		skillId: text("skill_id").notNull(),
		version: text("version").notNull(),
		mode: text("mode").notNull(),
		status: text("status").notNull(),
		errorCode: text("error_code"),
		requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull(),
		loadedAt: integer("loaded_at", { mode: "timestamp_ms" }),
		failedAt: integer("failed_at", { mode: "timestamp_ms" }),
	},
	(table) => ({
		runIdIdx: index("skill_invocations_run_id_idx").on(table.runId),
		skillIdIdx: index("skill_invocations_skill_id_idx").on(table.skillId),
	}),
);

export const intelligenceSnapshots = sqliteTable(
	"intelligence_snapshots",
	{
		id: text("id").primaryKey(),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		status: text("status").notNull(),
		startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }).notNull(),
		sourceMetadata: text("source_metadata").notNull(),
		warnings: text("warnings").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => ({
		repositoryIdUnique: uniqueIndex(
			"intelligence_snapshots_repository_id_unique",
		).on(table.repositoryId),
	}),
);

export const intelligenceWorktrees = sqliteTable(
	"intelligence_worktrees",
	{
		id: text("id").primaryKey(),
		snapshotId: text("snapshot_id")
			.notNull()
			.references(() => intelligenceSnapshots.id, { onDelete: "cascade" }),
		worktreeId: text("worktree_id")
			.notNull()
			.references(() => worktrees.id, { onDelete: "restrict" }),
		runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
		agentKind: text("agent_kind"),
		agentName: text("agent_name"),
		agentStatus: text("agent_status").notNull(),
		task: text("task").notNull(),
		branch: text("branch").notNull(),
		baseBranch: text("base_branch"),
		additions: integer("additions").notNull(),
		deletions: integer("deletions").notNull(),
		changedFileCount: integer("changed_file_count").notNull(),
		independent: integer("independent", { mode: "boolean" }).notNull(),
		warning: text("warning"),
		activityUpdatedAt: integer("activity_updated_at", {
			mode: "timestamp_ms",
		}).notNull(),
	},
	(table) => ({
		snapshotWorktreeUnique: uniqueIndex(
			"intelligence_worktrees_snapshot_worktree_unique",
		).on(table.snapshotId, table.worktreeId),
		snapshotIdIdx: index("intelligence_worktrees_snapshot_id_idx").on(
			table.snapshotId,
		),
	}),
);

export const intelligenceChangedFiles = sqliteTable(
	"intelligence_changed_files",
	{
		id: text("id").primaryKey(),
		intelligenceWorktreeId: text("intelligence_worktree_id")
			.notNull()
			.references(() => intelligenceWorktrees.id, { onDelete: "cascade" }),
		path: text("path").notNull(),
		previousPath: text("previous_path"),
		changeType: text("change_type").notNull(),
		folderPath: text("folder_path").notNull(),
		modulePath: text("module_path").notNull(),
		additions: integer("additions").notNull(),
		deletions: integer("deletions").notNull(),
		ranges: text("ranges").notNull(),
		patch: text("patch"),
		binary: integer("binary", { mode: "boolean" }).notNull(),
		fingerprint: text("fingerprint").notNull(),
	},
	(table) => ({
		worktreePathUnique: uniqueIndex(
			"intelligence_changed_files_worktree_path_unique",
		).on(table.intelligenceWorktreeId, table.path),
		worktreeIdIdx: index("intelligence_changed_files_worktree_id_idx").on(
			table.intelligenceWorktreeId,
		),
	}),
);

export const intelligenceChangedSymbols = sqliteTable(
	"intelligence_changed_symbols",
	{
		id: text("id").primaryKey(),
		changedFileId: text("changed_file_id")
			.notNull()
			.references(() => intelligenceChangedFiles.id, { onDelete: "cascade" }),
		kind: text("kind").notNull(),
		name: text("name").notNull(),
		qualifiedName: text("qualified_name").notNull(),
		declarationStart: integer("declaration_start").notNull(),
		declarationEnd: integer("declaration_end").notNull(),
		changedStart: integer("changed_start").notNull(),
		changedEnd: integer("changed_end").notNull(),
	},
	(table) => ({
		fileSymbolUnique: uniqueIndex(
			"intelligence_changed_symbols_file_symbol_unique",
		).on(
			table.changedFileId,
			table.qualifiedName,
			table.declarationStart,
			table.declarationEnd,
		),
		changedFileIdIdx: index(
			"intelligence_changed_symbols_changed_file_id_idx",
		).on(table.changedFileId),
	}),
);

export const intelligenceOverlaps = sqliteTable(
	"intelligence_overlaps",
	{
		id: text("id").primaryKey(),
		snapshotId: text("snapshot_id")
			.notNull()
			.references(() => intelligenceSnapshots.id, { onDelete: "cascade" }),
		leftIntelligenceWorktreeId: text("left_intelligence_worktree_id")
			.notNull()
			.references(() => intelligenceWorktrees.id, { onDelete: "cascade" }),
		rightIntelligenceWorktreeId: text("right_intelligence_worktree_id")
			.notNull()
			.references(() => intelligenceWorktrees.id, { onDelete: "cascade" }),
		risk: text("risk").notNull(),
		category: text("category").notNull(),
		reasonCode: text("reason_code").notNull(),
		summary: text("summary").notNull(),
		actionable: integer("actionable", { mode: "boolean" }).notNull(),
		sortOrder: integer("sort_order").notNull(),
	},
	(table) => ({
		snapshotPairUnique: uniqueIndex(
			"intelligence_overlaps_snapshot_pair_unique",
		).on(
			table.snapshotId,
			table.leftIntelligenceWorktreeId,
			table.rightIntelligenceWorktreeId,
		),
		snapshotIdIdx: index("intelligence_overlaps_snapshot_id_idx").on(
			table.snapshotId,
		),
	}),
);

export const intelligenceOverlapTargets = sqliteTable(
	"intelligence_overlap_targets",
	{
		id: text("id").primaryKey(),
		overlapId: text("overlap_id")
			.notNull()
			.references(() => intelligenceOverlaps.id, { onDelete: "cascade" }),
		targetType: text("target_type").notNull(),
		path: text("path").notNull(),
		symbol: text("symbol"),
		leftChangedFileId: text("left_changed_file_id").references(
			() => intelligenceChangedFiles.id,
			{ onDelete: "cascade" },
		),
		rightChangedFileId: text("right_changed_file_id").references(
			() => intelligenceChangedFiles.id,
			{ onDelete: "cascade" },
		),
		reasonCode: text("reason_code").notNull(),
		risk: text("risk").notNull(),
		sortOrder: integer("sort_order").notNull(),
	},
	(table) => ({
		overlapTargetUnique: uniqueIndex(
			"intelligence_overlap_targets_overlap_target_unique",
		).on(table.overlapId, table.targetType, table.path, table.symbol),
		overlapIdIdx: index("intelligence_overlap_targets_overlap_id_idx").on(
			table.overlapId,
		),
	}),
);

export const conflictResolutionSessions = sqliteTable(
	"conflict_resolution_sessions",
	{
		id: text("id").primaryKey(),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "restrict" }),
		snapshotId: text("snapshot_id").notNull(),
		overlapId: text("overlap_id").notNull(),
		targetBranch: text("target_branch").notNull(),
		targetCommitSha: text("target_commit_sha"),
		state: text("state").notNull(),
		classification: text("classification"),
		currentStage: text("current_stage").notNull(),
		integrationBranch: text("integration_branch"),
		integrationPath: text("integration_path"),
		retained: integer("retained", { mode: "boolean" }).notNull(),
		cleanupPending: integer("cleanup_pending", { mode: "boolean" }).notNull(),
		errorMessage: text("error_message"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
	},
	(table) => ({
		repositoryUpdatedIdx: index(
			"conflict_resolution_sessions_repository_updated_idx",
		).on(table.repositoryId, table.updatedAt),
		overlapUpdatedIdx: index(
			"conflict_resolution_sessions_overlap_updated_idx",
		).on(table.overlapId, table.updatedAt),
		activeTupleIdx: index("conflict_resolution_sessions_active_tuple_idx").on(
			table.repositoryId,
			table.overlapId,
			table.targetBranch,
			table.state,
		),
	}),
);

export const conflictResolutionParticipants = sqliteTable(
	"conflict_resolution_participants",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => conflictResolutionSessions.id, { onDelete: "cascade" }),
		side: text("side").notNull(),
		sortOrder: integer("sort_order").notNull(),
		worktreeId: text("worktree_id").notNull(),
		runId: text("run_id"),
		task: text("task").notNull(),
		agentName: text("agent_name"),
		branch: text("branch").notNull(),
		originalHeadSha: text("original_head_sha").notNull(),
		mergeBaseSha: text("merge_base_sha").notNull(),
		syntheticCommitSha: text("synthetic_commit_sha").notNull(),
		syntheticRef: text("synthetic_ref").notNull(),
		statusFingerprintBefore: text("status_fingerprint_before").notNull(),
		statusFingerprintAfter: text("status_fingerprint_after").notNull(),
	},
	(table) => ({
		sessionSideUnique: uniqueIndex(
			"conflict_resolution_participants_session_side_unique",
		).on(table.sessionId, table.side),
		sessionIdIdx: index("conflict_resolution_participants_session_id_idx").on(
			table.sessionId,
		),
	}),
);

export const conflictResolutionFiles = sqliteTable(
	"conflict_resolution_files",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => conflictResolutionSessions.id, { onDelete: "cascade" }),
		path: text("path").notNull(),
		kind: text("kind").notNull(),
		risk: text("risk").notNull(),
		reasonCode: text("reason_code").notNull(),
		leftPath: text("left_path"),
		rightPath: text("right_path"),
		symbol: text("symbol"),
		staticRanges: text("static_ranges").notNull(),
		gitStages: text("git_stages").notNull(),
		markerRanges: text("marker_ranges").notNull(),
		sortOrder: integer("sort_order").notNull(),
	},
	(table) => ({
		sessionPathUnique: uniqueIndex(
			"conflict_resolution_files_session_path_unique",
		).on(table.sessionId, table.path),
		sessionIdIdx: index("conflict_resolution_files_session_id_idx").on(
			table.sessionId,
		),
	}),
);

export const conflictResolutionOperations = sqliteTable(
	"conflict_resolution_operations",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => conflictResolutionSessions.id, { onDelete: "cascade" }),
		sequence: integer("sequence").notNull(),
		stage: text("stage").notNull(),
		kind: text("kind").notNull(),
		commandSummary: text("command_summary"),
		status: text("status").notNull(),
		startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		outputSummary: text("output_summary"),
		errorMessage: text("error_message"),
	},
	(table) => ({
		sessionSequenceUnique: uniqueIndex(
			"conflict_resolution_operations_session_sequence_unique",
		).on(table.sessionId, table.sequence),
		sessionIdIdx: index("conflict_resolution_operations_session_id_idx").on(
			table.sessionId,
		),
	}),
);

export type Repository = typeof repositories.$inferSelect;
export type Worktree = typeof worktrees.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunOutputEvent = typeof runOutputEvents.$inferSelect;
export type RunMessage = typeof runMessages.$inferSelect;
export type CodingAgentInstallation =
	typeof codingAgentInstallations.$inferSelect;
export type CodingAgentSession = typeof codingAgentSessions.$inferSelect;
export type CodingAgentSessionDiff =
	typeof codingAgentSessionDiffs.$inferSelect;
export type CapabilityInstallation = typeof capabilityInstallations.$inferSelect;
export type CapabilitySettingRecord = typeof capabilitySettings.$inferSelect;
export type SessionCapability = typeof sessionCapabilities.$inferSelect;
export type IntelligenceSnapshot = typeof intelligenceSnapshots.$inferSelect;
export type IntelligenceWorktree = typeof intelligenceWorktrees.$inferSelect;
export type IntelligenceChangedFile =
	typeof intelligenceChangedFiles.$inferSelect;
export type IntelligenceChangedSymbol =
	typeof intelligenceChangedSymbols.$inferSelect;
export type IntelligenceOverlap = typeof intelligenceOverlaps.$inferSelect;
export type IntelligenceOverlapTarget =
	typeof intelligenceOverlapTargets.$inferSelect;
export type ConflictResolutionSession =
	typeof conflictResolutionSessions.$inferSelect;
export type ConflictResolutionParticipant =
	typeof conflictResolutionParticipants.$inferSelect;
export type ConflictResolutionFile =
	typeof conflictResolutionFiles.$inferSelect;
export type ConflictResolutionOperation =
	typeof conflictResolutionOperations.$inferSelect;
