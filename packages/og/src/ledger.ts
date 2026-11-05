import { ethers } from "ethers";
import { getBroker } from "./broker.ts";

/** Available 0G ledger balance in OG (what pays for inference). */
export async function ogBalance(): Promise<string> {
  const ledger = await (await getBroker()).ledger.getLedger();
  return ethers.formatEther(ledger.availableBalance);
}

/**
 * One-off: create the 0G ledger, acknowledge the provider and move funds to it.
 * Safe to re-run: each step is skipped if already done.
 *
 * The SDK refuses to create a ledger below 3 OG, but the ledger contract
 * itself accepts much less (0.1 OG simulated fine), so the ledger is created
 * by calling the contract's addLedger directly with `depositOg`.
 *
 * Note (tested 1 Nov 2026): providers refuse requests unless at least 1 OG is
 * locked in the provider sub-account, so in practice providerOg must be ≥ 1.
 */
export async function fundProvider(provider: string, depositOg: string, providerOg: string, log: (m: string) => void = () => undefined) {
  const broker = await getBroker();

  let exists = true;
  try {
    const l = await broker.ledger.getLedger();
    log(`ledger exists: ${ethers.formatEther(l.availableBalance)} OG available`);
  } catch {
    exists = false;
  }
  if (!exists) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contract = (broker.ledger as any).ledger.ledgerContract.ledger as { addLedger: (info: string, o: { value: bigint }) => Promise<ethers.ContractTransactionResponse> };
    log(`creating ledger with ${depositOg} OG (direct contract call)…`);
    const tx = await contract.addLedger("", { value: ethers.parseEther(depositOg) });
    await tx.wait();
    log(`  ledger created (${tx.hash})`);
  }

  const status = await broker.inference.checkProviderSignerStatus(provider);
  if (!status.isAcknowledged) {
    log("acknowledging provider…");
    await broker.inference.acknowledgeProviderSigner(provider);
    log("  acknowledged");
  }

  log(`transferring ${providerOg} OG from the ledger to the provider…`);
  await broker.ledger.transferFund(provider, "inference", ethers.parseEther(providerOg));
  log(`  done. ledger now ${await ogBalance()} OG available`);
}
