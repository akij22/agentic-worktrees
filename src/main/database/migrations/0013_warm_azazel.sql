CREATE TABLE `resource_activity` (
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
	FOREIGN KEY (`catalog_generation_id`) REFERENCES `worktree_runtime_catalog_generations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_activity_request_key_unique` ON `resource_activity` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `resource_activity_correlation_key_unique` ON `resource_activity` (`correlation_key`);--> statement-breakpoint
CREATE TABLE `resource_activity_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`boundary` text NOT NULL,
	`source_event_key` text NOT NULL,
	`correlation_key` text,
	`provider_contract` text NOT NULL,
	`observed_at` integer NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `resource_activity`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_activity_evidence_source_unique` ON `resource_activity_evidence` (`boundary`,`source_event_key`);--> statement-breakpoint
CREATE TABLE `resource_activity_outbox` (
	`event_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`safe_delta_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_activity_outbox_sequence_unique` ON `resource_activity_outbox` (`run_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `resource_activity_session_routes` (
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
	FOREIGN KEY (`catalog_generation_id`) REFERENCES `worktree_runtime_catalog_generations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `resource_activity_streams` (
	`run_id` text PRIMARY KEY NOT NULL,
	`sequence` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "resource_activity_streams_sequence_check" CHECK("resource_activity_streams"."sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE `resource_distribution_operation_worktrees` (
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
	FOREIGN KEY (`attempt_id`) REFERENCES `worktree_assignment_attempts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_distribution_operation_worktrees_attempt_id_unique` ON `resource_distribution_operation_worktrees` (`attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `resource_distribution_operation_worktrees_order_unique` ON `resource_distribution_operation_worktrees` (`operation_id`,`apply_order`);--> statement-breakpoint
CREATE TABLE `resource_distribution_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`target_resource_version_id` text,
	`status` text NOT NULL,
	`side_effect_boundary` text NOT NULL,
	`failure_code` text,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`target_resource_version_id`) REFERENCES `resource_versions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `resource_evidence_coverage` (
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
	FOREIGN KEY (`catalog_generation_id`) REFERENCES `worktree_runtime_catalog_generations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_evidence_coverage_source_unique` ON `resource_evidence_coverage` (`kind`,`source_event_key`);--> statement-breakpoint
CREATE TABLE `resource_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`version` text NOT NULL,
	`content_digest` text NOT NULL,
	`security_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "resource_versions_content_digest_check" CHECK("resource_versions"."content_digest" GLOB 'sha256:[0-9a-f]*' AND length("resource_versions"."content_digest") = 71),
	CONSTRAINT "resource_versions_security_digest_check" CHECK("resource_versions"."security_digest" GLOB 'sha256:[0-9a-f]*' AND length("resource_versions"."security_digest") = 71)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_versions_identity_unique` ON `resource_versions` (`resource_kind`,`resource_id`,`version`,`content_digest`,`security_digest`);--> statement-breakpoint
CREATE TABLE `worktree_assignment_attempt_participants` (
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
	FOREIGN KEY (`target_catalog_generation_id`) REFERENCES `worktree_runtime_catalog_generations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_assignment_attempt_participants_order_unique` ON `worktree_assignment_attempt_participants` (`attempt_id`,`apply_order`);--> statement-breakpoint
CREATE TABLE `worktree_assignment_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`worktree_id` text NOT NULL,
	`distribution_operation_id` text,
	`kind` text NOT NULL,
	`target_revision` integer NOT NULL,
	`target_generation_id` text NOT NULL,
	`prior_verified_generation_id` text,
	`status` text NOT NULL,
	`side_effect_boundary` text NOT NULL,
	`failure_code` text,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`distribution_operation_id`) REFERENCES `resource_distribution_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`target_generation_id`) REFERENCES `worktree_assignment_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`prior_verified_generation_id`) REFERENCES `worktree_assignment_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "worktree_assignment_attempts_target_revision_check" CHECK("worktree_assignment_attempts"."target_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE `worktree_assignment_generation_resource_providers` (
	`generation_resource_id` text NOT NULL,
	`agent_kind` text NOT NULL,
	`availability` text NOT NULL,
	`skill_isolation` text NOT NULL,
	`qualification_digest` text NOT NULL,
	`expected_state_digest` text NOT NULL,
	PRIMARY KEY(`generation_resource_id`, `agent_kind`),
	FOREIGN KEY (`generation_resource_id`) REFERENCES `worktree_assignment_generation_resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `worktree_assignment_generation_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_id` text NOT NULL,
	`resource_version_id` text NOT NULL,
	`configuration_digest` text NOT NULL,
	`invocation_policy_digest` text NOT NULL,
	FOREIGN KEY (`generation_id`) REFERENCES `worktree_assignment_generations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_version_id`) REFERENCES `resource_versions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_assignment_generation_resources_member_unique` ON `worktree_assignment_generation_resources` (`generation_id`,`resource_version_id`);--> statement-breakpoint
CREATE TABLE `worktree_assignment_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`worktree_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`resource_set_digest` text NOT NULL,
	`migration_key` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "worktree_assignment_generations_ordinal_check" CHECK("worktree_assignment_generations"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_assignment_generations_ordinal_unique` ON `worktree_assignment_generations` (`worktree_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_assignment_generations_digest_unique` ON `worktree_assignment_generations` (`worktree_id`,`resource_set_digest`);--> statement-breakpoint
CREATE TABLE `worktree_assignment_migrations` (
	`migration_key` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`worktree_count` integer NOT NULL,
	`resource_version_count` integer NOT NULL,
	`generation_count` integer NOT NULL,
	`failure_code` text,
	`started_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `worktree_assignment_outbox` (
	`event_id` text PRIMARY KEY NOT NULL,
	`worktree_id` text NOT NULL,
	`revision` integer NOT NULL,
	`projection_sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`schema_version` integer NOT NULL,
	`safe_payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_assignment_outbox_sequence_unique` ON `worktree_assignment_outbox` (`worktree_id`,`projection_sequence`);--> statement-breakpoint
CREATE TABLE `worktree_assignments` (
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
	CONSTRAINT "worktree_assignments_revision_check" CHECK("worktree_assignments"."revision" >= 0),
	CONSTRAINT "worktree_assignments_sequence_check" CHECK("worktree_assignments"."projection_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE `worktree_runtime_assignment_attestations` (
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
	FOREIGN KEY (`catalog_generation_id`) REFERENCES `worktree_runtime_catalog_generations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `worktree_runtime_catalog_generations` (
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
	CONSTRAINT "worktree_runtime_catalog_generations_contract_version_check" CHECK("worktree_runtime_catalog_generations"."adapter_contract_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_runtime_catalog_generations_identity_unique` ON `worktree_runtime_catalog_generations` (`worktree_id`,`agent_kind`,`assignment_generation_id`,`provider_version`,`adapter_contract_version`,`projection_digest`);