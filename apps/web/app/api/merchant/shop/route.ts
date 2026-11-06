import { encodeFunctionData } from "viem";
import { RESOLVER_ABI, forgetMerchant, issueSubname, merchantRecordCalls, parentName, resolveMerchant, sepoliaClient } from "@sangam/ens";
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

  const body = (await req.json().catch(() => ({}))) as { priceInr?: unknown; upiHandle?: unknown; txHash?: unknown };

  // A merchant that owns its name signs its own changes. Step 2: the wallet sent
  // the transaction; check it on chain and refresh the profile from ENS.
  if (shop.owned && typeof body.txHash === "string") {
    try {
      const receipt = await sepoliaClient().waitForTransactionReceipt({ hash: body.txHash as `0x${string}`, timeout: 60_000 });
      if (receipt.status !== "success" || receipt.to?.toLowerCase() !== shop.owned.resolver.toLowerCase()) throw new Error("that transaction didn't update your records");
      // Public RPCs lag a block or two: wait until ENS shows what was just written.
      const wantPrice = Math.round(Number(body.priceInr) * 100);
      const wantUpi = String(body.upiHandle ?? "").trim().toLowerCase();
      let rec = null;
      for (let i = 0; i < 12; i++) {
        forgetMerchant(me.identity.label);
        rec = await resolveMerchant(me.identity.label).catch(() => null);
        if (rec && rec.priceInrPaise === wantPrice && rec.upiHandle === wantUpi) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (!rec) throw new Error("couldn't read your updated records yet; refresh in a moment");
      const identity = await updateMerchantShop(me.identity.nullifier, { priceInrPaise: rec.priceInrPaise, upiHandle: rec.upiHandle });
      return Response.json({ ok: true, txs: [{ step: "update (your wallet)", tx: body.txHash }], me: publicMe(identity, otherRole(me)) });
    } catch (err) {
      return Response.json({ error: (err as Error).message.split("\n")[0] }, { status: 502 });
    }
  }
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
  // Step 1 for an owned name: Sangam can't write it, so it hands back the
  // transaction for the merchant's wallet to sign.
  if (shop.owned) {
    const data = encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: "multicall",
      args: [
        merchantRecordCalls([
          { name, key: "sangam.priceInrPaise", value: String(priceInrPaise) },
          { name, key: "sangam.upi", value: upiHandle },
        ]),
      ],
    });
    return Response.json({ sign: { from: shop.owned.owner, to: shop.owned.resolver, data } });
  }
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
