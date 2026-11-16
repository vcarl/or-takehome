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

- No documented rankings API. The public page `https://openrouter.ai/rankings` embeds TanStack Query dehydrated state, queryKey `["rankings","models",{"view":"week"}]`, containing per-model **weekly** rows: `{date, model_permaslug, variant, total_prompt_tokens, total_completion_tokens, ...}`.
- **Rows are weekly aggregates labelled by the week's last day (a Sunday).** `date` 2026-11-15 = Mon 2026-11-09 .. Sun 2026-11-15 (so `week_start = date - 6 days`). Inferred from magnitude (~167T tokens across 20 rows is implausible for one day) and the capture time (Mon 2026-11-16 16:02 UTC; 2026-11-15 was the prior Sunday). Extraction errors loudly if a label is not a Sunday. Confirm by re-snapshotting on a later Monday: a new Sunday-labelled week should appear.
- `snapshot` fetches only that public page, extracts the rows, stores them in `weekly_usage` (latest snapshot wins per week+model). Do not probe undocumented `api/frontend/*` endpoints.
- `fixtures/rankings-*.html` is a committed capture so demos/tests run offline. It holds one week (2026-11-09), so `seed-demo` synthesizes earlier weeks from it (source `demo-synthetic`).
- Weekly total per model = prompt+completion tokens, variants summed per `model_permaslug`. A week is resolvable once `weekly_usage` has rows for it. `openWeek(W)` builds markets from the most recent available prior week.

## Stack (deliberate deviation from the house blessed stack)

Brief-driven minimum for a few-hour, local-only take-home:
- Single pnpm package, React Router v8 framework mode, loaders/actions are the server seam.
- **`node:sqlite`** (built in) at an absolute path from `DATABASE_PATH` env (default `<repo>/data/app.sqlite3`, resolved absolute). No Docker.
- Karma and winnings are **append-only ledgers**; balances are sums.
- Skipped on purpose: Postgres + Kanel/Effect/HttpApi generation chain, Zero sync, Nx, deploy.
- Auth MVP: username-only login → cookie session. Stretch: OpenRouter OAuth PKCE.
- `./dev` launcher: `./dev` (serve), `./dev snapshot [--fixture path]`, `./dev open-week`, `./dev resolve`, `./dev seed-demo`, `./dev test`.
- DB init is explicit (`./dev` migrates on start idempotently); seeding is opt-in, never automatic.
