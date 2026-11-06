import { LabelTakenError } from "@/lib/server/identity";
import { checkDemoLogin, clearFailures, demoLoginsEnabled, ensureDemoMerchant, isLockedOut, noteFailure } from "@/lib/server/demo-logins";
import { createSession, homeFor } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Whether demo merchant sign-in is configured (DEMO_MERCHANT_LOGINS). */
export function GET() {
  return Response.json({ enabled: demoLoginsEnabled() });
}

/** DEMO ONLY: sign in as one of Sangam's demo merchants with a username and password. */
export async function POST(req: Request) {
  if (!demoLoginsEnabled()) return Response.json({ error: "Demo merchant sign-in is not enabled." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = String(body.username ?? "").slice(0, 64);
  const password = String(body.password ?? "").slice(0, 200);
  if (!username || !password) return Response.json({ error: "Enter the username and password." }, { status: 400 });
  if (isLockedOut(username)) return Response.json({ error: "Too many wrong attempts. Try again in 10 minutes." }, { status: 429 });

  const login = checkDemoLogin(username, password);
  if (!login) {
    noteFailure(username);
    return Response.json({ error: "Wrong username or password." }, { status: 401 });
  }
  clearFailures(username);

  try {
    const identity = await ensureDemoMerchant(login);
    await createSession(identity.nullifier, "merchant");
    return Response.json({ ok: true, redirect: homeFor(identity) });
  } catch (err) {
    if (err instanceof LabelTakenError) return Response.json({ error: `${login.ensName} already belongs to a merchant who signed in with Self.` }, { status: 409 });
    return Response.json({ error: `Could not set up the profile: ${(err as Error).message.split("\n")[0]}` }, { status: 502 });
  }
}
