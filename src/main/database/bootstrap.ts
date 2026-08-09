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
      last_viewed_at INTEGER,
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
  `
    CREATE TABLE IF NOT EXISTS coding_agent_session_diffs (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL,
      file TEXT NOT NULL,
      before TEXT NOT NULL,
      after TEXT NOT NULL,
      additions INTEGER NOT NULL,
      deletions INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS coding_agent_session_diffs_run_id_idx
    ON coding_agent_session_diffs (run_id)
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS coding_agent_session_diffs_run_file_unique
    ON coding_agent_session_diffs (run_id, file)
  `,
  `
    CREATE TABLE IF NOT EXISTS intelligence_snapshots (
      id TEXT PRIMARY KEY NOT NULL,
      repository_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL,
      source_metadata TEXT NOT NULL,
      warnings TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS intelligence_snapshots_repository_id_unique
    ON intelligence_snapshots (repository_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS intelligence_worktrees (
      id TEXT PRIMARY KEY NOT NULL,
      snapshot_id TEXT NOT NULL,
      worktree_id TEXT NOT NULL,
      run_id TEXT,
      agent_kind TEXT,
      agent_name TEXT,
      agent_status TEXT NOT NULL,
      task TEXT NOT NULL,
      branch TEXT NOT NULL,
      base_branch TEXT,
      additions INTEGER NOT NULL,
      deletions INTEGER NOT NULL,
      changed_file_count INTEGER NOT NULL,
      independent INTEGER NOT NULL,
      warning TEXT,
      activity_updated_at INTEGER NOT NULL,
      FOREIGN KEY (snapshot_id) REFERENCES intelligence_snapshots(id) ON DELETE CASCADE,
      FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE RESTRICT,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS intelligence_worktrees_snapshot_worktree_unique
    ON intelligence_worktrees (snapshot_id, worktree_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS intelligence_worktrees_snapshot_id_idx
    ON intelligence_worktrees (snapshot_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS intelligence_changed_files (
      id TEXT PRIMARY KEY NOT NULL,
      intelligence_worktree_id TEXT NOT NULL,
      path TEXT NOT NULL,
      previous_path TEXT,
      change_type TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      module_path TEXT NOT NULL,
      additions INTEGER NOT NULL,
      deletions INTEGER NOT NULL,
      ranges TEXT NOT NULL,
      patch TEXT,
      binary INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      FOREIGN KEY (intelligence_worktree_id) REFERENCES intelligence_worktrees(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS intelligence_changed_files_worktree_path_unique
    ON intelligence_changed_files (intelligence_worktree_id, path)
  `,
  `
    CREATE INDEX IF NOT EXISTS intelligence_changed_files_worktree_id_idx
    ON intelligence_changed_files (intelligence_worktree_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS intelligence_changed_symbols (
      id TEXT PRIMARY KEY NOT NULL,
      changed_file_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      qualified_name TEXT NOT NULL,
      declaration_start INTEGER NOT NULL,
      declaration_end INTEGER NOT NULL,
      changed_start INTEGER NOT NULL,
      changed_end INTEGER NOT NULL,
      FOREIGN KEY (changed_file_id) REFERENCES intelligence_changed_files(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS intelligence_changed_symbols_file_symbol_unique
    ON intelligence_changed_symbols (
      changed_file_id, qualified_name, declaration_start, declaration_end
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS intelligence_changed_symbols_changed_file_id_idx
    ON intelligence_changed_symbols (changed_file_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS intelligence_overlaps (
      id TEXT PRIMARY KEY NOT NULL,
      snapshot_id TEXT NOT NULL,
      left_intelligence_worktree_id TEXT NOT NULL,
      right_intelligence_worktree_id TEXT NOT NULL,
      risk TEXT NOT NULL,
      category TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      summary TEXT NOT NULL,
      actionable INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (snapshot_id) REFERENCES intelligence_snapshots(id) ON DELETE CASCADE,
      FOREIGN KEY (left_intelligence_worktree_id) REFERENCES intelligence_worktrees(id) ON DELETE CASCADE,
      FOREIGN KEY (right_intelligence_worktree_id) REFERENCES intelligence_worktrees(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS intelligence_overlaps_snapshot_pair_unique
    ON intelligence_overlaps (
      snapshot_id, left_intelligence_worktree_id, right_intelligence_worktree_id
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS intelligence_overlaps_snapshot_id_idx
    ON intelligence_overlaps (snapshot_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS intelligence_overlap_targets (
      id TEXT PRIMARY KEY NOT NULL,
      overlap_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      path TEXT NOT NULL,
      symbol TEXT,
      left_changed_file_id TEXT,
      right_changed_file_id TEXT,
      reason_code TEXT NOT NULL,
      risk TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (overlap_id) REFERENCES intelligence_overlaps(id) ON DELETE CASCADE,
      FOREIGN KEY (left_changed_file_id) REFERENCES intelligence_changed_files(id) ON DELETE CASCADE,
      FOREIGN KEY (right_changed_file_id) REFERENCES intelligence_changed_files(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS intelligence_overlap_targets_overlap_target_unique
    ON intelligence_overlap_targets (overlap_id, target_type, path, symbol)
  `,
  `
    CREATE INDEX IF NOT EXISTS intelligence_overlap_targets_overlap_id_idx
    ON intelligence_overlap_targets (overlap_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS conflict_resolution_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      repository_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      overlap_id TEXT NOT NULL,
      target_branch TEXT NOT NULL,
      target_commit_sha TEXT,
      state TEXT NOT NULL,
      classification TEXT,
      current_stage TEXT NOT NULL,
      integration_branch TEXT,
      integration_path TEXT,
      retained INTEGER NOT NULL,
      cleanup_pending INTEGER NOT NULL,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE RESTRICT
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS conflict_resolution_sessions_repository_updated_idx
    ON conflict_resolution_sessions (repository_id, updated_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS conflict_resolution_sessions_overlap_updated_idx
    ON conflict_resolution_sessions (overlap_id, updated_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS conflict_resolution_sessions_active_tuple_idx
    ON conflict_resolution_sessions (repository_id, overlap_id, target_branch, state)
  `,
  `
    CREATE TABLE IF NOT EXISTS conflict_resolution_participants (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      side TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      worktree_id TEXT NOT NULL,
      run_id TEXT,
      task TEXT NOT NULL,
      agent_name TEXT,
      branch TEXT NOT NULL,
      original_head_sha TEXT NOT NULL,
      merge_base_sha TEXT NOT NULL,
      synthetic_commit_sha TEXT NOT NULL,
      synthetic_ref TEXT NOT NULL,
      status_fingerprint_before TEXT NOT NULL,
      status_fingerprint_after TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES conflict_resolution_sessions(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS conflict_resolution_participants_session_side_unique
    ON conflict_resolution_participants (session_id, side)
  `,
  `
    CREATE INDEX IF NOT EXISTS conflict_resolution_participants_session_id_idx
    ON conflict_resolution_participants (session_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS conflict_resolution_files (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      risk TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      left_path TEXT,
      right_path TEXT,
      symbol TEXT,
      static_ranges TEXT NOT NULL,
      git_stages TEXT NOT NULL,
      marker_ranges TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES conflict_resolution_sessions(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS conflict_resolution_files_session_path_unique
    ON conflict_resolution_files (session_id, path)
  `,
  `
    CREATE INDEX IF NOT EXISTS conflict_resolution_files_session_id_idx
    ON conflict_resolution_files (session_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS conflict_resolution_operations (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      stage TEXT NOT NULL,
      kind TEXT NOT NULL,
      command_summary TEXT,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      output_summary TEXT,
      error_message TEXT,
      FOREIGN KEY (session_id) REFERENCES conflict_resolution_sessions(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS conflict_resolution_operations_session_sequence_unique
    ON conflict_resolution_operations (session_id, sequence)
  `,
  `
    CREATE INDEX IF NOT EXISTS conflict_resolution_operations_session_id_idx
    ON conflict_resolution_operations (session_id)
  `,
] as const;

export const bootstrapSchemaSql = bootstrapStatements.join(';\n');
