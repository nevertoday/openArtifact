-- Better Auth's core schema, as its own migration generator emits it for SQLite (better-auth 1.7.7).
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);
create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

-- A public link can expire and can require a password; anonymous visitors may write shared data only when the author allows it.
ALTER TABLE artifacts ADD COLUMN public_link_expires_at INTEGER;
ALTER TABLE artifacts ADD COLUMN public_link_password_hash TEXT;
ALTER TABLE artifacts ADD COLUMN anonymous_write_enabled INTEGER NOT NULL DEFAULT 0;

-- The agent client that published a version or posted a comment, e.g. "Claude Code"; null when a person used the web page.
ALTER TABLE artifact_versions ADD COLUMN published_via TEXT;
ALTER TABLE comments ADD COLUMN posted_via TEXT;
ALTER TABLE comments ADD COLUMN resolved_by TEXT;

CREATE INDEX artifact_grants_by_user ON artifact_grants(user_id);
CREATE INDEX comments_waiting_for_agent ON comments(artifact_id) WHERE for_agent = 1 AND resolved_at IS NULL;
