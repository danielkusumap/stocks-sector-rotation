-- docs/05 §4.6: `ingest_run.kind` hanya enam nilai baku.
-- Migrasi data lama yang masih memakai nama lama (docs/07 B10, ADR-026).
UPDATE ingest_run SET kind = 'import_excel' WHERE kind = 'excel';
UPDATE ingest_run SET kind = 'compute_all' WHERE kind IN ('compute_index', 'compute_rrg');
