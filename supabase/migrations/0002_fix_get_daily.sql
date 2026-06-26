-- ============================================================
--  Patch: get_daily() RETURNS TABLE output names collided with the
--  daily_words columns in `on conflict (puzzle_date)`, causing
--  "column reference puzzle_date is ambiguous" the first time a day's
--  word was generated. Callers only `perform` it, so make it RETURNS void.
--
--  Run this once in the Supabase SQL editor if you already ran 0001.
--  (0001_init.sql has been corrected too, for fresh installs.)
-- ============================================================
create or replace function public.get_daily()
returns void language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'utc')::date;
begin
  if not exists (select 1 from daily_words w where w.puzzle_date = d) then
    insert into daily_words (puzzle_date, length, word)
    select d, ap.length, ap.word from answer_pool ap order by random() limit 1
    on conflict (puzzle_date) do nothing;
  end if;
end $$;
