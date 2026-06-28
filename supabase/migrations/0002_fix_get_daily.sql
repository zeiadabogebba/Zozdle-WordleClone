

drop function if exists public.get_daily();

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
