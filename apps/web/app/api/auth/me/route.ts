import { currentUser, otherRole, publicMe, renewSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * The signed-in person (no nullifier, no date of birth), or { signedIn: false }.
 * Also slides the session cookie forward, so active users stay signed in.
 */
export async function GET() {
  const me = await currentUser();
  if (me) await renewSession();
  return Response.json(me ? { signedIn: true, me: publicMe(me.identity, otherRole(me)) } : { signedIn: false }, {
    headers: { "cache-control": "no-store" },
  });
}
