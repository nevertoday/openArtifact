-- One row per publish (a new artifact or a new version), kept a day, so each person's publishes can be capped.
CREATE TABLE publish_log (
  publisher_id TEXT NOT NULL,
  published_at INTEGER NOT NULL
);
CREATE INDEX publish_log_by_publisher ON publish_log (publisher_id, published_at);
