-- An author puts an artifact on their personal page at /@handle; it shows there only while its public link is
-- open to anyone without a password, which the app checks on every read.
ALTER TABLE artifacts ADD COLUMN listed INTEGER NOT NULL DEFAULT 0;
-- What the author says the artifact is about; null leaves it to the current version's opening words.
ALTER TABLE artifacts ADD COLUMN summary TEXT CHECK (summary IS NULL OR length(summary) <= 300);
CREATE INDEX artifacts_listed_by_author ON artifacts(author_id, updated_at) WHERE listed = 1;
-- The opening words of each version's entry page, read once when the version is published.
ALTER TABLE artifact_versions ADD COLUMN excerpt TEXT;

CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  bio TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 200),
  pinned_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL
);
