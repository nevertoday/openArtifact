-- Wrong sign-in codes typed for an address, kept for a day so guessing one person's code can be capped across many codes.
CREATE TABLE sign_in_code_failure (
  email TEXT NOT NULL,
  failed_at INTEGER NOT NULL
);
CREATE INDEX sign_in_code_failure_email_time ON sign_in_code_failure (email, failed_at);
