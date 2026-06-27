-- ============================================================
--  ZOZDLE — multiplayer backend (server-authoritative)
--
--  The daily answer lives only in `daily_words` (RLS-locked, never
--  selectable by clients). All scoring happens inside SECURITY DEFINER
--  functions, which return tile colours only — the word is never sent to
--  the browser until your game is finished. Clients talk to this purely
--  through RPC (supabase.rpc(...)); there are no Edge Functions.
--
--  Run order: paste this whole file in the Supabase SQL editor, then import
--  the two seed CSVs into `answer_pool` and `valid_words` (see SUPABASE_SETUP.md).
--  No extensions required (gen_random_uuid is core since PG13).
-- ============================================================

-- ---------------- profiles ----------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  username         text not null,
  current_streak   int  not null default 0,
  max_streak       int  not null default 0,
  last_solved_date date,
  total_wins       int  not null default 0,
  total_played     int  not null default 0,
  created_at       timestamptz not null default now()
);
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

alter table public.profiles enable row level security;
drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- auto-create a profile (with a throwaway username) on signup
create sequence if not exists public.player_seq;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, 'player' || nextval('player_seq'));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------- word data (locked: only definer funcs read these) -------
create table if not exists public.answer_pool (
  length int  not null,
  word   text not null,
  primary key (length, word)
);
create table if not exists public.valid_words (
  word   text primary key,
  length int  not null
);
alter table public.answer_pool enable row level security;  -- no policies => no client access
alter table public.valid_words enable row level security;

-- ---------------- daily words (SECRET) ----------------
create table if not exists public.daily_words (
  puzzle_date   date primary key,
  puzzle_number int generated always as ((puzzle_date - date '2026-06-25') + 1) stored,
  length        int  not null,
  word          text not null
);
alter table public.daily_words enable row level security;  -- no policies => secret

-- ---------------- plays ----------------
create table if not exists public.plays (
  user_id     uuid not null references auth.users(id) on delete cascade,
  puzzle_date date not null,
  length      int  not null,
  guesses     text[] not null default '{}',   -- private (letters)
  patterns    text[] not null default '{}',   -- shareable (e.g. 'GGYXX')
  solved      boolean not null default false,
  finished    boolean not null default false,
  tries       int,                            -- guesses used if solved, else null
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  primary key (user_id, puzzle_date)
);
create index if not exists plays_by_date on public.plays (puzzle_date);
alter table public.plays enable row level security;
drop policy if exists "read own plays" on public.plays;
create policy "read own plays" on public.plays for select using (auth.uid() = user_id);
-- no insert/update policies: only submit_guess (SECURITY DEFINER) writes

-- ---------------- leagues ----------------
create table if not exists public.leagues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 40),
  invite_code text not null unique,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create table if not exists public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
create index if not exists league_members_by_user on public.league_members (user_id);

-- membership check that bypasses RLS (avoids recursive-policy errors)
create or replace function public.is_member(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.league_members m
    where m.league_id = p_league and m.user_id = auth.uid()
  );
$$;

alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
drop policy if exists "see my leagues" on public.leagues;
create policy "see my leagues" on public.leagues for select using (public.is_member(id));
drop policy if exists "see co-members" on public.league_members;
create policy "see co-members" on public.league_members for select using (public.is_member(league_id));

-- ============================================================
--  game logic
-- ============================================================

-- two-pass Wordle scoring -> 'G' green, 'Y' yellow, 'X' grey
create or replace function public.score_guess(p_guess text, p_answer text)
returns text language plpgsql immutable as $$
declare
  n int := length(p_answer);
  res text[] := array_fill('X'::text, array[n]);
  cnt int[] := array_fill(0, array[26]);
  i int; c int;
begin
  for i in 1..n loop
    c := ascii(substr(p_answer, i, 1)) - 96;
    if c between 1 and 26 then cnt[c] := cnt[c] + 1; end if;
  end loop;
  for i in 1..n loop
    if substr(p_guess, i, 1) = substr(p_answer, i, 1) then
      res[i] := 'G';
      c := ascii(substr(p_guess, i, 1)) - 96;
      if c between 1 and 26 then cnt[c] := cnt[c] - 1; end if;
    end if;
  end loop;
  for i in 1..n loop
    if res[i] = 'X' then
      c := ascii(substr(p_guess, i, 1)) - 96;
      if c between 1 and 26 and cnt[c] > 0 then
        res[i] := 'Y';
        cnt[c] := cnt[c] - 1;
      end if;
    end if;
  end loop;
  return array_to_string(res, '');
end $$;

-- ensure today's secret word exists (lazy, race-safe)
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

-- full status for the signed-in user (no word unless finished)
create or replace function public.daily_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'utc')::date; w record; p record;
begin
  perform get_daily();
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

