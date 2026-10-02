import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { runs, worktrees } from "./schema";

const digestCheck = (column: ReturnType<typeof text>) => sql`${column} GLOB 'sha256:[0-9a-f]*' AND length(${column}) = 71`;

export const resourceVersions = sqliteTable("resource_versions", {
  id: text("id").primaryKey(),
  resourceKind: text("resource_kind", { enum: ["capability", "skill"] }).notNull(),
  resourceId: text("resource_id").notNull(),
  version: text("version").notNull(),
  contentDigest: text("content_digest").notNull(),
  securityDigest: text("security_digest").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  identityUnique: uniqueIndex("resource_versions_identity_unique").on(table.resourceKind, table.resourceId, table.version, table.contentDigest, table.securityDigest),
  contentDigestCheck: check("resource_versions_content_digest_check", digestCheck(table.contentDigest)),
  securityDigestCheck: check("resource_versions_security_digest_check", digestCheck(table.securityDigest)),
  kindCheck: check("resource_versions_kind_check", sql`${table.resourceKind} IN ('capability','skill')`),
}));

export const worktreeAssignmentGenerations = sqliteTable("worktree_assignment_generations", {
  id: text("id").primaryKey(),
  worktreeId: text("worktree_id").notNull().references(() => worktrees.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  resourceSetDigest: text("resource_set_digest").notNull(),
  migrationKey: text("migration_key"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  ordinalUnique: uniqueIndex("worktree_assignment_generations_ordinal_unique").on(table.worktreeId, table.ordinal),
  digestUnique: uniqueIndex("worktree_assignment_generations_digest_unique").on(table.worktreeId, table.resourceSetDigest),
  ordinalCheck: check("worktree_assignment_generations_ordinal_check", sql`${table.ordinal} >= 0`),
}));

export const worktreeAssignmentGenerationResources = sqliteTable("worktree_assignment_generation_resources", {
  id: text("id").primaryKey(),
  generationId: text("generation_id").notNull().references(() => worktreeAssignmentGenerations.id, { onDelete: "cascade" }),
  resourceVersionId: text("resource_version_id").notNull().references(() => resourceVersions.id, { onDelete: "restrict" }),
  configurationDigest: text("configuration_digest").notNull(),
  invocationPolicyDigest: text("invocation_policy_digest").notNull(),
}, (table) => ({
  memberUnique: uniqueIndex("worktree_assignment_generation_resources_member_unique").on(table.generationId, table.resourceVersionId),
}));

export const worktreeAssignmentGenerationResourceProviders = sqliteTable("worktree_assignment_generation_resource_providers", {
  generationResourceId: text("generation_resource_id").notNull().references(() => worktreeAssignmentGenerationResources.id, { onDelete: "cascade" }),
  agentKind: text("agent_kind", { enum: ["codex", "opencode"] }).notNull(),
  availability: text("availability", { enum: ["compatible", "unavailable"] }).notNull(),
  skillIsolation: text("skill_isolation", { enum: ["enforced", "not_enforced", "not_applicable"] }).notNull(),
  qualificationDigest: text("qualification_digest").notNull(),
  expectedStateDigest: text("expected_state_digest").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.generationResourceId, table.agentKind] }),
  agentCheck: check("worktree_assignment_generation_resource_providers_agent_check", sql`${table.agentKind} IN ('codex','opencode')`),
  availabilityCheck: check("worktree_assignment_generation_resource_providers_availability_check", sql`${table.availability} IN ('compatible','unavailable')`),
  isolationCheck: check("worktree_assignment_generation_resource_providers_isolation_check", sql`${table.skillIsolation} IN ('enforced','not_enforced','not_applicable')`),
}));

export const worktreeRuntimeCatalogGenerations = sqliteTable("worktree_runtime_catalog_generations", {
  id: text("id").primaryKey(),
  worktreeId: text("worktree_id").notNull().references(() => worktrees.id, { onDelete: "cascade" }),
  agentKind: text("agent_kind", { enum: ["codex", "opencode"] }).notNull(),
  assignmentGenerationId: text("assignment_generation_id").notNull().references(() => worktreeAssignmentGenerations.id, { onDelete: "restrict" }),
  providerVersion: text("provider_version").notNull(),
  adapterContractVersion: integer("adapter_contract_version").notNull(),
  projectionDigest: text("projection_digest").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  identityUnique: uniqueIndex("worktree_runtime_catalog_generations_identity_unique").on(table.worktreeId, table.agentKind, table.assignmentGenerationId, table.providerVersion, table.adapterContractVersion, table.projectionDigest),
  contractVersionCheck: check("worktree_runtime_catalog_generations_contract_version_check", sql`${table.adapterContractVersion} > 0`),
  agentCheck: check("worktree_runtime_catalog_generations_agent_check", sql`${table.agentKind} IN ('codex','opencode')`),
}));

