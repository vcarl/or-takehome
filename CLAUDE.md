# OR Futures — karma prediction market on OpenRouter weekly token usage

Time-boxed take-home (devrel/community role). MVP first; real auth is a stretch.

## Product

- **Week** = Monday 00:00 UTC → next Monday 00:00 UTC. Markets for week W are created from week W-1's data and **close for betting when W starts**. They resolve once a snapshot covers all 7 days of W.
- **Karma** = spend currency. Every user starts with 1000; +100 weekly grant (claimed lazily, once per ISO week, on any authenticated request). Staking burns karma — win or lose, it's spent.
- **Winnings** = separate, monotonically increasing score, minted at resolution as `stake × multiplier`. Bigger stake → bigger winnings. Public leaderboard ranks by winnings.
- **Market types** (per week):
  - `top_model` — categorical: which model is #1 by total tokens (prompt+completion). Options = last week's top 10. Multiplier = `total staked in market / total staked on winning option` (contrarian picks pay more; 0 if wrong).
  - `growth` — numeric, one per model in last week's top 8: predict week-over-week % change in total tokens. Multiplier = `3 × max(0, 1 − |predicted − actual| / 25)` (percentage points).
- All payout math lives in one pure module (`app/domain/payout.ts`) with Vitest coverage.

## Data source

- Official dataset API: `GET https://openrouter.ai/api/v1/datasets/rankings-daily?period=week&start_date=…&end_date=…` with `Authorization: Bearer $OPENROUTER_API_KEY` (key in gitignored `.env`, loaded by the CLI only, never printed/committed/fixtured). Limits: 30/min, 500/day, so one request per `./dev snapshot` (default window: last 12 weeks).
- Response `{data:[{date, model_permaslug, total_tokens:"<decimal string>"}], meta:{as_of, start_date, end_date, version}}`. `period=week` buckets by ISO week start, so `date` IS `week_start`. Up to 50 models per bucket plus a reserved `other` long-tail row (stored, excluded from markets/options). `:variant` suffixes are stripped and summed into the base permaslug. There is no prompt/completion split.
- Stored in `weekly_usage(week_start, model_permaslug, total_tokens, snapshot_id)` (latest snapshot wins per week+model); `snapshots.as_of` is kept per fetch.
- **Partial-week rule:** the trailing bucket is the in-progress week. A week is resolvable only when `week_start + 7d <= date(as_of) + 1d`. `openWeek(W)` builds from the most recent complete prior week.
- **License CC BY 4.0.** Show the citation `Source: OpenRouter (openrouter.ai/rankings), as of {as_of}.` (app footer, from `latestAsOf()`).
- `fixtures/rankings-weekly.json` is one recorded live response (no key) so tests/`seed-demo` run offline: `./dev snapshot --fixture fixtures/rankings-weekly.json`. `seed-demo` uses only real data, with the fixture's `as_of` as the demo clock.

## Stack (deliberate deviation from the house blessed stack)

Brief-driven minimum for a few-hour, local-only take-home:
- Single pnpm package, React Router v8 framework mode, loaders/actions are the server seam.
- **`node:sqlite`** (built in) at an absolute path from `DATABASE_PATH` env (default `<repo>/data/app.sqlite3`, resolved absolute). No Docker.
- Karma and winnings are **append-only ledgers**; balances are sums.
- Skipped on purpose: Postgres + Kanel/Effect/HttpApi generation chain, Zero sync, Nx, deploy.
- Auth MVP: username-only login → cookie session. Stretch: OpenRouter OAuth PKCE.
- `./dev` launcher: `./dev` (serve), `./dev snapshot [--fixture path]`, `./dev open-week`, `./dev resolve`, `./dev seed-demo`, `./dev test`.
- DB init is explicit (`./dev` migrates on start idempotently); seeding is opt-in, never automatic.
