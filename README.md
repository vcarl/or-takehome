# OR Futures

A prediction game on OpenRouter's public weekly token-usage rankings. Each week, players call which models will make the top 5 and how fast the top 8 will grow, then get scored when the week's data lands. Reputation comes from being right, not from being loud: the leaderboard ranks forecasting skill, not volume or luck. As a by-product the crowd produces a forecast of model adoption (median growth with a range, and a consensus top 5), which is market-research signal a community team can use and publish.

## Run it

Requires Node >= 24 (uses built-in `node:sqlite`) and pnpm. `./dev` runs `pnpm install` on first use.

```
./dev seed-demo   # fresh DB from the recorded fixture (offline, real data, no API key)
./dev             # migrate and serve (React Router dev server)
./dev test        # typecheck + Vitest
./dev snapshot    # pull live rankings; needs OPENROUTER_API_KEY in .env (gitignored)
```

Other commands: `./dev open-week [date]`, `./dev resolve`, `./dev snapshot --fixture fixtures/rankings-weekly.json`. Login is username-only (cookie session); data lives in `data/app.sqlite3` (override with `DATABASE_PATH`).

## How scoring works

A week runs Monday 00:00 UTC to the next Monday. Markets for week W are built from week W-1 and close when W starts.

- **Predictions.** Rank next week's top 5 models (tap to rank, with a Lean/Likely/Lock confidence chip per slot). For each of last week's top 8 models, give a best guess plus an 80% range for week-over-week growth. One prediction per market.
- **Skill** is how much better you did than the free "same as last week" forecast. Growth: (house interval-score loss minus yours) / 15. Slate: 0.6 x (your points minus house points). Clamped to -1..+2.
- **Winnings** = stake x max(0, 0.9 + skill). Copying the free forecast returns 0.9x, so it loses a little and farming doesn't pay. A bigger stake means bigger winnings.
- **Karma** is the stake currency: 1000 to start, +100 each week, burned when staked (default stake 10, max 100).
- **Leaderboard** = sum of skill / sqrt(predictions + 9). Skill first, engagement second: a lucky newcomer can't leapfrog a consistent forecaster.
- **Crowd forecast** (median growth and range; consensus top 5 by Borda count) is shown only after you've predicted, so nobody can copy it.

Worked example: you stake 10 on a growth market and beat the "same as last week" forecast by a skill of +0.5. Winnings = 10 x (0.9 + 0.5) = 14. If you did worse by 0.9 or more, you get 0. If you simply copied last week, you get 9.

Evidence: 1000 simulated 26-week seasons resampled from the real data (stake 10). Copying last week or predicting zero growth returns 0.90x; random guessing about 0.68x; skilled forecasters return between about 0.82x and 1.64x depending on skill level. The leaderboard order matches true skill (Spearman 0.98 at weeks 4 to 26). Crowd median growth error was 6.28 pp against 29.60 pp for "same as last week". Full tables: `scratchpad/backtest/results-v2-stake10-d15.md` (not in this repo).

## Data source

The official OpenRouter rankings dataset API (`/api/v1/datasets/rankings-daily`, `period=week`), one request per `./dev snapshot` (default: last 12 weeks), plus `/api/v1/models` for display names. The long-tail `other` row and `:variant` suffixes are handled (excluded / folded into the base model). A week resolves only once a snapshot covers all 7 days. `fixtures/` holds recorded live responses so tests and `seed-demo` run offline.

Licensed CC BY 4.0. Citation shown in the app footer: `Source: OpenRouter (openrouter.ai/rankings), as of {as_of}.`

## Design notes and trade-offs

- **Stack:** React Router 8 framework mode (loaders/actions are the server seam), `node:sqlite`, a single pnpm package, no Docker. Chosen to be the smallest thing that runs locally for a time-boxed take-home. Karma and winnings are append-only ledgers; balances are sums. Payout math is one pure module with unit tests.
- **Cut for time:** blind-then-open betting rounds (the simulation shows they remove the advantage of betting late and copying the crowd; here the crowd is hidden until you predict instead); real auth ("Sign in with OpenRouter" via OAuth PKCE); weighting the crowd by forecaster skill.
- **Known gaps:** without real identity, multiple accounts can distort the crowd forecast. Betting for next week is open while the baseline week is still being reported, so late bettors see partial data for the week growth is measured against.

## What's next: benchmark events

Scheduled LLM benchmark events, where people predict a model's result on a task before it runs (design in `mechanism.md` section 4). Carries over unchanged: skill as reference loss minus your loss, the 0.9 intercept, the skill leaderboard (sum of skill divided by the square root of predictions plus 9), and hiding the crowd until you predict. What changes: there is no persistence baseline, so the house forecast is a prior registered at event creation (50% or a base rate for yes/no; previous best plus past release jumps for numeric), and entry requires a probability or range. Employees and lab insiders need a declared affiliation and are scored separately from the public crowd. Events a single lab can steer are exhibition only. Undeclared insiders and sybils can't be excluded on free accounts, so real identity is a precondition for events to carry skill.
