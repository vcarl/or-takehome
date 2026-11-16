import { useState } from "react";
import { Form, Link, useFetcher } from "react-router";
import type { Route } from "./+types/home";
import { isCovered, placeBet } from "../markets.server.ts";
import { getUser, requireUser } from "../session.server.ts";
import { modelNames } from "../rankings.server.ts";
import { crowdFor, listMarkets, marketBets, usageByModel } from "../queries.server.ts";
import { compact, displayName } from "../format.ts";
import type { Conf, House } from "../domain/payout.ts";

export async function loader({ request }: Route.LoaderArgs) {
  const now = Date.now();
  const user = await getUser(request);
  const all = listMarkets();
  // Bettable week: soonest open week that hasn't started yet.
  const week = all
    .filter((m) => m.status === "open" && Date.parse(`${m.week_start}T00:00:00Z`) > now)
    .map((m) => m.week_start)
    .sort()[0];
  const mins = week ? Math.floor((Date.parse(`${week}T00:00:00Z`) - now) / 60000) : 0;
  const closes = `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;

  const usage = usageByModel();
  const names = modelNames();
  const open = all.filter((m) => m.week_start === week);
  const slugs = open.flatMap((m) => (m.model_permaslug ? [m.model_permaslug] : []));
  const cards = open.map((m) => {
    const bets = marketBets(m.id);
    const { crowd } = crowdFor(m, bets, user?.id ?? null, now); // null until the viewer has predicted
    if (m.kind === "top5") {
      // Options are last week's top 10, already in rank order.
      const options: string[] = JSON.parse(m.options_json ?? "[]");
      const lastOf = (s: string) => (usage.get(s) ?? []).filter((p) => isCovered(p.week)).at(-1)?.tokens ?? 0;
      return {
        kind: "slate" as const,
        m,
        betCount: bets.length,
        crowd,
        options: options.map((o) => ({ slug: o, name: displayName(o, options, names), tokens: lastOf(o) })),
      };
    }
    // Complete weeks only: the trailing bucket is partial and would fake a crash.
    const series = (usage.get(m.model_permaslug!) ?? []).filter((p) => isCovered(p.week));
    const last = series.at(-1)?.tokens ?? null;
    const mine = user ? bets.find((b) => b.user_id === user.id) : undefined;
    const prev = series.at(-2)?.tokens;
    return {
      kind: "growth" as const,
      m,
      name: displayName(m.model_permaslug!, slugs, names),
      series: series.map((p) => p.tokens),
      last,
      wow: last !== null && prev ? ((last - prev) / prev) * 100 : null,
      betCount: bets.length,
      crowd,
      median: crowd?.kind === "growth" ? crowd.median : null,
      house: (m.house_json ? JSON.parse(m.house_json) : { low: -40, high: 40 }) as House,
      mine: mine ? { pct: mine.predicted_pct!, stake: mine.stake } : null,
    };
  });
  const settled = [...new Set(all.filter((m) => m.status === "resolved").map((m) => m.week_start))].map((w) => {
    const ms = all.filter((m) => m.week_start === w && m.status === "resolved");
    const t5 = ms.find((m) => m.kind === "top5");
    const slate = t5?.resolved_value;
    const top: string | null = slate ? JSON.parse(slate)[0] ?? null : null;
    return { week: w, id: t5?.id ?? null, top: top && displayName(top, [], names), topSlug: top };
  });
  // One shared log-scale y-axis and week axis so sparklines compare across models.
  const all_ = cards.flatMap((c) => (c.kind === "growth" ? c.series.filter((v) => v > 0) : []));
  const scale = { lo: Math.min(...all_), hi: Math.max(...all_), span: Math.max(2, ...cards.map((c) => (c.kind === "growth" ? c.series.length : 0))) };
  return { week, closes, cards, settled, scale, user };
}

/** Home forms: growth cards (via fetcher, field `pct`) and the top5 slate hero, without leaving the page. */
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const f = await request.formData();
  if (f.has("pct")) {
    try {
      placeBet(user.id, Number(f.get("market")), Number(f.get("stake")), { pct: Number(f.get("pct")) });
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Prediction failed" };
    }
    return { ok: "Prediction placed" };
  }
  const slate = [1, 2, 3, 4, 5].map((i) => String(f.get(`slot${i}`) ?? ""));
  if (slate.some((s) => !s)) return { error: "Fill all 5 slots" };
  const conf = [1, 2, 3, 4, 5].map((i) => String(f.get(`conf${i}`) || "lean") as Conf);
  try {
    placeBet(user.id, Number(f.get("market")), Number(f.get("stake")), { slate, conf });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Prediction failed" };
  }
  return { ok: "Slate submitted" };
}

type Opt = { slug: string; name: string; tokens: number };
const CYCLE: Conf[] = ["lean", "likely", "lock"];
const CONF_LABEL: Record<Conf, string> = { lean: "Lean", likely: "Likely", lock: "Lock" };
/** Tap-to-rank: tapping a model fills the next empty slot; tapping a filled slot (or the model again) clears it. */
function SlateHero({ marketId, options, betCount, karma, result }: { marketId: number; options: Opt[]; betCount: number; karma: number | null; result?: { error: string } | { ok: string } }) {
  const [slots, setSlots] = useState<(string | null)[]>([null, null, null, null, null]);
  const [conf, setConf] = useState<Conf[]>(["lean", "lean", "lean", "lean", "lean"]);
  const cycle = (i: number) => setConf((cur) => cur.map((c, j) => (j === i ? CYCLE[(CYCLE.indexOf(c) + 1) % CYCLE.length]! : c)));
  const byslug = new Map(options.map((o) => [o.slug, o]));
  const toggle = (slug: string) =>
    setSlots((cur) => {
      const at = cur.indexOf(slug);
      const next = [...cur];
      if (at >= 0) next[at] = null;
      else {
        const free = next.indexOf(null);
        if (free >= 0) next[free] = slug;
      }
      return next;
    });
  const clear = (i: number) => setSlots((cur) => cur.map((s, j) => (j === i ? null : s)));
  // Drag a filled slot onto another slot to swap them (with their confidence chips). Mouse only; tap-to-clear still works everywhere.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const swap = <T,>(xs: T[], a: number, b: number) => xs.map((x, j) => (j === a ? xs[b]! : j === b ? xs[a]! : x));
  const drop = (to: number) => {
    if (dragFrom !== null && dragFrom !== to) {
      setSlots((cur) => swap(cur, dragFrom, to));
      setConf((cur) => swap(cur, dragFrom, to));
    }
    setDragFrom(null);
    setDragOver(null);
  };
  const left = slots.filter((s) => !s).length;
  return (
    <section className="card hero">
      <h2>Rank next week's top 5</h2>
      <p className="muted">{betCount ? `${betCount} ${betCount === 1 ? "slate" : "slates"} submitted` : "No slates yet. Submit the first one."} · Exact slot 1 pt, in the top 5 elsewhere 0.4 pt.</p>
      <Form method="post" className="slate">
        <input type="hidden" name="market" value={marketId} />
        <ol className="slots" aria-label="Your top 5">
          {slots.map((s, i) => (
            <li
              key={i}
              className={dragOver === i && dragFrom !== i ? "drop-target" : undefined}
              draggable={!!s}
              onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { if (dragFrom !== null) { e.preventDefault(); setDragOver(i); } }}
              onDragLeave={() => setDragOver((o) => (o === i ? null : o))}
              onDrop={(e) => { e.preventDefault(); drop(i); }}
              onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
            >
              <input type="hidden" name={`slot${i + 1}`} value={s ?? ""} />
              <input type="hidden" name={`conf${i + 1}`} value={conf[i]} />
              <span className="grip" aria-hidden="true">{s ? "⠿" : ""}</span>
              <button type="button" className={`slot${s ? " filled" : ""}`} onClick={() => s && clear(i)} aria-label={s ? `Slot ${i + 1}: ${byslug.get(s)?.name}. Tap to clear, or drag to reorder` : `Slot ${i + 1}, empty`}>
                <span className="slot-n">#{i + 1}</span>
                <span className="slot-name">{s ? byslug.get(s)?.name : ""}</span>
              </button>
              {s && (
                <button type="button" className={`chip chip-${conf[i]}`} onClick={() => cycle(i)} aria-label={`Confidence for slot ${i + 1}: ${CONF_LABEL[conf[i]!]}. Tap to change`}>
                  {CONF_LABEL[conf[i]!]}
                </button>
              )}
            </li>
          ))}
        </ol>
        <div className="ranking">
          <p className="muted">Last week's ranking · tap to place</p>
          <ol>
            {options.map((o, i) => {
              const at = slots.indexOf(o.slug);
              return (
                <li key={o.slug}>
                  <button type="button" className="pick" aria-pressed={at >= 0} onClick={() => toggle(o.slug)} title={o.slug} disabled={at < 0 && left === 0}>
                    <span className="pick-rank">{i + 1}</span>
                    <span className="pick-name">{o.name}</span>
                    <span className="muted">{compact(o.tokens)}</span>
                    <span className="pick-slot">{at >= 0 ? `→ #${at + 1}` : ""}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="hero-submit">
          {karma === null ? (
            <Link className="btn" to="/login">Log in to rank</Link>
          ) : (
            <>
              <label>Stake <input name="stake" type="number" min="1" step="1" defaultValue={10} required /> <span className="muted">of {karma.toLocaleString()} karma</span></label>
              <button className="btn" type="submit" disabled={left > 0}>{left > 0 ? `Pick ${left} more` : "Submit slate"}</button>
            </>
          )}
          {result && "error" in result && <p className="error">{result.error}</p>}
          {result && "ok" in result && <p className="up">{result.ok}</p>}
        </div>
      </Form>
    </section>
  );
}

