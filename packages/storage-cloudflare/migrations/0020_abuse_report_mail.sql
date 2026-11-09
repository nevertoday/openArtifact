-- When the operator was mailed the report; NULL when it was stored without mail, because too many reports were
-- mailed in the last day or no operator address is set. Mail per day is capped across all pages by counting these.
ALTER TABLE abuse_reports ADD COLUMN mailed_at INTEGER;
UPDATE abuse_reports SET mailed_at = created_at;
CREATE INDEX abuse_reports_by_mailed_at ON abuse_reports (mailed_at) WHERE mailed_at IS NOT NULL;
CREATE INDEX abuse_reports_by_created_at ON abuse_reports (created_at);
