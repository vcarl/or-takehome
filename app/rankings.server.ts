import { getDb, tx } from "./db.server.ts";
import { addDays, weekStart } from "./domain/week.ts";

/**
 * Official dataset API (CC BY 4.0). period=week buckets by ISO week start (Monday), so `date` is the week_start.
 * Cite as: "Source: OpenRouter (openrouter.ai/rankings), as of {as_of}." (see latestAsOf()).
 */
const API_URL = "https://openrouter.ai/api/v1/datasets/rankings-daily";

export interface WeeklyUsage {
  weekStart: string; // Monday YYYY-MM-DD
  model: string; // base permaslug, variants summed; may be the reserved "other" long-tail row
  tokens: number;
}
export interface Dataset {
  rows: WeeklyUsage[];
  asOf: string;
}
interface ApiResponse {
  data: { date: string; model_permaslug: string; total_tokens: string }[];
  meta: { as_of: string };
}

/** Parses an API response: strips ":variant" suffixes and sums into the base permaslug per week. */
export function parseDataset(json: ApiResponse): Dataset {
  const sums = new Map<string, WeeklyUsage>();
  for (const r of json.data) {
    const model = r.model_permaslug.split(":")[0]!;
    const k = `${r.date}|${model}`;
    const s = sums.get(k) ?? { weekStart: r.date, model, tokens: 0 };
    s.tokens += Number(BigInt(r.total_tokens)); // ponytail: Number is exact below 2^53 (~9e15); weekly totals are ~1e14
    sums.set(k, s);
  }
  if (!sums.size) throw new Error("dataset has no rows");
  return { rows: [...sums.values()], asOf: json.meta.as_of };
}

/** One request per snapshot (rate limit 30/min, 500/day). Needs OPENROUTER_API_KEY; never logged. */
export async function fetchDataset(weeks = 12): Promise<Dataset> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set (put it in .env)");
  const today = new Date();
  const start = addDays(weekStart(today), -7 * weeks);
  const end = today.toISOString().slice(0, 10);
  const res = await fetch(`${API_URL}?period=week&start_date=${start}&end_date=${end}`, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`GET ${API_URL} -> ${res.status}`);
  return parseDataset((await res.json()) as ApiResponse);
}

/** Stores rows under a new snapshot; later snapshots overwrite earlier (week, model) rows. */
export function storeSnapshot(ds: Dataset, source: string): { snapshotId: number; from: string; to: string } {
  const db = getDb();
  return tx(() => {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO snapshots (fetched_at, source, as_of) VALUES (?, ?, ?)")
      .run(new Date().toISOString(), source, ds.asOf);
    const snapshotId = Number(lastInsertRowid);
    const up = db.prepare(
      `INSERT INTO weekly_usage (week_start, model_permaslug, total_tokens, snapshot_id) VALUES (?, ?, ?, ?)
       ON CONFLICT (week_start, model_permaslug) DO UPDATE SET
         total_tokens = excluded.total_tokens, snapshot_id = excluded.snapshot_id`,
    );
    for (const r of ds.rows) up.run(r.weekStart, r.model, r.tokens, snapshotId);
    const weeks = ds.rows.map((r) => r.weekStart).sort();
    return { snapshotId, from: weeks[0]!, to: weeks.at(-1)! };
  });
}

/** /models: canonical_slug (= dataset permaslug) -> display name. Base entry only (ids without ":variant"); "Author: " prefix dropped. */
export function parseModelNames(json: { data: { canonical_slug: string; id: string; name: string }[] }): [string, string][] {
  return json.data.filter((m) => !m.id.includes(":")).map((m) => [m.canonical_slug, m.name.replace(/^[^:]+:\s*/, "")]);
}

export async function fetchModelNames(): Promise<[string, string][]> {
  const res = await fetch("https://openrouter.ai/api/v1/models", { headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } });
  if (!res.ok) throw new Error(`GET /models -> ${res.status}`);
  return parseModelNames(await res.json());
}

export function storeModelNames(names: [string, string][]): void {
  const up = getDb().prepare("INSERT INTO model_names (permaslug, name) VALUES (?, ?) ON CONFLICT (permaslug) DO UPDATE SET name = excluded.name");
  tx(() => { for (const [s, n] of names) up.run(s, n); });
}

/** All known display names; models missing from /models (stealth, retired) fall back to displayName()'s slug formatting. */
export function modelNames(): Record<string, string> {
  return Object.fromEntries(getDb().prepare("SELECT permaslug, name FROM model_names").all().map((r) => [String(r.permaslug), String(r.name)]));
}

/** Latest snapshot's as_of (ISO), for the required citation footer; null before any snapshot. */
export function latestAsOf(): string | null {
  const r = getDb().prepare("SELECT as_of FROM snapshots ORDER BY id DESC LIMIT 1").get();
  return r ? String(r.as_of) : null;
}