-- maintain streak/profile when a daily finishes
create or replace function public.update_streak(p_uid uuid, p_date date, p_solved boolean)
returns void language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  select * into pr from profiles where id = p_uid for update;
  if p_solved then
    update profiles set
      current_streak = case
        when pr.last_solved_date = p_date - 1 then pr.current_streak + 1
        when pr.last_solved_date = p_date     then pr.current_streak
        else 1 end,
      last_solved_date = p_date,
      total_wins   = pr.total_wins + 1,
      total_played = pr.total_played + 1
    where id = p_uid;
    update profiles set max_streak = greatest(max_streak, current_streak) where id = p_uid;
  else
    update profiles set current_streak = 0, total_played = pr.total_played + 1 where id = p_uid;
  end if;
end $$;

-- THE move: score one guess server-side, record it, return colours only
create or replace function public.submit_guess(p_guess text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  d   date := (now() at time zone 'utc')::date;
  w   record; p record;
  g   text := lower(trim(p_guess));
  pat text; new_patterns text[]; new_guesses text[]; used int;
  is_solved boolean; is_finished boolean;
begin
  if uid is null then return jsonb_build_object('error', 'auth'); end if;
  perform get_daily();
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

-- ============================================================
--  social: usernames, leagues, leaderboards, gated grids
-- ============================================================

create or replace function public.set_username(p_username text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); u text := trim(p_username);
begin
  if uid is null then return jsonb_build_object('error', 'auth'); end if;
  if u !~ '^[A-Za-z0-9_]{3,16}$' then return jsonb_build_object('error', 'format'); end if;
  begin
    update profiles set username = u where id = uid;
  exception when unique_violation then
    return jsonb_build_object('error', 'taken');
  end;
  return jsonb_build_object('username', u);
end $$;

create or replace function public.create_league(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); code text; lid uuid;
begin
  if uid is null then return jsonb_build_object('error', 'auth'); end if;
  loop
    code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from leagues where invite_code = code);
  end loop;
  insert into leagues (name, invite_code, owner_id) values (trim(p_name), code, uid) returning id into lid;
  insert into league_members (league_id, user_id) values (lid, uid);
  return jsonb_build_object('id', lid, 'name', trim(p_name), 'code', code);
end $$;

create or replace function public.join_league(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); l record;
begin
  if uid is null then return jsonb_build_object('error', 'auth'); end if;
  select * into l from leagues where invite_code = upper(trim(p_code));
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  insert into league_members (league_id, user_id) values (l.id, uid)
  on conflict (league_id, user_id) do nothing;
  return jsonb_build_object('id', l.id, 'name', l.name);
end $$;

create or replace function public.my_leagues()
returns table (id uuid, name text, code text, members int)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.invite_code,
    (select count(*) from league_members mm where mm.league_id = l.id)::int
  from leagues l
  join league_members m on m.league_id = l.id and m.user_id = auth.uid()
  order by l.created_at;
$$;

-- effective streak = current_streak only while still "active" (solved today/yesterday)
create or replace function public.global_board(p_limit int default 100)
returns table (username text, streak int, max_streak int, wins int)
language sql stable security definer set search_path = public as $$
  select username,
    case when last_solved_date >= (now() at time zone 'utc')::date - 1
         then current_streak else 0 end as streak,
    max_streak, total_wins
  from profiles
  order by streak desc, max_streak desc, total_wins desc
  limit p_limit;
$$;

create or replace function public.league_board(p_league uuid)
returns table (username text, streak int, max_streak int, wins int)
language sql stable security definer set search_path = public as $$
  select p.username,
    case when p.last_solved_date >= (now() at time zone 'utc')::date - 1
         then p.current_streak else 0 end as streak,
    p.max_streak, p.total_wins
  from league_members m
  join profiles p on p.id = m.user_id
  where m.league_id = p_league and public.is_member(p_league)
  order by streak desc, p.max_streak desc, p.total_wins desc;
$$;

-- friends' grids for a day — colours only, and ONLY if you've finished that day
create or replace function public.league_day_grids(p_league uuid, p_date date)
returns table (username text, length int, patterns text[], solved boolean, tries int)
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
    select pr.username, pl.length, pl.patterns, pl.solved, pl.tries
    from league_members m
    join plays pl    on pl.user_id = m.user_id and pl.puzzle_date = p_date and pl.finished
    join profiles pr on pr.id = m.user_id
    where m.league_id = p_league
    order by pl.solved desc, pl.tries asc nulls last, pr.username;
end $$;

-- ---------------- grants ----------------
grant usage on schema public to anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant select on public.plays to authenticated;
grant select on public.leagues, public.league_members to authenticated;

grant execute on function public.daily_status(), public.global_board(int) to anon, authenticated;
grant execute on function
  public.submit_guess(text), public.set_username(text),
  public.create_league(text), public.join_league(text), public.my_leagues(),
  public.league_board(uuid), public.league_day_grids(uuid, date)
  to authenticated;
