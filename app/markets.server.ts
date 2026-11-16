import { getDb, tx } from "./db.server.ts";
import { CONF, growthPct, growthSkill, houseRange, multiplier, slatePoints, slateSkill, topN, type Conf, type House } from "./domain/payout.ts";
import { addDays, isoWeekKey } from "./domain/week.ts";
import type { MarketRow } from "./queries.server.ts";
import { latestAsOf } from "./rankings.server.ts";

const INITIAL_KARMA = 1000;
const WEEKLY_GRANT = 100;

type Market = Omit<MarketRow, "total_staked" | "bet_count">;
const MAX_STAKE = 100;
const HOUSE_DEFAULT: House = { low: -40, high: 40 };

/** model -> total tokens for `week`. "other" is the API's aggregate long-tail row, not a model. */
function totalsFor(week: string): Map<string, number> {
  const rows = getDb()
    .prepare("SELECT model_permaslug AS m, total_tokens AS t FROM weekly_usage WHERE week_start = ? AND model_permaslug != 'other'")
    .all(week);
  return new Map(rows.map((r) => [String(r.m), Number(r.t)]));
}

/**
 * `week` is resolvable: weekly_usage has rows for it AND its last day is complete per the latest snapshot's
 * as_of (week_start + 7d <= as_of date + 1d). The trailing bucket is partial until then.
 */
export function isCovered(week: string): boolean {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM weekly_usage WHERE week_start = ? LIMIT 1").get(week)) return false;
  const asOf = latestAsOf();
  return !!asOf && addDays(week, 7) <= addDays(asOf.slice(0, 10), 1);
}

/**
 * Creates week's markets from the most recent complete prior week's totals (week-7 normally; an earlier
 * week if that one has no data yet, e.g. the demo opens 11-23 from 11-09). Idempotent. Returns new markets.
 */
export function openWeek(week: string): number {
  const weeks = getDb()
    .prepare("SELECT DISTINCT week_start AS w FROM weekly_usage WHERE week_start < ? ORDER BY w DESC")
    .all(week)
    .map((r) => String(r.w));
  const src = weeks.find(isCovered); // complete weeks only; skips the partial in-progress bucket
  const prior = src ? totalsFor(src) : new Map<string, number>();
  const db = getDb();
  const ins = db.prepare(
    "INSERT OR IGNORE INTO markets (week_start, kind, model_permaslug, options_json, house_json) VALUES (?, ?, ?, ?, ?)",
  );
  // House growth range: pooled week-over-week growth of each week's then-top-8 over the 12 complete weeks up to src
  // (as in the backtest; using today's top 8 would pull in their launch weeks and blow the range out).
  const top8 = topN(prior, 8).filter(([, t]) => t > 0);
  const covered = weeks.filter(isCovered).slice(0, 12); // ponytail: totals re-read per week; fine at 12 weeks
  const growths: number[] = [];
  for (const w of covered) {
    const cur = totalsFor(w);
    const prev = totalsFor(addDays(w, -7));
    for (const [m] of topN(prev, 8)) {
      const g = growthPct(prev.get(m) ?? 0, cur.get(m) ?? 0);
      if (g !== null) growths.push(g);
    }
  }
  const house = JSON.stringify(houseRange(growths));
  return tx(() => {
    let n = 0;
    const top10 = topN(prior, 10);
    if (top10.length >= 5) {
      const opts = top10.map(([m]) => m);
      const slateHouse = JSON.stringify({ slate: opts.slice(0, 5), conf: Array(5).fill("lean") });
      n += Number(ins.run(week, "top5", null, JSON.stringify(opts), slateHouse).changes); // a slate needs 5 distinct options
    }
    for (const [m] of top8) n += Number(ins.run(week, "growth", m, null, house).changes);
    return n;
  });
}

export function getOrCreateUser(username: string, now = new Date()): number {
  const db = getDb();
  const row = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (row) return Number(row.id);
  return tx(() => {
    const id = Number(
      db.prepare("INSERT INTO users (username, created_at) VALUES (?, ?)").run(username, now.toISOString())
        .lastInsertRowid,
    );
    db.prepare("INSERT INTO karma_ledger (user_id, delta, reason, created_at) VALUES (?, ?, 'initial', ?)").run(
      id,
      INITIAL_KARMA,
      now.toISOString(),
    );
    return id;
  });
}

/** +100 once per ISO week (unique index enforces). Returns true if granted. */
export function ensureWeeklyGrant(userId: number, now = new Date()): boolean {
  const r = getDb()
    .prepare(
      `INSERT OR IGNORE INTO karma_ledger (user_id, delta, reason, week, created_at)
       VALUES (?, ?, 'weekly_grant', ?, ?)`,
    )
    .run(userId, WEEKLY_GRANT, isoWeekKey(now), now.toISOString());
  return Number(r.changes) === 1;
}

export function karmaBalance(userId: number): number {
  return Number(getDb().prepare("SELECT COALESCE(SUM(delta), 0) AS b FROM karma_ledger WHERE user_id = ?").get(userId)?.b);
}

export function winningsTotal(userId: number): number {
  return Number(
    getDb().prepare("SELECT COALESCE(SUM(amount), 0) AS b FROM winnings_ledger WHERE user_id = ?").get(userId)?.b,
  );
}

export type Pick = { pct: number; low?: number; high?: number } | { slate: string[]; conf?: Conf[] };

/**
 * Stake karma on a market (one prediction per user per market, stake 1-100). `now` is injectable for tests
 * (bets must land before the week starts). Growth: median plus optional 80% range, defaulting to the market's
 * house range shifted to the median. Slate: 5 distinct options plus per-slot confidence (default lean).
 */
