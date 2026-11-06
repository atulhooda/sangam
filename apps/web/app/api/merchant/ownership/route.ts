import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import { ownershipMessage } from "@/lib/ownership-link";
import { ownershipJob, startOwnership } from "@/lib/server/ownership";
import { currentUser, otherRole, publicMe } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/*
 * The merchant takes ownership of its ENS name with its own wallet.
 *   GET   → the handover's progress (and the merchant's profile once done)
 *   POST  { address, issuedAt, signature } → start it, after checking the
 *         wallet signed the ownership message
 */

async function merchant() {
  const me = await currentUser();
  return me && me.session.role === "merchant" ? me : null;
}

export async function GET() {
  const me = await merchant();
  if (!me) return Response.json({ error: "Sign in as a merchant first." }, { status: 401 });
  return Response.json({ job: ownershipJob(me.identity.label), me: publicMe(me.identity, otherRole(me)) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const me = await merchant();
  if (!me) return Response.json({ error: "Sign in as a merchant first." }, { status: 401 });
  const shop = me.identity.shop;
  if (!shop?.provisionedAt) return Response.json({ error: "Your name isn't on ENS yet." }, { status: 409 });
  if (shop.owned) return Response.json({ error: `${me.identity.label} already belongs to ${shop.owned.owner}.` }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as { address?: string; issuedAt?: string; signature?: string };
  if (!body.address || !isAddress(body.address) || !body.signature || !body.issuedAt) {
    return Response.json({ error: "Send the wallet address, the time and the signature." }, { status: 400 });
  }
  const age = Date.now() - Date.parse(body.issuedAt);
  if (!(age >= -60_000 && age < 10 * 60_000)) return Response.json({ error: "That signature is too old. Try again." }, { status: 400 });
  const address = getAddress(body.address);
  const ok = await verifyMessage({ address, message: ownershipMessage(me.identity.label, address, body.issuedAt), signature: body.signature as Hex }).catch(() => false);
  if (!ok) return Response.json({ error: "The signature doesn't match that wallet." }, { status: 400 });

  try {
    return Response.json({ job: startOwnership(me.identity.nullifier, me.identity.label, address) }, { status: 202 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 409 });
  }
}
