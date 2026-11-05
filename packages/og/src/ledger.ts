import { ethers } from "ethers";
import { getBroker } from "./broker.ts";

/** Available 0G ledger balance in OG (what pays for inference). */
export async function ogBalance(): Promise<string> {
  const ledger = await (await getBroker()).ledger.getLedger();
  return ethers.formatEther(ledger.availableBalance);
}
