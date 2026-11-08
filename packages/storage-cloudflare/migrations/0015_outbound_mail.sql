-- Invite and share mail sent to addresses people typed, one row per request, kept a day so each can be capped.
CREATE TABLE outbound_mail (
  kind TEXT NOT NULL CHECK (kind IN ('invite', 'share')),
  sender_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  mail_count INTEGER NOT NULL CHECK (mail_count > 0),
  sent_at INTEGER NOT NULL
);
CREATE INDEX outbound_mail_by_workspace ON outbound_mail (kind, workspace_id, sent_at);
CREATE INDEX outbound_mail_by_sender ON outbound_mail (kind, sender_id, sent_at);
