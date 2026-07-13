CREATE TABLE `coding_agent_session_diffs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`file` text NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`additions` integer NOT NULL,
	`deletions` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `coding_agent_session_diffs_run_id_idx` ON `coding_agent_session_diffs` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `coding_agent_session_diffs_run_file_unique` ON `coding_agent_session_diffs` (`run_id`,`file`);