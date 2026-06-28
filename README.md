# Zozdle

A server-authoritative, offline-first daily word game with variable word length and optional real-time multiplayer — built as a zero-dependency vanilla PWA backed by Supabase.

**[Play at zozdle.vercel.app](https://zozdle.vercel.app/)**

## What it does

Zozdle is a Wordle-style daily puzzle where the word is randomly **4, 5, or 6 letters** long — the length itself is unknown until the board appears, adding a layer of uncertainty that standard Wordle can't match. Players get 6 attempts per day, with colour-coded tile feedback after each guess. Three modes are available: **Daily** (one global puzzle per day), **Archive** (catch up on any past daily), and **Practice** (unlimited, off-the-record).

## Key Features

- **Variable word length** — the length is randomised daily, making each game feel genuinely different
- **Server-authoritative scoring** — the answer never reaches the browser; every guess is scored by a PostgreSQL stored function that returns only tile colours
- **Offline-first** — the full game runs with no network using a pre-cached ~56k word list and a seeded PRNG for offline daily consistency
- **Archive mode** — play any past daily; archive wins count toward played/win stats but the streak is strictly Daily-only (backfilling is blocked at the database level)
- **No word repeats** — the same answer can't appear twice until the entire ~3,400-word pool is exhausted (~9 years at one word per day)
- **Win distribution bars** — shown across all three modes; server-side distribution is computed from the `plays` table and fetched in parallel with the profile on sign-in
- **Multiplayer** — sign in with a 6-digit email OTP, create or join friend leagues, view each other's full guess grids (letters + colours revealed only after you finish your own puzzle)
- **Global and league leaderboards** — ranked by active streak
- **PWA** — installable, works offline, iOS standalone mode supported

## Architecture

The client is split into three JS files with clear separation of concerns:

| File | Responsibility |
|---|---|
| `js/app.js` | Game engine — board/keyboard, input, evaluation, persistence, modals, share |
| `js/online.js` | Supabase client, auth, RPC wrappers, leaderboard and league UI |
| `js/config.js` | Environment — Supabase URL/key, game knobs (lengths, rows, launch date) |

Word lists are generated offline by `build/build-words.mjs` and committed as static assets. Guess validation runs entirely client-side against the pre-loaded word set — no round-trip needed to check whether a word exists.

### Server-authoritative daily

The daily answer lives only in a PostgreSQL table (`daily_words`) with Row Level Security that blocks all direct client reads. Game logic lives in `SECURITY DEFINER` stored functions:

1. The client sends its **local date string** via `submit_guess(p_guess, p_date)`
2. `clamp_date()` bounds the date to **±1 day of UTC** — this lets the puzzle flip at each player's local midnight without allowing anyone to jump to a future date
3. `score_guess()` runs the two-pass Wordle algorithm server-side and returns only `G`/`Y`/`X` tile colours
4. The actual word is included in the response only once `finished = true`

The `pick_daily_word()` helper ensures no answer is reused until the pool is exhausted, then resets. All three word-pick sites (`get_daily`, `archive_status`, `submit_archive_guess`) delegate to this shared function.

### Offline mode

When signed out (or offline), today's word is derived deterministically from the date via a mulberry32 seeded PRNG — `seed = ((dayIndex + 1) * 2654435761) >>> 0`. The same seed always produces the same word, so an offline player always sees the consistent daily puzzle without any server call.

### Archive integrity

Archive plays write to the same `plays` table as the daily but call `submit_archive_guess()`, which updates `total_played` and `total_wins` directly without touching the streak columns. The streak can only advance through `submit_guess()` (today's daily). This is enforced at the SQL level — there is no client-side path to inflate a streak.

### Auth

Email OTP (6-digit code) only — no magic links. Magic links open in the system browser on iOS, which is a separate browsing context from the installed standalone PWA, making the redirect unreachable. Code-only auth (`signInWithOtp` + `verifyOtp`) works entirely in-page. The input carries `autocomplete="one-time-code"` for native iOS autofill.

Supabase's `onAuthStateChange` callback runs while an internal auth lock is held. Any Supabase query initiated inside this callback deadlocks. All post-auth work is deferred via `setTimeout(0)` to run after the lock is released.

## Tech Stack

| Layer | Technology |
|---|---|
| Client | Vanilla HTML/CSS/JS — no framework, no build step |
| Backend | Supabase (PostgreSQL + Auth + JS client) |
| Game logic | PL/pgSQL `SECURITY DEFINER` stored functions |
| Offline | Service Worker — cache-first for app shell, stale-while-revalidate for definitions |
| Definitions | Free Dictionary API (cached by the service worker) |
| Word lists | Node.js build script — run once, output committed |
| Hosting | Vercel (static) |

## Word List

Answers (~3,400 words) are sourced from the Google 10,000 most-common English words, filtered to 4–6 letter real words and scrubbed of proper nouns, brand names, and profanity. A curated `KEEP` set preserves real words that collide with names (`rose`, `grace`, `holly`). Valid guesses (~53k words) use the dwyl/english-words corpus. Both lists are seeded into Supabase's `answer_pool` and `valid_words` tables.

