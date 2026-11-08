-- The words an author wrote to go before the link when an artifact is shared on X; null leaves them to its title and
-- summary. The app checks they fit in a post; the bound here only keeps a row from growing without limit.
ALTER TABLE artifacts ADD COLUMN share_text TEXT CHECK (share_text IS NULL OR length(share_text) <= 1000);
