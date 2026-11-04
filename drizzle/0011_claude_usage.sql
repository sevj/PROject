CREATE TABLE `claude_api_calls` (
	`message_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`project_id` integer,
	`cwd` text NOT NULL,
	`called_at` integer NOT NULL,
	`model` text NOT NULL,
	`is_sidechain` integer NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cache_read_tokens` integer NOT NULL,
	`cache_write_5m_tokens` integer NOT NULL,
	`cache_write_1h_tokens` integer NOT NULL,
	`web_search_requests` integer NOT NULL,
	`speed` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `claude_api_calls_project_called` ON `claude_api_calls` (`project_id`,`called_at`);--> statement-breakpoint
CREATE INDEX `claude_api_calls_session` ON `claude_api_calls` (`session_id`);--> statement-breakpoint
CREATE INDEX `claude_api_calls_cwd` ON `claude_api_calls` (`cwd`);--> statement-breakpoint
CREATE TABLE `claude_transcripts` (
	`path` text PRIMARY KEY NOT NULL,
	`offset` integer NOT NULL,
	`unreadable_lines` integer DEFAULT 0 NOT NULL
);
