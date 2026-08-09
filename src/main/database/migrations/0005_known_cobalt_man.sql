CREATE TABLE `conflict_resolution_files` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`path` text NOT NULL,
	`kind` text NOT NULL,
	`risk` text NOT NULL,
	`reason_code` text NOT NULL,
	`left_path` text,
	`right_path` text,
	`symbol` text,
	`static_ranges` text NOT NULL,
	`git_stages` text NOT NULL,
	`marker_ranges` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `conflict_resolution_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conflict_resolution_files_session_path_unique` ON `conflict_resolution_files` (`session_id`,`path`);--> statement-breakpoint
CREATE INDEX `conflict_resolution_files_session_id_idx` ON `conflict_resolution_files` (`session_id`);--> statement-breakpoint
CREATE TABLE `conflict_resolution_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`stage` text NOT NULL,
	`kind` text NOT NULL,
	`command_summary` text,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`output_summary` text,
	`error_message` text,
	FOREIGN KEY (`session_id`) REFERENCES `conflict_resolution_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conflict_resolution_operations_session_sequence_unique` ON `conflict_resolution_operations` (`session_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `conflict_resolution_operations_session_id_idx` ON `conflict_resolution_operations` (`session_id`);--> statement-breakpoint
CREATE TABLE `conflict_resolution_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`side` text NOT NULL,
	`sort_order` integer NOT NULL,
	`worktree_id` text NOT NULL,
	`run_id` text,
	`task` text NOT NULL,
	`agent_name` text,
	`branch` text NOT NULL,
	`original_head_sha` text NOT NULL,
	`merge_base_sha` text NOT NULL,
	`synthetic_commit_sha` text NOT NULL,
	`synthetic_ref` text NOT NULL,
	`status_fingerprint_before` text NOT NULL,
	`status_fingerprint_after` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `conflict_resolution_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conflict_resolution_participants_session_side_unique` ON `conflict_resolution_participants` (`session_id`,`side`);--> statement-breakpoint
CREATE INDEX `conflict_resolution_participants_session_id_idx` ON `conflict_resolution_participants` (`session_id`);--> statement-breakpoint
CREATE TABLE `conflict_resolution_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`overlap_id` text NOT NULL,
	`target_branch` text NOT NULL,
	`target_commit_sha` text,
	`state` text NOT NULL,
	`classification` text,
	`current_stage` text NOT NULL,
	`integration_branch` text,
	`integration_path` text,
	`retained` integer NOT NULL,
	`cleanup_pending` integer NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `conflict_resolution_sessions_repository_updated_idx` ON `conflict_resolution_sessions` (`repository_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `conflict_resolution_sessions_overlap_updated_idx` ON `conflict_resolution_sessions` (`overlap_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `conflict_resolution_sessions_active_tuple_idx` ON `conflict_resolution_sessions` (`repository_id`,`overlap_id`,`target_branch`,`state`);