export const worktreeAssignments = sqliteTable("worktree_assignments", {
  worktreeId: text("worktree_id").primaryKey().references(() => worktrees.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  projectionSequence: integer("projection_sequence").notNull(),
  phase: text("phase", { enum: ["reconciling", "stable", "waiting_for_idle", "applying", "rolling_back", "failed_rolled_back", "recovery_required", "removing"] }).notNull(),
  desiredGenerationId: text("desired_generation_id").notNull().references(() => worktreeAssignmentGenerations.id, { onDelete: "restrict" }),
  verifiedGenerationId: text("verified_generation_id").references(() => worktreeAssignmentGenerations.id, { onDelete: "restrict" }),
  failureCode: text("failure_code"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  revisionCheck: check("worktree_assignments_revision_check", sql`${table.revision} >= 0`),
  sequenceCheck: check("worktree_assignments_sequence_check", sql`${table.projectionSequence} >= 0`),
  phaseCheck: check("worktree_assignments_phase_check", sql`${table.phase} IN ('reconciling','stable','waiting_for_idle','applying','rolling_back','failed_rolled_back','recovery_required','removing')`),
}));

export const resourceActivityStreams = sqliteTable("resource_activity_streams", {
  runId: text("run_id").primaryKey().references(() => runs.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
}, (table) => ({
  sequenceCheck: check("resource_activity_streams_sequence_check", sql`${table.sequence} >= 0`),
}));

export const resourceDistributionOperations = sqliteTable("resource_distribution_operations", {
  id: text("id").primaryKey(), resourceKind: text("resource_kind", { enum: ["capability", "skill"] }).notNull(), resourceId: text("resource_id").notNull(),
  targetResourceVersionId: text("target_resource_version_id").references(() => resourceVersions.id, { onDelete: "restrict" }),
  status: text("status", { enum: ["preparing", "waiting_for_idle", "applying", "commit_pending", "rolling_back", "verified", "failed", "recovery_required", "superseded", "cancelled"] }).notNull(),
  sideEffectBoundary: text("side_effect_boundary", { enum: ["none", "gates_acquired", "staged", "activated", "commit_pending"] }).notNull(),
  failureCode: text("failure_code"), startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(), completedAt: integer("completed_at", { mode: "timestamp_ms" }),
}, (table) => ({
  oneActivePerResource: uniqueIndex("resource_distribution_operations_one_active_per_resource").on(table.resourceKind, table.resourceId).where(sql`${table.status} IN ('preparing','waiting_for_idle','applying','commit_pending','rolling_back','recovery_required')`),
  statusLookup: index("resource_distribution_operations_status_idx").on(table.status),
  kindCheck: check("resource_distribution_operations_kind_check", sql`${table.resourceKind} IN ('capability','skill')`),
  statusCheck: check("resource_distribution_operations_status_check", sql`${table.status} IN ('preparing','waiting_for_idle','applying','commit_pending','rolling_back','verified','failed','recovery_required','superseded','cancelled')`),
  boundaryCheck: check("resource_distribution_operations_boundary_check", sql`${table.sideEffectBoundary} IN ('none','gates_acquired','staged','activated','commit_pending')`),
  terminalCheck: check("resource_distribution_operations_terminal_check", sql`(${table.completedAt} IS NULL) = (${table.status} IN ('preparing','waiting_for_idle','applying','commit_pending','rolling_back','recovery_required'))`),
}));

export const worktreeAssignmentAttempts = sqliteTable("worktree_assignment_attempts", {
  id: text("id").primaryKey(), worktreeId: text("worktree_id").notNull().references(() => worktrees.id, { onDelete: "cascade" }),
  distributionOperationId: text("distribution_operation_id").references(() => resourceDistributionOperations.id, { onDelete: "restrict" }),
  kind: text("kind", { enum: ["assignment_apply", "runtime_join", "recovery", "resource_update", "removal"] }).notNull(), targetRevision: integer("target_revision").notNull(),
  targetGenerationId: text("target_generation_id").notNull().references(() => worktreeAssignmentGenerations.id, { onDelete: "restrict" }),
  priorVerifiedGenerationId: text("prior_verified_generation_id").references(() => worktreeAssignmentGenerations.id, { onDelete: "restrict" }),
  status: text("status", { enum: ["preparing", "waiting_for_idle", "applying", "rolling_back", "verified", "failed_rolled_back", "recovery_required", "superseded", "cancelled"] }).notNull(),
  sideEffectBoundary: text("side_effect_boundary", { enum: ["none", "staged", "activated", "commit_pending"] }).notNull(), failureCode: text("failure_code"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(), completedAt: integer("completed_at", { mode: "timestamp_ms" }),
}, (table) => ({
  targetRevisionCheck: check("worktree_assignment_attempts_target_revision_check", sql`${table.targetRevision} >= 0`),
  oneActivePerWorktree: uniqueIndex("worktree_assignment_attempts_one_active_per_worktree").on(table.worktreeId).where(sql`${table.status} IN ('preparing','waiting_for_idle','applying','rolling_back')`),
  worktreeStatusLookup: index("worktree_assignment_attempts_worktree_status_idx").on(table.worktreeId, table.status),
  kindCheck: check("worktree_assignment_attempts_kind_check", sql`${table.kind} IN ('assignment_apply','runtime_join','recovery','resource_update','removal')`),
  statusCheck: check("worktree_assignment_attempts_status_check", sql`${table.status} IN ('preparing','waiting_for_idle','applying','rolling_back','verified','failed_rolled_back','recovery_required','superseded','cancelled')`),
  boundaryCheck: check("worktree_assignment_attempts_boundary_check", sql`${table.sideEffectBoundary} IN ('none','staged','activated','commit_pending')`),
  terminalCheck: check("worktree_assignment_attempts_terminal_check", sql`(${table.completedAt} IS NULL) = (${table.status} IN ('preparing','waiting_for_idle','applying','rolling_back','recovery_required'))`),
}));

export const resourceDistributionOperationWorktrees = sqliteTable("resource_distribution_operation_worktrees", {
  operationId: text("operation_id").notNull().references(() => resourceDistributionOperations.id, { onDelete: "cascade" }), worktreeId: text("worktree_id").notNull().references(() => worktrees.id, { onDelete: "cascade" }),
  applyOrder: integer("apply_order").notNull(), observedRevision: integer("observed_revision").notNull(), priorGenerationId: text("prior_generation_id").notNull().references(() => worktreeAssignmentGenerations.id, { onDelete: "restrict" }),
  targetGenerationId: text("target_generation_id").notNull().references(() => worktreeAssignmentGenerations.id, { onDelete: "restrict" }), attemptId: text("attempt_id").unique().references(() => worktreeAssignmentAttempts.id, { onDelete: "restrict" }),
  state: text("state", { enum: ["planned", "gate_acquired", "staged", "activated", "commit_ready", "committed", "rollback_started", "rolled_back", "unknown"] }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.operationId, table.worktreeId] }), orderUnique: uniqueIndex("resource_distribution_operation_worktrees_order_unique").on(table.operationId, table.applyOrder), orderCheck: check("resource_distribution_operation_worktrees_order_check", sql`${table.applyOrder} >= 0`), revisionCheck: check("resource_distribution_operation_worktrees_revision_check", sql`${table.observedRevision} >= 0`), stateCheck: check("resource_distribution_operation_worktrees_state_check", sql`${table.state} IN ('planned','gate_acquired','staged','activated','commit_ready','committed','rollback_started','rolled_back','unknown')`) }));

