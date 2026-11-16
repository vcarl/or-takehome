import { Link } from "react-router";
import type { Route } from "./+types/me";
import { ledger, userBets } from "../queries.server.ts";
import { requireUser } from "../session.server.ts";
import { choiceLabel, fmt, title } from "../format.ts";
import { useNames } from "../root.tsx";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return { bets: userBets(user.id), ledger: ledger(user.id) };
}

export default function Me({ loaderData: { bets, ledger } }: Route.ComponentProps) {
  const names = useNames();
  return (
    <>
      <h1>My bets</h1>
      {bets.length === 0 ? <p className="muted">No bets yet. <Link to="/">Browse markets</Link>.</p> : (
        <table>
          <thead><tr><th>Market</th><th>Status</th><th>Choice</th><th>Stake</th><th>Multiplier</th><th>Winnings</th></tr></thead>
          <tbody>
            {bets.map((b) => (
              <tr key={b.id}>
                <td><Link to={`/markets/${b.market_id}`}>{b.week_start} {title(b, names)}</Link></td>
                <td>{b.status}</td>
                <td>{choiceLabel(b, names)}</td>
                <td>{fmt(b.stake)}</td>
                <td>{b.status === "resolved" ? `${fmt((b.winnings ?? 0) / b.stake)}x` : "-"}</td>
                <td>{b.status === "resolved" ? fmt(b.winnings ?? 0) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Karma ledger</h2>
      <table>
        <thead><tr><th>When (UTC)</th><th>Reason</th><th>Change</th></tr></thead>
        <tbody>
          {ledger.map((l) => (
            <tr key={l.id}>
              <td>{l.created_at.slice(0, 16).replace("T", " ")}</td>
              <td>{l.reason}{l.week ? ` (${l.week})` : ""}</td>
              <td className={l.delta < 0 ? "error" : "good"}>{l.delta > 0 ? "+" : ""}{fmt(l.delta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
