CREATE TABLE `environment_accesses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`environment_id` integer NOT NULL,
	`server_id` integer NOT NULL,
	`label` text NOT NULL,
	`path` text,
	`namespace` text,
	`target` text,
	`container` text,
	FOREIGN KEY (`environment_id`) REFERENCES `project_environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `remote_servers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `environment_accesses_environment` ON `environment_accesses` (`environment_id`);--> statement-breakpoint
CREATE TABLE `project_environments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`urls` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_environments_project_name` ON `project_environments` (`project_id`,`name`);--> statement-breakpoint
CREATE TABLE `remote_servers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`host` text,
	`port` integer,
	`username` text,
	`auth` text,
	`key_path` text,
	`jump_host` text,
	`context` text,
	`password_secret` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `remote_servers_name_unique` ON `remote_servers` (`name`);