export const worktreeAssignmentAttemptParticipants = sqliteTable("worktree_assignment_attempt_participants", {
  attemptId: text("attempt_id").notNull().references(() => worktreeAssignmentAttempts.id, { onDelete: "cascade" }), agentKind: text("agent_kind", { enum: ["codex", "opencode"] }).notNull(), runtimeGeneration: text("runtime_generation").notNull(), providerVersion: text("provider_version").notNull(),
  priorCatalogGenerationId: text("prior_catalog_generation_id").references(() => worktreeRuntimeCatalogGenerations.id, { onDelete: "restrict" }), targetCatalogGenerationId: text("target_catalog_generation_id").notNull().references(() => worktreeRuntimeCatalogGenerations.id, { onDelete: "restrict" }),
  applyOrder: integer("apply_order").notNull(), state: text("state", { enum: ["planned", "staged", "activated", "verified", "rollback_started", "rolled_back", "unknown"] }).notNull(), priorEffectiveStateDigest: text("prior_effective_state_digest"), targetEffectiveStateDigest: text("target_effective_state_digest").notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.attemptId, table.agentKind, table.runtimeGeneration] }), orderUnique: uniqueIndex("worktree_assignment_attempt_participants_order_unique").on(table.attemptId, table.applyOrder), orderCheck: check("worktree_assignment_attempt_participants_order_check", sql`${table.applyOrder} >= 0`), agentCheck: check("worktree_assignment_attempt_participants_agent_check", sql`${table.agentKind} IN ('codex','opencode')`), stateCheck: check("worktree_assignment_attempt_participants_state_check", sql`${table.state} IN ('planned','staged','activated','verified','rollback_started','rolled_back','unknown')`) }));

