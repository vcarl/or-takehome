import { getDb } from "./db.server.ts";
import { median } from "./format.ts";

const rows = <T,>(sql: string, ...args: (string | number)[]) =>
  getDb().prepare(sql).all(...args) as unknown as T[];

export interface MarketRow {
  id: number;
  week_start: string;
  kind: "growth" | "top5";
  model_permaslug: string | null;
  options_json: string | null;
  status: "open" | "resolved";
  resolved_value: string | null;
  house_json: string | null;
  total_staked: number;
  bet_count: number;
}

const MARKET_SQL = `SELECT m.*, COALESCE(SUM(b.stake), 0) AS total_staked, COUNT(b.id) AS bet_count
  FROM markets m LEFT JOIN bets b ON b.market_id = m.id`;

export const listMarkets = () => rows<MarketRow>(`${MARKET_SQL} GROUP BY m.id ORDER BY m.week_start DESC, m.kind DESC, m.id`);

export const getMarket = (id: number) => rows<MarketRow>(`${MARKET_SQL} WHERE m.id = ? GROUP BY m.id`, id)[0];

export interface BetRow {
  id: number;
  market_id: number;
  user_id: number;
  username: string;
  stake: number;
  choice_text: string | null;
  predicted_pct: number | null;
  low: number | null;
  high: number | null;
  conf_json: string | null;
  skill: number | null;
  created_at: string;
  winnings: number | null;
}

const BET_SQL = `SELECT b.*, u.username, w.amount AS winnings FROM bets b
  JOIN users u ON u.id = b.user_id LEFT JOIN winnings_ledger w ON w.bet_id = b.id`;

export const marketBets = (marketId: number) => rows<BetRow>(`${BET_SQL} WHERE b.market_id = ? ORDER BY b.id`, marketId);

export type UserBet = BetRow & { week_start: string; kind: string; model_permaslug: string | null; status: string; resolved_value: string | null };

export const userBets = (userId: number) =>
  rows<UserBet>(
    `SELECT b.*, u.username, w.amount AS winnings, m.week_start, m.kind, m.model_permaslug, m.status, m.resolved_value
     FROM bets b JOIN users u ON u.id = b.user_id JOIN markets m ON m.id = b.market_id
     LEFT JOIN winnings_ledger w ON w.bet_id = b.id WHERE b.user_id = ? ORDER BY b.id DESC`,
    userId,
  );

export const ledger = (userId: number) =>
  rows<{ id: number; delta: number; reason: string; week: string | null; created_at: string }>(
    "SELECT id, delta, reason, week, created_at FROM karma_ledger WHERE user_id = ? ORDER BY id DESC",
    userId,
  );

/** skill_score = sum(skill) / sqrt(n + 9) over resolved bets (n = resolved bet count). */
export const leaderboard = () =>
  rows<{ username: string; skill_score: number; winnings: number; predictions: number }>(
    `SELECT u.username,
       COALESCE((SELECT SUM(skill) FROM bets WHERE user_id = u.id), 0) AS skill_sum,
       (SELECT COUNT(skill) FROM bets WHERE user_id = u.id) AS n,
       COALESCE((SELECT SUM(amount) FROM winnings_ledger WHERE user_id = u.id), 0) AS winnings,
       (SELECT COUNT(*) FROM bets WHERE user_id = u.id) AS predictions
     FROM users u`,
  )
    .map((r: any) => ({ username: r.username, skill_score: r.skill_sum / Math.sqrt(r.n + 9), winnings: r.winnings, predictions: r.predictions }))
    .sort((a, b) => b.skill_score - a.skill_score || b.winnings - a.winnings || a.username.localeCompare(b.username));

export type Crowd =
  | { kind: "growth"; median: number | null; low: number | null; high: number | null }
  | { kind: "top5"; order: string[]; models: { model: string; borda: number; inclusion: number; first: number }[] };

/** Crowd aggregates from a market's bets. Pure; gating lives in `crowdFor`. */
export function crowdOf(kind: string, bets: BetRow[]): Crowd {
  if (kind === "growth") {
    const nums = (f: (b: BetRow) => number | null) => bets.map(f).filter((x): x is number => x !== null);
    return { kind: "growth", median: median(nums((b) => b.predicted_pct)), low: median(nums((b) => b.low)), high: median(nums((b) => b.high)) };
  }
  const acc = new Map<string, { borda: number; incl: number; first: number }>();
  for (const b of bets) {
    (JSON.parse(b.choice_text!) as string[]).forEach((m, i) => {
      const a = acc.get(m) ?? { borda: 0, incl: 0, first: 0 };
      a.borda += 5 - i;
      a.incl++;
      if (i === 0) a.first++;
      acc.set(m, a);
    });
  }
  const n = bets.length || 1;
  const models = [...acc]
    .map(([model, a]) => ({ model, borda: a.borda, inclusion: a.incl / n, first: a.first / n }))
    .sort((x, y) => y.borda - x.borda || x.model.localeCompare(y.model));
  return { kind: "top5", order: models.slice(0, 5).map((m) => m.model), models };
}

/**
 * Crowd view for a market, hidden (crowd: null, count only) until the viewer has predicted in it or the market
 * is closed (week started) or resolved, so nobody can copy the crowd while betting is live.
 */
export function crowdFor(m: { id: number; kind: string; status: string; week_start: string }, bets: BetRow[], userId: number | null, now = Date.now()) {
  const closed = m.status !== "open" || now >= Date.parse(`${m.week_start}T00:00:00Z`);
  const revealed = closed || (userId !== null && bets.some((b) => b.user_id === userId));
  return { count: bets.length, crowd: revealed ? crowdOf(m.kind, bets) : null };
}

/** Per-model weekly totals, oldest first, excluding the long-tail "other" row. */
export function usageByModel(): Map<string, { week: string; tokens: number }[]> {
  const out = new Map<string, { week: string; tokens: number }[]>();
  for (const r of rows<{ week_start: string; model_permaslug: string; total_tokens: number }>(
    "SELECT week_start, model_permaslug, total_tokens FROM weekly_usage WHERE model_permaslug != 'other' ORDER BY week_start",
  )) out.set(r.model_permaslug, [...(out.get(r.model_permaslug) ?? []), { week: r.week_start, tokens: r.total_tokens }]);
  return out;
}
