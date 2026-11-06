import { LabelTakenError, claimMerchantLabel, updateMerchantShop } from "@/lib/server/identity";
import { checkName } from "@/lib/server/names";
import { provisionMerchant } from "@/lib/server/provision";
import { currentUser, otherRole, publicMe } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/*
 * Onboarding step 2 of 3: a merchant who has proved who it is with Self claims
 * its name. If <label>.sangam.eth is free, Sangam gives it its own deposit
 * accounts and publishes the name on ENS, marked verified, with the UPI handle
 * payouts go to and the price of its pay link. Then it sets a password.
 *
 * POST { label, upiHandle, priceInr }
 */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me || me.session.role !== "merchant") return Response.json({ error: "Verify with Self as a merchant first." }, { status: 401 });
  if (me.identity.label && me.identity.shop?.provisionedAt) {
    return Response.json({ error: `You already own ${me.identity.label}.`, me: publicMe(me.identity, otherRole(me)) }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { label?: unknown; upiHandle?: unknown; priceInr?: unknown };
  const upiHandle = String(body.upiHandle ?? "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,64}@[a-z0-9]{2,32}$/.test(upiHandle)) {
    return Response.json({ error: "Enter the UPI handle payouts go to, e.g. myshop@okaxis." }, { status: 400 });
  }
  const priceInr = Number(body.priceInr);
  if (!Number.isFinite(priceInr) || priceInr < 1 || priceInr > 100_000) {
    return Response.json({ error: "Enter a price for your pay link between ₹1 and ₹1,00,000." }, { status: 400 });
  }

  // A merchant whose earlier setup failed retries with the name it already holds.
  let check;
  try {
    check = await checkName(me.identity.label || String(body.label ?? ""), me.identity.nullifier);
  } catch (err) {
    return Response.json({ error: `Could not check ENS right now: ${(err as Error).message.split("\n")[0]}` }, { status: 502 });
  }
  if (!check.available) return Response.json({ error: check.reason, check }, { status: 409 });

  try {
    await claimMerchantLabel(me.identity.nullifier, check.name);
  } catch (err) {
    if (err instanceof LabelTakenError) return Response.json({ error: err.message }, { status: 409 });
    throw err;
  }
  await updateMerchantShop(me.identity.nullifier, { upiHandle, priceInrPaise: Math.round(priceInr * 100), endpoint: null, provisionedAt: undefined });
  const identity = await provisionMerchant(me.identity.nullifier);
  const ok = !!identity.shop?.provisionedAt;
  return Response.json({ ok, error: ok ? undefined : identity.shop?.error, me: publicMe(identity, otherRole(me)) }, { status: ok ? 200 : 502 });
}
