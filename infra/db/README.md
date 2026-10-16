Place the full manuscript schema here as schema.sql (Tables 29-38).
docker-compose loads it automatically on first Postgres startup.


Migration numbering: the gaps at 010 and 023 are intentional. Applied migrations
are tracked by filename in `schema_migrations`, so never renumber or fill them.
The next new migration takes the next free number (041 at the time of writing).
