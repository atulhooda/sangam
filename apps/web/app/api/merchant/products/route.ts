import { MAX_PRODUCTS, confirmPublish, parseProductCsv, productJob, startPublish, storeUrl, storefront } from "@/lib/server/products";
import { currentUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/*
 * The signed-in merchant's catalogue.
 *   GET   → the publishing job (if any) and the storefront as ENS has it now
 *   POST  { csv, dryRun? } → check every row; unless dryRun, publish them all
 *         on ENS (one name per product) in the background
 */

async function merchantOrNull() {
  const me = await currentUser();
  if (!me || me.session.role !== "merchant") return null;
  return me;
}

export async function GET() {
  const me = await merchantOrNull();
  if (!me) return Response.json({ error: "Sign in as a merchant first." }, { status: 401 });
  const merchant = me.identity.label;
  const store = me.identity.shop?.provisionedAt ? await storefront(merchant).catch((err: Error) => ({ error: err.message.split("\n")[0] })) : null;
  return Response.json({ merchant, storeUrl: storeUrl(merchant), job: productJob(merchant), store }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const me = await merchantOrNull();
  if (!me) return Response.json({ error: "Sign in as a merchant first." }, { status: 401 });
  if (!me.identity.shop?.provisionedAt) {
    return Response.json({ error: "Your ENS name isn't set up yet. Finish setup on your profile first." }, { status: 409 });
  }
  const body = (await req.json().catch(() => ({}))) as { csv?: unknown; dryRun?: unknown; confirm?: unknown };
  // Owned shops: the wallet signed the record transactions; check them and finish.
  if (Array.isArray(body.confirm)) {
    try {
      return Response.json({ job: await confirmPublish(me.identity.label, body.confirm.map(String)) });
    } catch (err) {
      return Response.json({ error: (err as Error).message.split("\n")[0] }, { status: 409 });
    }
  }
  const csv = typeof body.csv === "string" ? body.csv : "";
  if (csv.length > 200_000) return Response.json({ error: "That file is too big." }, { status: 413 });

  const rows = parseProductCsv(csv);
  const good = rows.filter((r) => r.input);
  const bad = rows.filter((r) => r.error);
  if (rows.length === 0) return Response.json({ rows, error: "No products found. One per line: name, price_inr, description, image_url." }, { status: 400 });
  if (good.length > MAX_PRODUCTS) return Response.json({ rows, error: `Up to ${MAX_PRODUCTS} products per upload.` }, { status: 400 });
  if (body.dryRun === true || bad.length > 0) {
    return Response.json({ rows, error: bad.length ? `Fix ${bad.length} line${bad.length === 1 ? "" : "s"} first.` : undefined }, { status: bad.length ? 400 : 200 });
  }
  try {
    const owned = me.identity.shop?.owned;
    const job = startPublish(me.identity.label, good.map((r) => r.input!), owned ? { owner: owned.owner, resolver: owned.resolver } : undefined);
    return Response.json({ rows, job }, { status: 202 });
  } catch (err) {
    return Response.json({ rows, error: (err as Error).message }, { status: 409 });
  }
}
