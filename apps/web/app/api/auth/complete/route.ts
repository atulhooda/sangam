import { cookies } from "next/headers";
import { findIdentity } from "@/lib/server/identity";
import { LOGIN_COOKIE, findLoginBySecret, finishLogin } from "@/lib/server/logins";
import { cookieOptions, createSession, homeFor } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * The browser that started the sign-in polls here. Once Self's proof for its
 * QR has verified, it gets the session cookie and where to go next.
 */
export async function POST() {
  const jar = await cookies();
  const login = findLoginBySecret(jar.get(LOGIN_COOKIE)?.value);
  if (!login) return Response.json({ status: "expired", reason: "This sign-in expired. Start again." }, { status: 410 });
  if (login.error) {
    finishLogin(login);
    jar.set(LOGIN_COOKIE, "", cookieOptions(0));
    return Response.json({ status: "error", reason: login.error });
  }
  if (!login.nullifier) return Response.json({ status: "pending" });

  const identity = findIdentity(login.nullifier, login.role);
  if (!identity) return Response.json({ status: "error", reason: "Verified, but the identity was not saved. Try again." });

  finishLogin(login);
  jar.set(LOGIN_COOKIE, "", cookieOptions(0));
  await createSession(identity.nullifier, identity.role);
  return Response.json({ status: "signed-in", redirect: homeFor(identity) });
}
