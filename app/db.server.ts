import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS model_names (
  permaslug TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY, fetched_at TEXT NOT NULL, source TEXT NOT NULL, as_of TEXT);
CREATE TABLE IF NOT EXISTS weekly_usage (
  week_start TEXT NOT NULL, model_permaslug TEXT NOT NULL,
  total_tokens INTEGER NOT NULL,
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
  PRIMARY KEY (week_start, model_permaslug));
CREATE TABLE IF NOT EXISTS markets (
  id INTEGER PRIMARY KEY, week_start TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('top_model','growth')),
  model_permaslug TEXT, options_json TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_value TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS markets_uniq ON markets(week_start, kind, coalesce(model_permaslug, ''));
CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY, market_id INTEGER NOT NULL REFERENCES markets(id),
  user_id INTEGER NOT NULL REFERENCES users(id), stake INTEGER NOT NULL CHECK (stake > 0),
  choice_text TEXT, predicted_pct REAL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS karma_ledger (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), delta INTEGER NOT NULL,
  reason TEXT NOT NULL, ref TEXT, week TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS karma_grant_once ON karma_ledger(user_id, week) WHERE reason = 'weekly_grant';
CREATE TABLE IF NOT EXISTS winnings_ledger (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), amount REAL NOT NULL,
  bet_id INTEGER NOT NULL UNIQUE REFERENCES bets(id), created_at TEXT NOT NULL);
`;

export function dbPath(): string {
  return resolve(process.env.DATABASE_PATH ?? resolve(import.meta.dirname, "../data/app.sqlite3"));
}

let db: DatabaseSync | undefined;
let openedPath: string | undefined;

/** Opens (and idempotently migrates) the DB. ":memory:" is honored for tests. */
export function getDb(): DatabaseSync {
  const path = process.env.DATABASE_PATH === ":memory:" ? ":memory:" : dbPath();
  if (db && openedPath === path) return db;
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  openedPath = path;
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  // Upgrade pre-API DBs: weekly_usage was derived data (prompt/completion split), safe to rebuild via snapshot.
  const cols = (t: string) => db!.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  if (cols("weekly_usage").includes("prompt_tokens")) db.exec("DROP TABLE weekly_usage");
  db.exec(SCHEMA);
  if (!cols("snapshots").includes("as_of")) db.exec("ALTER TABLE snapshots ADD COLUMN as_of TEXT");
  return db;
}

export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
