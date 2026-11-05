CREATE TABLE `http_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`method` text NOT NULL,
	`url` text NOT NULL,
	`headers` text DEFAULT '[]' NOT NULL,
	`body` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `http_responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`environment` text NOT NULL,
	`method` text NOT NULL,
	`url` text NOT NULL,
	`status` integer,
	`error` text,
	`duration_ms` integer NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`headers` text DEFAULT '[]' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`truncated` integer DEFAULT false NOT NULL,
	`sent_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `http_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `http_variables` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`environment_id` integer,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`secret` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `project_environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `http_variables_scope_name` ON `http_variables` (`project_id`,`environment_id`,`name`);