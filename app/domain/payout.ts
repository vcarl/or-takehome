export interface WeeklyRow {
  week: string; // Monday YYYY-MM-DD
  model: string;
  tokens: number;
}

/** Total tokens per model for `week` (sums duplicate rows, ignores other weeks). */
export function weeklyTotals(rows: WeeklyRow[], week: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) if (r.week === week) out.set(r.model, (out.get(r.model) ?? 0) + r.tokens);
  return out;
}

/** Models sorted by tokens desc (ties by name), top n. */
export function topN(totals: Map<string, number>, n: number): [string, number][] {
  return [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

/** Week-over-week % change; null when prior is 0 (market skipped). */
export function growthPct(prior: number, current: number): number | null {
  return prior > 0 ? ((current - prior) / prior) * 100 : null;
}

/** top_model: total staked / staked on winner; 0 if nobody (or you) picked wrong. */
export function topModelMultiplier(totalStaked: number, stakedOnWinner: number, myChoiceIsWinner: boolean): number {
  return myChoiceIsWinner && stakedOnWinner > 0 ? totalStaked / stakedOnWinner : 0;
}

/** growth: 3 × max(0, 1 − |predicted − actual| / 25), in percentage points. */
export function growthMultiplier(predictedPct: number, actualPct: number): number {
  return 3 * Math.max(0, 1 - Math.abs(predictedPct - actualPct) / 25);
}


/** top5: per predicted slot 1 pt if exact position, 0.4 if in the actual top 5 elsewhere; 3 × points / 5. */
export function slateMultiplier(predicted: string[], actual: string[]): number {
  const pts = predicted.reduce((s, m, i) => s + (actual[i] === m ? 1 : actual.includes(m) ? 0.4 : 0), 0);
  return (3 * pts) / 5;
}
