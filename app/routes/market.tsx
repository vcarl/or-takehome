import { Form, Link, data } from "react-router";
import type { Route } from "./+types/market";
import { placeBet } from "../markets.server.ts";
import { crowdFor, getMarket, marketBets } from "../queries.server.ts";
import { getUser, requireUser } from "../session.server.ts";
import { choiceLabel, fmt, resolvedLabel, title } from "../format.ts";
import { useNames } from "../root.tsx";

export async function loader({ request, params }: Route.LoaderArgs) {
  const market = getMarket(Number(params.id));
  if (!market) throw data("No such market", { status: 404 });
  const user = await getUser(request);
  const all = marketBets(market.id);
  const { crowd, count } = crowdFor(market, all, user?.id ?? null);
  const bets = crowd ? all : []; // individual picks are crowd info too: hidden until revealed
  const options: string[] = market.options_json ? JSON.parse(market.options_json) : [];
  return { market, bets, options, crowd, count, median: crowd?.kind === "growth" ? crowd.median : null, user };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const f = await request.formData();
  const market = getMarket(Number(params.id));
  if (!market) throw data("No such market", { status: 404 });
  // Growth only: top5 slates are submitted from the home page hero.
  const num = (k: string) => (String(f.get(k) ?? "") === "" ? undefined : Number(f.get(k)));
  const pct = num("pct");
  if (pct === undefined) return { error: "Enter a predicted %" };
  try {
    placeBet(user.id, market.id, Number(f.get("stake")), { pct, low: num("low"), high: num("high") });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Bet failed" };
  }
  return { ok: true };
}

export default function MarketPage({ loaderData: { market: m, bets, options, crowd, count, median, user }, actionData }: Route.ComponentProps) {
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
          <p>Rank your top 5 models by total tokens, each slot with a confidence (lean, likely, lock). You are scored against the house slate (last week's top 5, all lean): beat it and you win more than your stake × 0.9, trail it and you win less. Stake (1-100) is spent either way.</p>
        ) : (
          <p>Predict the week-over-week % change in total tokens, with an optional 80% range (low and high). You are scored against the house forecast (0% change, house range): beat it and you win more than your stake × 0.9, trail it and you win less. Stake (1-100) is spent either way.</p>
        )}
      </section>
      <section className="card">
        <h2>Crowd</h2>
        {m.kind === "top5" ? (
          <p>{count} slates submitted.{crowd?.kind === "top5" && crowd.order.length > 0 && ` Consensus: ${crowd.order.map((o) => names[o] ?? o).join(", ")}.`}</p>
        ) : (
          <p>Median prediction: {crowd === null ? `hidden until you predict (${count} so far)` : median === null ? "no bets yet" : `${median.toFixed(1)}%`}</p>
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
              <label>Stake (karma, you have {fmt(user.karma)}) <input name="stake" type="number" min="1" max="100" step="1" defaultValue={10} required /></label>
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
