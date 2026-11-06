-- Visitors of a public link see the page alone; the author may let them read the comments too.
ALTER TABLE artifacts ADD COLUMN public_link_shows_comments INTEGER NOT NULL DEFAULT 0;
