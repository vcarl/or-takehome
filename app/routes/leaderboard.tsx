import type { Route } from "./+types/leaderboard";
import { leaderboard } from "../queries.server.ts";
import { fmt } from "../format.ts";

export const loader = () => ({ rows: leaderboard() });

export default function Leaderboard({ loaderData: { rows } }: Route.ComponentProps) {
  return (
    <>
      <h1>Leaderboard</h1>
      <table>
        <thead><tr><th>#</th><th>User</th><th>Score</th><th>Predictions</th><th aria-label="Breakdown"></th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.username}>
              <td>{i + 1}</td>
              <td>{r.username}</td>
              <td>{Math.round(r.score).toLocaleString()}</td>
              <td>{r.predictions}</td>
              <td className="tip-cell">
                <span className="tip" tabIndex={0} aria-label={`Skill ${r.skill_score.toFixed(2)}, winnings ${fmt(r.winnings)}`}>
                  ⓘ<span className="tip-body" aria-hidden="true">Skill {r.skill_score.toFixed(2)} · Winnings {fmt(r.winnings)}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Score = winnings × (1 + skill ÷ 10). Winnings reward taking part; skill (how much you beat “same as last week”, per √(predictions + 9)) scales it up or down. Hover ⓘ for the breakdown.</p>
    </>
  );
}
