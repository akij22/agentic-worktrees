CREATE TABLE `repositories` (
  `id` text PRIMARY KEY NOT NULL,
  `github_repo_id` integer NOT NULL,
  `owner_login` text NOT NULL,
  `name` text NOT NULL,
  `full_name` text NOT NULL,
  `default_branch` text,
  `is_private` integer NOT NULL,
  `is_archived` integer DEFAULT 0 NOT NULL,
  `clone_url` text NOT NULL,
  `ssh_url` text,
  `html_url` text NOT NULL,
  `local_root_path` text,
  `local_clone_status` text NOT NULL,
  `last_local_scan_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `last_synced_at` integer
);

CREATE UNIQUE INDEX `repositories_github_repo_id_unique`
  ON `repositories` (`github_repo_id`);
CREATE UNIQUE INDEX `repositories_full_name_unique`
  ON `repositories` (`full_name`);
CREATE UNIQUE INDEX `repositories_local_root_path_unique`
  ON `repositories` (`local_root_path`);

CREATE TABLE `worktrees` (
  `id` text PRIMARY KEY NOT NULL,
  `repository_id` text NOT NULL,
  `name` text NOT NULL,
  `path` text NOT NULL,
  `branch_name` text NOT NULL,
  `base_branch_name` text,
  `head_commit_sha` text,
  `status` text NOT NULL,
  `active_run_id` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `last_synced_at` integer,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON DELETE restrict ON UPDATE no action
);

CREATE UNIQUE INDEX `worktrees_path_unique`
  ON `worktrees` (`path`);
CREATE INDEX `worktrees_repository_id_idx`
  ON `worktrees` (`repository_id`);

CREATE TABLE `runs` (
  `id` text PRIMARY KEY NOT NULL,
  `repository_id` text NOT NULL,
  `worktree_id` text NOT NULL,
  `title` text NOT NULL,
  `prompt` text NOT NULL,
  `status` text NOT NULL,
  `pid` integer,
  `command` text,
  `started_at` integer,
  `finished_at` integer,
  `exit_code` integer,
  `error_message` text,
  `output_status` text DEFAULT 'idle' NOT NULL,
  `last_output_at` integer,
  `last_sequence` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON DELETE restrict ON UPDATE no action,
  FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON DELETE restrict ON UPDATE no action
);

CREATE INDEX `runs_repository_id_idx`
  ON `runs` (`repository_id`);
CREATE INDEX `runs_worktree_id_idx`
  ON `runs` (`worktree_id`);
CREATE INDEX `runs_status_idx`
  ON `runs` (`status`);

CREATE TABLE `run_output_events` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `sequence` integer NOT NULL,
  `event_type` text NOT NULL,
  `stream` text,
  `payload` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE cascade ON UPDATE no action
);

CREATE UNIQUE INDEX `run_output_events_run_sequence_unique`
  ON `run_output_events` (`run_id`, `sequence`);
CREATE INDEX `run_output_events_run_sequence_idx`
  ON `run_output_events` (`run_id`, `sequence`);

CREATE TABLE `run_messages` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `role` text NOT NULL,
  `message_type` text NOT NULL,
  `content` text NOT NULL,
  `sequence` integer NOT NULL,
  `created_at` integer NOT NULL,
  `completed_at` integer,
  FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE cascade ON UPDATE no action
);

CREATE UNIQUE INDEX `run_messages_run_sequence_unique`
  ON `run_messages` (`run_id`, `sequence`);
CREATE INDEX `run_messages_run_sequence_idx`
  ON `run_messages` (`run_id`, `sequence`);
