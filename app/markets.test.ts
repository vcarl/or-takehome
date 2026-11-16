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
    expect(openWeek("2026-11-16")).toBe(2); // growth a + growth b (top5 needs 5 options)
    expect(openWeek("2026-11-16")).toBe(0);
    const u = getOrCreateUser("u", new Date("2026-11-15T00:00:00Z"));
    expect(ensureWeeklyGrant(u, new Date("2026-11-15T00:00:00Z"))).toBe(true);
    expect(ensureWeeklyGrant(u, new Date("2026-11-15T01:00:00Z"))).toBe(false);
    const db = getDb();
    const g = db.prepare("SELECT id FROM markets WHERE kind='growth' AND model_permaslug='a'").get()!.id as number;
    const before = new Date("2026-11-15T12:00:00Z");
    expect(() => placeBet(u, g, 0, 0, before)).toThrow();
    expect(() => placeBet(u, g, 5000, 0, before)).toThrow(/insufficient/);
    expect(() => placeBet(u, g, 10, 0, new Date("2026-11-16T00:00:00Z"))).toThrow(/closed/);
    placeBet(u, g, 100, 0, before);
    expect(karmaBalance(u)).toBe(1000);
    expect(resolveReady()).toBe(0);
    const wk = [r("2026-11-16", "a", 100), r("2026-11-16", "b", 150), r("2026-11-16", "other", 99999)];
    storeSnapshot({ asOf: "2026-11-20T00:00:00Z", rows: wk }, "partial"); // week 11-16 still in progress
    expect(resolveReady()).toBe(0);
    storeSnapshot({ asOf: "2026-11-23T01:00:00Z", rows: wk }, "complete");
    expect(resolveReady()).toBe(2);
    expect(winningsTotal(u)).toBe(300); // a: 100 -> 100 is 0% growth, predicted 0: x3
    expect(resolveReady()).toBe(0);
  });
});

describe("top5 market", () => {
  it("resolves to the actual top 5 and pays the slate multiplier", () => {
    const r = (weekStart: string, model: string, tokens: number) => ({ weekStart, model, tokens });
    const ms = ["a", "b", "c", "d", "e", "f"];
    const rows = (w: string, rev: boolean) => ms.map((m, i) => r(w, m, (rev ? i + 1 : 6 - i) * 100));
    storeSnapshot({ asOf: "2027-01-20T00:00:00Z", rows: [...rows("2027-01-04", false), ...rows("2027-01-11", false)] }, "t5");
    expect(openWeek("2027-01-11")).toBeGreaterThan(0);
    const db = getDb();
    const id = db.prepare("SELECT id FROM markets WHERE kind='top5' AND week_start='2027-01-11'").get()!.id as number;
    const u = getOrCreateUser("slate", new Date("2027-01-01T00:00:00Z"));
    const before = new Date("2027-01-02T00:00:00Z");
    expect(() => placeBet(u, id, 10, ["a", "a", "b", "c", "d"], before)).toThrow(/distinct/);
    expect(() => placeBet(u, id, 10, ["a", "b", "c", "d", "zz"], before)).toThrow(/option/);
    placeBet(u, id, 100, ["b", "a", "c", "d", "f"], before); // 0.4 + 0.4 + 1 + 1 + 0 = 2.8 pts
    resolveReady();
    expect(db.prepare("SELECT resolved_value v FROM markets WHERE id=?").get(id)!.v).toBe(JSON.stringify(["a", "b", "c", "d", "e"]));
    expect(winningsTotal(u)).toBeCloseTo(100 * 1.68); // 3 × 2.8 / 5
  });
});
