import { getDb, tx } from "./db.server.ts";
import { addDays } from "./domain/week.ts";

export const RANKINGS_URL = "https://openrouter.ai/rankings";

export interface WeeklyUsage {
  weekStart: string; // Monday YYYY-MM-DD
  model: string;
  prompt: number;
  completion: number;
}

/**
 * The page embeds TanStack Query dehydrated state (RSC-escaped). The per-model weekly token rows are the
 * query with queryKey ["rankings","models",{"view":"week"}]. (Others: apps, benchmarks, performance,
 * taskSpend.) Rows are WEEKLY aggregates labelled by the week's final day: date 2026-11-15 (a Sunday) =
 * Mon 2026-11-09..Sun 2026-11-15. Assumption (magnitudes are implausible for a single day); we error if a
 * label isn't a Sunday. Each variant is its own row; we sum variants per (week, model).
 */
export function extractWeeklyUsage(html: string): WeeklyUsage[] {
  const keyAt = html.indexOf('\\"queryKey\\":[\\"rankings\\",\\"models\\"');
  if (keyAt < 0) throw new Error("rankings models query not found; page format changed?");
  const start = html.lastIndexOf('{\\"dehydratedAt\\"', keyAt);
  const chunk = html.slice(start, keyAt).replaceAll('\\"', '"');
  const sums = new Map<string, WeeklyUsage>();
  for (const [obj] of chunk.matchAll(/\{"date":"[^{}]*\}/g)) {
    const r = JSON.parse(obj);
    const date = String(r.date).slice(0, 10);
    if (new Date(`${date}T00:00:00Z`).getUTCDay() !== 0)
      throw new Error(`row date ${date} is not a Sunday: weekly-aggregate assumption broke`);
    const weekStart = addDays(date, -6);
    const k = `${weekStart}|${r.model_permaslug}`;
    const s = sums.get(k) ?? { weekStart, model: r.model_permaslug, prompt: 0, completion: 0 };
    s.prompt += r.total_prompt_tokens;
    s.completion += r.total_completion_tokens;
    sums.set(k, s);
  }
  if (!sums.size) throw new Error("no weekly rows extracted");
  return [...sums.values()];
}

export async function fetchRankingsHtml(): Promise<string> {
  const res = await fetch(RANKINGS_URL, { headers: { "user-agent": "or-futures-takehome" } });
  if (!res.ok) throw new Error(`GET ${RANKINGS_URL} -> ${res.status}`);
  return res.text();
}

/** Stores rows under a new snapshot; later snapshots overwrite earlier (week, model) rows. */
export function storeSnapshot(rows: WeeklyUsage[], source: string): { snapshotId: number; from: string; to: string } {
  const db = getDb();
  return tx(() => {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO snapshots (fetched_at, source) VALUES (?, ?)")
      .run(new Date().toISOString(), source);
    const snapshotId = Number(lastInsertRowid);
    const up = db.prepare(
      `INSERT INTO weekly_usage (week_start, model_permaslug, prompt_tokens, completion_tokens, snapshot_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (week_start, model_permaslug) DO UPDATE SET
         prompt_tokens = excluded.prompt_tokens, completion_tokens = excluded.completion_tokens,
         snapshot_id = excluded.snapshot_id`,
    );
    for (const r of rows) up.run(r.weekStart, r.model, r.prompt, r.completion, snapshotId);
    const dates = rows.map((r) => r.weekStart).sort();
    return { snapshotId, from: dates[0]!, to: dates.at(-1)! };
  });
}
