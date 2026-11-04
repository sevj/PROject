CREATE TABLE `query_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`container_name` text NOT NULL,
	`database` text NOT NULL,
	`statement` text NOT NULL,
	`ran_at` integer NOT NULL,
	`ok` integer NOT NULL,
	`row_count` integer,
	`elapsed_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `query_history_project` ON `query_history` (`project_id`,`ran_at`);