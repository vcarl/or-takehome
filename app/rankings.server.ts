import { getDb, tx } from "./db.server.ts";

export const RANKINGS_URL = "https://openrouter.ai/rankings";

export interface DailyUsage {
  date: string; // YYYY-MM-DD
  model: string;
  prompt: number;
  completion: number;
}

/**
 * The page embeds TanStack Query dehydrated state (RSC-escaped). The per-model daily token rows are the
 * query with queryKey ["rankings","models",{"view":"week"}]. (Others: apps, benchmarks, performance,
 * taskSpend.) Despite view "week", the 2026-11-16 capture holds ONE day (2026-11-15) for the top ~20 models.
 * Each variant is its own row; we sum variants per (date, model).
 */
export function extractDailyUsage(html: string): DailyUsage[] {
  const keyAt = html.indexOf('\\"queryKey\\":[\\"rankings\\",\\"models\\"');
  if (keyAt < 0) throw new Error("rankings models query not found; page format changed?");
  const start = html.lastIndexOf('{\\"dehydratedAt\\"', keyAt);
  const chunk = html.slice(start, keyAt).replaceAll('\\"', '"');
  const sums = new Map<string, DailyUsage>();
  for (const [obj] of chunk.matchAll(/\{"date":"[^{}]*\}/g)) {
    const r = JSON.parse(obj);
    const date = String(r.date).slice(0, 10);
    const k = `${date}|${r.model_permaslug}`;
    const s = sums.get(k) ?? { date, model: r.model_permaslug, prompt: 0, completion: 0 };
    s.prompt += r.total_prompt_tokens;
    s.completion += r.total_completion_tokens;
    sums.set(k, s);
  }
  if (!sums.size) throw new Error("no daily rows extracted");
  return [...sums.values()];
}

export async function fetchRankingsHtml(): Promise<string> {
  const res = await fetch(RANKINGS_URL, { headers: { "user-agent": "or-futures-takehome" } });
  if (!res.ok) throw new Error(`GET ${RANKINGS_URL} -> ${res.status}`);
  return res.text();
}

/** Stores rows under a new snapshot; later snapshots overwrite earlier (date, model) rows. */
export function storeSnapshot(rows: DailyUsage[], source: string): { snapshotId: number; from: string; to: string } {
  const db = getDb();
  return tx(() => {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO snapshots (fetched_at, source) VALUES (?, ?)")
      .run(new Date().toISOString(), source);
    const snapshotId = Number(lastInsertRowid);
    const up = db.prepare(
      `INSERT INTO daily_usage (date, model_permaslug, prompt_tokens, completion_tokens, snapshot_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (date, model_permaslug) DO UPDATE SET
         prompt_tokens = excluded.prompt_tokens, completion_tokens = excluded.completion_tokens,
         snapshot_id = excluded.snapshot_id`,
    );
    for (const r of rows) up.run(r.date, r.model, r.prompt, r.completion, snapshotId);
    const dates = rows.map((r) => r.date).sort();
    return { snapshotId, from: dates[0]!, to: dates.at(-1)! };
  });
}