const signed = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(0)}%`;

/** In-card growth prediction: one slider for the median; the 80% range defaults to the house range around it. */
function GrowthForm({ marketId, house, mine, median, betCount, karma }: { marketId: number; house: House; mine: { pct: number; stake: number } | null; median: number | null; betCount: number; karma: number | null }) {
  const fetcher = useFetcher<typeof action>();
  const [pct, setPct] = useState("0"); // string so "-" and "" are typeable; the number input is the submitted value
  if (mine)
    return (
      <div className="growth-result">
        <span>You: <strong>{signed(mine.pct)}</strong> <span className="muted">({mine.stake} karma)</span></span>
        {median !== null && <span>Crowd: <strong>{signed(median)}</strong> <span className="muted">({betCount} {betCount === 1 ? "prediction" : "predictions"})</span></span>}
      </div>
    );
  if (karma === null) return <Link className="btn" to="/login">Log in to predict</Link>;
  const res = fetcher.data;
  return (
    <fetcher.Form method="post" className="growth-form">
      <input type="hidden" name="market" value={marketId} />
      <label className="growth-slider">
        <input type="range" min={-50} max={50} step={1} value={Math.max(-50, Math.min(50, Number(pct) || 0))} onChange={(e) => setPct(e.target.value)} aria-hidden tabIndex={-1} />
        <span className="growth-readout">
          <span>Next week</span>
          <span className="growth-pct stat">
            <input name="pct" type="number" min={-100} step={1} value={pct} onChange={(e) => setPct(e.target.value)} required aria-label="Predicted week-over-week change, %" />%
          </span>
          <span className="muted">House: +0% (80% range {signed(house.low)} to {signed(house.high)})</span>
          <span className="muted">{betCount} {betCount === 1 ? "prediction" : "predictions"}</span>
        </span>
      </label>
      <div className="growth-submit">
        <label>Stake <input name="stake" type="number" min="1" max="100" step="1" defaultValue={10} required /></label>
        <button className="btn" type="submit" disabled={fetcher.state !== "idle"}>Predict</button>
      </div>
      {res && "error" in res && <p className="error" role="alert">{res.error}</p>}
    </fetcher.Form>
  );
}

const dm = (w: string) => new Date(`${w}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

