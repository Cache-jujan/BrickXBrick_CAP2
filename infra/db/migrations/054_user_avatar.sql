-- A profile picture is optional. The image itself lives in object storage
-- (Cloudflare R2, under avatars/<userid>/); this column only holds its public URL.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatarurl TEXT;
