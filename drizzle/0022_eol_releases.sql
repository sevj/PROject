CREATE TABLE `eol_releases` (
	`product` text PRIMARY KEY NOT NULL,
	`releases` text NOT NULL,
	`fetched_at` integer NOT NULL
);
