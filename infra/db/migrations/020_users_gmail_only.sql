ALTER TABLE Users ADD CONSTRAINT users_email_gmail_check
  CHECK (email ~ '^[a-z0-9.]{6,30}@gmail\.com$') NOT VALID;