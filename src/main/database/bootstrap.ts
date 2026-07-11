const bootstrapStatements = [
  `
    CREATE TABLE IF NOT EXISTS repositories (
      id TEXT PRIMARY KEY NOT NULL,
      github_repo_id INTEGER NOT NULL,
      owner_login TEXT NOT NULL,
      name TEXT NOT NULL,
      full_name TEXT NOT NULL,
      default_branch TEXT,
      is_private INTEGER NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0,
      clone_url TEXT NOT NULL,
      ssh_url TEXT,
      html_url TEXT NOT NULL,
      local_root_path TEXT,
      local_clone_status TEXT NOT NULL,
      last_local_scan_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_synced_at INTEGER
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS repositories_github_repo_id_unique
    ON repositories (github_repo_id)
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS repositories_full_name_unique
    ON repositories (full_name)
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS repositories_local_root_path_unique
    ON repositories (local_root_path)
  `,
  `
    CREATE TABLE IF NOT EXISTS worktrees (
      id TEXT PRIMARY KEY NOT NULL,
      repository_id TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      base_branch_name TEXT,
      head_commit_sha TEXT,
      status TEXT NOT NULL,
      active_run_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_synced_at INTEGER,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE RESTRICT
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS worktrees_path_unique
    ON worktrees (path)
  `,
  `
    CREATE INDEX IF NOT EXISTS worktrees_repository_id_idx
    ON worktrees (repository_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY NOT NULL,
      repository_id TEXT NOT NULL,
      worktree_id TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      pid INTEGER,
      command TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      exit_code INTEGER,
      error_message TEXT,
      output_status TEXT NOT NULL DEFAULT 'idle',
      last_output_at INTEGER,
      last_sequence INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE RESTRICT,
      FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE RESTRICT
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS runs_repository_id_idx
    ON runs (repository_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS runs_worktree_id_idx
    ON runs (worktree_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS runs_status_idx
    ON runs (status)
  `,
  `
    CREATE TABLE IF NOT EXISTS run_output_events (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      stream TEXT,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS run_output_events_run_sequence_unique
    ON run_output_events (run_id, sequence)
  `,
  `
    CREATE INDEX IF NOT EXISTS run_output_events_run_sequence_idx
    ON run_output_events (run_id, sequence)
  `,
  `
    CREATE TABLE IF NOT EXISTS run_messages (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL,
      role TEXT NOT NULL,
      message_type TEXT NOT NULL,
      content TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS run_messages_run_sequence_unique
    ON run_messages (run_id, sequence)
  `,
  `
    CREATE INDEX IF NOT EXISTS run_messages_run_sequence_idx
    ON run_messages (run_id, sequence)
  `,
  `
    CREATE TABLE IF NOT EXISTS coding_agent_installations (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      executable_path TEXT NOT NULL,
      version TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_verified_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS coding_agent_installations_kind_unique
    ON coding_agent_installations (kind)
  `,
  `
    CREATE TABLE IF NOT EXISTS coding_agent_sessions (
      run_id TEXT PRIMARY KEY NOT NULL,
      installation_id TEXT NOT NULL,
      external_session_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (installation_id) REFERENCES coding_agent_installations(id) ON DELETE RESTRICT
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS coding_agent_sessions_external_session_id_unique
    ON coding_agent_sessions (external_session_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS coding_agent_sessions_installation_id_idx
    ON coding_agent_sessions (installation_id)
  `,
] as const;

export const bootstrapSchemaSql = bootstrapStatements.join(';\n');
