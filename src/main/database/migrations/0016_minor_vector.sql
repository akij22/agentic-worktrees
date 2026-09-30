PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_resource_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`worktree_id` text NOT NULL,
	`run_id` text,
	`resource_kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`resource_version` text NOT NULL,
	`resource_digest` text,
	`assignment_revision` text,
	`assignment_generation_id` text,
	`catalog_generation_id` text,
	`runtime_generation_id` text,
	`provider` text,
	`provider_version` text,
	`adapter_contract_version` integer,
	`request_key` text,
	`correlation_key` text,
	`request_state` text NOT NULL,
	`use_state` text NOT NULL,
	`lifecycle` text NOT NULL,
	`outcome` text NOT NULL,
	`attribution` text NOT NULL,
	`mode` text NOT NULL,
	`routing_integrity` text NOT NULL,
	`coverage` text NOT NULL,
	`requested_at` integer,
	`entered_or_loaded_at` integer,
	`finished_at` integer,
	`first_observed_at` integer NOT NULL,
	`last_observed_at` integer NOT NULL,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignment_generation_id`) REFERENCES `worktree_assignment_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`catalog_generation_id`) REFERENCES `worktree_runtime_catalog_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "resource_activity_terminal_check" CHECK(("__new_resource_activity"."lifecycle" = 'terminal') = ("__new_resource_activity"."finished_at" IS NOT NULL)),
	CONSTRAINT "resource_activity_request_check" CHECK(("__new_resource_activity"."request_state" = 'requested') = ("__new_resource_activity"."requested_at" IS NOT NULL)),
	CONSTRAINT "resource_activity_use_check" CHECK(("__new_resource_activity"."use_state" = 'confirmed') = ("__new_resource_activity"."entered_or_loaded_at" IS NOT NULL)),
	CONSTRAINT "resource_activity_kind_check" CHECK("__new_resource_activity"."resource_kind" IN ('capability','skill')),
	CONSTRAINT "resource_activity_provider_check" CHECK("__new_resource_activity"."provider" IS NULL OR "__new_resource_activity"."provider" IN ('codex','opencode')),
	CONSTRAINT "resource_activity_request_state_check" CHECK("__new_resource_activity"."request_state" IN ('not_observed','requested')),
	CONSTRAINT "resource_activity_use_state_check" CHECK("__new_resource_activity"."use_state" IN ('not_confirmed','confirmed')),
	CONSTRAINT "resource_activity_lifecycle_check" CHECK("__new_resource_activity"."lifecycle" IN ('open','terminal')),
	CONSTRAINT "resource_activity_outcome_check" CHECK("__new_resource_activity"."outcome" IN ('not_observed','success','reported_error','thrown','timeout','cancelled','rejected','permission_denied','load_failed')),
	CONSTRAINT "resource_activity_attribution_check" CHECK("__new_resource_activity"."attribution" IN ('exact','unknown','conflict')),
	CONSTRAINT "resource_activity_mode_check" CHECK("__new_resource_activity"."mode" IN ('explicit','automatic','unknown')),
	CONSTRAINT "resource_activity_routing_check" CHECK("__new_resource_activity"."routing_integrity" IN ('verified','lease_mismatch','unknown')),
	CONSTRAINT "resource_activity_coverage_check" CHECK("__new_resource_activity"."coverage" IN ('qualified','pending','evidence_gap','provider_unqualified','format_drift','legacy_unverified','conflict'))
);
--> statement-breakpoint
INSERT INTO `__new_resource_activity`("id", "worktree_id", "run_id", "resource_kind", "resource_id", "resource_version", "resource_digest", "assignment_revision", "assignment_generation_id", "catalog_generation_id", "runtime_generation_id", "provider", "provider_version", "adapter_contract_version", "request_key", "correlation_key", "request_state", "use_state", "lifecycle", "outcome", "attribution", "mode", "routing_integrity", "coverage", "requested_at", "entered_or_loaded_at", "finished_at", "first_observed_at", "last_observed_at") SELECT "id", "worktree_id", "run_id", "resource_kind", "resource_id", "resource_version", "resource_digest", "assignment_revision", "assignment_generation_id", "catalog_generation_id", "runtime_generation_id", "provider", "provider_version", "adapter_contract_version", "request_key", "correlation_key", "request_state", "use_state", "lifecycle", "outcome", "attribution", "mode", "routing_integrity", "coverage", "requested_at", "entered_or_loaded_at", "finished_at", "first_observed_at", "last_observed_at" FROM `resource_activity`;--> statement-breakpoint
DROP TABLE `resource_activity`;--> statement-breakpoint
ALTER TABLE `__new_resource_activity` RENAME TO `resource_activity`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `resource_activity_request_key_unique` ON `resource_activity` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `resource_activity_correlation_key_unique` ON `resource_activity` (`correlation_key`);--> statement-breakpoint
CREATE TABLE `__new_resource_activity_session_routes` (
	`route_key` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`worktree_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_version` text NOT NULL,
	`adapter_contract_version` integer NOT NULL,
	`runtime_generation_id` text NOT NULL,
	`assignment_generation_id` text NOT NULL,
	`catalog_generation_id` text NOT NULL,
	`registered_at` integer NOT NULL,
	`retired_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignment_generation_id`) REFERENCES `worktree_assignment_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`catalog_generation_id`) REFERENCES `worktree_runtime_catalog_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "resource_activity_session_routes_provider_check" CHECK("__new_resource_activity_session_routes"."provider" IN ('codex','opencode')),
	CONSTRAINT "resource_activity_session_routes_contract_check" CHECK("__new_resource_activity_session_routes"."adapter_contract_version" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_resource_activity_session_routes`("route_key", "run_id", "worktree_id", "provider", "provider_version", "adapter_contract_version", "runtime_generation_id", "assignment_generation_id", "catalog_generation_id", "registered_at", "retired_at") SELECT "route_key", "run_id", "worktree_id", "provider", "provider_version", "adapter_contract_version", "runtime_generation_id", "assignment_generation_id", "catalog_generation_id", "registered_at", "retired_at" FROM `resource_activity_session_routes`;--> statement-breakpoint
DROP TABLE `resource_activity_session_routes`;--> statement-breakpoint
ALTER TABLE `__new_resource_activity_session_routes` RENAME TO `resource_activity_session_routes`;--> statement-breakpoint
CREATE TABLE `__new_resource_distribution_operation_worktrees` (
	`operation_id` text NOT NULL,
	`worktree_id` text NOT NULL,
	`apply_order` integer NOT NULL,
	`observed_revision` integer NOT NULL,
	`prior_generation_id` text NOT NULL,
	`target_generation_id` text NOT NULL,
	`attempt_id` text,
	`state` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`operation_id`, `worktree_id`),
	FOREIGN KEY (`operation_id`) REFERENCES `resource_distribution_operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prior_generation_id`) REFERENCES `worktree_assignment_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`target_generation_id`) REFERENCES `worktree_assignment_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`attempt_id`) REFERENCES `worktree_assignment_attempts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "resource_distribution_operation_worktrees_order_check" CHECK("__new_resource_distribution_operation_worktrees"."apply_order" >= 0),
	CONSTRAINT "resource_distribution_operation_worktrees_revision_check" CHECK("__new_resource_distribution_operation_worktrees"."observed_revision" >= 0),
	CONSTRAINT "resource_distribution_operation_worktrees_state_check" CHECK("__new_resource_distribution_operation_worktrees"."state" IN ('planned','gate_acquired','staged','activated','commit_ready','committed','rollback_started','rolled_back','unknown'))
);
--> statement-breakpoint
INSERT INTO `__new_resource_distribution_operation_worktrees`("operation_id", "worktree_id", "apply_order", "observed_revision", "prior_generation_id", "target_generation_id", "attempt_id", "state", "updated_at") SELECT "operation_id", "worktree_id", "apply_order", "observed_revision", "prior_generation_id", "target_generation_id", "attempt_id", "state", "updated_at" FROM `resource_distribution_operation_worktrees`;--> statement-breakpoint
DROP TABLE `resource_distribution_operation_worktrees`;--> statement-breakpoint
ALTER TABLE `__new_resource_distribution_operation_worktrees` RENAME TO `resource_distribution_operation_worktrees`;--> statement-breakpoint
CREATE UNIQUE INDEX `resource_distribution_operation_worktrees_attempt_id_unique` ON `resource_distribution_operation_worktrees` (`attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `resource_distribution_operation_worktrees_order_unique` ON `resource_distribution_operation_worktrees` (`operation_id`,`apply_order`);--> statement-breakpoint
CREATE TABLE `__new_resource_evidence_coverage` (
	`id` text PRIMARY KEY NOT NULL,
	`worktree_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_version` text NOT NULL,
	`adapter_contract_version` integer NOT NULL,
	`runtime_generation_id` text NOT NULL,
	`assignment_generation_id` text,
	`catalog_generation_id` text,
	`kind` text NOT NULL,
	`source_event_key` text NOT NULL,
	`observed_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignment_generation_id`) REFERENCES `worktree_assignment_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`catalog_generation_id`) REFERENCES `worktree_runtime_catalog_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "resource_evidence_coverage_provider_check" CHECK("__new_resource_evidence_coverage"."provider" IN ('codex','opencode')),
	CONSTRAINT "resource_evidence_coverage_kind_check" CHECK("__new_resource_evidence_coverage"."kind" IN ('evidence_gap','provider_unqualified','format_drift','security_conflict')),
	CONSTRAINT "resource_evidence_coverage_contract_check" CHECK("__new_resource_evidence_coverage"."adapter_contract_version" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_resource_evidence_coverage`("id", "worktree_id", "provider", "provider_version", "adapter_contract_version", "runtime_generation_id", "assignment_generation_id", "catalog_generation_id", "kind", "source_event_key", "observed_at", "resolved_at") SELECT "id", "worktree_id", "provider", "provider_version", "adapter_contract_version", "runtime_generation_id", "assignment_generation_id", "catalog_generation_id", "kind", "source_event_key", "observed_at", "resolved_at" FROM `resource_evidence_coverage`;--> statement-breakpoint
