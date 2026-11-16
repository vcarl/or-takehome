import { getDb, tx } from "./db.server.ts";
import {
  growthMultiplier,
  growthPct,
  topModelMultiplier,
  topN,
  weeklyTotals,
  type WeeklyRow,
} from "./domain/payout.ts";
import { addDays, isoWeekKey } from "./domain/week.ts";

const INITIAL_KARMA = 1000;
const WEEKLY_GRANT = 100;

interface Market {
  id: number;
  week_start: string;
  kind: "top_model" | "growth";
  model_permaslug: string | null;
  options_json: string | null;
  status: "open" | "resolved";
  resolved_value: string | null;
}

const num = (v: unknown) => Number(v);

function weekRows(week: string): WeeklyRow[] {
  return getDb()
    .prepare(
      `SELECT week_start AS week, model_permaslug AS model, prompt_tokens + completion_tokens AS tokens
       FROM weekly_usage WHERE week_start = ?`,
    )
    .all(week) as unknown as WeeklyRow[];
}

export function totalsFor(week: string) {
  return weeklyTotals(weekRows(week), week);
}

/** `week` is resolvable: weekly_usage has rows for it (rows are whole-week aggregates). */
export function isCovered(week: string): boolean {
  return !!getDb().prepare("SELECT 1 FROM weekly_usage WHERE week_start = ? LIMIT 1").get(week);
}

/**
 * Creates week's markets from the most recent available prior week's totals (week-7 normally; an earlier
 * week if that one has no data yet, e.g. the demo opens 11-23 from 11-09). Idempotent. Returns new markets.
 */
export function openWeek(week: string): number {
  const src = getDb().prepare("SELECT MAX(week_start) AS w FROM weekly_usage WHERE week_start < ?").get(week)?.w;
  const prior = src ? totalsFor(String(src)) : new Map<string, number>();
  const db = getDb();
  const ins = db.prepare(
    "INSERT OR IGNORE INTO markets (week_start, kind, model_permaslug, options_json) VALUES (?, ?, ?, ?)",
  );
  return tx(() => {
    let n = 0;
    const top10 = topN(prior, 10);
    if (top10.length) n += num(ins.run(week, "top_model", null, JSON.stringify(top10.map(([m]) => m))).changes);
    for (const [m, t] of topN(prior, 8)) if (t > 0) n += num(ins.run(week, "growth", m, null).changes);
    return n;
  });
}

export function getOrCreateUser(username: string, now = new Date()): number {
  const db = getDb();
  const row = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (row) return num(row.id);
  return tx(() => {
    const id = num(
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
  return num(r.changes) === 1;
}

export function karmaBalance(userId: number): number {
  return num(getDb().prepare("SELECT COALESCE(SUM(delta), 0) AS b FROM karma_ledger WHERE user_id = ?").get(userId)?.b);
}

export function winningsTotal(userId: number): number {
  return num(
    getDb().prepare("SELECT COALESCE(SUM(amount), 0) AS b FROM winnings_ledger WHERE user_id = ?").get(userId)?.b,
  );
}

/**
 * Stake karma on a market. `now` is injectable so the demo seed can place bets "in the past" (before the
 * week started) without bypassing validation; the app always uses the real clock.
 */
export function placeBet(
  userId: number,
  marketId: number,
  stake: number,
  choice: string | number,
  now = new Date(),
): number {
  const db = getDb();
  if (!Number.isInteger(stake) || stake <= 0) throw new Error("stake must be a positive integer");
  return tx(() => {
    const m = db.prepare("SELECT * FROM markets WHERE id = ?").get(marketId) as unknown as Market | undefined;
    if (!m) throw new Error("no such market");
    if (m.status !== "open") throw new Error("market is not open");
    if (now.getTime() >= Date.parse(`${m.week_start}T00:00:00Z`)) throw new Error("betting closed: week has started");
    if (karmaBalance(userId) < stake) throw new Error("insufficient karma");
    let text: string | null = null;
    let pct: number | null = null;
    if (m.kind === "top_model") {
      if (typeof choice !== "string" || !(JSON.parse(m.options_json!) as string[]).includes(choice))
        throw new Error("choice is not an option");
      text = choice;
    } else {
      if (typeof choice !== "number" || !Number.isFinite(choice)) throw new Error("prediction must be a number");
      pct = choice;
    }
    const id = num(
      db
        .prepare(
          "INSERT INTO bets (market_id, user_id, stake, choice_text, predicted_pct, created_at) VALUES (?,?,?,?,?,?)",
        )
        .run(marketId, userId, stake, text, pct, now.toISOString()).lastInsertRowid,
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
}

function resolveMarket(m: Market): void {
  const db = getDb();
  const cur = totalsFor(m.week_start);
  const bets = db.prepare("SELECT * FROM bets WHERE market_id = ?").all(m.id) as unknown as Bet[];
  let value: string | null;
  let mult: (b: Bet) => number;
  if (m.kind === "top_model") {
    value = topN(cur, 1)[0]?.[0] ?? null;
    const total = bets.reduce((s, b) => s + b.stake, 0);
    const onWinner = bets.filter((b) => b.choice_text === value).reduce((s, b) => s + b.stake, 0);
    mult = (b) => topModelMultiplier(total, onWinner, b.choice_text === value);
  } else {
    const actual = growthPct(totalsFor(addDays(m.week_start, -7)).get(m.model_permaslug!) ?? 0, cur.get(m.model_permaslug!) ?? 0);
    value = actual === null ? null : String(actual);
    mult = (b) => (actual === null ? 0 : growthMultiplier(b.predicted_pct!, actual));
  }
  tx(() => {
    db.prepare("UPDATE markets SET status = 'resolved', resolved_value = ? WHERE id = ?").run(value, m.id);
    const mint = db.prepare("INSERT INTO winnings_ledger (user_id, amount, bet_id, created_at) VALUES (?,?,?,?)");
    for (const b of bets) {
      const amount = b.stake * mult(b);
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

