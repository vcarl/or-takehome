// Run via ./dev (node native TS type-stripping). Subcommands: migrate | snapshot | open-week | resolve | seed-demo
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "../app/db.server.ts";
import { addDays, weekStart } from "../app/domain/week.ts";
import { openWeek, resolveReady } from "../app/markets.server.ts";
import { fetchDataset, fetchModelNames, parseDataset, parseModelNames, storeModelNames, storeSnapshot } from "../app/rankings.server.ts";

try {
  process.loadEnvFile(".env"); // CLI only (key is read lazily by fetchDataset, never printed)
} catch {} // .env optional

const [cmd, ...args] = process.argv.slice(2);
const db = getDb();

async function takeSnapshot(fixture?: string) {
  const ds = fixture ? parseDataset(JSON.parse(readFileSync(resolve(fixture), "utf8"))) : await fetchDataset();
  const r = storeSnapshot(ds, fixture ? `fixture:${fixture}` : "live");
  const names = fixture ? loadNamesFixture() : await fetchModelNames();
  storeModelNames(names);
  console.log(`snapshot ${r.snapshotId}: ${ds.rows.length} rows, weeks ${r.from}..${r.to}, as_of ${ds.asOf}; ${names.length} model names`);
}

const loadNamesFixture = () => parseModelNames(JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/models.json"), "utf8")));

function seedDemo(fixture: string) {
  if (db.prepare("SELECT 1 FROM markets LIMIT 1").get()) throw new Error("seed-demo needs a fresh DB (markets already exist); delete data/ first");
  const ds = parseDataset(JSON.parse(readFileSync(resolve(fixture), "utf8")));
  storeSnapshot(ds, `fixture:${fixture}`);
  storeModelNames(loadNamesFixture());
  // Demo "now" = the fixture's as_of. Last complete week is resolved (with the 2 before it); the week
  // containing as_of is locked (started, unresolved); the next week is open for live betting.
  const demoNow = new Date(ds.asOf);
  const cur = weekStart(demoNow);
  const w = (n: number) => addDays(cur, n * 7);
  // No users or bets: the demo shows real outcomes only; bets come from real logins.
  for (const wk of [w(-3), w(-2), w(-1), w(0), w(1)]) openWeek(wk);
  resolveReady();
  console.log(`seeded markets: resolved weeks ${w(-3)}..${w(-1)}; locked ${w(0)}; open ${w(1)}`);
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
