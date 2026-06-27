/* Zozdle configuration.
   Zozdle is fully offline — no backend, no API keys. The word lists are
   bundled (js/words-answers.js + js/words-valid.js) and the daily word is
   derived from the date, so everyone gets the same puzzle with no server.

   Tweak the knobs below to retune the game. */
window.ZOZDLE_CONFIG = {
  launch: "2026-06-25",   // date of puzzle #1 (drives the daily number + archive start)
  rows: 6,                // guesses allowed
  lengths: [4, 5, 6],     // the daily word is randomly one of these lengths
};

/* Multiplayer (Supabase). Leave blank to run Zozdle as a pure offline
   single-player game; fill these in (from your Supabase project →
   Settings → API) to enable accounts, leagues and leaderboards.
   The anon key is SAFE to ship publicly — Row Level Security + the
   server-authoritative RPCs protect the data, not key secrecy. */
window.ZOZDLE_SUPABASE = {
  url: "https://jcohkjpyloznjrllkipi.supabase.co",       // e.g. https://abcdefghijkl.supabase.co
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impjb2hranB5bG96bmpybGxraXBpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MjE2NjcsImV4cCI6MjA5Nzk5NzY2N30.sjw1pQ_yL0bh19HoFtG9QT5YWU2RiB4izdiQ6tfbF1k",   // the long "anon" / "publishable" key
};
