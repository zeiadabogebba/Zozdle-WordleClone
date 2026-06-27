# Zozdle — Supabase setup (multiplayer backend)

This turns Zozdle into an account-based game with worldwide leaderboards, friend
leagues, and gated daily-grid sharing. The design is **server-authoritative**: the
daily answer lives only in your database and is *never* sent to the browser —
every guess is scored by a SQL function that returns tile colours only. There are
**no Edge Functions or servers to run**; the client talks to Postgres through RPC.

> The whole backend is in [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)
> and has been tested end-to-end against Postgres (scoring, streaks, leagues, and
> the gated grid reveal). Steps below get it live.

## 1. Create a project
1. Go to <https://supabase.com> → **New project** (a fresh, dedicated Zozdle project).
2. Pick a region near your players and save the database password.

## 2. Run the schema
1. Open **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase/migrations/0001_init.sql` and **Run**.
   This creates all tables, RLS policies, and the game/league/leaderboard functions.
3. Then run `supabase/migrations/0002_fix_get_daily.sql` too (a one-line fix to the
   daily-word generator). Fresh installs still need it; it's idempotent.

## 3. Load the word lists
The schema created two empty tables, `answer_pool` (daily answers) and
`valid_words` (accepted guesses). Import the generated CSVs from `supabase/seed/`:

1. **Table Editor** → open **`answer_pool`** → **Insert → Import data from CSV** →
   upload `supabase/seed/answer_pool.csv` (3,417 rows).
2. Same for **`valid_words`** ← `valid_words.csv` (52,940 rows).

> If the dashboard balks at the larger file, use the CLI instead:
> ```bash
> psql "$DATABASE_URL" -c "\copy valid_words(word,length) from 'supabase/seed/valid_words.csv' csv header"
> psql "$DATABASE_URL" -c "\copy answer_pool(length,word) from 'supabase/seed/answer_pool.csv' csv header"
> ```
> (`DATABASE_URL` is under **Settings → Database → Connection string**.)

Quick check in the SQL editor:
```sql
select count(*) from valid_words;   -- 52940
select count(*) from answer_pool;   -- 3417
```

## 4. Enable email-code sign-in
Zozdle signs in with a **6-digit code** (no magic link — links can't open an iOS
home-screen PWA, so the code is the reliable path).

1. **Authentication → Sign In / Providers → Email** — make sure it's **enabled**,
   and set **Email OTP Length = `6`** (default is sometimes 8). Adjust OTP expiry to taste.
2. **Authentication → Email Templates → Magic Link** — this is the slot the code flow
   uses (the name is Supabase's, the email itself has no link). Set the **Subject** to
   e.g. `Your Zozdle sign-in code` and paste the body from
   [`supabase/email/otp-code.html`](supabase/email/otp-code.html) — it shows only the
   6-digit `{{ .Token }}`.
3. **SMTP must work** or no email sends. With Gmail SMTP the password must be a Google
   **App Password** (requires 2-Step Verification), not your normal password — or use
   a transactional provider like Resend.

## 5. Point the app at your project
In [`js/config.js`](js/config.js), fill in `window.ZOZDLE_SUPABASE`:
```js
window.ZOZDLE_SUPABASE = {
  url: "https://YOURPROJECT.supabase.co",
  anonKey: "eyJhbGciOi…",   // Settings → API → "anon" / "publishable" key
};
```
The **anon key is safe to commit/ship** — Row Level Security and the
server-authoritative RPCs are what protect the data, not key secrecy. Leaving these
blank keeps Zozdle running as the pure offline single-player game.

## How it stays cheat-resistant
- `daily_words` (the answer) and `valid_words` have **RLS enabled with no policies** —
  no client can read them. Only `SECURITY DEFINER` functions (owned by `postgres`)
  touch them.
- `submit_guess(word)` enforces ≤ 6 guesses/day, validates length + dictionary,
  scores against the secret, records the result, updates your streak, and returns
  only the colour pattern (plus the word *after* you finish).
- `league_day_grids(league, date)` returns a friend's grid **only if you have
  finished that day's puzzle**, and only as colour patterns — never letters.
- Streaks rank by *active* current streak (resets on a miss or loss; a stale streak
  shows 0 automatically — no cron needed). The daily rolls over at **00:00 UTC**.

## The client is wired up
Once the steps above are done and `js/config.js` has your keys, the app already
supports it all: 6-digit email-code sign-in (account button), a username picker, the
daily played through `submit_guess`, and the **Compete** button (trophy) for the global
leaderboard, leagues (create/join by code), and friends' gated grids. Signed-out or
offline visitors still get the full single-player game.