export function placeBet(userId: number, marketId: number, stake: number, pick: Pick, now = new Date()): number {
  const db = getDb();
  if (!Number.isInteger(stake) || stake < 1 || stake > MAX_STAKE) throw new Error(`stake must be a whole number from 1 to ${MAX_STAKE}`);
  return tx(() => {
    const m = db.prepare("SELECT * FROM markets WHERE id = ?").get(marketId) as unknown as Market | undefined;
    if (!m) throw new Error("no such market");
    if (m.status !== "open") throw new Error("market is not open");
    if (now.getTime() >= Date.parse(`${m.week_start}T00:00:00Z`)) throw new Error("betting closed: week has started");
    if (db.prepare("SELECT 1 FROM bets WHERE market_id = ? AND user_id = ?").get(marketId, userId))
      throw new Error("you already predicted in this market");
    if (karmaBalance(userId) < stake) throw new Error("insufficient karma");
    let text: string | null = null;
    let pct: number | null = null;
    let low: number | null = null;
    let high: number | null = null;
    let conf: string | null = null;
    if (m.kind === "top5") {
      if (!("slate" in pick)) throw new Error("slate required");
      const slate = pick.slate;
      if (!Array.isArray(slate) || slate.length !== 5 || new Set(slate).size !== 5) throw new Error("pick 5 distinct models");
      const opts = JSON.parse(m.options_json!) as string[];
      if (!slate.every((s) => opts.includes(s))) throw new Error("choice is not an option");
      const cs = pick.conf ?? Array(5).fill("lean");
      if (cs.length !== 5 || !cs.every((c) => Object.hasOwn(CONF, c))) throw new Error("confidence must be lean, likely or lock");
      text = JSON.stringify(slate);
      conf = JSON.stringify(cs);
    } else {
      if (!("pct" in pick) || !Number.isFinite(pick.pct)) throw new Error("prediction must be a number");
      const h = m.house_json ? (JSON.parse(m.house_json) as House) : HOUSE_DEFAULT;
      pct = pick.pct;
      low = pick.low ?? pct + h.low;
      high = pick.high ?? pct + h.high;
      if (!Number.isFinite(low) || !Number.isFinite(high) || low > pct || pct > high) throw new Error("range must satisfy low <= prediction <= high");
    }
    const id = Number(
      db
        .prepare(
          "INSERT INTO bets (market_id, user_id, stake, choice_text, predicted_pct, low, high, conf_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .run(marketId, userId, stake, text, pct, low, high, conf, now.toISOString()).lastInsertRowid,
    );
    db.prepare(
      "INSERT INTO karma_ledger (user_id, delta, reason, ref, week, created_at) VALUES (?, ?, 'bet', ?, ?, ?)",
    ).run(userId, -stake, String(id), m.week_start, now.toISOString());
    return id;
  });
}

interface Bet {
  id: number;
  user_id: number;
  stake: number;
  choice_text: string | null;
  predicted_pct: number | null;
  low: number | null;
  high: number | null;
  conf_json: string | null;
}

function resolveMarket(m: Market): void {
  const db = getDb();
  const cur = totalsFor(m.week_start);
  const bets = db.prepare("SELECT * FROM bets WHERE market_id = ?").all(m.id) as unknown as Bet[];
  let value: string | null;
  let skill: (b: Bet) => number | null; // null = void (no prior-week data): stake refunded
  if (m.kind === "top5") {
    const actual = topN(cur, 5).map(([s]) => s);
    value = JSON.stringify(actual);
    const h = m.house_json ? JSON.parse(m.house_json) : { slate: (JSON.parse(m.options_json!) as string[]).slice(0, 5), conf: Array(5).fill("lean") };
    const ph = slatePoints(h.slate, h.conf, actual);
    skill = (b) => slateSkill(slatePoints(JSON.parse(b.choice_text!), JSON.parse(b.conf_json!), actual), ph);
  } else {
    const actual = growthPct(totalsFor(addDays(m.week_start, -7)).get(m.model_permaslug!) ?? 0, cur.get(m.model_permaslug!) ?? 0);
    value = actual === null ? null : String(actual);
    const h: House = m.house_json ? JSON.parse(m.house_json) : HOUSE_DEFAULT;
    skill = (b) => (actual === null ? null : growthSkill(h, { pct: b.predicted_pct!, low: b.low!, high: b.high! }, actual));
  }
  tx(() => {
    db.prepare("UPDATE markets SET status = 'resolved', resolved_value = ? WHERE id = ?").run(value, m.id);
    const mint = db.prepare("INSERT INTO winnings_ledger (user_id, amount, bet_id, created_at) VALUES (?,?,?,?)");
    const setSkill = db.prepare("UPDATE bets SET skill = ? WHERE id = ?");
    const refund = db.prepare("INSERT INTO karma_ledger (user_id, delta, reason, ref, created_at) VALUES (?, ?, 'void_refund', ?, ?)");
    for (const b of bets) {
      const s = skill(b);
      if (s === null) {
        refund.run(b.user_id, b.stake, String(b.id), new Date().toISOString());
        continue;
      }
      setSkill.run(s, b.id);
      const amount = b.stake * multiplier(s);
      if (amount > 0) mint.run(b.user_id, amount, b.id, new Date().toISOString());
    }
  });
}

/** Resolves every open market whose week is fully covered by data. Returns count resolved. */
export function resolveReady(): number {
  const open = getDb().prepare("SELECT * FROM markets WHERE status = 'open'").all() as unknown as Market[];
  let n = 0;
  for (const m of open) {
    if (isCovered(m.week_start)) {
      resolveMarket(m);
      n++;
    }
  }
  return n;
}

