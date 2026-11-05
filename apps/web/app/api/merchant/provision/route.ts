import { provisionMerchant } from "@/lib/server/provision";
import { currentUser, otherRole, publicMe } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Retry the Hedera deposit account + ENS setup for the signed-in merchant. */
export async function POST() {
  const me = await currentUser();
  if (!me || me.session.role !== "merchant") return Response.json({ error: "Sign in as a merchant first." }, { status: 401 });
  try {
    const identity = await provisionMerchant(me.identity.nullifier);
    return Response.json({ ok: !!identity.shop?.provisionedAt, me: publicMe(identity, otherRole(me)) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 409 });
  }
}
