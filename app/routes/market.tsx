import { Link, data } from "react-router";
import type { Route } from "./+types/market";
import { crowdFor, getMarket, marketBets } from "../queries.server.ts";
import { getUser } from "../session.server.ts";
import { displayName, fmt, title } from "../format.ts";
import { useNames } from "../root.tsx";
import type { Conf, House } from "../domain/payout.ts";

export async function loader({ request, params }: Route.LoaderArgs) {
  const market = getMarket(Number(params.id));
  if (!market) throw data("No such market", { status: 404 });
  const user = await getUser(request);
  const all = marketBets(market.id);
  const { crowd, count } = crowdFor(market, all, user?.id ?? null);
  const bets = crowd ? all : []; // individual picks are crowd info too: hidden until revealed
  const options: string[] = market.options_json ? JSON.parse(market.options_json) : [];
  const hj = market.house_json ? JSON.parse(market.house_json) : null;
  const house: House = market.kind === "growth" && hj ? hj : { low: -40, high: 40 };
  const houseSlate: { slate: string[]; conf: Conf[] } | null = market.kind === "top5" ? hj : null;
  return { market, bets, options, crowd, count, house, houseSlate, user };
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(Math.abs(n) < 10 ? 1 : 0)}%`;

type Row = { key: string; label: string; m: number; l: number; u: number; skill?: number | null; cls?: string };

/** Shared % axis: each row is an 80% range bar with a median dot; a vertical line marks the actual result. */
function RangeStrip({ rows, actual }: { rows: Row[]; actual: number | null }) {
  const xs = rows.flatMap((r) => [r.l, r.u]).concat(actual ?? [], 0);
  const lo = Math.min(...xs) - 5, hi = Math.max(...xs) + 5;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const ticks = [lo, 0, hi].map((v) => Math.round(v / 5) * 5);
  return (
    <div className="strip">
      {rows.map((r) => {
        const covered = actual !== null && r.l <= actual && actual <= r.u;
        return (
          <div key={r.key} className={`strip-row ${r.cls ?? ""}`}>
            <span className="strip-label">{r.label}</span>
            <span className="strip-track" title={`${signed(r.m)} (80%: ${signed(r.l)} to ${signed(r.u)})`}>
              <span className={`strip-bar${covered ? " hit" : ""}`} style={{ left: x(r.l), width: `calc(${x(r.u)} - ${x(r.l)})` }} />
              <span className="strip-dot" style={{ left: x(r.m) }} />
              {actual !== null && <span className="strip-actual" style={{ left: x(actual) }} />}
            </span>
            <span className="strip-val">{signed(r.m)}</span>
            <span className={`strip-skill ${r.skill == null ? "" : r.skill >= 0 ? "up" : "down"}`}>
              {r.skill == null ? "" : `${r.skill >= 0 ? "+" : ""}${r.skill.toFixed(2)}`}
            </span>
          </div>
        );
      })}
      <div className="strip-row strip-axis">
        <span />
        <span className="strip-track">
          {ticks.map((t) => <span key={t} className="strip-tick" style={{ left: x(t) }}>{signed(t)}</span>)}
        </span>
        <span className="muted">median</span>
        <span className="muted">skill</span>
      </div>
    </div>
  );
}

type SlateRow = { key: string; label: string; slate: string[]; conf?: (Conf | null)[]; skill?: number | null; winnings?: number | null; cls?: string };
const CONF_MARK: Record<string, string> = { lean: "", likely: "◐", lock: "●" };

/** One row per slate; each slot is colored by outcome: exact position, in the top 5 elsewhere, or missed. */
function SlateGrid({ rows, actual, label }: { rows: SlateRow[]; actual: string[] | null; label: (s: string) => string }) {
  const outcome = (s: string, i: number) => (!actual ? "" : actual[i] === s ? "exact" : actual.includes(s) ? "in" : "miss");
  return (
    <div className="slate-grid">
      <div className="slate-row slate-head"><span /> {[1, 2, 3, 4, 5].map((i) => <span key={i}>#{i}</span>)}<span>skill</span><span>won</span></div>
      {actual && (
        <div className="slate-row actual"><span className="strip-label">Actual</span>
          {actual.map((s) => <span key={s} className="slot-cell exact" title={s}>{label(s)}</span>)}<span /><span />
        </div>
      )}
      {rows.map((r) => (
        <div key={r.key} className={`slate-row ${r.cls ?? ""}`}>
          <span className="strip-label">{r.label}</span>
          {r.slate.map((s, i) => (
            <span key={i} className={`slot-cell ${outcome(s, i)}`} title={`${s}${r.conf?.[i] ? ` (${r.conf[i]})` : ""}`}>
              {label(s)} <span className="conf">{CONF_MARK[r.conf?.[i] ?? "lean"]}</span>
            </span>
          ))}
          <span className={`strip-skill ${r.skill == null ? "" : r.skill >= 0 ? "up" : "down"}`}>{r.skill == null ? "" : `${r.skill >= 0 ? "+" : ""}${r.skill.toFixed(2)}`}</span>
          <span className="strip-skill">{r.winnings == null ? "" : fmt(r.winnings)}</span>
        </div>
      ))}
      {actual && <p className="muted legend"><span className="slot-cell exact">exact</span> <span className="slot-cell in">in top 5</span> <span className="slot-cell miss">missed</span> · ◐ likely ● lock</p>}
    </div>
  );
}

export default function MarketPage({ loaderData: { market: m, bets, options, crowd, count, house, houseSlate, user } }: Route.ComponentProps) {
  const names = useNames();
  const open = m.status === "open" && Date.now() < Date.parse(`${m.week_start}T00:00:00Z`);
  const resolved = m.status === "resolved";
  const actual = resolved && m.kind === "growth" && m.resolved_value !== null ? Number(m.resolved_value) : null;
  const sorted = resolved ? [...bets].sort((a, b) => (b.skill ?? 0) - (a.skill ?? 0)) : bets;
  const rows: Row[] =
    m.kind !== "growth" ? [] : [
      { key: "house", label: "House", m: 0, l: house.low, u: house.high, cls: "house" },
      ...(crowd?.kind === "growth" && crowd.median !== null
        ? [{ key: "crowd", label: "Crowd", m: crowd.median, l: crowd.low ?? crowd.median, u: crowd.high ?? crowd.median, cls: "crowd" }]
        : []),
      ...sorted.map((b) => ({
        key: String(b.id),
        label: b.username,
        m: b.predicted_pct!,
        l: b.low ?? b.predicted_pct! + house.low,
        u: b.high ?? b.predicted_pct! + house.high,
        skill: b.skill,
        cls: b.user_id === user?.id ? "me" : undefined,
      })),
    ];
  return (
    <>
      <p><Link to="/">&larr; This week</Link></p>
      <h1 title={m.model_permaslug ?? undefined}>{title(m, names)}</h1>
      <p className="muted">
        Week of {m.week_start} · {m.status === "open" ? (open ? `bets close ${m.week_start} 00:00 UTC` : "betting closed") : "resolved"} · {count} predictions · {fmt(m.total_staked)} staked
      </p>
      {m.kind === "growth" ? (
        <section className="card">
          <p className="summary">
            {actual !== null && <>Actual <strong className={actual >= 0 ? "up" : "down"}>{signed(actual)}</strong> · </>}
            House {signed(0)} ({signed(house.low)} to {signed(house.high)})
            {crowd?.kind === "growth" && crowd.median !== null && <> · Crowd {signed(crowd.median)}</>}
          </p>
          <RangeStrip rows={rows} actual={actual} />
          {crowd === null && <p className="muted">{count} predictions hidden until you predict.</p>}
          {open && <p><Link className="btn" to="/">Predict on the home page</Link></p>}
        </section>
      ) : (
        <section className="card">
          <SlateGrid
            actual={resolved && m.resolved_value ? JSON.parse(m.resolved_value) : null}
            label={(s) => displayName(s, options, names)}
            rows={[
              ...(houseSlate ? [{ key: "house", label: "House", slate: houseSlate.slate, conf: houseSlate.conf, cls: "house" }] : []),
              ...(crowd?.kind === "top5" && crowd.order.length === 5 ? [{ key: "crowd", label: "Crowd", slate: crowd.order, cls: "crowd" }] : []),
              ...sorted.map((b) => ({
                key: String(b.id),
                label: b.username,
                slate: JSON.parse(b.choice_text!) as string[],
                conf: b.conf_json ? (JSON.parse(b.conf_json) as Conf[]) : undefined,
                skill: b.skill,
                winnings: b.winnings,
                cls: b.user_id === user?.id ? "me" : undefined,
              })),
            ]}
          />
          {crowd === null && <p className="muted">{count} slates hidden until you predict.</p>}
          {open && <p><Link className="btn" to="/">Rank your top 5 on the home page</Link></p>}
        </section>
      )}
    </>
  );
}
