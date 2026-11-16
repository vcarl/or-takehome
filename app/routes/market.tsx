import { Form, Link, data } from "react-router";
import type { Route } from "./+types/market";
import { placeBet } from "../markets.server.ts";
import { getMarket, marketBets } from "../queries.server.ts";
import { getUser, requireUser } from "../session.server.ts";
import { choiceLabel, fmt, median, resolvedLabel, title } from "../format.ts";
import { useNames } from "../root.tsx";

export async function loader({ request, params }: Route.LoaderArgs) {
  const market = getMarket(Number(params.id));
  if (!market) throw data("No such market", { status: 404 });
  const bets = marketBets(market.id);
  const options: string[] = market.options_json ? JSON.parse(market.options_json) : [];
  const med = median(bets.map((b) => b.predicted_pct).filter((p): p is number => p !== null));
  return { market, bets, options, median: med, user: await getUser(request) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const f = await request.formData();
  const market = getMarket(Number(params.id));
  if (!market) throw data("No such market", { status: 404 });
  // Growth only: top5 slates are submitted from the home page hero.
  const raw = String(f.get("pct") ?? "");
  if (raw === "") return { error: "Enter a predicted %" };
  try {
    placeBet(user.id, market.id, Number(f.get("stake")), Number(raw));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Bet failed" };
  }
  return { ok: true };
}

export default function MarketPage({ loaderData: { market: m, bets, options, median, user }, actionData }: Route.ComponentProps) {
  const names = useNames();
  const open = m.status === "open" && Date.now() < Date.parse(`${m.week_start}T00:00:00Z`);
  return (
    <>
      <p><Link to="/">&larr; This week</Link></p>
      <h1 title={m.model_permaslug ?? undefined}>{title(m, names)}</h1>
      <p className="muted">
        Week of {m.week_start} · {m.status === "open" ? (open ? `bets close ${m.week_start} 00:00 UTC` : "betting closed") : "resolved"} · {fmt(m.total_staked)} staked · {m.bet_count} bets
      </p>
      {m.status === "resolved" && (
        <p className="card"><strong>Result:</strong> {resolvedLabel(m, names, options)}</p>
      )}
      <section className="card">
        <h2>How it pays</h2>
        {m.kind === "top5" ? (
          <p>Rank your top 5 models by total tokens. Each slot scores 1 point if that model lands in exactly that position, 0.4 if it is in the actual top 5 but a different slot. You win your stake × 3 × points ÷ 5 (a perfect slate pays 3x). Stake is spent either way.</p>
        ) : (
          <p>Predict the week-over-week % change in total tokens. You win your stake × 3 × max(0, 1 − |predicted − actual| ÷ 25), with the error in percentage points. Stake is spent either way.</p>
        )}
      </section>
      <section className="card">
        <h2>Crowd</h2>
        {m.kind === "top5" ? (
          <p>{m.bet_count} slates submitted.</p>
        ) : (
          <p>Median prediction: {median === null ? "no bets yet" : `${median.toFixed(1)}%`}</p>
        )}
      </section>
      {open && (m.kind === "top5" ? (
        <p><Link className="btn" to="/">Rank your top 5 on the home page</Link></p>
      ) : (
        <section className="card">
          <h2>Place a bet</h2>
          {user ? (
            <Form method="post">
              <label>Predicted % change <input name="pct" type="number" step="0.1" required /></label>
              <label>Stake (karma, you have {fmt(user.karma)}) <input name="stake" type="number" min="1" step="1" required /></label>
              {actionData && "error" in actionData && <p className="error" role="alert">{actionData.error}</p>}
              {actionData && "ok" in actionData && <p className="good">Bet placed.</p>}
              <button>Place bet</button>
            </Form>
          ) : (
            <p><Link to="/login">Log in</Link> to bet.</p>
          )}
        </section>
      ))}
      <section className="card">
        <h2>Bets</h2>
        {bets.length === 0 ? <p className="muted">None yet.</p> : (
          <table>
            <thead><tr><th>User</th><th>Choice</th><th>Stake</th>{m.status === "resolved" && <><th>Multiplier</th><th>Winnings</th></>}</tr></thead>
            <tbody>
              {bets.map((b) => (
                <tr key={b.id}>
                  <td>{b.username}</td>
                  <td title={b.choice_text ?? undefined}>{choiceLabel(b, names, options)}</td>
                  <td>{fmt(b.stake)}</td>
                  {m.status === "resolved" && <><td>{fmt((b.winnings ?? 0) / b.stake)}x</td><td>{fmt(b.winnings ?? 0)}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
