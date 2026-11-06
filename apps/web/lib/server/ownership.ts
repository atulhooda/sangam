import "server-only";
import type { Hex } from "viem";
import { transferToMerchant } from "@sangam/ens";
import { updateMerchantShop } from "./identity";

/*
 * Handing a merchant its ENS name (packages/ens ownership.ts) takes about six
 * Sepolia transactions, so it runs in the background and the desk polls it.
 */

export type OwnershipJob = { state: "running" | "done" | "failed"; log: string[]; error: string | null; startedAt: string };

const g = globalThis as unknown as { __sangamOwnershipJobs?: Map<string, OwnershipJob> };
const jobs = (g.__sangamOwnershipJobs ??= new Map());

export const ownershipJob = (merchant: string) => jobs.get(merchant) ?? null;

export function startOwnership(nullifier: string, merchant: string, owner: Hex): OwnershipJob {
  if (jobs.get(merchant)?.state === "running") throw new Error("Ownership is already being handed over; wait a moment.");
  const job: OwnershipJob = { state: "running", log: [], error: null, startedAt: new Date().toISOString() };
  jobs.set(merchant, job);
  void transferToMerchant(merchant, owner, (m) => job.log.push(m.trim()))
    .then(async (o) => {
      await updateMerchantShop(nullifier, {
        owned: { owner: o.owner, resolver: o.resolver, tokenId: o.tokenId, at: new Date().toISOString(), txs: o.steps.map((s) => ({ step: s.step, tx: s.tx })) },
      });
      job.state = "done";
    })
    .catch((err: Error) => {
      job.state = "failed";
      job.error = err.message.split("\n")[0]!.slice(0, 300);
      console.error(`[ownership] ${merchant}: ${err.message}`);
    });
  return job;
}
