-- Users can pick a username. On the organizational side (assignments, expenses,
-- notifications) a person then shows as "username.role", so Users.name holds that
-- label once a username is set, and fullname keeps the name the account was
-- created with. Both are set together by lib/displayName.js.
ALTER TABLE users ADD COLUMN IF NOT EXISTS fullname TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
UPDATE users SET fullname = name WHERE fullname IS NULL;
