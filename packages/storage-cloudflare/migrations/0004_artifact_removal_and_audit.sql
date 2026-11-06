-- A removed artifact is hidden from everyone at once and purged 30 days after removed_at.
-- removed_as_admin marks an admin taking down someone else's artifact; only an admin may restore it.
ALTER TABLE artifacts ADD COLUMN removed_at INTEGER;
ALTER TABLE artifacts ADD COLUMN removed_by TEXT;
ALTER TABLE artifacts ADD COLUMN removed_as_admin INTEGER;
CREATE INDEX artifacts_removed ON artifacts(removed_at) WHERE removed_at IS NOT NULL;

-- Who removed, restored or renamed what, and who changed whose membership.
-- Events outlive the artifacts and memberships they name, so target_id has no foreign key.
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail TEXT NOT NULL CHECK (json_valid(detail)),
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_events_by_workspace ON audit_events(workspace_id, created_at);