export const worktreeRuntimeAssignmentAttestations = sqliteTable("worktree_runtime_assignment_attestations", {
  worktreeId: text("worktree_id").notNull().references(() => worktrees.id, { onDelete: "cascade" }), agentKind: text("agent_kind", { enum: ["codex", "opencode"] }).notNull(), runtimeGeneration: text("runtime_generation").notNull(),
  assignmentGenerationId: text("assignment_generation_id").notNull().references(() => worktreeAssignmentGenerations.id, { onDelete: "restrict" }), catalogGenerationId: text("catalog_generation_id").notNull().references(() => worktreeRuntimeCatalogGenerations.id, { onDelete: "restrict" }),
  providerVersion: text("provider_version").notNull(), effectiveStateDigest: text("effective_state_digest").notNull(), verifiedAt: integer("verified_at", { mode: "timestamp_ms" }).notNull(), invalidatedAt: integer("invalidated_at", { mode: "timestamp_ms" }), invalidationCode: text("invalidation_code"),
}, (table) => ({ pk: primaryKey({ columns: [table.worktreeId, table.agentKind, table.runtimeGeneration] }), agentCheck: check("worktree_runtime_assignment_attestations_agent_check", sql`${table.agentKind} IN ('codex','opencode')`) }));

export const worktreeAssignmentOutbox = sqliteTable("worktree_assignment_outbox", {
  eventId: text("event_id").primaryKey(), worktreeId: text("worktree_id").notNull().references(() => worktrees.id, { onDelete: "cascade" }), revision: integer("revision").notNull(), projectionSequence: integer("projection_sequence").notNull(), eventType: text("event_type").notNull(), schemaVersion: integer("schema_version").notNull(), safePayloadJson: text("safe_payload_json").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), publishedAt: integer("published_at", { mode: "timestamp_ms" }),
}, (table) => ({ sequenceUnique: uniqueIndex("worktree_assignment_outbox_sequence_unique").on(table.worktreeId, table.projectionSequence) }));

export const worktreeAssignmentMigrations = sqliteTable("worktree_assignment_migrations", {
  migrationKey: text("migration_key").primaryKey(), status: text("status", { enum: ["pending", "applying", "verified", "failed"] }).notNull(), sourceFingerprint: text("source_fingerprint").notNull(), worktreeCount: integer("worktree_count").notNull(), resourceVersionCount: integer("resource_version_count").notNull(), generationCount: integer("generation_count").notNull(), failureCode: text("failure_code"), startedAt: integer("started_at", { mode: "timestamp_ms" }), completedAt: integer("completed_at", { mode: "timestamp_ms" }),
}, (table) => ({ statusCheck: check("worktree_assignment_migrations_status_check", sql`${table.status} IN ('pending','applying','verified','failed')`), countCheck: check("worktree_assignment_migrations_count_check", sql`${table.worktreeCount} >= 0 AND ${table.resourceVersionCount} >= 0 AND ${table.generationCount} >= 0`) }));

