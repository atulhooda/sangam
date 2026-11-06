import { forgetMerchant, issueSubname, parentName } from "@sangam/ens";
import { updateMerchantShop } from "@/lib/server/identity";
import { currentUser, otherRole, publicMe } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/*
 * A verified merchant edits its own price and UPI handle from its profile.
 * Both live in the merchant's ENS record, which buyer agents check every
 * invoice against, so saving rewrites the record on chain (one transaction)
 * and clears Sangam's ENS cache: agents see the new price straight away.
 */

const g = globalThis as unknown as { __sangamShopEdits?: Set<string> };
const running = (g.__sangamShopEdits ??= new Set());

export async function PATCH(req: Request) {
  const me = await currentUser();
  if (!me || me.session.role !== "merchant") return Response.json({ error: "Sign in as a merchant first." }, { status: 401 });
  const shop = me.identity.shop;
  if (!shop?.provisionedAt || !shop.depositAccountId) {
    return Response.json({ error: "Your ENS name isn't set up yet. Finish setup on your profile first." }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { priceInr?: unknown; upiHandle?: unknown };
  const priceInr = body.priceInr === undefined ? shop.priceInrPaise / 100 : Number(body.priceInr);
  if (!Number.isFinite(priceInr) || priceInr < 1 || priceInr > 100_000) {
    return Response.json({ error: "Enter a price per order between ₹1 and ₹1,00,000." }, { status: 400 });
  }
  const upiHandle = body.upiHandle === undefined ? shop.upiHandle : String(body.upiHandle).trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,64}@[a-z0-9]{2,32}$/.test(upiHandle)) {
    return Response.json({ error: "Enter the UPI handle payouts go to, e.g. myshop@okaxis." }, { status: 400 });
  }
  const priceInrPaise = Math.round(priceInr * 100);
  if (priceInrPaise === shop.priceInrPaise && upiHandle === shop.upiHandle) {
    return Response.json({ ok: true, unchanged: true, me: publicMe(me.identity, otherRole(me)) });
  }

  const endpoint = shop.publishedUrl ?? shop.endpoint;
  if (!endpoint) return Response.json({ error: "Your shop has no published URL yet. Finish setup on your profile first." }, { status: 409 });
  const name = me.identity.label;
  const suffix = `.${parentName()}`;
  if (!name.endsWith(suffix)) return Response.json({ error: `${name} is not under ${parentName()}.` }, { status: 409 });
  if (running.has(name)) return Response.json({ error: "A change is already being saved. Wait a moment." }, { status: 409 });
  running.add(name);
  try {
    // Rewrites the whole record in one transaction; everything but price and UPI stays as it is.
    const issued = await issueSubname(name.slice(0, -suffix.length), {
      endpoint,
      hederaPayTo: shop.depositAccountId,
      network: "hedera:testnet",
      priceInrPaise,
      upiHandle,
      status: "verified",
    });
    forgetMerchant(name);
    const identity = await updateMerchantShop(me.identity.nullifier, {
      priceInrPaise,
      upiHandle,
      ensTxs: [...(shop.ensTxs ?? []), ...issued.txs.map((t) => ({ step: `update ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, tx: t.tx }))].slice(-6),
    });
    return Response.json({ ok: true, txs: issued.txs, offline: issued.offline, me: publicMe(identity, otherRole(me)) });
  } catch (err) {
    return Response.json({ error: `Could not update ENS: ${(err as Error).message.split("\n")[0]}` }, { status: 502 });
  } finally {
    running.delete(name);
  }
}
