import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getDb } from "./db.server.ts";
import { parseDataset, storeSnapshot } from "./rankings.server.ts";
import { ensureWeeklyGrant, getOrCreateUser, karmaBalance, openWeek, placeBet, resolveReady, winningsTotal } from "./markets.server.ts";

process.env.DATABASE_PATH = ":memory:";

describe("rankings parse", () => {
  const json = JSON.parse(readFileSync("fixtures/rankings-weekly.json", "utf8"));
  it("parses the fixture; variants fold into base slug", () => {
    const ds = parseDataset(json);
    expect(ds.asOf).toBe(json.meta.as_of);
    expect(ds.rows.some((r) => r.model.includes(":"))).toBe(false);
    expect(ds.rows.length).toBeLessThan(json.data.length);
  });
  it("sums variants", () => {
    const ds = parseDataset({
      data: [
        { date: "2026-11-09", model_permaslug: "m/x", total_tokens: "100" },
        { date: "2026-11-09", model_permaslug: "m/x:free", total_tokens: "50" },
      ],
      meta: { as_of: "2026-11-16T00:00:00Z" },
    });
    expect(ds.rows).toEqual([{ weekStart: "2026-11-09", model: "m/x", tokens: 150 }]);
  });
});

describe("markets flow", () => {
  const r = (weekStart: string, model: string, tokens: number) => ({ weekStart, model, tokens });
  beforeAll(() => {
    getDb();
    storeSnapshot({ asOf: "2026-11-16T16:00:00Z", rows: [r("2026-11-09", "a", 100), r("2026-11-09", "b", 50), r("2026-11-09", "other", 9999)] }, "t");
  });

  it("opens idempotently, validates bets, resolves only covered weeks", () => {
    expect(openWeek("2026-11-16")).toBe(3); // top_model + growth a + growth b
    expect(openWeek("2026-11-16")).toBe(0);
    const u = getOrCreateUser("u", new Date("2026-11-15T00:00:00Z"));
    expect(ensureWeeklyGrant(u, new Date("2026-11-15T00:00:00Z"))).toBe(true);
    expect(ensureWeeklyGrant(u, new Date("2026-11-15T01:00:00Z"))).toBe(false);
    const db = getDb();
    const top = db.prepare("SELECT id FROM markets WHERE kind='top_model'").get()!.id as number;
    const before = new Date("2026-11-15T12:00:00Z");
    expect(() => placeBet(u, top, 0, "a", before)).toThrow();
    expect(() => placeBet(u, top, 5000, "a", before)).toThrow(/insufficient/);
    expect(() => placeBet(u, top, 10, "a", new Date("2026-11-16T00:00:00Z"))).toThrow(/closed/);
    placeBet(u, top, 100, "b", before);
    expect(karmaBalance(u)).toBe(1000);
    expect(resolveReady()).toBe(0);
    const wk = [r("2026-11-16", "a", 100), r("2026-11-16", "b", 150), r("2026-11-16", "other", 99999)];
    storeSnapshot({ asOf: "2026-11-20T00:00:00Z", rows: wk }, "partial"); // week 11-16 still in progress
    expect(resolveReady()).toBe(0);
    storeSnapshot({ asOf: "2026-11-23T01:00:00Z", rows: wk }, "complete");
    expect(resolveReady()).toBe(3);
    expect(winningsTotal(u)).toBe(100); // sole bettor, picked winner: x1
    expect(resolveReady()).toBe(0);
  });
});
