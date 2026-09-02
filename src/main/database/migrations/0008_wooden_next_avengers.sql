CREATE TABLE `skill_installations` (
	`skill_id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_ref` text NOT NULL,
	`content_digest` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`license` text,
	`codex_compatibility` text NOT NULL,
	`opencode_compatibility` text NOT NULL,
	`automatic_invocation` integer NOT NULL,
	`state` text NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `skill_installations_state_idx` ON `skill_installations` (`state`);--> statement-breakpoint
CREATE TABLE `skill_invocations` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`version` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`requested_at` integer NOT NULL,
	`loaded_at` integer,
	`failed_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_invocations_run_id_idx` ON `skill_invocations` (`run_id`);--> statement-breakpoint
CREATE INDEX `skill_invocations_skill_id_idx` ON `skill_invocations` (`skill_id`);