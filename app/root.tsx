import { Form, isRouteErrorResponse, Link, Links, Meta, NavLink, Outlet, Scripts, ScrollRestoration, useLoaderData, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/root";
import { getUser } from "./session.server.ts";
import { latestAsOf, modelNames } from "./rankings.server.ts";
import { fmt, type Names } from "./format.ts";
import "./styles.css";

export const loader = async ({ request }: Route.LoaderArgs) => ({ user: await getUser(request), asOf: latestAsOf(), names: modelNames() });

/** OpenRouter display names, loaded once by the root route. */
export const useNames = (): Names => useRouteLoaderData<typeof loader>("root")?.names ?? {};

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>OR Futures</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { user, asOf } = useLoaderData<typeof loader>();
  return (
    <>
      <header>
        <Link to="/" className="brand">OR Futures</Link>
        <nav>
          <NavLink to="/markets">Markets</NavLink>
          <NavLink to="/me">My bets</NavLink>
          <NavLink to="/leaderboard">Leaderboard</NavLink>
        </nav>
        {user ? (
          <span>
            <strong>{user.username}</strong> · {fmt(user.karma)} karma · {fmt(user.winnings)} winnings{" "}
            <Form method="post" action="/logout"><button className="link">Log out</button></Form>
          </span>
        ) : (
          <Link to="/login">Log in</Link>
        )}
      </header>
      <main><Outlet /></main>
      {asOf && <footer><div>Source: OpenRouter (openrouter.ai/rankings), as of {asOf}.</div></footer>}
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const msg = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : "Unknown error";
  return (
    <main>
      <h1>Something went wrong</h1>
      <p className="error">{msg}</p>
      <Link to="/markets">Back to markets</Link>
    </main>
  );
}
