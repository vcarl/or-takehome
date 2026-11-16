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
import { fetchDataset, parseDataset, storeSnapshot } from "../app/rankings.server.ts";

try {
  process.loadEnvFile(".env"); // CLI only (key is read lazily by fetchDataset, never printed)
} catch {} // .env optional

const [cmd, ...args] = process.argv.slice(2);
const db = getDb();

async function takeSnapshot(fixture?: string) {
  const ds = fixture ? parseDataset(JSON.parse(readFileSync(resolve(fixture), "utf8"))) : await fetchDataset();
  const r = storeSnapshot(ds, fixture ? `fixture:${fixture}` : "live");
  console.log(`snapshot ${r.snapshotId}: ${ds.rows.length} rows, weeks ${r.from}..${r.to}, as_of ${ds.asOf}`);
}

function seedDemo(fixture: string) {
  if (db.prepare("SELECT 1 FROM markets LIMIT 1").get()) throw new Error("seed-demo needs a fresh DB (markets already exist); delete data/ first");
  const ds = parseDataset(JSON.parse(readFileSync(resolve(fixture), "utf8")));
  storeSnapshot(ds, `fixture:${fixture}`);
  // Demo "now" = the fixture's as_of. Last complete week is resolved (with the 2 before it); the week
  // containing as_of is locked (started, unresolved); the next week is open for live betting.
  const demoNow = new Date(ds.asOf);
  const cur = weekStart(demoNow);
  const w = (n: number) => addDays(cur, n * 7);
  const users = ["alice", "bob", "carol", "dave"];
  const ids = users.map((u) => getOrCreateUser(u, new Date(`${w(-4)}T00:00:00Z`)));
  const marketsFor = (w: string) =>
    db.prepare("SELECT * FROM markets WHERE week_start = ? ORDER BY id").all(w) as unknown as {
      id: number; kind: string; options_json: string | null; model_permaslug: string | null;
    }[];
  let k = 0;
  // Weeks to bet on, each before it starts, using an injected clock instead of bypassing validation.
  for (const wk of [w(-3), w(-2), w(-1), w(0), w(1)]) {
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
  console.log(`seeded demo users: ${users.join(", ")}; resolved weeks ${w(-3)}..${w(-1)}; locked ${w(0)}; open ${w(1)}`);
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
    seedDemo(args[0] ?? resolve(import.meta.dirname, "../fixtures/rankings-weekly.json"));
    break;
  default:
    console.error("usage: dev [snapshot [--fixture path] | open-week [YYYY-MM-DD] | resolve | seed-demo | test]");
    process.exit(2);
}
