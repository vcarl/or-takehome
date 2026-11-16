import { Form, redirect } from "react-router";
import type { Route } from "./+types/login";
import { getOrCreateUser } from "../markets.server.ts";
import { commitSession, getSession, getUser } from "../session.server.ts";

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUser(request)) throw redirect("/");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const username = String((await request.formData()).get("username") ?? "").trim();
  if (!/^[\w.-]{2,32}$/.test(username)) return { error: "Username: 2-32 letters, digits, _ . -" };
  const session = await getSession(request);
  session.set("userId", getOrCreateUser(username)); // new users get the +1000 initial karma
  session.set("username", username);
  return redirect("/", { headers: { "Set-Cookie": await commitSession(session) } });
}

export default function Login({ actionData }: Route.ComponentProps) {
  return (
    <>
      <h1>Log in</h1>
      <p className="muted">Username only. New names get an account with 1,000 karma.</p>
      <Form method="post" className="card">
        <label>Username <input name="username" required autoFocus autoComplete="username" /></label>
        {actionData?.error && <p className="error">{actionData.error}</p>}
        <button>Continue</button>
      </Form>
    </>
  );
}
