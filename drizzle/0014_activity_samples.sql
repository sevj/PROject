CREATE TABLE `activity_samples` (
	`project_id` integer NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `at`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