export const resourceActivity = sqliteTable("resource_activity", {
  id: text("id").primaryKey(), worktreeId: text("worktree_id").notNull().references(() => worktrees.id, { onDelete: "cascade" }), runId: text("run_id").references(() => runs.id, { onDelete: "cascade" }),
  resourceKind: text("resource_kind", { enum: ["capability", "skill"] }).notNull(), resourceId: text("resource_id").notNull(), resourceVersion: text("resource_version").notNull(), resourceDigest: text("resource_digest"), assignmentRevision: text("assignment_revision"), assignmentGenerationId: text("assignment_generation_id").references(() => worktreeAssignmentGenerations.id, { onDelete: "restrict" }), catalogGenerationId: text("catalog_generation_id").references(() => worktreeRuntimeCatalogGenerations.id, { onDelete: "restrict" }), runtimeGenerationId: text("runtime_generation_id"), provider: text("provider", { enum: ["codex", "opencode"] }), providerVersion: text("provider_version"), adapterContractVersion: integer("adapter_contract_version"),
  requestKey: text("request_key"), correlationKey: text("correlation_key"), requestState: text("request_state", { enum: ["not_observed", "requested"] }).notNull(), useState: text("use_state", { enum: ["not_confirmed", "confirmed"] }).notNull(), lifecycle: text("lifecycle", { enum: ["open", "terminal"] }).notNull(), outcome: text("outcome", { enum: ["not_observed", "success", "reported_error", "thrown", "timeout", "cancelled", "rejected", "permission_denied", "load_failed"] }).notNull(), attribution: text("attribution", { enum: ["exact", "unknown", "conflict"] }).notNull(), mode: text("mode", { enum: ["explicit", "automatic", "unknown"] }).notNull(), routingIntegrity: text("routing_integrity", { enum: ["verified", "lease_mismatch", "unknown"] }).notNull(), coverage: text("coverage", { enum: ["qualified", "pending", "evidence_gap", "provider_unqualified", "format_drift", "legacy_unverified", "conflict"] }).notNull(),
  requestedAt: integer("requested_at", { mode: "timestamp_ms" }), enteredOrLoadedAt: integer("entered_or_loaded_at", { mode: "timestamp_ms" }), finishedAt: integer("finished_at", { mode: "timestamp_ms" }), firstObservedAt: integer("first_observed_at", { mode: "timestamp_ms" }).notNull(), lastObservedAt: integer("last_observed_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  requestKeyUnique: uniqueIndex("resource_activity_request_key_unique").on(table.requestKey), correlationKeyUnique: uniqueIndex("resource_activity_correlation_key_unique").on(table.correlationKey),
  terminalCheck: check("resource_activity_terminal_check", sql`(${table.lifecycle} = 'terminal') = (${table.finishedAt} IS NOT NULL)`),
  requestCheck: check("resource_activity_request_check", sql`(${table.requestState} = 'requested') = (${table.requestedAt} IS NOT NULL)`),
  useCheck: check("resource_activity_use_check", sql`(${table.useState} = 'confirmed') = (${table.enteredOrLoadedAt} IS NOT NULL)`),
  kindCheck: check("resource_activity_kind_check", sql`${table.resourceKind} IN ('capability','skill')`),
  providerCheck: check("resource_activity_provider_check", sql`${table.provider} IS NULL OR ${table.provider} IN ('codex','opencode')`),
  requestStateCheck: check("resource_activity_request_state_check", sql`${table.requestState} IN ('not_observed','requested')`),
  useStateCheck: check("resource_activity_use_state_check", sql`${table.useState} IN ('not_confirmed','confirmed')`),
  lifecycleCheck: check("resource_activity_lifecycle_check", sql`${table.lifecycle} IN ('open','terminal')`),
  outcomeCheck: check("resource_activity_outcome_check", sql`${table.outcome} IN ('not_observed','success','reported_error','thrown','timeout','cancelled','rejected','permission_denied','load_failed')`),
  attributionCheck: check("resource_activity_attribution_check", sql`${table.attribution} IN ('exact','unknown','conflict')`),
  modeCheck: check("resource_activity_mode_check", sql`${table.mode} IN ('explicit','automatic','unknown')`),
  routingCheck: check("resource_activity_routing_check", sql`${table.routingIntegrity} IN ('verified','lease_mismatch','unknown')`),
  coverageCheck: check("resource_activity_coverage_check", sql`${table.coverage} IN ('qualified','pending','evidence_gap','provider_unqualified','format_drift','legacy_unverified','conflict')`),
}));

