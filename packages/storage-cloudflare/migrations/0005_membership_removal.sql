-- An admin removed this person from the workspace. The row stays so signing in again does not re-join them.
ALTER TABLE memberships ADD COLUMN removed_at INTEGER;
