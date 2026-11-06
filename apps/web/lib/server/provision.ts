import "server-only";
import { issueSubname, parentName, resolveMerchant } from "@sangam/ens";
import { createDepositAccount } from "@sangam/hedera";
import { findIdentity, updateMerchantShop, type VerifiedIdentity } from "./identity";
import { merchantEnsName, sangamApiUrl } from "./merchant";
import { depositAddress, evmWalletEnabled } from "./evm-keys";

/*
 * Merchant onboarding, the part Sangam does for the merchant once it has
 * proved who it is with Self and claimed its name:
 *
 *   1. a Hedera deposit account of its own (created once, reused on retries)
 *   2. <label>.sangam.eth on ENSv2 Sepolia, with sangam.payTo = that account,
 *      sangam.upi, sangam.priceInrPaise, url and sangam.status = verified,
 *
 * After this, any agent can find the merchant by name, check it's verified,
 * and pay it; USDC landing in the account becomes rupees on its UPI.
 */

const g = globalThis as unknown as { __sangamProvisioning?: Set<string> };
const running = (g.__sangamProvisioning ??= new Set());

/** Where agents buy from this merchant: its own API, the demo ticket shop, or Sangam's pay link. */
async function publishedUrl(identity: VerifiedIdentity): Promise<string> {
  if (identity.shop?.endpoint) return identity.shop.endpoint;
  const base = sangamApiUrl().replace(/\/+$/, "");
  if (identity.label === merchantEnsName()) return `${base}/merchant/book`;
  try {
    // An existing name keeps its url, rebased if it still points at a dev machine.
    const existing = new URL((await resolveMerchant(identity.label)).endpoint);
    if (!["localhost", "127.0.0.1"].includes(existing.hostname)) return existing.toString();
    return `${base}${existing.pathname}${existing.search}`;
  } catch {
    return `${base}/merchant/pay/${encodeURIComponent(identity.label)}`;
  }
}

export async function provisionMerchant(nullifier: string): Promise<VerifiedIdentity> {
  if (running.has(nullifier)) throw new Error("Setup is already running for this merchant; wait a moment.");
  running.add(nullifier);
  try {
    let identity = findIdentity(nullifier, "merchant");
    if (!identity?.label) throw new Error("Claim your shop name first.");
    if (!identity.shop?.upiHandle) throw new Error("Add the UPI handle your payouts go to first.");
    const suffix = `.${parentName()}`;
    if (!identity.label.endsWith(suffix)) throw new Error(`${identity.label} is not under ${parentName()}`);
    const label = identity.label.slice(0, -suffix.length);

    try {
      let depositAccountId = identity.shop.depositAccountId;
      if (!depositAccountId) {
        depositAccountId = (await createDepositAccount(`Sangam deposit ${identity.label}`)).accountId;
        // Saved straight away, so a failure further on never creates a second account.
        identity = await updateMerchantShop(nullifier, { depositAccountId });
      }
      const url = await publishedUrl(identity);
      const issued = await issueSubname(label, {
        endpoint: url,
        hederaPayTo: depositAccountId,
        network: "hedera:testnet",
        priceInrPaise: identity.shop!.priceInrPaise,
        upiHandle: identity.shop!.upiHandle,
        status: "verified",
        // The name's standard address record: where any wallet sends when it pays this name.
        ...(evmWalletEnabled() ? { evmPayTo: depositAddress(identity.label) } : {}),
      });
      return await updateMerchantShop(nullifier, {
        publishedUrl: url,
        ensTxs: issued.txs.map((t) => ({ step: t.step, tx: t.tx })),
        provisionedAt: new Date().toISOString(),
        error: undefined,
      });
    } catch (err) {
      const message = (err as Error).message.split("\n")[0]!.slice(0, 300);
      console.error(`[provision] ${identity.label}: ${message}`);
      return await updateMerchantShop(nullifier, { error: message, provisionedAt: undefined });
    }
  } finally {
    running.delete(nullifier);
  }
}
