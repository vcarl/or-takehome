import { expect, test } from "vitest";
import { compact, displayName, median } from "./format.ts";

test("displayName", () => {
  expect(displayName("deepseek/deepseek-v4.1-flash-20251101")).toBe("Deepseek v4.1 Flash");
  expect(displayName("openai/gpt-5")).toBe("GPT 5");
  const sib = ["a/x-20250101", "a/x-20250201"];
  expect(displayName(sib[0]!, sib)).toBe("X (Jan 1)");
});
test("compact", () => {
  expect(compact(59.2e12)).toBe("59.2T");
  expect(compact(812e9)).toBe("812B");
});
test("median", () => {
  expect(median([])).toBeNull();
  expect(median([3, 1, 2])).toBe(2);
  expect(median([4, 1, 2, 3])).toBe(2.5);
});
