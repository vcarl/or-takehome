import { createCookieSessionStorage, redirect } from "react-router";
import { ensureWeeklyGrant, karmaBalance, winningsTotal } from "./markets.server.ts";
import { getDb } from "./db.server.ts";

const storage = createCookieSessionStorage({
  cookie: {
    name: "orf_session",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Dev default only; set SESSION_SECRET in any real deployment.
    secrets: [process.env.SESSION_SECRET ?? "dev-only-insecure-secret"],
  },
});

export const getSession = (request: Request) => storage.getSession(request.headers.get("Cookie"));
export const commitSession = storage.commitSession;
export const destroySession = storage.destroySession;

export interface User {
  id: number;
  username: string;
  karma: number;
  winnings: number;
}

/** Current user (or null). Claims the lazy weekly karma grant on every authenticated load. */
export async function getUser(request: Request): Promise<User | null> {
  const session = await getSession(request);
  const id = session.get("userId");
  if (typeof id !== "number") return null;
  const row = getDb().prepare("SELECT username FROM users WHERE id = ?").get(id);
  // The username check stops a stale cookie from adopting whoever now holds that id (e.g. after a DB recreate).
  if (!row || row.username !== session.get("username")) return null;
  ensureWeeklyGrant(id);
  return { id, username: String(row.username), karma: karmaBalance(id), winnings: winningsTotal(id) };
}

export async function requireUser(request: Request): Promise<User> {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  return user;
}
