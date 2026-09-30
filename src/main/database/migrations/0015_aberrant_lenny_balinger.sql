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
	CONSTRAINT "resource_activity_use_check" CHECK(("__new_resource_activity"."use_state" = 'confirmed') = ("__new_resource_activity"."entered_or_loaded_at" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_resource_activity`("id", "worktree_id", "run_id", "resource_kind", "resource_id", "resource_version", "resource_digest", "assignment_revision", "assignment_generation_id", "catalog_generation_id", "runtime_generation_id", "provider", "provider_version", "adapter_contract_version", "request_key", "correlation_key", "request_state", "use_state", "lifecycle", "outcome", "attribution", "mode", "routing_integrity", "coverage", "requested_at", "entered_or_loaded_at", "finished_at", "first_observed_at", "last_observed_at") SELECT "id", "worktree_id", "run_id", "resource_kind", "resource_id", "resource_version", "resource_digest", "assignment_revision", "assignment_generation_id", "catalog_generation_id", "runtime_generation_id", "provider", "provider_version", "adapter_contract_version", "request_key", "correlation_key", "request_state", "use_state", "lifecycle", "outcome", "attribution", "mode", "routing_integrity", "coverage", "requested_at", "entered_or_loaded_at", "finished_at", "first_observed_at", "last_observed_at" FROM `resource_activity`;--> statement-breakpoint
DROP TABLE `resource_activity`;--> statement-breakpoint
ALTER TABLE `__new_resource_activity` RENAME TO `resource_activity`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `resource_activity_request_key_unique` ON `resource_activity` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `resource_activity_correlation_key_unique` ON `resource_activity` (`correlation_key`);--> statement-breakpoint
CREATE TABLE `__new_resource_distribution_operations` (
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
	FOREIGN KEY (`target_resource_version_id`) REFERENCES `resource_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "resource_distribution_operations_kind_check" CHECK("__new_resource_distribution_operations"."resource_kind" IN ('capability','skill')),
	CONSTRAINT "resource_distribution_operations_status_check" CHECK("__new_resource_distribution_operations"."status" IN ('preparing','waiting_for_idle','applying','commit_pending','rolling_back','verified','failed','recovery_required','superseded','cancelled')),
	CONSTRAINT "resource_distribution_operations_boundary_check" CHECK("__new_resource_distribution_operations"."side_effect_boundary" IN ('none','gates_acquired','staged','activated','commit_pending')),
	CONSTRAINT "resource_distribution_operations_terminal_check" CHECK(("__new_resource_distribution_operations"."completed_at" IS NULL) = ("__new_resource_distribution_operations"."status" IN ('preparing','waiting_for_idle','applying','commit_pending','rolling_back','recovery_required')))
);
--> statement-breakpoint
INSERT INTO `__new_resource_distribution_operations`("id", "resource_kind", "resource_id", "target_resource_version_id", "status", "side_effect_boundary", "failure_code", "started_at", "updated_at", "completed_at") SELECT "id", "resource_kind", "resource_id", "target_resource_version_id", "status", "side_effect_boundary", "failure_code", "started_at", "updated_at", "completed_at" FROM `resource_distribution_operations`;--> statement-breakpoint
DROP TABLE `resource_distribution_operations`;--> statement-breakpoint
ALTER TABLE `__new_resource_distribution_operations` RENAME TO `resource_distribution_operations`;--> statement-breakpoint
CREATE UNIQUE INDEX `resource_distribution_operations_one_active_per_resource` ON `resource_distribution_operations` (`resource_kind`,`resource_id`) WHERE "resource_distribution_operations"."status" IN ('preparing','waiting_for_idle','applying','commit_pending','rolling_back','recovery_required');--> statement-breakpoint
CREATE INDEX `resource_distribution_operations_status_idx` ON `resource_distribution_operations` (`status`);--> statement-breakpoint
CREATE TABLE `__new_worktree_assignment_attempts` (
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
	CONSTRAINT "worktree_assignment_attempts_target_revision_check" CHECK("__new_worktree_assignment_attempts"."target_revision" >= 0),
	CONSTRAINT "worktree_assignment_attempts_kind_check" CHECK("__new_worktree_assignment_attempts"."kind" IN ('assignment_apply','runtime_join','recovery','resource_update','removal')),
	CONSTRAINT "worktree_assignment_attempts_status_check" CHECK("__new_worktree_assignment_attempts"."status" IN ('preparing','waiting_for_idle','applying','rolling_back','verified','failed_rolled_back','recovery_required','superseded','cancelled')),
	CONSTRAINT "worktree_assignment_attempts_boundary_check" CHECK("__new_worktree_assignment_attempts"."side_effect_boundary" IN ('none','staged','activated','commit_pending')),
	CONSTRAINT "worktree_assignment_attempts_terminal_check" CHECK(("__new_worktree_assignment_attempts"."completed_at" IS NULL) = ("__new_worktree_assignment_attempts"."status" IN ('preparing','waiting_for_idle','applying','rolling_back','recovery_required')))
);
--> statement-breakpoint
INSERT INTO `__new_worktree_assignment_attempts`("id", "worktree_id", "distribution_operation_id", "kind", "target_revision", "target_generation_id", "prior_verified_generation_id", "status", "side_effect_boundary", "failure_code", "started_at", "updated_at", "completed_at") SELECT "id", "worktree_id", "distribution_operation_id", "kind", "target_revision", "target_generation_id", "prior_verified_generation_id", "status", "side_effect_boundary", "failure_code", "started_at", "updated_at", "completed_at" FROM `worktree_assignment_attempts`;--> statement-breakpoint
DROP TABLE `worktree_assignment_attempts`;--> statement-breakpoint
ALTER TABLE `__new_worktree_assignment_attempts` RENAME TO `worktree_assignment_attempts`;--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_assignment_attempts_one_active_per_worktree` ON `worktree_assignment_attempts` (`worktree_id`) WHERE "worktree_assignment_attempts"."status" IN ('preparing','waiting_for_idle','applying','rolling_back');--> statement-breakpoint
CREATE INDEX `worktree_assignment_attempts_worktree_status_idx` ON `worktree_assignment_attempts` (`worktree_id`,`status`);