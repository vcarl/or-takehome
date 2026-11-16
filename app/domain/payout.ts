/** Models sorted by tokens desc (ties by name), top n. */
export function topN(totals: Map<string, number>, n: number): [string, number][] {
  return [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

/** Week-over-week % change; null when prior is 0 (market skipped). */
export function growthPct(prior: number, current: number): number | null {
  return prior > 0 ? ((current - prior) / prior) * 100 : null;
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
