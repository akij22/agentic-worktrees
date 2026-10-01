CREATE TABLE `worktree_capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`worktree_id` text NOT NULL,
	`capability_id` text NOT NULL,
	`version` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`activated_at` integer,
	`deactivated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_capabilities_worktree_capability_unique` ON `worktree_capabilities` (`worktree_id`,`capability_id`);--> statement-breakpoint
CREATE INDEX `worktree_capabilities_worktree_id_idx` ON `worktree_capabilities` (`worktree_id`);--> statement-breakpoint
CREATE INDEX `worktree_capabilities_capability_id_idx` ON `worktree_capabilities` (`capability_id`);--> statement-breakpoint
CREATE INDEX `worktree_capabilities_status_idx` ON `worktree_capabilities` (`status`);