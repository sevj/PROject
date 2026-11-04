CREATE TABLE `env_value_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`origin` text NOT NULL,
	`saved_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `env_value_history_project_key` ON `env_value_history` (`project_id`,`key`);