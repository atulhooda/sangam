import { checkDemoBuyer, clearFailures, ensureDemoBuyer, isLockedOut, noteFailure } from "@/lib/server/demo-logins";
import { createSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/*
 * Buyer sign-in with username + password, for Sangam's demo buyers
 * (DEMO_BUYER_LOGINS). Real buyers sign in with Self.
 *
 * POST { username, password }
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
  const username = String(body.username ?? "").trim().toLowerCase().slice(0, 80);
  const password = String(body.password ?? "").slice(0, 200);
  if (!username || !password) return Response.json({ error: "Enter your username and password." }, { status: 400 });
  const key = `buyer:${username}`;
  if (isLockedOut(key)) return Response.json({ error: "Too many wrong attempts. Try again in 10 minutes." }, { status: 429 });
  const login = checkDemoBuyer(username, password);
  if (!login) {
    noteFailure(key);
    return Response.json({ error: "Wrong username or password." }, { status: 401 });
  }
  clearFailures(key);
  const identity = await ensureDemoBuyer(login);
  await createSession(identity.nullifier, "user");
  return Response.json({ ok: true, redirect: "/buyer" });
}
