

alter table public.daily_words drop column if exists puzzle_number;
alter table public.daily_words
  add column puzzle_number int generated always as ((puzzle_date - date '2026-06-25') + 1) stored;
