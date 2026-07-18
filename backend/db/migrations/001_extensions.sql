-- 001_extensions.sql
-- Enables UUID generation used as primary key type across every table
-- (Data Dictionary specifies UUID PKs throughout).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- pgcrypto's gen_random_uuid() is used instead of uuid-ossp for wider
-- compatibility with Neon-managed Postgres.
