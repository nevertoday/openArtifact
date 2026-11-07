-- An admin's invitation into a workspace. email is NULL for a link anyone who opens it may use until it
-- expires; an email invite lets in only that address, once, and accepted_at marks it spent.
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT CHECK (email IS NULL OR email = lower(email)),
  code TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  accepted_at INTEGER
);
CREATE INDEX invites_by_workspace ON invites(workspace_id, created_at);
CREATE INDEX invites_by_email ON invites(email) WHERE email IS NOT NULL;
