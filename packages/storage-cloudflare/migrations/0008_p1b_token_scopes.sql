-- What a personal API token may do: 'publish' works on artifacts but never changes who can see them;
-- 'full' may also change sharing. Tokens made before scopes existed keep the full access they had.
ALTER TABLE personal_access_tokens ADD COLUMN scope TEXT NOT NULL DEFAULT 'full' CHECK (scope IN ('publish', 'full'));
