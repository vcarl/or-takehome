// Opt-in demo players (`./dev seed-demo --players`): scripted strategies that predict every market with bets
// timestamped before each week starts, so the skill leaderboard shows on real resolved outcomes.
import { getDb } from "./db.server.ts";
import { growthPct, topN, type Conf } from "./domain/payout.ts";
import { addDays, weekStart } from "./domain/week.ts";
import { ensureWeeklyGrant, getOrCreateUser, openWeek, placeBet, resolveReady, type Pick } from "./markets.server.ts";
import { leaderboard } from "./queries.server.ts";

const STAKE = 10;

function rng(seed: number) {
  // mulberry32
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedPlayers(demoNow: Date) {
  const db = getDb();
  const rand = rng(20261116);
  const normal = (sd: number) => sd * Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const uniform = (a: number, b: number) => a + (b - a) * rand();

  const dataWeeks = db.prepare("SELECT DISTINCT week_start AS w FROM weekly_usage ORDER BY w").all().map((r) => String(r.w));
  const totals = (w: string) =>
    new Map(db.prepare("SELECT model_permaslug AS m, total_tokens AS t FROM weekly_usage WHERE week_start = ? AND model_permaslug != 'other'").all(w).map((r) => [String(r.m), Number(r.t)]));
  const growth = (model: string, w: string) => growthPct(totals(addDays(w, -7)).get(model) ?? 0, totals(w).get(model) ?? 0);

  // Open every week that has a complete prior week, through the next week after the demo clock.
  const last = addDays(weekStart(demoNow), 7);
  const weeks: string[] = [];
  for (let w = dataWeeks[1]!; w <= last; w = addDays(w, 7)) weeks.push(w);
  for (const w of weeks) openWeek(w);

  const names = ["demo-copycat", "demo-momentum", "demo-random", "demo-sharp", "demo-decent", "demo-casual"] as const;
  const users = Object.fromEntries(names.map((n) => [n, getOrCreateUser(n, new Date(`${weeks[0]}T00:00:00Z`))]));

  const swap = (xs: string[], k: number) => {
    const a = [...xs];
    for (let j = 0; j < k; j++) {
      const i = Math.floor(rand() * (a.length - 1));
      [a[i], a[i + 1]] = [a[i + 1]!, a[i]!];
    }
    return a;
  };
  const shuffle = (xs: string[]) => xs.map((x) => [rand(), x] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  const range = (pct: number, w: number): Pick => ({ pct, low: pct - w, high: pct + w });

  weeks.forEach((W, wi) => {
    const at = new Date(`${addDays(W, -1)}T12:00:00Z`);
    const known = dataWeeks.includes(W) && W < weekStart(demoNow); // outcome exists (resolved weeks only)
    const prior = dataWeeks.filter((d) => d < W).at(-1)!; // the week the markets were built from
    for (const n of names) ensureWeeklyGrant(users[n]!, at);
    const markets = db.prepare("SELECT id, kind, model_permaslug AS m, options_json AS o FROM markets WHERE week_start = ?").all(W) as { id: number; kind: string; m: string | null; o: string | null }[];
    for (const mk of markets) {
      const play = (name: (typeof names)[number], pick: Pick) => placeBet(users[name]!, mk.id, STAKE, pick, at);
      if (mk.kind === "top5") {
        const opts = JSON.parse(mk.o!) as string[];
        const truth = topN(totals(W), 5).map(([m]) => m).filter((m) => opts.includes(m));
        for (const o of opts) if (truth.length < 5 && !truth.includes(o)) truth.push(o);
        const lean: Conf[] = Array(5).fill("lean");
        const mom = opts.slice(0, 5);
        const insight = (k: number) => (known ? swap(truth, k) : swap(mom, 1)); // unknown outcome: momentum plus a swap
        play("demo-copycat", { slate: mom, conf: lean });
        play("demo-momentum", { slate: mom, conf: lean });
        play("demo-random", { slate: shuffle(opts).slice(0, 5), conf: lean });
        play("demo-sharp", { slate: insight(1), conf: ["lock", "likely", "likely", "likely", "likely"] });
        play("demo-decent", { slate: insight(2), conf: ["likely", "likely", "lean", "lean", "lean"] });
        if (wi % 2 === 0) play("demo-casual", { slate: insight(2), conf: ["likely", "likely", "lean", "lean", "lean"] });
      } else {
        const model = mk.m!;
        const mom = growth(model, prior) ?? 0; // extrapolate last week's growth
        const actual = known ? growth(model, W) : null;
        const insight = (sd: number): Pick => {
          const pct = actual === null ? mom + normal(15) : actual + normal(sd);
          return range(pct, actual === null ? 25 : 1.28 * sd);
        };
        play("demo-copycat", { pct: 0 }); // house range: expected skill 0, return 0.90x
        play("demo-momentum", { pct: mom });
        play("demo-random", range(uniform(-30, 50), 25));
        play("demo-sharp", insight(8));
        play("demo-decent", insight(20));
        if (wi % 2 === 0) play("demo-casual", insight(20));
      }
    }
  });
  const n = resolveReady();
  console.log(`resolved ${n} markets; weeks ${weeks[0]}..${last}`);
  for (const r of leaderboard()) console.log(`${r.username.padEnd(14)} skill ${r.skill_score.toFixed(3).padStart(7)}  winnings ${r.winnings.toFixed(1).padStart(7)}  predictions ${r.predictions}`);
}
