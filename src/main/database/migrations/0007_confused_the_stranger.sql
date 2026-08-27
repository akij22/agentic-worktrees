CREATE TABLE `capability_installations` (
	`capability_id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`permission_digest` text NOT NULL,
	`configured` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `capability_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`capability_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text,
	`secret_ref` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`capability_id`) REFERENCES `capability_installations`(`capability_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capability_settings_capability_key_unique` ON `capability_settings` (`capability_id`,`key`);--> statement-breakpoint
CREATE INDEX `capability_settings_capability_id_idx` ON `capability_settings` (`capability_id`);--> statement-breakpoint
CREATE TABLE `session_capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`capability_id` text NOT NULL,
	`version` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`activated_at` integer,
	`deactivated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_capabilities_run_capability_unique` ON `session_capabilities` (`run_id`,`capability_id`);--> statement-breakpoint
CREATE INDEX `session_capabilities_run_id_idx` ON `session_capabilities` (`run_id`);--> statement-breakpoint
CREATE INDEX `session_capabilities_status_idx` ON `session_capabilities` (`status`);