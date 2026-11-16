import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { destroySession, getSession } from "../session.server.ts";

export const loader = () => redirect("/");

export async function action({ request }: Route.ActionArgs) {
  return redirect("/", { headers: { "Set-Cookie": await destroySession(await getSession(request)) } });
}
