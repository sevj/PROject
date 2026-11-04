ALTER TABLE `project_facts` ADD `branch_count` integer;--> statement-breakpoint
ALTER TABLE `project_facts` ADD `stash_count` integer;--> statement-breakpoint
ALTER TABLE `project_facts` ADD `first_commit_at` integer;--> statement-breakpoint
ALTER TABLE `project_facts` ADD `last_commit_author` text;--> statement-breakpoint
ALTER TABLE `project_facts` ADD `versions` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_facts` ADD `package_managers` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_facts` ADD `ci` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_facts` ADD `test_tools` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_facts` ADD `manifest_description` text;--> statement-breakpoint
ALTER TABLE `project_facts` ADD `deps_bytes` integer;--> statement-breakpoint
ALTER TABLE `project_facts` ADD `git_bytes` integer;--> statement-breakpoint
ALTER TABLE `project_meta` ADD `description` text;