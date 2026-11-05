CREATE TABLE `vpns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`config_path` text,
	`connection_uuid` text,
	`username` text,
	`password_secret` text,
	`token_appended` integer DEFAULT false NOT NULL,
	`gateway` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vpns_name_unique` ON `vpns` (`name`);--> statement-breakpoint
ALTER TABLE `remote_servers` ADD `vpn_id` integer REFERENCES vpns(id) ON DELETE set null;