DROP TABLE `resource_evidence_coverage`;--> statement-breakpoint
ALTER TABLE `__new_resource_evidence_coverage` RENAME TO `resource_evidence_coverage`;--> statement-breakpoint
CREATE UNIQUE INDEX `resource_evidence_coverage_source_unique` ON `resource_evidence_coverage` (`kind`,`source_event_key`);--> statement-breakpoint
CREATE TABLE `__new_resource_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`version` text NOT NULL,
	`content_digest` text NOT NULL,
	`security_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "resource_versions_content_digest_check" CHECK("__new_resource_versions"."content_digest" GLOB 'sha256:[0-9a-f]*' AND length("__new_resource_versions"."content_digest") = 71),
	CONSTRAINT "resource_versions_security_digest_check" CHECK("__new_resource_versions"."security_digest" GLOB 'sha256:[0-9a-f]*' AND length("__new_resource_versions"."security_digest") = 71),
	CONSTRAINT "resource_versions_kind_check" CHECK("__new_resource_versions"."resource_kind" IN ('capability','skill'))
);
--> statement-breakpoint
INSERT INTO `__new_resource_versions`("id", "resource_kind", "resource_id", "version", "content_digest", "security_digest", "created_at") SELECT "id", "resource_kind", "resource_id", "version", "content_digest", "security_digest", "created_at" FROM `resource_versions`;--> statement-breakpoint
DROP TABLE `resource_versions`;--> statement-breakpoint
ALTER TABLE `__new_resource_versions` RENAME TO `resource_versions`;--> statement-breakpoint
CREATE UNIQUE INDEX `resource_versions_identity_unique` ON `resource_versions` (`resource_kind`,`resource_id`,`version`,`content_digest`,`security_digest`);--> statement-breakpoint
CREATE TABLE `__new_worktree_assignment_attempt_participants` (
	`attempt_id` text NOT NULL,
	`agent_kind` text NOT NULL,
	`runtime_generation` text NOT NULL,
	`provider_version` text NOT NULL,
	`prior_catalog_generation_id` text,
	`target_catalog_generation_id` text NOT NULL,
	`apply_order` integer NOT NULL,
	`state` text NOT NULL,
	`prior_effective_state_digest` text,
	`target_effective_state_digest` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`attempt_id`, `agent_kind`, `runtime_generation`),
	FOREIGN KEY (`attempt_id`) REFERENCES `worktree_assignment_attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prior_catalog_generation_id`) REFERENCES `worktree_runtime_catalog_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`target_catalog_generation_id`) REFERENCES `worktree_runtime_catalog_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "worktree_assignment_attempt_participants_order_check" CHECK("__new_worktree_assignment_attempt_participants"."apply_order" >= 0),
	CONSTRAINT "worktree_assignment_attempt_participants_agent_check" CHECK("__new_worktree_assignment_attempt_participants"."agent_kind" IN ('codex','opencode')),
	CONSTRAINT "worktree_assignment_attempt_participants_state_check" CHECK("__new_worktree_assignment_attempt_participants"."state" IN ('planned','staged','activated','verified','rollback_started','rolled_back','unknown'))
);
--> statement-breakpoint
INSERT INTO `__new_worktree_assignment_attempt_participants`("attempt_id", "agent_kind", "runtime_generation", "provider_version", "prior_catalog_generation_id", "target_catalog_generation_id", "apply_order", "state", "prior_effective_state_digest", "target_effective_state_digest", "updated_at") SELECT "attempt_id", "agent_kind", "runtime_generation", "provider_version", "prior_catalog_generation_id", "target_catalog_generation_id", "apply_order", "state", "prior_effective_state_digest", "target_effective_state_digest", "updated_at" FROM `worktree_assignment_attempt_participants`;--> statement-breakpoint
DROP TABLE `worktree_assignment_attempt_participants`;--> statement-breakpoint
ALTER TABLE `__new_worktree_assignment_attempt_participants` RENAME TO `worktree_assignment_attempt_participants`;--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_assignment_attempt_participants_order_unique` ON `worktree_assignment_attempt_participants` (`attempt_id`,`apply_order`);--> statement-breakpoint
CREATE TABLE `__new_worktree_assignment_generation_resource_providers` (
	`generation_resource_id` text NOT NULL,
	`agent_kind` text NOT NULL,
	`availability` text NOT NULL,
	`skill_isolation` text NOT NULL,
	`qualification_digest` text NOT NULL,
	`expected_state_digest` text NOT NULL,
	PRIMARY KEY(`generation_resource_id`, `agent_kind`),
	FOREIGN KEY (`generation_resource_id`) REFERENCES `worktree_assignment_generation_resources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "worktree_assignment_generation_resource_providers_agent_check" CHECK("__new_worktree_assignment_generation_resource_providers"."agent_kind" IN ('codex','opencode')),
	CONSTRAINT "worktree_assignment_generation_resource_providers_availability_check" CHECK("__new_worktree_assignment_generation_resource_providers"."availability" IN ('compatible','unavailable')),
	CONSTRAINT "worktree_assignment_generation_resource_providers_isolation_check" CHECK("__new_worktree_assignment_generation_resource_providers"."skill_isolation" IN ('enforced','not_enforced','not_applicable'))
);
--> statement-breakpoint
INSERT INTO `__new_worktree_assignment_generation_resource_providers`("generation_resource_id", "agent_kind", "availability", "skill_isolation", "qualification_digest", "expected_state_digest") SELECT "generation_resource_id", "agent_kind", "availability", "skill_isolation", "qualification_digest", "expected_state_digest" FROM `worktree_assignment_generation_resource_providers`;--> statement-breakpoint
DROP TABLE `worktree_assignment_generation_resource_providers`;--> statement-breakpoint
ALTER TABLE `__new_worktree_assignment_generation_resource_providers` RENAME TO `worktree_assignment_generation_resource_providers`;--> statement-breakpoint
CREATE TABLE `__new_worktree_assignment_migrations` (
	`migration_key` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`worktree_count` integer NOT NULL,
	`resource_version_count` integer NOT NULL,
	`generation_count` integer NOT NULL,
	`failure_code` text,
	`started_at` integer,
	`completed_at` integer,
	CONSTRAINT "worktree_assignment_migrations_status_check" CHECK("__new_worktree_assignment_migrations"."status" IN ('pending','applying','verified','failed')),
	CONSTRAINT "worktree_assignment_migrations_count_check" CHECK("__new_worktree_assignment_migrations"."worktree_count" >= 0 AND "__new_worktree_assignment_migrations"."resource_version_count" >= 0 AND "__new_worktree_assignment_migrations"."generation_count" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_worktree_assignment_migrations`("migration_key", "status", "source_fingerprint", "worktree_count", "resource_version_count", "generation_count", "failure_code", "started_at", "completed_at") SELECT "migration_key", "status", "source_fingerprint", "worktree_count", "resource_version_count", "generation_count", "failure_code", "started_at", "completed_at" FROM `worktree_assignment_migrations`;--> statement-breakpoint
DROP TABLE `worktree_assignment_migrations`;--> statement-breakpoint
ALTER TABLE `__new_worktree_assignment_migrations` RENAME TO `worktree_assignment_migrations`;--> statement-breakpoint
CREATE TABLE `__new_worktree_assignments` (
	`worktree_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`projection_sequence` integer NOT NULL,
	`phase` text NOT NULL,
	`desired_generation_id` text NOT NULL,
	`verified_generation_id` text,
	`failure_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`desired_generation_id`) REFERENCES `worktree_assignment_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`verified_generation_id`) REFERENCES `worktree_assignment_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "worktree_assignments_revision_check" CHECK("__new_worktree_assignments"."revision" >= 0),
	CONSTRAINT "worktree_assignments_sequence_check" CHECK("__new_worktree_assignments"."projection_sequence" >= 0),
	CONSTRAINT "worktree_assignments_phase_check" CHECK("__new_worktree_assignments"."phase" IN ('reconciling','stable','waiting_for_idle','applying','rolling_back','failed_rolled_back','recovery_required','removing'))
);
--> statement-breakpoint
INSERT INTO `__new_worktree_assignments`("worktree_id", "revision", "projection_sequence", "phase", "desired_generation_id", "verified_generation_id", "failure_code", "created_at", "updated_at") SELECT "worktree_id", "revision", "projection_sequence", "phase", "desired_generation_id", "verified_generation_id", "failure_code", "created_at", "updated_at" FROM `worktree_assignments`;--> statement-breakpoint
DROP TABLE `worktree_assignments`;--> statement-breakpoint
ALTER TABLE `__new_worktree_assignments` RENAME TO `worktree_assignments`;--> statement-breakpoint
CREATE TABLE `__new_worktree_runtime_assignment_attestations` (
	`worktree_id` text NOT NULL,
	`agent_kind` text NOT NULL,
	`runtime_generation` text NOT NULL,
	`assignment_generation_id` text NOT NULL,
	`catalog_generation_id` text NOT NULL,
	`provider_version` text NOT NULL,
	`effective_state_digest` text NOT NULL,
	`verified_at` integer NOT NULL,
	`invalidated_at` integer,
	`invalidation_code` text,
	PRIMARY KEY(`worktree_id`, `agent_kind`, `runtime_generation`),
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignment_generation_id`) REFERENCES `worktree_assignment_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`catalog_generation_id`) REFERENCES `worktree_runtime_catalog_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "worktree_runtime_assignment_attestations_agent_check" CHECK("__new_worktree_runtime_assignment_attestations"."agent_kind" IN ('codex','opencode'))
);
--> statement-breakpoint
INSERT INTO `__new_worktree_runtime_assignment_attestations`("worktree_id", "agent_kind", "runtime_generation", "assignment_generation_id", "catalog_generation_id", "provider_version", "effective_state_digest", "verified_at", "invalidated_at", "invalidation_code") SELECT "worktree_id", "agent_kind", "runtime_generation", "assignment_generation_id", "catalog_generation_id", "provider_version", "effective_state_digest", "verified_at", "invalidated_at", "invalidation_code" FROM `worktree_runtime_assignment_attestations`;--> statement-breakpoint
DROP TABLE `worktree_runtime_assignment_attestations`;--> statement-breakpoint
ALTER TABLE `__new_worktree_runtime_assignment_attestations` RENAME TO `worktree_runtime_assignment_attestations`;--> statement-breakpoint
CREATE TABLE `__new_worktree_runtime_catalog_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`worktree_id` text NOT NULL,
	`agent_kind` text NOT NULL,
	`assignment_generation_id` text NOT NULL,
	`provider_version` text NOT NULL,
	`adapter_contract_version` integer NOT NULL,
	`projection_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignment_generation_id`) REFERENCES `worktree_assignment_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "worktree_runtime_catalog_generations_contract_version_check" CHECK("__new_worktree_runtime_catalog_generations"."adapter_contract_version" > 0),
	CONSTRAINT "worktree_runtime_catalog_generations_agent_check" CHECK("__new_worktree_runtime_catalog_generations"."agent_kind" IN ('codex','opencode'))
);
--> statement-breakpoint
INSERT INTO `__new_worktree_runtime_catalog_generations`("id", "worktree_id", "agent_kind", "assignment_generation_id", "provider_version", "adapter_contract_version", "projection_digest", "created_at") SELECT "id", "worktree_id", "agent_kind", "assignment_generation_id", "provider_version", "adapter_contract_version", "projection_digest", "created_at" FROM `worktree_runtime_catalog_generations`;--> statement-breakpoint
DROP TABLE `worktree_runtime_catalog_generations`;--> statement-breakpoint
ALTER TABLE `__new_worktree_runtime_catalog_generations` RENAME TO `worktree_runtime_catalog_generations`;--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_runtime_catalog_generations_identity_unique` ON `worktree_runtime_catalog_generations` (`worktree_id`,`agent_kind`,`assignment_generation_id`,`provider_version`,`adapter_contract_version`,`projection_digest`);