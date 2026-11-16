import { Link } from "react-router";
import type { Route } from "./+types/markets";
import { listMarkets, type MarketRow } from "../queries.server.ts";
import { fmt, resolvedLabel, title } from "../format.ts";
import { useNames } from "../root.tsx";

export const loader = () => ({ markets: listMarkets() });

function Market({ m }: { m: MarketRow }) {
  const names = useNames();
  return (
    <li>
      <Link to={`/markets/${m.id}`}>{title(m, names)}</Link>{" "}
      <span className="muted">
        {m.kind === "top5" ? "rank the top 5" : "predict WoW % change"} · {fmt(m.total_staked)} staked · {m.bet_count} bets
        {m.status === "open" ? ` · closes ${m.week_start} 00:00 UTC` : ` · resolved: ${resolvedLabel(m, names)}`}
      </span>
    </li>
  );
}

export default function Markets({ loaderData: { markets } }: Route.ComponentProps) {
  const byWeek = new Map<string, MarketRow[]>();
  for (const m of markets) byWeek.set(m.week_start, [...(byWeek.get(m.week_start) ?? []), m]);
  return (
    <>
      <h1>Markets</h1>
      {markets.length === 0 && <p className="muted">No markets yet.</p>}
      {[...byWeek].map(([w, ms]) => (
        <section key={w} id={w} className="card">
          <h2>Week of {w}</h2>
          <ul>{ms.map((m) => <Market key={m.id} m={m} />)}</ul>
        </section>
      ))}
    </>
  );
}
