import type { Route } from "./+types/leaderboard";
import { leaderboard } from "../queries.server.ts";
import { fmt } from "../format.ts";

export const loader = () => ({ rows: leaderboard() });

export default function Leaderboard({ loaderData: { rows } }: Route.ComponentProps) {
  return (
    <>
      <h1>Leaderboard</h1>
      <table>
        <thead><tr><th>#</th><th>User</th><th>Winnings</th><th>Bets</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.username}>
              <td>{i + 1}</td><td>{r.username}</td><td>{fmt(r.winnings)}</td><td>{r.bets}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
