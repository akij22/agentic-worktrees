CREATE TABLE `intelligence_changed_files` (
	`id` text PRIMARY KEY NOT NULL,
	`intelligence_worktree_id` text NOT NULL,
	`path` text NOT NULL,
	`previous_path` text,
	`change_type` text NOT NULL,
	`folder_path` text NOT NULL,
	`module_path` text NOT NULL,
	`additions` integer NOT NULL,
	`deletions` integer NOT NULL,
	`ranges` text NOT NULL,
	`patch` text,
	`binary` integer NOT NULL,
	`fingerprint` text NOT NULL,
	FOREIGN KEY (`intelligence_worktree_id`) REFERENCES `intelligence_worktrees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intelligence_changed_files_worktree_path_unique` ON `intelligence_changed_files` (`intelligence_worktree_id`,`path`);--> statement-breakpoint
CREATE INDEX `intelligence_changed_files_worktree_id_idx` ON `intelligence_changed_files` (`intelligence_worktree_id`);--> statement-breakpoint
CREATE TABLE `intelligence_changed_symbols` (
	`id` text PRIMARY KEY NOT NULL,
	`changed_file_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`qualified_name` text NOT NULL,
	`declaration_start` integer NOT NULL,
	`declaration_end` integer NOT NULL,
	`changed_start` integer NOT NULL,
	`changed_end` integer NOT NULL,
	FOREIGN KEY (`changed_file_id`) REFERENCES `intelligence_changed_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intelligence_changed_symbols_file_symbol_unique` ON `intelligence_changed_symbols` (`changed_file_id`,`qualified_name`,`declaration_start`,`declaration_end`);--> statement-breakpoint
CREATE INDEX `intelligence_changed_symbols_changed_file_id_idx` ON `intelligence_changed_symbols` (`changed_file_id`);--> statement-breakpoint
CREATE TABLE `intelligence_overlap_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`overlap_id` text NOT NULL,
	`target_type` text NOT NULL,
	`path` text NOT NULL,
	`symbol` text,
	`left_changed_file_id` text,
	`right_changed_file_id` text,
	`reason_code` text NOT NULL,
	`risk` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`overlap_id`) REFERENCES `intelligence_overlaps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`left_changed_file_id`) REFERENCES `intelligence_changed_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`right_changed_file_id`) REFERENCES `intelligence_changed_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intelligence_overlap_targets_overlap_target_unique` ON `intelligence_overlap_targets` (`overlap_id`,`target_type`,`path`,`symbol`);--> statement-breakpoint
CREATE INDEX `intelligence_overlap_targets_overlap_id_idx` ON `intelligence_overlap_targets` (`overlap_id`);--> statement-breakpoint
CREATE TABLE `intelligence_overlaps` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`left_intelligence_worktree_id` text NOT NULL,
	`right_intelligence_worktree_id` text NOT NULL,
	`risk` text NOT NULL,
	`category` text NOT NULL,
	`reason_code` text NOT NULL,
	`summary` text NOT NULL,
	`actionable` integer NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `intelligence_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`left_intelligence_worktree_id`) REFERENCES `intelligence_worktrees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`right_intelligence_worktree_id`) REFERENCES `intelligence_worktrees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intelligence_overlaps_snapshot_pair_unique` ON `intelligence_overlaps` (`snapshot_id`,`left_intelligence_worktree_id`,`right_intelligence_worktree_id`);--> statement-breakpoint
CREATE INDEX `intelligence_overlaps_snapshot_id_idx` ON `intelligence_overlaps` (`snapshot_id`);--> statement-breakpoint
CREATE TABLE `intelligence_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer NOT NULL,
	`source_metadata` text NOT NULL,
	`warnings` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intelligence_snapshots_repository_id_unique` ON `intelligence_snapshots` (`repository_id`);--> statement-breakpoint
CREATE TABLE `intelligence_worktrees` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`worktree_id` text NOT NULL,
	`run_id` text,
	`agent_kind` text,
	`agent_name` text,
	`agent_status` text NOT NULL,
	`task` text NOT NULL,
	`branch` text NOT NULL,
	`base_branch` text,
	`additions` integer NOT NULL,
	`deletions` integer NOT NULL,
	`changed_file_count` integer NOT NULL,
	`independent` integer NOT NULL,
	`warning` text,
	`activity_updated_at` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `intelligence_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intelligence_worktrees_snapshot_worktree_unique` ON `intelligence_worktrees` (`snapshot_id`,`worktree_id`);--> statement-breakpoint
CREATE INDEX `intelligence_worktrees_snapshot_id_idx` ON `intelligence_worktrees` (`snapshot_id`);