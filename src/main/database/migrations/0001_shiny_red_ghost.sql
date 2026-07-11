CREATE TABLE `coding_agent_installations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`executable_path` text NOT NULL,
	`version` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_verified_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coding_agent_installations_kind_unique` ON `coding_agent_installations` (`kind`);
--> statement-breakpoint
CREATE TABLE `coding_agent_sessions` (
	`run_id` text PRIMARY KEY NOT NULL,
	`installation_id` text NOT NULL,
	`external_session_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`installation_id`) REFERENCES `coding_agent_installations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coding_agent_sessions_external_session_id_unique` ON `coding_agent_sessions` (`external_session_id`);
--> statement-breakpoint
CREATE INDEX `coding_agent_sessions_installation_id_idx` ON `coding_agent_sessions` (`installation_id`);
