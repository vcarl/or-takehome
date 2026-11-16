import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getDb } from "./db.server.ts";
import { extractDailyUsage, storeSnapshot } from "./rankings.server.ts";
import { ensureWeeklyGrant, getOrCreateUser, karmaBalance, openWeek, placeBet, resolveReady, winningsTotal } from "./markets.server.ts";

process.env.DATABASE_PATH = ":memory:";

describe("rankings extract", () => {
  it("parses the fixture", () => {
    const rows = extractDailyUsage(readFileSync("fixtures/rankings-2026-11-16.html", "utf8"));
    expect(new Set(rows.map((r) => r.date))).toEqual(new Set(["2026-11-15"]));
    expect(rows).toHaveLength(20);
  });
});

describe("markets flow", () => {
  const days = ["09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22"];
  beforeAll(() => {
    getDb();
    const rows = days.flatMap((d, i) => [
      { date: `2026-11-${d}`, model: "a", prompt: 100, completion: 0 },
      { date: `2026-11-${d}`, model: "b", prompt: 50 + (i >= 7 ? 100 : 0), completion: 0 }, // b overtakes in week 2
    ]);
    storeSnapshot(rows.filter((r) => r.date < "2026-11-22"), "t"); // last day missing: week 2 not covered
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
    storeSnapshot([{ date: "2026-11-22", model: "a", prompt: 100, completion: 0 }, { date: "2026-11-22", model: "b", prompt: 150, completion: 0 }], "t2");
    expect(resolveReady()).toBe(3);
    expect(winningsTotal(u)).toBe(100); // sole bettor, picked winner: x1
    expect(resolveReady()).toBe(0);
  });
});
