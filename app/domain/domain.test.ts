import { describe, expect, it } from "vitest";
import { growthPct, growthSkill, houseRange, multiplier, slatePoints, slateSkill, slotX, wis } from "./payout.ts";
import { isoWeekKey, weekStart } from "./week.ts";

describe("week", () => {
  it("finds UTC Monday", () => {
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
    expect(weekStart("2026-11-22 00:00:00")).toBe("2026-11-16");
  });
  it("iso week key", () => {
    expect(isoWeekKey("2026-11-16")).toBe("2026-W47");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(isoWeekKey("2024-12-30")).toBe("2025-W01");
  });
});

describe("payout", () => {
  it("growth pct and zero prior", () => {
    expect(growthPct(100, 150)).toBe(50);
    expect(growthPct(0, 10)).toBeNull();
  });
});

describe("skill scoring", () => {
  it("wis: point forecast is |a-m|; a miss outside the range costs more", () => {
    expect(wis(10, 10, 10, 25)).toBeCloseTo(15);
    expect(wis(0, -20, 20, 50)).toBeGreaterThan(wis(0, -60, 60, 50));
    expect(wis(0, -20, 20, 500)).toBe(wis(0, -20, 20, 100)); // winsorised
  });
  it("slotX table", () => {
    expect([slotX(0.3, true), slotX(0.3, false)].map((x) => +x.toFixed(2))).toEqual([0.73, 0.51]);
    expect([slotX(0.6, true), slotX(0.6, false)].map((x) => +x.toFixed(2))).toEqual([0.91, 0.36]);
    expect([slotX(0.9, true), slotX(0.9, false)].map((x) => +x.toFixed(2))).toEqual([0.99, 0.11]);
  });
  it("house copy scores 0 skill and pays 0.9; skill clamps to [-1, 2]", () => {
    const house = { low: -40, high: 40 };
    expect(growthSkill(house, { pct: 0, ...house }, 12)).toBe(0);
    expect(growthSkill(house, { pct: 100, low: 100, high: 100 }, -100)).toBe(-1);
    expect(growthSkill(house, { pct: 7, low: 7, high: 7 }, 7)).toBeGreaterThan(0);
    const a = ["a", "b", "c", "d", "e"];
    const lean = Array(5).fill("lean");
    expect(slateSkill(slatePoints(a, lean, a), slatePoints(a, lean, a))).toBe(0);
    expect(slateSkill(5, 0)).toBe(2);
    expect(multiplier(0)).toBe(0.9);
    expect(multiplier(-1)).toBe(0);
    expect(multiplier(2)).toBeCloseTo(2.9);
  });
  it("house range: +-40 until 16 observations, then rounded pooled p10/p90", () => {
    expect(houseRange([1, 2, 3])).toEqual({ low: -40, high: 40 });
    const g = Array.from({ length: 20 }, (_, i) => i * 2 - 20); // -20..18
    expect(houseRange(g)).toEqual({ low: -15, high: 15 });
  });
});
