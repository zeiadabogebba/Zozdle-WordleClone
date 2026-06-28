

drop function if exists public.submit_guess(text);
drop function if exists public.daily_status();
drop function if exists public.get_daily();

create or replace function public.clamp_date(p_date date)
returns date language sql stable as $$
  select greatest((now() at time zone 'utc')::date - 1,
                  least((now() at time zone 'utc')::date + 1,
                        coalesce(p_date, (now() at time zone 'utc')::date)));
$$;

create or replace function public.get_daily(p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare d date := clamp_date(p_date);
begin
  if not exists (select 1 from daily_words w where w.puzzle_date = d) then
    insert into daily_words (puzzle_date, length, word)
    select d, ap.length, ap.word from answer_pool ap order by random() limit 1
    on conflict (puzzle_date) do nothing;
  end if;
end $$;

create or replace function public.daily_status(p_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := clamp_date(p_date); w record; p record;
begin
  perform get_daily(d);
  select * into w from daily_words where puzzle_date = d;
  select * into p from plays where user_id = auth.uid() and puzzle_date = d;
  return jsonb_build_object(
    'date',     d,
    'number',   w.puzzle_number,
    'length',   w.length,
    'patterns', coalesce(p.patterns, '{}'),
    'guesses',  coalesce(p.guesses, '{}'),
    'solved',   coalesce(p.solved, false),
    'finished', coalesce(p.finished, false),
    'word',     case when coalesce(p.finished, false) then w.word else null end
  );
end $$;

create or replace function public.submit_guess(p_guess text, p_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  d   date := clamp_date(p_date);
  w   record; p record;
  g   text := lower(trim(p_guess));
  pat text; new_patterns text[]; new_guesses text[]; used int;
  is_solved boolean; is_finished boolean;
begin
  if uid is null then return jsonb_build_object('error', 'auth'); end if;
  perform get_daily(d);
  select * into w from daily_words where puzzle_date = d;

  if char_length(g) <> w.length then return jsonb_build_object('error', 'length'); end if;
  if not exists (select 1 from valid_words v where v.word = g) then
    return jsonb_build_object('error', 'invalid');
  end if;

  select * into p from plays where user_id = uid and puzzle_date = d for update;
  if not found then
    insert into plays (user_id, puzzle_date, length) values (uid, d, w.length)
    on conflict (user_id, puzzle_date) do nothing;
    select * into p from plays where user_id = uid and puzzle_date = d for update;
  end if;

  if p.finished then return jsonb_build_object('error', 'finished'); end if;
  used := coalesce(array_length(p.patterns, 1), 0);
  if used >= 6 then return jsonb_build_object('error', 'no_attempts'); end if;

  pat := score_guess(g, w.word);
  new_patterns := p.patterns || pat;
  new_guesses  := p.guesses || g;
  is_solved    := (pat = repeat('G', w.length));
  is_finished  := is_solved or array_length(new_patterns, 1) >= 6;

  update plays set
    patterns    = new_patterns,
    guesses     = new_guesses,
    solved      = is_solved,
    finished    = is_finished,
    tries       = case when is_solved then array_length(new_patterns, 1) else null end,
    finished_at = case when is_finished then now() else finished_at end
  where user_id = uid and puzzle_date = d;

  if is_finished then perform update_streak(uid, d, is_solved); end if;

  return jsonb_build_object(
    'pattern',  pat,
    'solved',   is_solved,
    'finished', is_finished,
    'row',      array_length(new_patterns, 1),
    'word',     case when is_finished then w.word else null end
  );
end $$;

grant execute on function public.daily_status(date) to anon, authenticated;
grant execute on function public.submit_guess(text, date) to authenticated;
