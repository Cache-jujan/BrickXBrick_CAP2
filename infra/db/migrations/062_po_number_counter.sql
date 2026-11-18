-- 062_po_number_counter.sql
-- Sequential Purchase Order numbers (PO-2026-001, PO-2026-002, ...), restarting each year.
-- This table holds ONLY the last number handed out per year. A Purchase Order is not stored:
-- the PDF is built on the phone from the open requests, and the number is the one thing the
-- server has to own so two Purchasers never get the same one.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS po_counters (
  year        INTEGER PRIMARY KEY,
  lastnumber  INTEGER NOT NULL DEFAULT 0 CHECK (lastnumber >= 0)
);