type Scale = { lo: number; hi: number; span: number };
/** Log y-scale shared across cards; shorter histories end at the right edge (latest week). */
function Spark({ values, name, scale: { lo, hi, span } }: { values: number[]; name: string; scale: Scale }) {
  if (values.length < 2) return <span className="muted">no history</span>;
  const y = (v: number) => 30 - ((Math.log(Math.max(v, lo)) - Math.log(lo)) / (Math.log(hi / lo) || 1)) * 28;
  const off = span - values.length;
  const pts = values.map((v, i) => `${(((off + i) / (span - 1)) * 116 + 2).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 120 36" role="img" aria-label={`${name} weekly tokens: ${compact(values[0]!)} to ${compact(values.at(-1)!)} over ${values.length} weeks`}>
      <polyline points={pts} />
      {/* One tick per week on the shared axis. */}
      {Array.from({ length: span }, (_, i) => {
        const x = ((i / (span - 1)) * 116 + 2).toFixed(1);
        return <line key={i} className="tick" x1={x} x2={x} y1={33} y2={36} />;
      })}
    </svg>
  );
}

export default function Home({ loaderData: { week, closes, cards, settled, scale, user }, actionData }: Route.ComponentProps) {
  return (
    <>
      <h1>{week ? `Week of ${dm(week)}` : "No open week"}</h1>
      <p className="muted">{week ? `Closes in ${closes}` : "No market is currently open for betting."}</p>
      {cards.map((c) => c.kind === "slate" && (
        <SlateHero key={c.m.id} marketId={c.m.id} options={c.options} betCount={c.betCount} karma={user?.karma ?? null} result={actionData} />
      ))}
      {cards.some((c) => c.kind === "growth") && (
        <>
          <h2>Growth predictions</h2>
          <p className="muted">Each card shows a model's total tokens last week, its change from the week before, and its weekly history (one tick per week); predict how much it moves next week.</p>
        </>
      )}
      <div className="grid">
        {cards.map((c) =>
          c.kind === "slate" ? null : (
            <section key={c.m.id} className="card">
              <h2 title={c.m.model_permaslug!}><Link to={`/markets/${c.m.id}`}>{c.name}</Link></h2>
              <div className="card-stats">
                <span className="stat">{c.last === null ? "--" : compact(c.last)}</span>
                {c.wow !== null && (
                  <span className={c.wow >= 0 ? "up" : "down"}>{c.wow >= 0 ? "▲" : "▼"} {Math.abs(c.wow).toFixed(1)}%</span>
                )}
                <Spark values={c.series} name={c.name} scale={scale} />
              </div>
              <GrowthForm marketId={c.m.id} house={c.house} mine={c.mine} median={c.median} betCount={c.betCount} karma={user?.karma ?? null} />
            </section>
          ),
        )}
      </div>
      <h2>Settled weeks</h2>
      {settled.length === 0 ? <p className="muted">None yet.</p> : (
        <ul className="settled">
          {settled.map((s) => (
            <li key={s.week}>
              {s.id ? <Link to={`/markets/${s.id}`}>Week of {dm(s.week)}</Link> : `Week of ${dm(s.week)}`}{" "}
              <span className="muted">· #1 <span title={s.topSlug ?? undefined}>{s.top ?? "n/a"}</span></span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
