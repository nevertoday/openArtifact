-- Every person has one personal workspace, created on first sign-in; the unique index lets two requests that
-- race to create it end with a single row.
ALTER TABLE workspaces ADD COLUMN personal_of TEXT;
CREATE UNIQUE INDEX workspaces_by_personal_owner ON workspaces(personal_of) WHERE personal_of IS NOT NULL;

-- An admin deleted the workspace; it can be restored until the daily purge deletes it for good.
ALTER TABLE workspaces ADD COLUMN deleted_at INTEGER;

-- The person left on their own. Unlike removed_at, any invite brings them back.
ALTER TABLE memberships ADD COLUMN left_at INTEGER;

-- An invite link may never expire, so expires_at becomes nullable. SQLite changes a column's constraint only by
-- rebuilding the table; no other table references invites, and its rows (with their rowids, which order
-- listings), indexes and foreign key are kept.
PRAGMA defer_foreign_keys = on;
CREATE TABLE invites_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT CHECK (email IS NULL OR email = lower(email)),
  code TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER CHECK (expires_at IS NOT NULL OR email IS NULL),
  revoked_at INTEGER,
  accepted_at INTEGER
);
INSERT INTO invites_new (rowid, id, workspace_id, email, code, invited_by, created_at, expires_at, revoked_at, accepted_at)
  SELECT rowid, id, workspace_id, email, code, invited_by, created_at, expires_at, revoked_at, accepted_at FROM invites;
DROP TABLE invites;
ALTER TABLE invites_new RENAME TO invites;
CREATE INDEX invites_by_workspace ON invites(workspace_id, created_at);
CREATE INDEX invites_by_email ON invites(email) WHERE email IS NOT NULL;
PRAGMA defer_foreign_keys = off;
