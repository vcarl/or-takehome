import type { Route } from "./+types/leaderboard";
import { leaderboard } from "../queries.server.ts";
import { fmt } from "../format.ts";

export const loader = () => ({ rows: leaderboard() });

export default function Leaderboard({ loaderData: { rows } }: Route.ComponentProps) {
  return (
    <>
      <h1>Leaderboard</h1>
      <table>
        <thead><tr><th>#</th><th>User</th><th>Score</th><th>Skill</th><th>Winnings</th><th>Predictions</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.username}>
              <td>{i + 1}</td><td>{r.username}</td><td>{Math.round(r.score).toLocaleString()}</td><td>{r.skill_score.toFixed(2)}</td><td>{fmt(r.winnings)}</td><td>{r.predictions}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Score = winnings × (1 + skill ÷ 10). Winnings reward taking part; skill (how much you beat “same as last week”, per √(predictions + 9)) scales it up or down.</p>
    </>
  );
}
