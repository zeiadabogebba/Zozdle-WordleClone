# Zozdle

A neon-arcade daily word game — Wordle, but you don't know how long the word is.
Each day the answer is **4, 5 or 6 letters**, picked at random, and you have **6 guesses**.

Built as a zero-dependency, offline-first PWA (plain HTML / CSS / JS — same stack as
its sibling apps), with a deliberately different look: a dark synthwave cabinet with
CRT scanlines, a perspective grid horizon, and glowing neon tiles.

## Features

- **The twist** — the daily word length (4 / 5 / 6) is randomized, so the board
  reshapes every day and you have to figure out the length from the start.
- **Daily mode** — the puzzle is derived from the date, so everyone gets the same
  word. Finish it and share your spoiler-free grid (`🟩🟨⬛`).
- **Practice mode** — endless random words of random length.
- **Any valid word accepted** — guesses are checked against ~53,000 real English
  words (4–6 letters); answers are drawn from ~3,400 common, fair words.
- **Hard mode** — revealed hints must be reused in later guesses.
- **Definitions** — when a game ends, the answer's definition is fetched from the
  free, no-key [dictionaryapi.dev](https://dictionaryapi.dev) and shown inline. It's
  a progressive enhancement: if you're offline (or the word isn't found) it quietly
  falls back to a Merriam-Webster link, and looked-up words are cached for offline reuse.
- **Stats** — played, win %, current/max streak, guess distribution, and a
  countdown to the next daily.
- **Offline** — a service worker precaches everything (including the word lists),
  so it works with no network and installs to your home screen.
- **Accessible** — keyboard play, focus rings, `prefers-reduced-motion`, and a
  CRT toggle for anyone who finds scanlines distracting.

## Run it

It's a static site — serve the folder over HTTP (a service worker won't register
from `file://`):

```bash
# any static server works, e.g.
npx serve .
# or
python -m http.server 8080
```

Then open the printed URL. The first visit shows a quick how-to.

## Project layout

```
index.html              · markup, icon sprite, PWA head
css/styles.css          · "Neon Cabinet" design system (tokens, tiles, CRT)
js/config.js            · tunable knobs (launch date, rows, word lengths)
js/app.js               · game engine
js/words-answers.js     · ~3,400 curated answers, bucketed by length  (generated)
js/words-valid.js       · ~53,000 valid guesses, packed string         (generated)
manifest.webmanifest    · PWA manifest
sw.js                   · offline service worker
icons/icon.svg          · neon "Z" app icon
build/build-words.mjs   · regenerates the two word lists
```

## Word lists

The two `js/words-*.js` files are generated, not hand-written. The build step pulls
from two sources and bundles the result so the game stays fully offline:

- **Answers** — [google-10000-english](https://github.com/first20hours/google-10000-english)
  (most common words), filtered to 4/5/6 letters and intersected with the
  validation list. Proper nouns, place names and slang are stripped (see the
  block/keep lists in `build/build-words.mjs`).
- **Valid guesses** — [dwyl/english-words](https://github.com/dwyl/english-words)
  `words_alpha.txt`, filtered to 4/5/6 letters.

To rebuild (e.g. after editing the curation lists):

```bash
node build/build-words.mjs
```

> **Note:** the daily word is a function of the date *and* the answer list, so
> editing the answer list shifts which word maps to which day. Freeze the list
> once the game is "live" if you want past/future dailies to stay put.

## How the daily word is chosen

A day index is computed from the launch date (`config.js`). That index seeds a small
deterministic PRNG (mulberry32), which first picks the length (4/5/6) and then the
word — so the puzzle is identical for every player, with no backend.
