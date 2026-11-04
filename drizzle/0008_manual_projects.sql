-- Projects are now added by hand. Rows the old scan kept without ever showing them
-- (plain folders, folders gone from the disk) would suddenly appear, so they go,
-- unless the user wrote something on them.
DELETE FROM projects
WHERE abandoned = 0
  AND kind <> 'group'
  AND (kind = 'folder' OR missing_at IS NOT NULL)
  AND id NOT IN (SELECT project_id FROM project_meta)
  AND id NOT IN (SELECT project_id FROM project_tags);
--> statement-breakpoint
DELETE FROM projects
WHERE kind = 'group'
  AND id NOT IN (SELECT parent_id FROM projects WHERE parent_id IS NOT NULL)
  AND id NOT IN (SELECT project_id FROM project_meta)
  AND id NOT IN (SELECT project_id FROM project_tags);
--> statement-breakpoint
UPDATE projects SET kind = 'project' WHERE kind = 'folder';
