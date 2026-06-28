create or replace function public.pick_daily_word(p_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from daily_words w where w.puzzle_date = p_date) then return; end if;
  insert into daily_words (puzzle_date, length, word)
  select p_date, ap.length, ap.word from answer_pool ap
  where not exists (select 1 from daily_words dw where dw.word = ap.word)
  order by random() limit 1
  on conflict (puzzle_date) do nothing;
  if not exists (select 1 from daily_words w where w.puzzle_date = p_date) then
    insert into daily_words (puzzle_date, length, word)
    select p_date, ap.length, ap.word from answer_pool ap
    order by random() limit 1
    on conflict (puzzle_date) do nothing;
  end if;
end $$;

create or replace function public.get_daily(p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare d date := clamp_date(p_date);
begin
  perform pick_daily_word(d);
end $$;

create or replace function public.archive_status(p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d date := p_date;
  today date := (now() at time zone 'utc')::date;
  launch date := date '2026-06-25';
  w record; p record;
begin
  if d is null or d > today or d < launch then return jsonb_build_object('error', 'range'); end if;
  perform pick_daily_word(d);
  select * into w from daily_words where puzzle_date = d;
  select * into p from plays where user_id = auth.uid() and puzzle_date = d;
  return jsonb_build_object(
    'date', d, 'number', w.puzzle_number, 'length', w.length,
    'patterns', coalesce(p.patterns, '{}'), 'guesses', coalesce(p.guesses, '{}'),
    'solved', coalesce(p.solved, false), 'finished', coalesce(p.finished, false),
    'word', case when coalesce(p.finished, false) then w.word else null end
  );
end $$;

create or replace function public.submit_archive_guess(p_guess text, p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  d date := p_date;
  today date := (now() at time zone 'utc')::date;
  launch date := date '2026-06-25';
  w record; p record; g text := lower(trim(p_guess));
  pat text; new_patterns text[]; new_guesses text[]; used int; is_solved boolean; is_finished boolean;
begin
  if uid is null then return jsonb_build_object('error', 'auth'); end if;
  if d is null or d >= today or d < launch then return jsonb_build_object('error', 'range'); end if;
  perform pick_daily_word(d);
  select * into w from daily_words where puzzle_date = d;
  if char_length(g) <> w.length then return jsonb_build_object('error', 'length'); end if;
  if not exists (select 1 from valid_words v where v.word = g) then return jsonb_build_object('error', 'invalid'); end if;

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
    patterns = new_patterns, guesses = new_guesses, solved = is_solved, finished = is_finished,
    tries = case when is_solved then array_length(new_patterns, 1) else null end,
    finished_at = case when is_finished then now() else finished_at end
  where user_id = uid and puzzle_date = d;

  if is_finished then
    update profiles set total_played = total_played + 1,
                        total_wins = total_wins + (case when is_solved then 1 else 0 end)
    where id = uid;
  end if;

  return jsonb_build_object(
    'pattern', pat, 'solved', is_solved, 'finished', is_finished,
    'row', array_length(new_patterns, 1),
    'word', case when is_finished then w.word else null end
  );
end $$;

grant execute on function public.archive_status(date), public.submit_archive_guess(text, date) to authenticated;
