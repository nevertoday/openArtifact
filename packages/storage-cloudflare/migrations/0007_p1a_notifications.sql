-- What happened on an artifact, told to one person; read_at is set when they open or dismiss it.
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  actor_agent_client TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX notifications_by_recipient ON notifications(recipient_id, created_at);
