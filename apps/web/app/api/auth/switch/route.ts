import { homeFor, switchRole } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * Switch the active role to another one this browser already proved with
 * Self (buyer ⇄ merchant), without scanning again. Roles never proven here
 * are refused: the person has to sign in with Self for that role first.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { role?: string };
  const role = body.role === "merchant" ? "merchant" : body.role === "user" ? "user" : null;
  if (!role) return Response.json({ error: "role must be merchant or user" }, { status: 400 });
  const me = await switchRole(role);
  if (!me) return Response.json({ error: `Sign in as a ${role === "merchant" ? "merchant" : "buyer"} with Self first.`, signIn: `/verify?role=${role}` }, { status: 403 });
  return Response.json({ ok: true, redirect: homeFor(me.identity) });
}
