import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getDb } from "./db.server.ts";
import { parseDataset, storeSnapshot } from "./rankings.server.ts";
import { leaderboard } from "./queries.server.ts";
import { seedPlayers } from "./seedPlayers.server.ts";

process.env.DATABASE_PATH = ":memory:";

it("players seed: sharp outranks copycat; copycat returns 0.90x", () => {
  const ds = parseDataset(JSON.parse(readFileSync("fixtures/rankings-weekly.json", "utf8")));
  storeSnapshot(ds, "fixture");
  seedPlayers(new Date(ds.asOf));
  const lb = leaderboard().map((r) => r.username);
  expect(lb.indexOf("demo-sharp")).toBeLessThan(lb.indexOf("demo-copycat"));
  const r = getDb().prepare("SELECT SUM(b.stake) s, SUM(w.amount) w FROM bets b JOIN users u ON u.id=b.user_id LEFT JOIN winnings_ledger w ON w.bet_id=b.id WHERE u.username='demo-copycat' AND b.skill IS NOT NULL").get()!;
  expect(Math.abs(Number(r.w) / Number(r.s) - 0.9)).toBeLessThan(0.02);
});
