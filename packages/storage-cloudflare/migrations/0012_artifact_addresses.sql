-- An artifact's address is /a/{slug}-{short_id}: the short id alone finds it, the slug is words for people.
-- SQLite adds a NOT NULL column only with a default, so short_id starts as '' and every existing row is given
-- a random one before the unique index is built. Deploys apply migrations before the Workers, so for a moment
-- the previous app still inserts rows without a short_id; the trigger gives each such row one, and keeps doing
-- so for any insert that leaves it out.
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
CREATE TRIGGER artifacts_fill_short_id AFTER INSERT ON artifacts WHEN NEW.short_id = ''
BEGIN
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
  WHERE id = NEW.id;
END;
