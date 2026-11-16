import { Form, Link } from "react-router";
import type { Route } from "./+types/markets";
import { listMarkets, weeks, type MarketRow } from "../queries.server.ts";
import { fmt, title } from "../format.ts";

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const week = url.searchParams.get("week") ?? "";
  const status = url.searchParams.get("status") ?? "";
  return { week, status, weeks: weeks(), markets: listMarkets(week, status) };
}

function Market({ m }: { m: MarketRow }) {
  return (
    <li>
      <Link to={`/markets/${m.id}`}>{title(m)}</Link>{" "}
      <span className="muted">
        {m.kind === "top_model" ? `${JSON.parse(m.options_json!).length} options` : "predict WoW % change"} · {fmt(m.total_staked)} staked · {m.bet_count} bets
        {m.status === "open" ? ` · closes ${m.week_start} 00:00 UTC` : ` · resolved: ${m.kind === "growth" && m.resolved_value ? `${Number(m.resolved_value).toFixed(1)}%` : (m.resolved_value ?? "n/a")}`}
      </span>
    </li>
  );
}

export default function Markets({ loaderData: { week, status, weeks, markets } }: Route.ComponentProps) {
  const byWeek = new Map<string, MarketRow[]>();
  for (const m of markets) byWeek.set(m.week_start, [...(byWeek.get(m.week_start) ?? []), m]);
  return (
    <>
      <h1>Markets</h1>
      <Form className="filters">
        <label>Week
          <select name="week" defaultValue={week}>
            <option value="">All</option>
            {weeks.map((w) => <option key={w}>{w}</option>)}
          </select>
        </label>
        <label>Status
          <select name="status" defaultValue={status}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
        </label>
        <button>Filter</button>
      </Form>
      {markets.length === 0 && <p className="muted">No markets match.</p>}
      {[...byWeek].map(([w, ms]) => {
        const open = ms.filter((m) => m.status === "open");
        const done = ms.filter((m) => m.status === "resolved");
        return (
          <section key={w} className="card">
            <h2>Week of {w}</h2>
            {open.length > 0 && <ul>{open.map((m) => <Market key={m.id} m={m} />)}</ul>}
            {done.length > 0 && (
              <details open={open.length === 0 && !!status}>
                <summary>{done.length} resolved</summary>
                <ul>{done.map((m) => <Market key={m.id} m={m} />)}</ul>
              </details>
            )}
          </section>
        );
      })}
    </>
  );
}
