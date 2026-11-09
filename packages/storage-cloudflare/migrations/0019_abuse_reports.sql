-- Reports from visitors of a public link that a page is abusive, for the operator. No foreign key: a report is
-- the record of why a page was taken down, so it outlives the purge of the artifact it names. ip_hash is an HMAC
-- of the sender's address, enough to tell repeat senders apart without keeping the address.
CREATE TABLE abuse_reports (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  short_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'phishing_or_malware', 'illegal', 'other')),
  details TEXT CHECK (details IS NULL OR length(details) <= 1000),
  reporter_email TEXT,
  reporter_id TEXT,
  ip_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX abuse_reports_by_artifact ON abuse_reports (artifact_id, created_at);
