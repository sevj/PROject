CREATE TABLE `collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_name_unique` ON `collections` (`name`);--> statement-breakpoint
CREATE TABLE `project_collections` (
	`project_id` integer NOT NULL,
	`collection_id` integer NOT NULL,
	PRIMARY KEY(`project_id`, `collection_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_facts` (
	`project_id` integer PRIMARY KEY NOT NULL,
	`stacks` text DEFAULT '[]' NOT NULL,
	`has_git` integer DEFAULT false NOT NULL,
	`branch` text,
	`upstream` text,
	`ahead` integer,
	`behind` integer,
	`dirty_count` integer,
	`remote_url` text,
	`commit_count` integer,
	`last_commit_at` integer,
	`last_commit_subject` text,
	`weekly_commits` text,
	`has_compose` integer DEFAULT false NOT NULL,
	`containers` text DEFAULT '[]' NOT NULL,
	`docs` text DEFAULT '[]' NOT NULL,
	`env_files` text DEFAULT '[]' NOT NULL,
	`size_bytes` integer,
	`size_scanned_at` integer,
	`scan_error` text,
	`scanned_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_meta` (
	`project_id` integer PRIMARY KEY NOT NULL,
	`status` text,
	`favorite` integer DEFAULT false NOT NULL,
	`note` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_tags` (
	`project_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`project_id`, `tag_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'project' NOT NULL,
	`parent_id` integer,
	`hidden` integer DEFAULT false NOT NULL,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`missing_at` integer,
	FOREIGN KEY (`parent_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_path_unique` ON `projects` (`path`);--> statement-breakpoint
CREATE TABLE `scans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`project_count` integer,
	`error_count` integer,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);