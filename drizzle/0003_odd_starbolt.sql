ALTER TABLE `projects` ADD `abandoned` integer DEFAULT false NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `tags` (`name`) SELECT `name` FROM `collections` WHERE `name` <> 'Abandonnés';
--> statement-breakpoint
INSERT OR IGNORE INTO `project_tags` (`project_id`, `tag_id`) SELECT pc.`project_id`, t.`id` FROM `project_collections` pc JOIN `collections` c ON c.`id` = pc.`collection_id` JOIN `tags` t ON t.`name` = c.`name` WHERE c.`name` <> 'Abandonnés';
--> statement-breakpoint
UPDATE `projects` SET `abandoned` = 1 WHERE `hidden` = 1 OR `id` IN (SELECT pc.`project_id` FROM `project_collections` pc JOIN `collections` c ON c.`id` = pc.`collection_id` WHERE c.`name` = 'Abandonnés');
