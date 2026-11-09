-- Who created a workspace, so the workspaces one person creates can be capped; NULL for a personal workspace,
-- which nobody creates by choice. Each existing workspace's first member is the person who created it. A deleted
-- workspace keeps its row, so it keeps counting until it is purged.
ALTER TABLE workspaces ADD COLUMN created_by TEXT;
UPDATE workspaces SET created_by = (
  SELECT user_id FROM memberships WHERE memberships.workspace_id = workspaces.id ORDER BY memberships.created_at, memberships.rowid LIMIT 1
) WHERE personal_of IS NULL;
CREATE INDEX workspaces_by_creator ON workspaces(created_by) WHERE created_by IS NOT NULL;
