CREATE TABLE sync_test_records (
    uuid UUID PRIMARY KEY,
    payload JSONB NOT NULL,
    synced_at TIMESTAMP DEFAULT NOW()
);