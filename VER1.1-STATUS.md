# HINATA FISHING Ver.1.1 implementation status

- The shared room URL continues to use `#room=...`; Supabase spot RPCs and local storage keys are unchanged.
- Hourly weather and marine forecast cards, per-hour rule-based grades, data completeness handling, and a 30-minute per-coordinate cache are implemented in `app.js` and `verdict.js`.
- Tide display is intentionally marked unavailable. JMA provides station-based predicted tide tables and observed tide products, but this build does not have a verified direct browser data endpoint or nearest-station mapping; it does not fabricate high/low times.
- Open-Meteo free endpoints are for non-commercial use, with stated limits of 10,000 calls/day, 5,000/hour, 600/minute and CC BY 4.0 attribution. This app is intended for private, non-commercial use; use a paid licence if that changes.
- The PWA cache version is bumped to invalidate the previous app shell and include `verdict.js`.
- Publishing and the remote V1.0 tag could not be completed in this environment because GitHub authentication/network access failed. The local V1.0 tag exists as `v1.0.0` at the original V1.0 commit.

## V1.0 protection and publishing

The V1.0 source remains protected by the local Git tag `v1.0.0` pointing to commit `2d6f94f`. The tag push failed because GitHub authentication could not be started here. V1.1 files remain uncommitted in this working tree; no production deployment was made.
