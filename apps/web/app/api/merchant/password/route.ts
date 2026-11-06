import { setMerchantPassword } from "@/lib/server/identity";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/server/passwords";
import { currentUser, homeFor, otherRole, publicMe } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/*
 * Onboarding step 3 of 3 (and later, changing it): the merchant sets a
 * password for name + password sign-in. Only after it has claimed its name.
 * Changing an existing password needs the current one.
 *
 * POST { password, current? }
 */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me || me.session.role !== "merchant") return Response.json({ error: "Sign in as a merchant first." }, { status: 401 });
  if (!me.identity.label || !me.identity.shop?.provisionedAt) return Response.json({ error: "Claim your shop name first." }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as { password?: unknown; current?: unknown };
  const password = String(body.password ?? "");
  const problem = passwordProblem(password);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  if (me.identity.password && !(await verifyPassword(String(body.current ?? ""), me.identity.password))) {
    return Response.json({ error: "Your current password is wrong." }, { status: 403 });
  }

  const identity = await setMerchantPassword(me.identity.nullifier, await hashPassword(password));
  return Response.json({ ok: true, redirect: homeFor(identity), me: publicMe(identity, otherRole(me)) });
}
