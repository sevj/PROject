CREATE TABLE `analyses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`kind` text NOT NULL,
	`result` text NOT NULL,
	`analyzed_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analyses_project_kind` ON `analyses` (`project_id`,`kind`);