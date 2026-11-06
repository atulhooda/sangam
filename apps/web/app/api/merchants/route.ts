import { resolveMerchant } from "@sangam/ens";
import { envOr, inrPerUsd, paiseToUsdcAtomic } from "@sangam/shared";
import { listProvisionedMerchantNames } from "@/lib/server/identity";
import { merchantEnsName } from "@/lib/server/merchant";

export const dynamic = "force-dynamic";

/*
 * The merchant directory buyers' agents shop from: Sangam's demo shop, any
 * extra names in DIRECTORY_EXTRA, and every merchant onboarded on this site.
 * Everything shown is read from ENS, the same records the agent checks
 * before it pays.
 */
export async function GET() {
  const extra = envOr("DIRECTORY_EXTRA", "sangam-demo.sangam.eth").split(",").map((s) => s.trim()).filter(Boolean);
  const names = Array.from(new Set([merchantEnsName(), ...extra, ...listProvisionedMerchantNames()].map((n) => n.toLowerCase())));
  const fx = await inrPerUsd();
  const treasury = process.env.TREASURY_ACCOUNT_ID ?? "";

  const rows = await Promise.all(
    names.map(async (ensName) => {
      try {
        const r = await resolveMerchant(ensName);
        return {
          ensName,
          url: r.endpoint,
          priceInrPaise: r.priceInrPaise,
          priceUsdcAtomic: paiseToUsdcAtomic(r.priceInrPaise, fx).toString(),
          payTo: r.hederaPayTo,
          upiHandle: r.upiHandle,
          status: r.status ?? null,
          verified: r.status === "verified",
          /** Paid into its own deposit account (not Sangam's shared treasury). */
          ownAccount: r.hederaPayTo !== treasury,
        };
      } catch (err) {
        return { ensName, error: (err as Error).message.split("\n")[0] };
      }
    }),
  );
  return Response.json(rows, { headers: { "cache-control": "no-store" } });
}
