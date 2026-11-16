import type { Route } from "./+types/leaderboard";
import { leaderboard } from "../queries.server.ts";
import { fmt } from "../format.ts";

export const loader = () => ({ rows: leaderboard() });

export default function Leaderboard({ loaderData: { rows } }: Route.ComponentProps) {
  return (
    <>
      <h1>Leaderboard</h1>
      <table>
        <thead><tr><th>#</th><th>User</th><th>Score</th><th>Predictions</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.username}>
              <td>{i + 1}</td>
              <td>{r.username}</td>
              <td>
                <details className="why">
                  <summary>{Math.round(r.score).toLocaleString()} <span className="info" aria-hidden="true">ⓘ</span></summary>
                  <span className="muted">Skill {r.skill_score.toFixed(2)} · Winnings {fmt(r.winnings)}</span>
                </details>
              </td>
              <td>{r.predictions}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Score = winnings × (1 + skill ÷ 10). Winnings reward taking part; skill (how much you beat “same as last week”, per √(predictions + 9)) scales it up or down. Tap a score for the breakdown.</p>
    </>
  );
}
