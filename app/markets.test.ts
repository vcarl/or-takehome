import { rankScore } from "./domain/payout.ts";
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getDb } from "./db.server.ts";
import { parseDataset, storeSnapshot } from "./rankings.server.ts";
import { crowdFor, leaderboard, marketBets } from "./queries.server.ts";
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
    expect(() => placeBet(u, g, 0, { pct: 0 }, before)).toThrow();
    expect(() => placeBet(u, g, 10, { pct: 0 }, new Date("2026-11-16T00:00:00Z"))).toThrow(/closed/);
    expect(() => placeBet(u, g, 101, { pct: 0 }, before)).toThrow(/1 to 100/);
    expect(() => placeBet(u, g, 10, { pct: 5, low: 6, high: 9 }, before)).toThrow(/range/);
    placeBet(u, g, 100, { pct: 0 }, before); // house copy: range defaults to -40/+40 around 0
    expect(() => placeBet(u, g, 10, { pct: 1 }, before)).toThrow(/already/);
    expect(karmaBalance(u)).toBe(1000);
    expect(resolveReady()).toBe(0);
    const wk = [r("2026-11-16", "a", 100), r("2026-11-16", "b", 150), r("2026-11-16", "other", 99999)];
    storeSnapshot({ asOf: "2026-11-20T00:00:00Z", rows: wk }, "partial"); // week 11-16 still in progress
    expect(resolveReady()).toBe(0);
    storeSnapshot({ asOf: "2026-11-23T01:00:00Z", rows: wk }, "complete");
    expect(resolveReady()).toBe(2);
    expect(winningsTotal(u)).toBeCloseTo(90); // a: house copy, skill 0, x0.9
    expect(resolveReady()).toBe(0);
  });
});

describe("top5 market, ranges, leaderboard and crowd gating", () => {
  it("scores slates and ranges against the house and gates the crowd", () => {
    const r = (weekStart: string, model: string, tokens: number) => ({ weekStart, model, tokens });
    const ms = ["a", "b", "c", "d", "e", "f"];
    const rows = (w: string, rev: boolean) => ms.map((m, i) => r(w, m, (rev ? i + 1 : 6 - i) * 100));
    storeSnapshot({ asOf: "2027-01-12T00:00:00Z", rows: [...rows("2027-01-04", false)] }, "t5");
    expect(openWeek("2027-01-11")).toBeGreaterThan(0);
    const db = getDb();
    const id = db.prepare("SELECT id FROM markets WHERE kind='top5' AND week_start='2027-01-11'").get()!.id as number;
    expect(JSON.parse(String(db.prepare("SELECT house_json h FROM markets WHERE id=?").get(id)!.h))).toEqual({ slate: ["a", "b", "c", "d", "e"], conf: Array(5).fill("lean") });
    const gm = db.prepare("SELECT id, house_json h FROM markets WHERE kind='growth' AND week_start='2027-01-11' AND model_permaslug='a'").get()!;
    expect(JSON.parse(String(gm.h))).toEqual({ low: -40, high: 40 });
    const g = Number(gm.id);
    const u = getOrCreateUser("slate", new Date("2027-01-01T00:00:00Z"));
    const v = getOrCreateUser("viewer", new Date("2027-01-01T00:00:00Z"));
    const before = new Date("2027-01-02T00:00:00Z");
    expect(() => placeBet(u, id, 10, { slate: ["a", "a", "b", "c", "d"] }, before)).toThrow(/distinct/);
    expect(() => placeBet(u, id, 10, { slate: ["a", "b", "c", "d", "zz"] }, before)).toThrow(/option/);
    expect(() => placeBet(u, id, 10, { slate: ["a", "b", "c", "d", "e"], conf: ["lock", "x" as never, "lock", "lock", "lock"] }, before)).toThrow(/confidence/);
    placeBet(u, id, 100, { slate: ["b", "a", "c", "d", "f"], conf: ["lock", "lock", "lock", "lock", "lock"] }, before);
    placeBet(u, g, 100, { pct: 0, low: 0, high: 0 }, before); // point forecast of 0; actual below is 0
    // crowd gating: hidden for a viewer who has not predicted, visible to the bettor
    const bets = marketBets(id);
    expect(crowdFor({ id, kind: "top5", status: "open", week_start: "2027-01-11" }, bets, v, before.getTime())).toEqual({ count: 1, crowd: null });
    const seen = crowdFor({ id, kind: "top5", status: "open", week_start: "2027-01-11" }, bets, u, before.getTime());
    expect(seen.crowd).toMatchObject({ kind: "top5", order: ["b", "a", "c", "d", "f"] });
    if (seen.crowd?.kind === "top5") expect(seen.crowd.models[0]).toEqual({ model: "b", borda: 5, inclusion: 1, first: 1 });
    expect(crowdFor({ id, kind: "top5", status: "open", week_start: "2027-01-11" }, bets, v, Date.parse("2027-01-11T00:00:00Z")).crowd).not.toBeNull(); // closed
    storeSnapshot({ asOf: "2027-01-20T00:00:00Z", rows: rows("2027-01-11", false) }, "t5b");
    resolveReady();
    expect(db.prepare("SELECT resolved_value v FROM markets WHERE id=?").get(id)!.v).toBe(JSON.stringify(["a", "b", "c", "d", "e"]));
    // slate: you = lock x5 on [b,a,c,d,f]; house = lean x5 on [a,b,c,d,e]; skill = 0.6 * (you - house)
    const X = (c: number, h: boolean) => (1 + 2 * (h ? c : (1 - c) / 9) - c * c - (1 - c) ** 2 / 9) / 2;
    const you = 0.4 * 4 + 0.6 * (X(0.9, false) * 2 + X(0.9, true) * 2 + X(0.9, false));
    const house = 0.4 * 5 + 0.6 * (X(0.3, true) * 5);
    const skill = Math.max(-1, Math.min(2, 0.6 * (you - house)));
    expect(Number(db.prepare("SELECT skill s FROM bets WHERE market_id=?").get(id)!.s)).toBeCloseTo(skill);
    expect(winningsTotal(u)).toBeCloseTo(100 * Math.max(0, 0.9 + skill) + 100 * (0.9 + (0.1 * 80) / 1.5 / 15)); // slate + growth (point forecast 0 hits 0%; house wis = 0.1*80/1.5)
  });
  it("orders the leaderboard by winnings scaled by skill", () => {
    const lb = leaderboard();
    expect(lb.map((r) => r.score)).toEqual(lb.map((r) => r.score).slice().sort((a, b) => b - a));
    expect(rankScore(100, 0)).toBe(100);
    expect(rankScore(100, 5)).toBe(150);
    expect(rankScore(100, -12)).toBe(0);
    expect(lb.find((r) => r.username === "viewer")).toMatchObject({ skill_score: 0, predictions: 0 });
  });
});
