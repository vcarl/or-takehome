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
import { extractDailyUsage, fetchRankingsHtml, storeSnapshot, type DailyUsage } from "../app/rankings.server.ts";

const [cmd, ...args] = process.argv.slice(2);
const db = getDb();

async function takeSnapshot(fixture?: string) {
  const html = fixture ? readFileSync(resolve(fixture), "utf8") : await fetchRankingsHtml();
  const rows = extractDailyUsage(html);
  const r = storeSnapshot(rows, fixture ? `fixture:${fixture}` : "live");
  console.log(`snapshot ${r.snapshotId}: ${rows.length} rows, ${r.from}..${r.to}`);
}

/** Demo only: the fixture covers a single day, so earlier days are synthesized (deterministically) from it. */
function synthesize(real: DailyUsage[], from: string, to: string): DailyUsage[] {
  const out: DailyUsage[] = [];
  const models = [...new Set(real.map((r) => r.model))].sort();
  for (let d = from, di = 0; d <= to; d = addDays(d, 1), di++) {
    models.forEach((m, i) => {
      const base = real.find((r) => r.model === m)!;
      const f = 1 + 0.25 * Math.sin(i * 1.7 + di * 0.9) + 0.015 * ((i % 5) - 2) * (di / 7);
      out.push({ date: d, model: m, prompt: Math.round(base.prompt * f), completion: Math.round(base.completion * f) });
    });
  }
  return out;
}

function seedDemo(fixture: string) {
  if (db.prepare("SELECT 1 FROM markets LIMIT 1").get()) throw new Error("seed-demo needs a fresh DB (markets already exist); delete data/ first");
  const real = extractDailyUsage(readFileSync(resolve(fixture), "utf8"));
  const realDay = real[0]!.date;
  const lastDay = addDays(realDay, 1); // synthetic "today" so the next week can open
  const firstWeek = addDays(weekStart(realDay), -21);
  storeSnapshot(synthesize(real, firstWeek, lastDay).filter((r) => r.date !== realDay), "demo-synthetic");
  storeSnapshot(real, `fixture:${fixture}`); // real day written last, wins
  const latestCovered = addDays(weekStart(realDay), 0); // week containing the real day is full via synthetic filler
  const users = ["alice", "bob", "carol", "dave"];
  const ids = users.map((u) => getOrCreateUser(u, new Date(`${addDays(firstWeek, 7)}T00:00:00Z`)));
  const marketsFor = (w: string) =>
    db.prepare("SELECT * FROM markets WHERE week_start = ? ORDER BY id").all(w) as unknown as {
      id: number; kind: string; options_json: string | null; model_permaslug: string | null;
    }[];
  let k = 0;
  // Weeks to bet on, each before it starts, using an injected clock instead of bypassing validation.
  for (const w of [-14, -7, 0, 7, 14].map((n) => addDays(latestCovered, n))) {
    openWeek(w);
    const clock = new Date(Math.min(Date.parse(`${addDays(w, -1)}T12:00:00Z`), Date.parse(`${lastDay}T12:00:00Z`)));
    for (const uid of ids) ensureWeeklyGrant(uid, clock);
    for (const m of marketsFor(w)) {
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
  console.log(`seeded demo users: ${users.join(", ")}; resolved weeks <= ${latestCovered}; open week ${addDays(latestCovered, 14)}`);
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
