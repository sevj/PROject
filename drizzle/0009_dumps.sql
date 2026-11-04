CREATE TABLE `dumps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer,
	`project_name` text NOT NULL,
	`container_name` text NOT NULL,
	`engine` text NOT NULL,
	`database` text,
	`file_name` text NOT NULL,
	`size_bytes` integer,
	`raw_bytes` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
