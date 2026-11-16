import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getDb } from "./db.server.ts";
import { extractWeeklyUsage, storeSnapshot } from "./rankings.server.ts";
import { ensureWeeklyGrant, getOrCreateUser, karmaBalance, openWeek, placeBet, resolveReady, winningsTotal } from "./markets.server.ts";

process.env.DATABASE_PATH = ":memory:";

describe("rankings extract", () => {
  it("parses the fixture", () => {
    const rows = extractWeeklyUsage(readFileSync("fixtures/rankings-2026-11-16.html", "utf8"));
    expect(new Set(rows.map((r) => r.weekStart))).toEqual(new Set(["2026-11-09"]));
    expect(rows).toHaveLength(20);
  });
  it("rejects non-Sunday labels", () => {
    const html = readFileSync("fixtures/rankings-2026-11-16.html", "utf8").replaceAll("2026-11-15 00", "2026-11-14 00");
    expect(() => extractWeeklyUsage(html)).toThrow(/Sunday/);
  });
});

describe("markets flow", () => {
  beforeAll(() => {
    getDb();
    storeSnapshot([{ weekStart: "2026-11-09", model: "a", prompt: 100, completion: 0 }, { weekStart: "2026-11-09", model: "b", prompt: 50, completion: 0 }], "t");
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
    storeSnapshot([{ weekStart: "2026-11-16", model: "a", prompt: 100, completion: 0 }, { weekStart: "2026-11-16", model: "b", prompt: 150, completion: 0 }], "t2");
    expect(resolveReady()).toBe(3);
    expect(winningsTotal(u)).toBe(100); // sole bettor, picked winner: x1
    expect(resolveReady()).toBe(0);
  });
});
