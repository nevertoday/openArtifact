-- An artifact's address is /a/{slug}-{short_id}: the short id alone finds it, the slug is words for people.
-- SQLite adds a NOT NULL column only with a default, so short_id starts as '' and every existing row is given
-- a random one before the unique index is built. The app always writes short_id itself; a row inserted
-- without one would keep '' and the second such row would fail the index, loudly.
ALTER TABLE artifacts ADD COLUMN short_id TEXT NOT NULL DEFAULT '';
ALTER TABLE artifacts ADD COLUMN slug TEXT NOT NULL DEFAULT '';
UPDATE artifacts SET short_id =
  substr('0123456789abcdefghijklmnopqrstuvwxyz', (abs(random()) % 36) + 1, 1) ||
  substr('0123456789abcdefghijklmnopqrstuvwxyz', (abs(random()) % 36) + 1, 1) ||
  substr('0123456789abcdefghijklmnopqrstuvwxyz', (abs(random()) % 36) + 1, 1) ||
  substr('0123456789abcdefghijklmnopqrstuvwxyz', (abs(random()) % 36) + 1, 1) ||
  substr('0123456789abcdefghijklmnopqrstuvwxyz', (abs(random()) % 36) + 1, 1) ||
  substr('0123456789abcdefghijklmnopqrstuvwxyz', (abs(random()) % 36) + 1, 1) ||
  substr('0123456789abcdefghijklmnopqrstuvwxyz', (abs(random()) % 36) + 1, 1) ||
  substr('0123456789abcdefghijklmnopqrstuvwxyz', (abs(random()) % 36) + 1, 1) ||
  substr('0123456789abcdefghijklmnopqrstuvwxyz', (abs(random()) % 36) + 1, 1) ||
  substr('0123456789abcdefghijklmnopqrstuvwxyz', (abs(random()) % 36) + 1, 1) ||
  substr('0123456789abcdefghijklmnopqrstuvwxyz', (abs(random()) % 36) + 1, 1) ||
  substr('0123456789abcdefghijklmnopqrstuvwxyz', (abs(random()) % 36) + 1, 1)
WHERE short_id = '';
CREATE UNIQUE INDEX artifacts_by_short_id ON artifacts(short_id);
