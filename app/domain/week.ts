const DAY = 86_400_000;

/** "YYYY-MM-DD" of the UTC Monday starting the week containing `date` (ISO "YYYY-MM-DD" or Date). */
export function weekStart(date: string | Date): string {
  const d = typeof date === "string" ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : date;
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY)
    .toISOString()
    .slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** ISO week key like "2026-W47" (lazy weekly grant dedupe). */
export function isoWeekKey(date: string | Date): string {
  const thursday = addDays(weekStart(date), 3);
  const year = Number(thursday.slice(0, 4));
  const jan1Week = weekStart(`${year}-01-04`);
  const n = (Date.parse(`${weekStart(date)}T00:00:00Z`) - Date.parse(`${jan1Week}T00:00:00Z`)) / (7 * DAY) + 1;
  return `${year}-W${String(n).padStart(2, "0")}`;
}
