import { Form, Link, data } from "react-router";
import type { Route } from "./+types/market";
import { placeBet } from "../markets.server.ts";
import { getMarket, marketBets } from "../queries.server.ts";
import { getUser, requireUser } from "../session.server.ts";
import { displayName, fmt, title } from "../format.ts";

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const market = getMarket(Number(params.id));
  if (!market) throw data("No such market", { status: 404 });
  const bets = marketBets(market.id);
  const options: string[] = market.options_json ? JSON.parse(market.options_json) : [];
  const staked = options.map((o) => {
    const s = bets.filter((b) => b.choice_text === o).reduce((a, b) => a + b.stake, 0);
    return { option: o, staked: s, multiplier: s > 0 ? market.total_staked / s : null };
  });
  const med = median(bets.map((b) => b.predicted_pct).filter((p): p is number => p !== null));
  return { market, bets, options, staked, median: med, user: await getUser(request) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const f = await request.formData();
  const market = getMarket(Number(params.id));
  if (!market) throw data("No such market", { status: 404 });
  const stake = Number(f.get("stake"));
  const raw = String(f.get(market.kind === "growth" ? "pct" : "option") ?? "");
  if (raw === "") return { error: market.kind === "growth" ? "Enter a predicted %" : "Pick an option" };
  try {
    placeBet(user.id, market.id, stake, market.kind === "growth" ? Number(raw) : raw);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Bet failed" };
  }
  return { ok: true };
}

export default function MarketPage({ loaderData: { market: m, bets, options, staked, median, user }, actionData }: Route.ComponentProps) {
  const open = m.status === "open" && Date.now() < Date.parse(`${m.week_start}T00:00:00Z`);
  return (
    <>
      <p><Link to="/">&larr; This week</Link></p>
      <h1 title={m.model_permaslug ?? undefined}>{title(m)}</h1>
      <p className="muted">
        Week of {m.week_start} · {m.status === "open" ? (open ? `bets close ${m.week_start} 00:00 UTC` : "betting closed") : "resolved"} · {fmt(m.total_staked)} staked · {m.bet_count} bets
      </p>
      {m.status === "resolved" && (
        <p className="card"><strong>Result:</strong> {m.kind === "growth" && m.resolved_value ? `${Number(m.resolved_value).toFixed(2)}% growth` : (m.resolved_value ?? "n/a")}</p>
      )}
      <section className="card">
        <h2>How it pays</h2>
        {m.kind === "top_model" ? (
          <p>Stake karma on the model you think is #1 by total tokens. If right, you win your stake × (total staked in this market ÷ total staked on the winning option), so contrarian picks pay more. If wrong, 0. Stake is spent either way.</p>
        ) : (
          <p>Predict the week-over-week % change in total tokens. You win your stake × 3 × max(0, 1 − |predicted − actual| ÷ 25), with the error in percentage points. Stake is spent either way.</p>
        )}
      </section>
      <section className="card">
        <h2>Crowd</h2>
        {m.kind === "top_model" ? (
          <table>
            <thead><tr><th>Option</th><th>Staked</th><th>Implied multiplier</th></tr></thead>
            <tbody>{staked.map((s) => <tr key={s.option}><td title={s.option}>{displayName(s.option, options)}</td><td>{fmt(s.staked)}</td><td>{s.multiplier ? `${s.multiplier.toFixed(2)}x` : "-"}</td></tr>)}</tbody>
          </table>
        ) : (
          <p>Median prediction: {median === null ? "no bets yet" : `${median.toFixed(1)}%`}</p>
        )}
      </section>
      {open && (
        <section className="card">
          <h2>Place a bet</h2>
          {user ? (
            <Form method="post">
              {m.kind === "top_model" ? (
                <label>Option
                  <select name="option" required defaultValue="">
                    <option value="" disabled>Choose...</option>
                    {staked.map((s) => <option key={s.option} value={s.option} title={s.option}>{displayName(s.option, options)}</option>)}
                  </select>
                </label>
              ) : (
                <label>Predicted % change <input name="pct" type="number" step="0.1" required /></label>
              )}
              <label>Stake (karma, you have {fmt(user.karma)}) <input name="stake" type="number" min="1" step="1" required /></label>
              {actionData && "error" in actionData && <p className="error" role="alert">{actionData.error}</p>}
              {actionData && "ok" in actionData && <p className="good">Bet placed.</p>}
              <button>Place bet</button>
            </Form>
          ) : (
            <p><Link to="/login">Log in</Link> to bet.</p>
          )}
        </section>
      )}
      <section className="card">
        <h2>Bets</h2>
        {bets.length === 0 ? <p className="muted">None yet.</p> : (
          <table>
            <thead><tr><th>User</th><th>Choice</th><th>Stake</th>{m.status === "resolved" && <><th>Multiplier</th><th>Winnings</th></>}</tr></thead>
            <tbody>
              {bets.map((b) => (
                <tr key={b.id}>
                  <td>{b.username}</td>
                  <td title={b.choice_text ?? undefined}>{b.choice_text ? displayName(b.choice_text, options) : `${b.predicted_pct}%`}</td>
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
