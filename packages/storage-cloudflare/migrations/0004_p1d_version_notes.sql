-- How a version came to be: published from new files, or restored from the files of an earlier version.
-- Versions written before this migration were all published.
ALTER TABLE artifact_versions ADD COLUMN origin TEXT NOT NULL DEFAULT 'published' CHECK (origin IN ('published', 'restored'));
ALTER TABLE artifact_versions ADD COLUMN restored_from INTEGER CHECK ((origin = 'restored') = (restored_from IS NOT NULL));
-- What changed in this version, in one plain-text sentence from whoever published it.
ALTER TABLE artifact_versions ADD COLUMN note TEXT CHECK (note IS NULL OR length(note) <= 200);
