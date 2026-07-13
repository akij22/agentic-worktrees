import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const repositories = sqliteTable(
  'repositories',
  {
    id: text('id').primaryKey(),
    githubRepoId: integer('github_repo_id').notNull(),
    ownerLogin: text('owner_login').notNull(),
    name: text('name').notNull(),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch'),
    isPrivate: integer('is_private', { mode: 'boolean' }).notNull(),
    isArchived: integer('is_archived', { mode: 'boolean' })
      .notNull()
      .default(false),
    cloneUrl: text('clone_url').notNull(),
    sshUrl: text('ssh_url'),
    htmlUrl: text('html_url').notNull(),
    localRootPath: text('local_root_path'),
    localCloneStatus: text('local_clone_status').notNull(),
    lastLocalScanAt: integer('last_local_scan_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
  },
  (table) => ({
    githubRepoIdUnique: uniqueIndex('repositories_github_repo_id_unique').on(
      table.githubRepoId,
    ),
    fullNameUnique: uniqueIndex('repositories_full_name_unique').on(
      table.fullName,
    ),
    localRootPathUnique: uniqueIndex('repositories_local_root_path_unique').on(
      table.localRootPath,
    ),
  }),
);

export const worktrees = sqliteTable(
  'worktrees',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    path: text('path').notNull(),
    branchName: text('branch_name').notNull(),
    baseBranchName: text('base_branch_name'),
    headCommitSha: text('head_commit_sha'),
    status: text('status').notNull(),
    activeRunId: text('active_run_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
  },
  (table) => ({
    pathUnique: uniqueIndex('worktrees_path_unique').on(table.path),
    repositoryIdIdx: index('worktrees_repository_id_idx').on(table.repositoryId),
  }),
);

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'restrict' }),
    worktreeId: text('worktree_id')
      .notNull()
      .references(() => worktrees.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    prompt: text('prompt').notNull(),
    status: text('status').notNull(),
    pid: integer('pid'),
    command: text('command'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    exitCode: integer('exit_code'),
    errorMessage: text('error_message'),
    outputStatus: text('output_status').notNull().default('idle'),
    lastOutputAt: integer('last_output_at', { mode: 'timestamp_ms' }),
    lastSequence: integer('last_sequence').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    repositoryIdIdx: index('runs_repository_id_idx').on(table.repositoryId),
    worktreeIdIdx: index('runs_worktree_id_idx').on(table.worktreeId),
    statusIdx: index('runs_status_idx').on(table.status),
  }),
);

export const runOutputEvents = sqliteTable(
  'run_output_events',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    eventType: text('event_type').notNull(),
    stream: text('stream'),
    payload: text('payload').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    runSequenceUnique: uniqueIndex('run_output_events_run_sequence_unique').on(
      table.runId,
      table.sequence,
    ),
    runSequenceIdx: index('run_output_events_run_sequence_idx').on(
      table.runId,
      table.sequence,
    ),
  }),
);

export const runMessages = sqliteTable(
  'run_messages',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    messageType: text('message_type').notNull(),
    content: text('content').notNull(),
    sequence: integer('sequence').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  },
  (table) => ({
    runSequenceUnique: uniqueIndex('run_messages_run_sequence_unique').on(
      table.runId,
      table.sequence,
    ),
    runSequenceIdx: index('run_messages_run_sequence_idx').on(
      table.runId,
      table.sequence,
    ),
  }),
);

export const codingAgentInstallations = sqliteTable(
  'coding_agent_installations',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    executablePath: text('executable_path').notNull(),
    version: text('version').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    lastVerifiedAt: integer('last_verified_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    kindUnique: uniqueIndex('coding_agent_installations_kind_unique').on(
      table.kind,
    ),
  }),
);

export const codingAgentSessions = sqliteTable(
  'coding_agent_sessions',
  {
    runId: text('run_id')
      .primaryKey()
      .references(() => runs.id, { onDelete: 'cascade' }),
    installationId: text('installation_id')
      .notNull()
      .references(() => codingAgentInstallations.id, { onDelete: 'restrict' }),
    externalSessionId: text('external_session_id').notNull(),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    externalSessionIdUnique: uniqueIndex(
      'coding_agent_sessions_external_session_id_unique',
    ).on(table.externalSessionId),
    installationIdIdx: index('coding_agent_sessions_installation_id_idx').on(
      table.installationId,
    ),
  }),
);

export const codingAgentSessionDiffs = sqliteTable(
  'coding_agent_session_diffs',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    before: text('before').notNull(),
    after: text('after').notNull(),
    additions: integer('additions').notNull(),
    deletions: integer('deletions').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    runIdIdx: index('coding_agent_session_diffs_run_id_idx').on(table.runId),
    runFileUnique: uniqueIndex('coding_agent_session_diffs_run_file_unique').on(
      table.runId,
      table.file,
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
export type CodingAgentSessionDiff = typeof codingAgentSessionDiffs.$inferSelect;