export const resourceActivityEvidence = sqliteTable("resource_activity_evidence", {
  id: text("id").primaryKey(), activityId: text("activity_id").notNull().references(() => resourceActivity.id, { onDelete: "cascade" }), boundary: text("boundary").notNull(), sourceEventKey: text("source_event_key").notNull(), correlationKey: text("correlation_key"), providerContract: text("provider_contract").notNull(), observedAt: integer("observed_at", { mode: "timestamp_ms" }).notNull(), canonicalDigest: text("canonical_digest"),
}, (table) => ({ sourceUnique: uniqueIndex("resource_activity_evidence_source_unique").on(table.boundary, table.sourceEventKey) }));

export const resourceActivitySessionRoutes = sqliteTable("resource_activity_session_routes", {
  routeKey: text("route_key").primaryKey(), runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }), worktreeId: text("worktree_id").notNull().references(() => worktrees.id, { onDelete: "cascade" }), provider: text("provider", { enum: ["codex", "opencode"] }).notNull(), providerVersion: text("provider_version").notNull(), adapterContractVersion: integer("adapter_contract_version").notNull(), runtimeGenerationId: text("runtime_generation_id").notNull(), assignmentGenerationId: text("assignment_generation_id").notNull().references(() => worktreeAssignmentGenerations.id, { onDelete: "restrict" }), catalogGenerationId: text("catalog_generation_id").notNull().references(() => worktreeRuntimeCatalogGenerations.id, { onDelete: "restrict" }), registeredAt: integer("registered_at", { mode: "timestamp_ms" }).notNull(), retiredAt: integer("retired_at", { mode: "timestamp_ms" }),
}, (table) => ({ providerCheck: check("resource_activity_session_routes_provider_check", sql`${table.provider} IN ('codex','opencode')`), contractCheck: check("resource_activity_session_routes_contract_check", sql`${table.adapterContractVersion} > 0`) }));

export const resourceEvidenceCoverage = sqliteTable("resource_evidence_coverage", {
  id: text("id").primaryKey(), worktreeId: text("worktree_id").notNull().references(() => worktrees.id, { onDelete: "cascade" }), provider: text("provider", { enum: ["codex", "opencode"] }).notNull(), providerVersion: text("provider_version").notNull(), adapterContractVersion: integer("adapter_contract_version").notNull(), runtimeGenerationId: text("runtime_generation_id").notNull(), assignmentGenerationId: text("assignment_generation_id").references(() => worktreeAssignmentGenerations.id, { onDelete: "restrict" }), catalogGenerationId: text("catalog_generation_id").references(() => worktreeRuntimeCatalogGenerations.id, { onDelete: "restrict" }), kind: text("kind", { enum: ["evidence_gap", "provider_unqualified", "format_drift", "security_conflict"] }).notNull(), sourceEventKey: text("source_event_key").notNull(), observedAt: integer("observed_at", { mode: "timestamp_ms" }).notNull(), resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
}, (table) => ({ sourceUnique: uniqueIndex("resource_evidence_coverage_source_unique").on(table.kind, table.sourceEventKey), providerCheck: check("resource_evidence_coverage_provider_check", sql`${table.provider} IN ('codex','opencode')`), kindCheck: check("resource_evidence_coverage_kind_check", sql`${table.kind} IN ('evidence_gap','provider_unqualified','format_drift','security_conflict')`), contractCheck: check("resource_evidence_coverage_contract_check", sql`${table.adapterContractVersion} > 0`) }));

export const resourceActivityOutbox = sqliteTable("resource_activity_outbox", {
  eventId: text("event_id").primaryKey(), runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }), sequence: integer("sequence").notNull(), schemaVersion: integer("schema_version").notNull(), safeDeltaJson: text("safe_delta_json").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), publishedAt: integer("published_at", { mode: "timestamp_ms" }),
}, (table) => ({ sequenceUnique: uniqueIndex("resource_activity_outbox_sequence_unique").on(table.runId, table.sequence) }));

export type ResourceVersionRecord = typeof resourceVersions.$inferSelect;
export type WorktreeAssignmentGenerationRecord = typeof worktreeAssignmentGenerations.$inferSelect;
export type WorktreeAssignmentRecord = typeof worktreeAssignments.$inferSelect;
