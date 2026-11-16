import { getDb } from "./db.server.ts";

const rows = <T,>(sql: string, ...args: (string | number)[]) =>
  getDb().prepare(sql).all(...args) as unknown as T[];

export interface MarketRow {
  id: number;
  week_start: string;
  kind: "top_model" | "growth";
  model_permaslug: string | null;
  options_json: string | null;
  status: "open" | "resolved";
  resolved_value: string | null;
  total_staked: number;
  bet_count: number;
}

const MARKET_SQL = `SELECT m.*, COALESCE(SUM(b.stake), 0) AS total_staked, COUNT(b.id) AS bet_count
  FROM markets m LEFT JOIN bets b ON b.market_id = m.id`;

export function listMarkets(week?: string, status?: string): MarketRow[] {
  const where: string[] = [];
  const args: string[] = [];
  if (week) (where.push("m.week_start = ?"), args.push(week));
  if (status === "open" || status === "resolved") (where.push("m.status = ?"), args.push(status));
  return rows<MarketRow>(
    `${MARKET_SQL} ${where.length ? "WHERE " + where.join(" AND ") : ""}
     GROUP BY m.id ORDER BY m.week_start DESC, m.kind DESC, m.id`,
    ...args,
  );
}

export const weeks = () => rows<{ week_start: string }>("SELECT DISTINCT week_start FROM markets ORDER BY 1 DESC").map((r) => r.week_start);

export const getMarket = (id: number) => rows<MarketRow>(`${MARKET_SQL} WHERE m.id = ? GROUP BY m.id`, id)[0];

export interface BetRow {
  id: number;
  market_id: number;
  username: string;
  stake: number;
  choice_text: string | null;
  predicted_pct: number | null;
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

export const leaderboard = () =>
  rows<{ username: string; winnings: number; bets: number; resolved: number; hits: number }>(
    `SELECT u.username,
       COALESCE((SELECT SUM(amount) FROM winnings_ledger WHERE user_id = u.id), 0) AS winnings,
       (SELECT COUNT(*) FROM bets WHERE user_id = u.id) AS bets,
       (SELECT COUNT(*) FROM bets b JOIN markets m ON m.id = b.market_id WHERE b.user_id = u.id AND m.status = 'resolved') AS resolved,
       (SELECT COUNT(*) FROM winnings_ledger WHERE user_id = u.id) AS hits
     FROM users u ORDER BY winnings DESC, u.username`,
  );

/** Per-model weekly totals, oldest first, excluding the long-tail "other" row. */
export function usageByModel(): Map<string, { week: string; tokens: number }[]> {
  const out = new Map<string, { week: string; tokens: number }[]>();
  for (const r of rows<{ week_start: string; model_permaslug: string; total_tokens: number }>(
    "SELECT week_start, model_permaslug, total_tokens FROM weekly_usage WHERE model_permaslug != 'other' ORDER BY week_start",
  )) out.set(r.model_permaslug, [...(out.get(r.model_permaslug) ?? []), { week: r.week_start, tokens: r.total_tokens }]);
  return out;
}
