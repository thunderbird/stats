-- One-time operator migration for the existing ATN global_stats table.
-- Cumulative downloads exceed the legacy unsigned 32-bit count limit.
-- Back up the table first. This preserves rows and all existing values.
-- The legacy table has a zero-date default, so allow that existing definition
-- during its rebuild without changing the application's date behavior.
SET @stats_original_sql_mode = @@SESSION.sql_mode;
SET SESSION sql_mode = REPLACE(REPLACE(@@SESSION.sql_mode, 'NO_ZERO_IN_DATE', ''), 'NO_ZERO_DATE', '');
SET SESSION lock_wait_timeout = 10;
ALTER TABLE global_stats MODIFY COLUMN count BIGINT UNSIGNED NOT NULL DEFAULT 0, ALGORITHM=COPY, LOCK=SHARED;
SET SESSION sql_mode = @stats_original_sql_mode;
