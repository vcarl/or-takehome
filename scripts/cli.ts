// Run via ./dev (node native TS type-stripping). Subcommands: migrate | snapshot | open-week | resolve | seed-demo
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "../app/db.server.ts";
import { addDays, weekStart } from "../app/domain/week.ts";
import {
  ensureWeeklyGrant,
  getOrCreateUser,
  openWeek,
  placeBet,
  resolveReady,
} from "../app/markets.server.ts";
import { extractWeeklyUsage, fetchRankingsHtml, storeSnapshot, type WeeklyUsage } from "../app/rankings.server.ts";

const [cmd, ...args] = process.argv.slice(2);
const db = getDb();

async function takeSnapshot(fixture?: string) {
  const html = fixture ? readFileSync(resolve(fixture), "utf8") : await fetchRankingsHtml();
  const rows = extractWeeklyUsage(html);
  const r = storeSnapshot(rows, fixture ? `fixture:${fixture}` : "live");
  console.log(`snapshot ${r.snapshotId}: ${rows.length} rows, ${r.from}..${r.to}`);
}

/** Demo only: the fixture holds one real week, so earlier weeks are synthesized (deterministically) from it. */
function synthesize(real: WeeklyUsage[], weeks: string[]): WeeklyUsage[] {
  const models = [...new Set(real.map((r) => r.model))].sort();
  return weeks.flatMap((weekStart, wi) =>
    models.map((model, i) => {
      const base = real.find((r) => r.model === model)!;
      const f = 1 + 0.25 * Math.sin(i * 1.7 + wi * 2.1) + 0.03 * ((i % 5) - 2) * (wi - 1);
      return { weekStart, model, prompt: Math.round(base.prompt * f), completion: Math.round(base.completion * f) };
    }),
  );
}

function seedDemo(fixture: string) {
  if (db.prepare("SELECT 1 FROM markets LIMIT 1").get()) throw new Error("seed-demo needs a fresh DB (markets already exist); delete data/ first");
  const real = extractWeeklyUsage(readFileSync(resolve(fixture), "utf8"));
  const realWeek = real[0]!.weekStart; // latest real week, resolvable
  const w = (n: number) => addDays(realWeek, n * 7);
  storeSnapshot(synthesize(real, [w(-3), w(-2), w(-1)]), "demo-synthetic");
  storeSnapshot(real, `fixture:${fixture}`); // real week written last
  // Demo "now" = the day after the real week ends. Week w(1) has started (locked, unresolved);
  // w(2) is the open one, built from the most recent available prior week (the real one).
  const demoNow = new Date(`${addDays(realWeek, 7)}T12:00:00Z`);
  const users = ["alice", "bob", "carol", "dave"];
  const ids = users.map((u) => getOrCreateUser(u, new Date(`${w(-3)}T00:00:00Z`)));
  const marketsFor = (w: string) =>
    db.prepare("SELECT * FROM markets WHERE week_start = ? ORDER BY id").all(w) as unknown as {
      id: number; kind: string; options_json: string | null; model_permaslug: string | null;
    }[];
  let k = 0;
  // Weeks to bet on, each before it starts, using an injected clock instead of bypassing validation.
  for (const wk of [w(-2), w(-1), w(0), w(1), w(2)]) {
    openWeek(wk);
    const clock = new Date(Math.min(Date.parse(`${addDays(wk, -1)}T12:00:00Z`), demoNow.getTime()));
    for (const uid of ids) ensureWeeklyGrant(uid, clock);
    for (const m of marketsFor(wk)) {
      ids.forEach((uid, ui) => {
        k++;
        if ((k + ui) % 3 === 0) return; // not everyone bets everywhere
        const stake = 5 + ((k * 7) % 30);
        try {
          if (m.kind === "top_model") {
            const opts = JSON.parse(m.options_json!) as string[];
            placeBet(uid, m.id, stake, opts[(k + ui) % 3 === 1 ? 0 : (k * 7 + ui) % 4], clock);
          } else placeBet(uid, m.id, stake, ((k * 13 + ui * 7) % 40) - 15, clock);
        } catch (e) {
          if (!String(e).includes("insufficient")) throw e;
        }
      });
    }
    resolveReady();
  }
  console.log(`seeded demo users: ${users.join(", ")}; resolved weeks ${w(-2)}..${w(0)}; locked ${w(1)}; open ${w(2)}`);
}

switch (cmd) {
  case "migrate":
    console.log("db ready");
    break;
  case "snapshot": {
    const i = args.indexOf("--fixture");
    await takeSnapshot(i >= 0 ? args[i + 1] : undefined);
    break;
  }
  case "open-week": {
    const w = args[0] ?? addDays(weekStart(new Date()), 7);
    console.log(`opened ${openWeek(w)} new markets for ${w}`);
    break;
  }
  case "resolve":
    console.log(`resolved ${resolveReady()} markets`);
    break;
  case "seed-demo":
    seedDemo(args[0] ?? resolve(import.meta.dirname, "../fixtures/rankings-2026-11-16.html"));
    break;
  default:
    console.error("usage: dev [snapshot [--fixture path] | open-week [YYYY-MM-DD] | resolve | seed-demo | test]");
    process.exit(2);
}
