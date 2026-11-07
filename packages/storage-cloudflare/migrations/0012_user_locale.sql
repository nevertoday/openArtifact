-- The interface language a person chose; NULL until they choose, so the browser's language decides.
ALTER TABLE "user" ADD COLUMN locale TEXT;
