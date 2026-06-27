-- ============================================================
--  Relaunch date: number the daily from 2026-06-25 (was 2025-01-01),
--  matching js/config.js `launch`. Optional — only affects the server
--  daily's displayed puzzle number; the game works either way.
--
--  Run once in the Supabase SQL editor. The generated column can't be
--  altered in place, so drop and re-add it (recomputes for existing rows).
-- ============================================================
alter table public.daily_words drop column if exists puzzle_number;
alter table public.daily_words
  add column puzzle_number int generated always as ((puzzle_date - date '2026-06-25') + 1) stored;
