import { describe, expect, it } from "vitest";
import { growthMultiplier, growthPct, slateMultiplier, topModelMultiplier, topN, weeklyTotals } from "./payout.ts";
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
  it("sums week totals, ignoring other weeks", () => {
    const t = weeklyTotals(
      [
        { week: "2026-11-09", model: "a", tokens: 10 },
        { week: "2026-11-16", model: "a", tokens: 100 },
        { week: "2026-11-09", model: "b", tokens: 7 },
      ],
      "2026-11-09",
    );
    expect(topN(t, 1)).toEqual([["a", 10]]);
  });
  it("growth pct and zero prior", () => {
    expect(growthPct(100, 150)).toBe(50);
    expect(growthPct(0, 10)).toBeNull();
  });
  it("top model multiplier: contrarian, sole bettor, no bets on winner", () => {
    expect(topModelMultiplier(100, 25, true)).toBe(4);
    expect(topModelMultiplier(50, 50, true)).toBe(1);
    expect(topModelMultiplier(100, 0, false)).toBe(0);
    expect(topModelMultiplier(100, 25, false)).toBe(0);
  });
  it("growth multiplier", () => {
    expect(growthMultiplier(10, 10)).toBe(3);
    expect(growthMultiplier(10, 22.5)).toBeCloseTo(1.5);
    expect(growthMultiplier(0, 25)).toBe(0);
    expect(growthMultiplier(0, 80)).toBe(0);
  });
});

describe("slateMultiplier", () => {
  const actual = ["a", "b", "c", "d", "e"];
  it("scores exact, swapped, disjoint and mixed slates", () => {
    expect(slateMultiplier(actual, actual)).toBe(3);
    expect(slateMultiplier(["b", "c", "d", "e", "a"], actual)).toBeCloseTo(1.2);
    expect(slateMultiplier(["v", "w", "x", "y", "z"], actual)).toBe(0);
    expect(slateMultiplier(["a", "c", "x", "d", "y"], actual)).toBeCloseTo(1.44); // 1 + .4 + 0 + 1 + 0
  });
});
