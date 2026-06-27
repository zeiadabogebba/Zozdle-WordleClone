-- ============================================================
--  Show league members' actual guesses (letters), not just colours.
--  Once you've finished that day's puzzle you're done, so seeing
--  friends' guessed words can't help you cheat your own game.
--
--  Run once in the Supabase SQL editor. (0001_init.sql is updated too.)
--  Return type changes, so drop first.
-- ============================================================
drop function if exists public.league_day_grids(uuid, date);

create or replace function public.league_day_grids(p_league uuid, p_date date)
returns table (username text, length int, patterns text[], guesses text[], solved boolean, tries int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(p_league) then raise exception 'not a member'; end if;
  if not exists (
    select 1 from plays pp
    where pp.user_id = auth.uid() and pp.puzzle_date = p_date and pp.finished
  ) then
    return; -- locked: finish your own puzzle first
  end if;
  return query
    select pr.username, pl.length, pl.patterns, pl.guesses, pl.solved, pl.tries
    from league_members m
    join plays pl    on pl.user_id = m.user_id and pl.puzzle_date = p_date and pl.finished
    join profiles pr on pr.id = m.user_id
    where m.league_id = p_league
    order by pl.solved desc, pl.tries asc nulls last, pr.username;
end $$;

grant execute on function public.league_day_grids(uuid, date) to authenticated;
