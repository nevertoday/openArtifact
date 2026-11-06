-- Where on the page a comment points: {"x": 0..1, "y": 0..1} as fractions of the page's width and height,
-- so the pin stays on the same spot at any screen width. Null for a comment about the whole page.
ALTER TABLE comments ADD COLUMN anchor TEXT CHECK (anchor IS NULL OR json_valid(anchor));
