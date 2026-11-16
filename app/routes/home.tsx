import { Form, Link } from "react-router";
import type { Route } from "./+types/home";
import { isCovered, placeBet } from "../markets.server.ts";
import { getUser, requireUser } from "../session.server.ts";
import { listMarkets, marketBets, usageByModel } from "../queries.server.ts";
import { compact, displayName } from "../format.ts";

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

export async function loader({ request }: Route.LoaderArgs) {
  const now = Date.now();
  const all = listMarkets();
  // Bettable week: soonest open week that hasn't started yet.
  const week = all
    .filter((m) => m.status === "open" && Date.parse(`${m.week_start}T00:00:00Z`) > now)
    .map((m) => m.week_start)
    .sort()[0];
  const mins = week ? Math.floor((Date.parse(`${week}T00:00:00Z`) - now) / 60000) : 0;
  const closes = `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;

  const usage = usageByModel();
  const open = all.filter((m) => m.week_start === week);
  const slugs = open.flatMap((m) => (m.model_permaslug ? [m.model_permaslug] : []));
  const cards = open.map((m) => {
    const bets = marketBets(m.id);
    if (m.kind === "top_model") {
      const tally = new Map<string, number>();
      for (const b of bets) if (b.choice_text) tally.set(b.choice_text, (tally.get(b.choice_text) ?? 0) + b.stake);
      const lead = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const options: string[] = JSON.parse(m.options_json ?? "[]");
      const lastOf = (s: string) => (usage.get(s) ?? []).filter((p) => isCovered(p.week)).at(-1)?.tokens ?? 0;
      const total = options.reduce((a, o) => a + lastOf(o), 0) || 1;
      return {
        kind: "top" as const,
        m,
        count: options.length,
        betCount: bets.length,
        lead: lead && { slug: lead, name: displayName(lead, options) },
        options: options.map((o) => ({ slug: o, name: displayName(o, options), tokens: lastOf(o), share: (lastOf(o) / total) * 100 })),
      };
    }
    // Complete weeks only: the trailing bucket is partial and would fake a crash.
    const series = (usage.get(m.model_permaslug!) ?? []).filter((p) => isCovered(p.week));
    const last = series.at(-1)?.tokens ?? null;
    const prev = series.at(-2)?.tokens;
    return {
      kind: "growth" as const,
      m,
      name: displayName(m.model_permaslug!, slugs),
      series: series.map((p) => p.tokens),
      last,
      wow: last !== null && prev ? ((last - prev) / prev) * 100 : null,
      betCount: bets.length,
      median: median(bets.map((b) => b.predicted_pct).filter((p): p is number => p !== null)),
    };
  });
  const settled = [...new Set(all.filter((m) => m.status === "resolved").map((m) => m.week_start))].map((w) => {
    const ms = all.filter((m) => m.week_start === w && m.status === "resolved");
    const top = ms.find((m) => m.kind === "top_model")?.resolved_value ?? null;
    return { week: w, top: top && displayName(top), topSlug: top, growth: ms.filter((m) => m.kind === "growth").length };
  });
  // One shared y-scale (0..max) so sparklines compare across models.
  const maxTokens = Math.max(1, ...cards.flatMap((c) => (c.kind === "growth" ? c.series : [])));
  return { week, closes, cards, settled, maxTokens, user: await getUser(request) };
}

/** Hero form: place a top_model bet without leaving the page. */
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const f = await request.formData();
  const option = String(f.get("option") ?? "");
  if (!option) return { error: "Pick a model" };
  try {
    placeBet(user.id, Number(f.get("market")), Number(f.get("stake")), option);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Prediction failed" };
  }
  return { ok: `Prediction placed on ${displayName(option)}` };
}

const dm = (w: string) => new Date(`${w}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function Spark({ values, name, max }: { values: number[]; name: string; max: number }) {
  if (values.length < 2) return <span className="muted">no history</span>;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 116 + 2).toFixed(1)},${(30 - (v / max) * 28).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 120 32" role="img" aria-label={`${name} weekly tokens: ${compact(values[0]!)} to ${compact(values.at(-1)!)} over ${values.length} weeks`}>
      <polyline points={pts} />
    </svg>
  );
}

export default function Home({ loaderData: { week, closes, cards, settled, maxTokens, user }, actionData }: Route.ComponentProps) {
  return (
    <>
      <h1>{week ? `Week of ${dm(week)}` : "No open week"}</h1>
      <p className="muted">{week ? `Closes in ${closes}` : "No market is currently open for betting."}</p>
      <div className="grid">
        {cards.map((c) =>
          c.kind === "top" ? (
            <section key={c.m.id} className="card hero">
              <h2>Who's #1 by tokens next week?</h2>
              <p className="muted">
                {c.lead ? <>Crowd leads: <span title={c.lead.slug}>{c.lead.name}</span> · {c.betCount} predictions</> : "No predictions yet. Make the first one."}
              </p>
              <Form method="post" className="hero-form">
                <input type="hidden" name="market" value={c.m.id} />
                <fieldset>
                  <legend className="muted">Last week's share of the top {c.count}</legend>
                  {c.options.map((o) => (
                    <label key={o.slug} className="option" title={o.slug}>
                      <input type="radio" name="option" value={o.slug} required disabled={!user} />
                      <span className="option-name">{o.name}</span>
                      <span className="option-bar" style={{ width: `${o.share}%` }} />
                      <span className="muted">{compact(o.tokens)}</span>
                    </label>
                  ))}
                </fieldset>
                {user ? (
                  <div className="hero-submit">
                    <label>Stake <input name="stake" type="number" min="1" step="1" defaultValue={50} required /> <span className="muted">of {user.karma.toLocaleString()} karma</span></label>
                    <button className="btn" type="submit">Predict</button>
                  </div>
                ) : (
                  <Link className="btn" to="/login">Log in to predict</Link>
                )}
                {actionData && "error" in actionData && <p className="error">{actionData.error}</p>}
                {actionData && "ok" in actionData && <p className="up">{actionData.ok}</p>}
              </Form>
            </section>
          ) : (
            <section key={c.m.id} className="card">
              <h2 title={c.m.model_permaslug!}>{c.name}</h2>
              <Spark values={c.series} name={c.name} max={maxTokens} />
              <span>
                <span className="stat">{c.last === null ? "--" : compact(c.last)}</span>{" "}
                {c.wow !== null && (
                  <span className={c.wow >= 0 ? "up" : "down"}>{c.wow >= 0 ? "▲" : "▼"} {Math.abs(c.wow).toFixed(1)}%</span>
                )}
              </span>
              {c.median === null ? (
                <Link className="cta" to={`/markets/${c.m.id}`}>Make the first prediction</Link>
              ) : (
                <span className="muted">Crowd: {`${c.median > 0 ? "+" : ""}${c.median.toFixed(0)}%`} · {c.betCount} predictions</span>
              )}
              <Link className="btn" to={`/markets/${c.m.id}`}>Predict</Link>
            </section>
          ),
        )}
      </div>
      <h2>Settled weeks</h2>
      {settled.length === 0 ? <p className="muted">None yet.</p> : (
        <ul className="settled">
          {settled.map((s) => (
            <li key={s.week}>
              <Link to={`/markets?status=resolved&week=${s.week}`}>Week of {dm(s.week)}</Link>{" "}
              <span className="muted">· #1 <span title={s.topSlug ?? undefined}>{s.top ?? "n/a"}</span> · {s.growth} growth markets</span>
            </li>
          ))}
        </ul>
      )}
      <p><Link to="/markets">All markets &rarr;</Link></p>
    </>
  );
}
