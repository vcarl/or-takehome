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

- No documented rankings API. The public page `https://openrouter.ai/rankings` embeds TanStack Query dehydrated state containing per-model **daily** rows: `{date, model_permaslug, variant, total_prompt_tokens, total_completion_tokens, ...}`.
- `snapshot` fetches only that public page, extracts the rows, stores them. Do not probe undocumented `api/frontend/*` endpoints.
- `fixtures/rankings-*.html` is a committed capture so demos/tests run offline.
- Weekly total per model = sum over the week's days of prompt+completion tokens, grouped by `model_permaslug` (all variants summed).

## Stack (deliberate deviation from the house blessed stack)

Brief-driven minimum for a few-hour, local-only take-home:
- Single pnpm package, React Router v8 framework mode, loaders/actions are the server seam.
- **`node:sqlite`** (built in) at an absolute path from `DATABASE_PATH` env (default `<repo>/data/app.sqlite3`, resolved absolute). No Docker.
- Karma and winnings are **append-only ledgers**; balances are sums.
- Skipped on purpose: Postgres + Kanel/Effect/HttpApi generation chain, Zero sync, Nx, deploy.
- Auth MVP: username-only login → cookie session. Stretch: OpenRouter OAuth PKCE.
- `./dev` launcher: `./dev` (serve), `./dev snapshot [--fixture path]`, `./dev open-week`, `./dev resolve`, `./dev seed-demo`, `./dev test`.
- DB init is explicit (`./dev` migrates on start idempotently); seeding is opt-in, never automatic.
