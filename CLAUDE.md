# OR Futures — karma prediction market on OpenRouter weekly token usage

Time-boxed take-home (devrel/community role). MVP first; real auth is a stretch.

## Product

- **Week** = Monday 00:00 UTC → next Monday 00:00 UTC. Markets for week W are created from week W-1's data and **close for betting when W starts**. They resolve once a snapshot covers all 7 days of W.
- **Karma** = spend currency. Every user starts with 1000; +100 weekly grant (claimed lazily, once per ISO week, on any authenticated request). Staking burns karma, win or lose. Stake is an integer 1-100 (default 10). One prediction per user per market (UNIQUE + friendly error).
- **Scoring is skill vs the house.** Each market stores a house forecast (`markets.house_json`) when `openWeek` creates it. No crowd reference, no blind/open rounds. Skill is clamped to [-1, 2]; multiplier = `max(0, 0.9 + skill)`; winnings = `stake × multiplier`, minted at resolution and stored per bet as `bets.skill`. A copy of the house scores skill 0 (x0.9).
- **Winnings** = separate, monotonically increasing score. **Leaderboard** ranks by `skill_score = Σ skill / √(n + 9)` over resolved bets (n = resolved bet count), showing Skill, Winnings, Predictions.
- **Market types** (per week):
  - `growth` — one per model in last week's top 8. Bet form fields: `pct` (median, week-over-week %), `low`, `high` (80% range; if missing, house range shifted to the median; require low ≤ pct ≤ high). House: median 0, range = pooled p10/p90 of WoW growth of the top-8 over the trailing 12 complete weeks, rounded to 5pp (±40 until ≥16 observations). Skill = `(wis_house − wis_you) / 15`, `wis(m,l,u,a) = (|a−m|/2 + 0.1(u−l) + max(0,l−a) + max(0,a−u)) / 1.5` on values winsorised to ±100.
  - `top5` — ranked slate, one per week, options = last week's top 10 (rank order), only created with ≥5 options. Bet fields: `slot1..slot5` (distinct options) and `conf1..conf5` in `lean|likely|lock` = 0.3/0.6/0.9 (default lean). House: last week's top 5 in order, all lean. Points = `Σ_i 0.4·1{pick in actual top5} + 0.6·X(c_i, exact)`, `X(c,hit) = (1 + 2·(hit ? c : (1−c)/9) − c² − (1−c)²/9) / 2`; skill = `0.6 × (pts_you − pts_house)`.
  - Form fields overall: `market`, `stake`, plus the per-type fields above. Markets close for betting when week W starts.
- **Crowd aggregates** (growth: median of medians/low/high; slate: Borda consensus 5..1, inclusion share, #1 share; plus count) are shown only after the viewer predicted in that market or once it is closed/resolved; before that loaders return `crowd: null` and the count. Individual bets on the market page are hidden the same way.
- All payout math lives in one pure module (`app/domain/payout.ts`) with Vitest coverage. No migrations: DBs created before this change (new `markets.house_json`, `bets.low/high/conf_json/skill`, bets UNIQUE) must be recreated.

## Data source

- Official dataset API: `GET https://openrouter.ai/api/v1/datasets/rankings-daily?period=week&start_date=…&end_date=…` with `Authorization: Bearer $OPENROUTER_API_KEY` (key in gitignored `.env`, loaded by the CLI only, never printed/committed/fixtured). Limits: 30/min, 500/day, so one rankings request per `./dev snapshot` (default window: last 12 weeks), plus one `GET /api/v1/models` for display names (`model_names` table, canonical_slug -> name).
- Response `{data:[{date, model_permaslug, total_tokens:"<decimal string>"}], meta:{as_of, start_date, end_date, version}}`. `period=week` buckets by ISO week start, so `date` IS `week_start`. Up to 50 models per bucket plus a reserved `other` long-tail row (stored, excluded from markets/options). `:variant` suffixes are stripped and summed into the base permaslug. There is no prompt/completion split.
- Stored in `weekly_usage(week_start, model_permaslug, total_tokens, snapshot_id)` (latest snapshot wins per week+model); `snapshots.as_of` is kept per fetch.
- **Partial-week rule:** the trailing bucket is the in-progress week. A week is resolvable only when `week_start + 7d <= date(as_of) + 1d`. `openWeek(W)` builds from the most recent complete prior week.
- **License CC BY 4.0.** Show the citation `Source: OpenRouter (openrouter.ai/rankings), as of {as_of}.` (app footer, from `latestAsOf()`).
- `fixtures/rankings-weekly.json` (and `fixtures/models.json` for names) are recorded live responses (no key) so tests/`seed-demo` run offline: `./dev snapshot --fixture fixtures/rankings-weekly.json`. `seed-demo` uses only real data, with the fixture's `as_of` as the demo clock.

## Stack (deliberate deviation from the house blessed stack)

Brief-driven minimum for a few-hour, local-only take-home:
- Single pnpm package, React Router v8 framework mode, loaders/actions are the server seam.
- **`node:sqlite`** (built in) at an absolute path from `DATABASE_PATH` env (default `<repo>/data/app.sqlite3`, resolved absolute). No Docker.
- Karma and winnings are **append-only ledgers**; balances are sums.
- Skipped on purpose: Postgres + Kanel/Effect/HttpApi generation chain, Zero sync, Nx, deploy.
- Auth MVP: username-only login → cookie session. Stretch: OpenRouter OAuth PKCE.
- `./dev` launcher: `./dev` (serve), `./dev snapshot [--fixture path]`, `./dev open-week`, `./dev resolve`, `./dev seed-demo [fixture]` (fresh DB only; resolves past weeks, opens current/next, creates no users or bets; `--players` adds scripted `demo-*` players betting every market (10 each) so the skill leaderboard runs on real outcomes), `./dev test`.
- DB init is explicit (`./dev` migrates on start idempotently); seeding is opt-in, never automatic.
