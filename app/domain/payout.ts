/** Models sorted by tokens desc (ties by name), top n. */
export function topN(totals: Map<string, number>, n: number): [string, number][] {
  return [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

/** Week-over-week % change; null when prior is 0 (market skipped). */
export function growthPct(prior: number, current: number): number | null {
  return prior > 0 ? ((current - prior) / prior) * 100 : null;
}

export const CONF = { lean: 0.3, likely: 0.6, lock: 0.9 } as const;
export type Conf = keyof typeof CONF;
export type House = { low: number; high: number };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const wz = (x: number) => clamp(x, -100, 100);

/** Weighted interval score (median + 80% range) on values winsorised to ±100. A point forecast (l=u=m) scores |a−m|. */
export function wis(m: number, l: number, u: number, a: number): number {
  m = wz(m);
  l = Math.min(wz(l), m);
  u = Math.max(wz(u), m);
  a = wz(a);
  return (Math.abs(a - m) / 2 + 0.1 * (u - l) + Math.max(0, l - a) + Math.max(0, a - u)) / 1.5;
}

/** Slot score for confidence c: quadratic score of "c on the pick, rest spread over 9", rescaled so c=1 gives 1 / 0. */
export function slotX(c: number, hit: boolean): number {
  const q = (1 - c) / 9;
  return (1 + 2 * (hit ? c : q) - c * c - 9 * q * q) / 2;
}

export function slatePoints(pick: string[], conf: Conf[], actual: string[]): number {
  return pick.reduce((s, m, i) => s + 0.4 * (actual.includes(m) ? 1 : 0) + 0.6 * slotX(CONF[conf[i] ?? "lean"], actual[i] === m), 0);
}

export const growthSkill = (house: House, bet: { pct: number; low: number; high: number }, actual: number) =>
  clamp((wis(0, house.low, house.high, actual) - wis(bet.pct, bet.low, bet.high, actual)) / 15, -1, 2);

export const slateSkill = (pointsYou: number, pointsHouse: number) => clamp(0.6 * (pointsYou - pointsHouse), -1, 2);

/** Payout multiplier for a skill in [-1, 2]; the house copy (skill 0) returns 0.9. */
export const multiplier = (skill: number) => Math.max(0, 0.9 + skill);

/** Linear-interpolated percentile (q in 0..1) of a non-empty list. */
export function percentile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = q * (s.length - 1);
  const lo = Math.floor(i);
  return s[lo]! + (s[Math.ceil(i)]! - s[lo]!) * (i - lo);
}

/** Pooled p10/p90 of week-over-week growth, rounded to 5pp; ±40 until 16 observations exist. */
export function houseRange(growths: number[]): House {
  if (growths.length < 16) return { low: -40, high: 40 };
  const r5 = (x: number) => Math.round(x / 5) * 5;
  return { low: Math.min(0, r5(percentile(growths, 0.1))), high: Math.max(0, r5(percentile(growths, 0.9))) };
}
