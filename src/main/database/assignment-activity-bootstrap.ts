export const assignmentActivitySchemaStatements = [
  `CREATE TABLE IF NOT EXISTS resource_versions (
    id TEXT PRIMARY KEY NOT NULL, resource_kind TEXT NOT NULL, resource_id TEXT NOT NULL,
    version TEXT NOT NULL, content_digest TEXT NOT NULL, security_digest TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    CHECK (resource_kind IN ('capability','skill'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS resource_versions_identity_unique ON resource_versions
    (resource_kind, resource_id, version, content_digest, security_digest)`,
  `CREATE TABLE IF NOT EXISTS worktree_assignment_generations (
    id TEXT PRIMARY KEY NOT NULL, worktree_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
    resource_set_digest TEXT NOT NULL, migration_key TEXT, created_at INTEGER NOT NULL,
    FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE,
    CHECK (ordinal >= 0), UNIQUE (worktree_id, ordinal), UNIQUE (worktree_id, resource_set_digest)
  )`,
  `CREATE TABLE IF NOT EXISTS worktree_assignment_generation_resources (
    id TEXT PRIMARY KEY NOT NULL, generation_id TEXT NOT NULL, resource_version_id TEXT NOT NULL,
    configuration_digest TEXT NOT NULL, invocation_policy_digest TEXT NOT NULL,
    FOREIGN KEY (generation_id) REFERENCES worktree_assignment_generations(id) ON DELETE CASCADE,
    FOREIGN KEY (resource_version_id) REFERENCES resource_versions(id) ON DELETE RESTRICT,
    UNIQUE (generation_id, resource_version_id)
  )`,
  `CREATE TABLE IF NOT EXISTS worktree_assignment_generation_resource_providers (
    generation_resource_id TEXT NOT NULL, agent_kind TEXT NOT NULL, availability TEXT NOT NULL,
    skill_isolation TEXT NOT NULL, qualification_digest TEXT NOT NULL, expected_state_digest TEXT NOT NULL,
    PRIMARY KEY (generation_resource_id, agent_kind),
    FOREIGN KEY (generation_resource_id) REFERENCES worktree_assignment_generation_resources(id) ON DELETE CASCADE,
    CHECK (agent_kind IN ('codex','opencode')),
    CHECK (availability IN ('compatible','unavailable')),
    CHECK (skill_isolation IN ('enforced','not_enforced','not_applicable'))
  )`,
  `CREATE TABLE IF NOT EXISTS worktree_runtime_catalog_generations (
    id TEXT PRIMARY KEY NOT NULL, worktree_id TEXT NOT NULL, agent_kind TEXT NOT NULL,
    assignment_generation_id TEXT NOT NULL, provider_version TEXT NOT NULL,
    adapter_contract_version INTEGER NOT NULL, projection_digest TEXT NOT NULL, created_at INTEGER NOT NULL,
    FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE,
    FOREIGN KEY (assignment_generation_id) REFERENCES worktree_assignment_generations(id) ON DELETE RESTRICT,
    CHECK (agent_kind IN ('codex','opencode')), CHECK (adapter_contract_version > 0),
    UNIQUE (worktree_id, agent_kind, assignment_generation_id, provider_version, adapter_contract_version, projection_digest)
  )`,
  `CREATE TABLE IF NOT EXISTS worktree_assignments (
    worktree_id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, projection_sequence INTEGER NOT NULL,
    phase TEXT NOT NULL, desired_generation_id TEXT NOT NULL, verified_generation_id TEXT,
    failure_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE,
    FOREIGN KEY (desired_generation_id) REFERENCES worktree_assignment_generations(id) ON DELETE RESTRICT,
    FOREIGN KEY (verified_generation_id) REFERENCES worktree_assignment_generations(id) ON DELETE RESTRICT,
    CHECK (revision >= 0), CHECK (projection_sequence >= 0),
    CHECK (phase IN ('reconciling','stable','waiting_for_idle','applying','rolling_back','failed_rolled_back','recovery_required','removing'))
  )`,
  `CREATE TABLE IF NOT EXISTS resource_distribution_operations (
    id TEXT PRIMARY KEY NOT NULL, resource_kind TEXT NOT NULL, resource_id TEXT NOT NULL,
    target_resource_version_id TEXT, status TEXT NOT NULL, side_effect_boundary TEXT NOT NULL,
    failure_code TEXT, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
    FOREIGN KEY (target_resource_version_id) REFERENCES resource_versions(id) ON DELETE RESTRICT,
    CHECK (resource_kind IN ('capability','skill')),
    CHECK (status IN ('preparing','waiting_for_idle','applying','commit_pending','rolling_back','verified','failed','recovery_required','superseded','cancelled')),
    CHECK (side_effect_boundary IN ('none','gates_acquired','staged','activated','commit_pending')),
    CHECK ((completed_at IS NULL) = (status IN ('preparing','waiting_for_idle','applying','commit_pending','rolling_back','recovery_required')))
  )`,
  `CREATE TABLE IF NOT EXISTS worktree_assignment_attempts (
    id TEXT PRIMARY KEY NOT NULL, worktree_id TEXT NOT NULL, distribution_operation_id TEXT,
    kind TEXT NOT NULL, target_revision INTEGER NOT NULL, target_generation_id TEXT NOT NULL,
    prior_verified_generation_id TEXT, status TEXT NOT NULL, side_effect_boundary TEXT NOT NULL,
    failure_code TEXT, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
    FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE,
    FOREIGN KEY (distribution_operation_id) REFERENCES resource_distribution_operations(id) ON DELETE RESTRICT,
    FOREIGN KEY (target_generation_id) REFERENCES worktree_assignment_generations(id) ON DELETE RESTRICT,
    FOREIGN KEY (prior_verified_generation_id) REFERENCES worktree_assignment_generations(id) ON DELETE RESTRICT,
    CHECK (target_revision >= 0),
    CHECK (kind IN ('assignment_apply','runtime_join','recovery','resource_update','removal')),
    CHECK (status IN ('preparing','waiting_for_idle','applying','rolling_back','verified','failed_rolled_back','recovery_required','superseded','cancelled')),
    CHECK (side_effect_boundary IN ('none','staged','activated','commit_pending')),
    CHECK ((completed_at IS NULL) = (status IN ('preparing','waiting_for_idle','applying','rolling_back','recovery_required')))
  )`,
  `CREATE TABLE IF NOT EXISTS resource_distribution_operation_worktrees (
    operation_id TEXT NOT NULL, worktree_id TEXT NOT NULL, apply_order INTEGER NOT NULL,
    observed_revision INTEGER NOT NULL, prior_generation_id TEXT NOT NULL, target_generation_id TEXT NOT NULL,
    attempt_id TEXT UNIQUE, state TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (operation_id, worktree_id),
    FOREIGN KEY (operation_id) REFERENCES resource_distribution_operations(id) ON DELETE CASCADE,
    FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE,
    FOREIGN KEY (prior_generation_id) REFERENCES worktree_assignment_generations(id) ON DELETE RESTRICT,
    FOREIGN KEY (target_generation_id) REFERENCES worktree_assignment_generations(id) ON DELETE RESTRICT,
    FOREIGN KEY (attempt_id) REFERENCES worktree_assignment_attempts(id) ON DELETE RESTRICT,
    CHECK (apply_order >= 0), CHECK (observed_revision >= 0),
    CHECK (state IN ('planned','gate_acquired','staged','activated','commit_ready','committed','rollback_started','rolled_back','unknown')),
    UNIQUE (operation_id, apply_order)
  )`,
  `CREATE TABLE IF NOT EXISTS worktree_assignment_attempt_participants (
    attempt_id TEXT NOT NULL, agent_kind TEXT NOT NULL, runtime_generation TEXT NOT NULL,
    provider_version TEXT NOT NULL, prior_catalog_generation_id TEXT, target_catalog_generation_id TEXT NOT NULL,
    apply_order INTEGER NOT NULL, state TEXT NOT NULL, prior_effective_state_digest TEXT,
    target_effective_state_digest TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (attempt_id, agent_kind, runtime_generation),
    FOREIGN KEY (attempt_id) REFERENCES worktree_assignment_attempts(id) ON DELETE CASCADE,
    FOREIGN KEY (prior_catalog_generation_id) REFERENCES worktree_runtime_catalog_generations(id) ON DELETE RESTRICT,
    FOREIGN KEY (target_catalog_generation_id) REFERENCES worktree_runtime_catalog_generations(id) ON DELETE RESTRICT,
    CHECK (agent_kind IN ('codex','opencode')), CHECK (apply_order >= 0),
    CHECK (state IN ('planned','staged','activated','verified','rollback_started','rolled_back','unknown')),
    UNIQUE (attempt_id, apply_order)
  )`,
  `CREATE TABLE IF NOT EXISTS worktree_runtime_assignment_attestations (
    worktree_id TEXT NOT NULL, agent_kind TEXT NOT NULL, runtime_generation TEXT NOT NULL,
    assignment_generation_id TEXT NOT NULL, catalog_generation_id TEXT NOT NULL,
    provider_version TEXT NOT NULL, effective_state_digest TEXT NOT NULL, verified_at INTEGER NOT NULL,
    invalidated_at INTEGER, invalidation_code TEXT,
    PRIMARY KEY (worktree_id, agent_kind, runtime_generation),
    FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE,
    FOREIGN KEY (assignment_generation_id) REFERENCES worktree_assignment_generations(id) ON DELETE RESTRICT,
    FOREIGN KEY (catalog_generation_id) REFERENCES worktree_runtime_catalog_generations(id) ON DELETE RESTRICT,
    CHECK (agent_kind IN ('codex','opencode'))
  )`,
  `CREATE TABLE IF NOT EXISTS worktree_assignment_outbox (
    event_id TEXT PRIMARY KEY NOT NULL, worktree_id TEXT NOT NULL, revision INTEGER NOT NULL,
    projection_sequence INTEGER NOT NULL, event_type TEXT NOT NULL, schema_version INTEGER NOT NULL,
    safe_payload_json TEXT NOT NULL, created_at INTEGER NOT NULL, published_at INTEGER,
    FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE,
    UNIQUE (worktree_id, projection_sequence)
  )`,
  `CREATE TABLE IF NOT EXISTS worktree_assignment_migrations (
    migration_key TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL, source_fingerprint TEXT NOT NULL,
    worktree_count INTEGER NOT NULL, resource_version_count INTEGER NOT NULL, generation_count INTEGER NOT NULL,
    failure_code TEXT, started_at INTEGER, completed_at INTEGER,
    CHECK (status IN ('pending','applying','verified','failed')),
    CHECK (worktree_count >= 0 AND resource_version_count >= 0 AND generation_count >= 0)
  )`,
  `CREATE TABLE IF NOT EXISTS resource_activity (
    id TEXT PRIMARY KEY NOT NULL, worktree_id TEXT NOT NULL, run_id TEXT,
    resource_kind TEXT NOT NULL, resource_id TEXT NOT NULL, resource_version TEXT NOT NULL,
    resource_digest TEXT, assignment_revision TEXT, assignment_generation_id TEXT,
    catalog_generation_id TEXT, runtime_generation_id TEXT, provider TEXT, provider_version TEXT,
    adapter_contract_version INTEGER, request_key TEXT UNIQUE, correlation_key TEXT UNIQUE,
    request_state TEXT NOT NULL, use_state TEXT NOT NULL, lifecycle TEXT NOT NULL, outcome TEXT NOT NULL,
    attribution TEXT NOT NULL, mode TEXT NOT NULL, routing_integrity TEXT NOT NULL, coverage TEXT NOT NULL,
    requested_at INTEGER, entered_or_loaded_at INTEGER, finished_at INTEGER,
    first_observed_at INTEGER NOT NULL, last_observed_at INTEGER NOT NULL,
    FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
    FOREIGN KEY (assignment_generation_id) REFERENCES worktree_assignment_generations(id) ON DELETE RESTRICT,
    FOREIGN KEY (catalog_generation_id) REFERENCES worktree_runtime_catalog_generations(id) ON DELETE RESTRICT,
    CHECK (resource_kind IN ('capability','skill')), CHECK (provider IS NULL OR provider IN ('codex','opencode')),
    CHECK (request_state IN ('not_observed','requested')), CHECK (use_state IN ('not_confirmed','confirmed')),
    CHECK (lifecycle IN ('open','terminal')), CHECK (outcome IN ('not_observed','success','reported_error','thrown','timeout','cancelled','rejected','permission_denied','load_failed')),
    CHECK (attribution IN ('exact','unknown','conflict')), CHECK (mode IN ('explicit','automatic','unknown')),
    CHECK (routing_integrity IN ('verified','lease_mismatch','unknown')),
    CHECK (coverage IN ('qualified','pending','evidence_gap','provider_unqualified','format_drift','legacy_unverified','conflict')),
    CHECK ((lifecycle = 'terminal') = (finished_at IS NOT NULL)),
    CHECK ((request_state = 'requested') = (requested_at IS NOT NULL)),
    CHECK ((use_state = 'confirmed') = (entered_or_loaded_at IS NOT NULL))
  )`,
  `CREATE TABLE IF NOT EXISTS resource_activity_evidence (
    id TEXT PRIMARY KEY NOT NULL, activity_id TEXT NOT NULL, boundary TEXT NOT NULL,
    source_event_key TEXT NOT NULL, correlation_key TEXT, provider_contract TEXT NOT NULL, observed_at INTEGER NOT NULL,
    FOREIGN KEY (activity_id) REFERENCES resource_activity(id) ON DELETE CASCADE,
    UNIQUE (boundary, source_event_key)
  )`,
  `CREATE TABLE IF NOT EXISTS resource_activity_session_routes (
    route_key TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, worktree_id TEXT NOT NULL,
    provider TEXT NOT NULL, provider_version TEXT NOT NULL, adapter_contract_version INTEGER NOT NULL,
    runtime_generation_id TEXT NOT NULL, assignment_generation_id TEXT NOT NULL, catalog_generation_id TEXT NOT NULL,
    registered_at INTEGER NOT NULL, retired_at INTEGER,
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
    FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE,
    FOREIGN KEY (assignment_generation_id) REFERENCES worktree_assignment_generations(id) ON DELETE RESTRICT,
    FOREIGN KEY (catalog_generation_id) REFERENCES worktree_runtime_catalog_generations(id) ON DELETE RESTRICT,
    CHECK (provider IN ('codex','opencode')), CHECK (adapter_contract_version > 0)
  )`,
  `CREATE TABLE IF NOT EXISTS resource_evidence_coverage (
    id TEXT PRIMARY KEY NOT NULL, worktree_id TEXT NOT NULL, provider TEXT NOT NULL,
    provider_version TEXT NOT NULL, adapter_contract_version INTEGER NOT NULL, runtime_generation_id TEXT NOT NULL,
    assignment_generation_id TEXT, catalog_generation_id TEXT, kind TEXT NOT NULL,
    source_event_key TEXT NOT NULL, observed_at INTEGER NOT NULL, resolved_at INTEGER,
    FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE,
    FOREIGN KEY (assignment_generation_id) REFERENCES worktree_assignment_generations(id) ON DELETE RESTRICT,
    FOREIGN KEY (catalog_generation_id) REFERENCES worktree_runtime_catalog_generations(id) ON DELETE RESTRICT,
    CHECK (provider IN ('codex','opencode')), CHECK (adapter_contract_version > 0),
    CHECK (kind IN ('evidence_gap','provider_unqualified','format_drift','security_conflict')),
    UNIQUE (kind, source_event_key)
  )`,
  `CREATE TABLE IF NOT EXISTS resource_activity_streams (
    run_id TEXT PRIMARY KEY NOT NULL, sequence INTEGER NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE, CHECK (sequence >= 0)
  )`,
  `CREATE TABLE IF NOT EXISTS resource_activity_outbox (
    event_id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, sequence INTEGER NOT NULL,
    schema_version INTEGER NOT NULL, safe_delta_json TEXT NOT NULL, created_at INTEGER NOT NULL, published_at INTEGER,
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE, UNIQUE (run_id, sequence)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS worktree_assignment_attempts_one_active_per_worktree
    ON worktree_assignment_attempts (worktree_id)
    WHERE status IN ('preparing','waiting_for_idle','applying','rolling_back')`,
  `CREATE INDEX IF NOT EXISTS worktree_assignment_attempts_worktree_status_idx
    ON worktree_assignment_attempts (worktree_id,status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS resource_distribution_operations_one_active_per_resource
    ON resource_distribution_operations (resource_kind,resource_id)
    WHERE status IN ('preparing','waiting_for_idle','applying','commit_pending','rolling_back','recovery_required')`,
  `CREATE INDEX IF NOT EXISTS resource_distribution_operations_status_idx
    ON resource_distribution_operations (status)`,
] as const;
