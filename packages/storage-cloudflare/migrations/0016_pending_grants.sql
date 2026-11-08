-- A role on an artifact kept for an address with no account yet. When someone signs up with that address it
-- becomes a row in artifact_grants and leaves this table.
CREATE TABLE pending_grants (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email = lower(email)),
  role TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor')),
  granted_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (artifact_id, email)
);
CREATE INDEX pending_grants_by_email ON pending_grants(email);
