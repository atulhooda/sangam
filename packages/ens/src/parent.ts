import { formatUnits, labelhash, toHex, type Hex } from "viem";
import { normalize } from "viem/ens";
import { sepoliaClient } from "./client.ts";
import { ENSV2_SEPOLIA, ERC20_ABI, REGISTRAR_ABI, REGISTRY_ABI } from "./contracts.ts";
import { parentName, sangamWallet } from "./wallet.ts";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const ZERO32 = `0x${"0".repeat(64)}` as Hex;
const YEAR = 31_536_000n;

/**
 * One-off: register the parent name (sangam.eth) on ENSv2 Sepolia for
 * Sangam's wallet. ENSv2 prices names in USD and takes USDC/DAI, not ETH; on
 * Sepolia that's MockUSDC, which anyone can mint, so this mints just enough.
 * Commit-reveal: commit, wait MIN_COMMITMENT_AGE, register.
 */
export async function registerParent(years = 1, log: (m: string) => void = () => undefined): Promise<{ expiry: Date; txs: { step: string; tx: Hex }[] }> {
  const wallet = sangamWallet();
  const client = sepoliaClient();
  const me = wallet.account.address;
  const name = normalize(parentName());
  const label = name.split(".")[0]!;
  const duration = YEAR * BigInt(years);
  const txs: { step: string; tx: Hex }[] = [];
  const send = async (step: string, tx: Hex) => {
    await client.waitForTransactionReceipt({ hash: tx });
    txs.push({ step, tx });
    log(`  ${step} ✓ (${tx})`);
  };

  const existing = await client.readContract({ address: ENSV2_SEPOLIA.ETHRegistry, abi: REGISTRY_ABI, functionName: "getExpiry", args: [BigInt(labelhash(label))] });
  if (existing * 1000n > BigInt(Date.now())) throw new Error(`${name} is already registered (expires ${new Date(Number(existing) * 1000).toISOString()})`);

  const [base, premium] = await client.readContract({ address: ENSV2_SEPOLIA.ETHRegistrar, abi: REGISTRAR_ABI, functionName: "getRegisterPrice", args: [label, duration, ENSV2_SEPOLIA.MockUSDC] });
  const price = base + premium;
  log(`${name} for ${years}y costs ${formatUnits(price, 6)} (mock) USDC`);

  // 1. Mint mock USDC if short, and approve the registrar.
  const balance = await client.readContract({ address: ENSV2_SEPOLIA.MockUSDC, abi: ERC20_ABI, functionName: "balanceOf", args: [me] });
  if (balance < price) {
    log("minting mock USDC…");
    await send("mint", await wallet.writeContract({ address: ENSV2_SEPOLIA.MockUSDC, abi: ERC20_ABI, functionName: "mint", args: [me, price * 2n - balance] }));
  }
  const allowance = await client.readContract({ address: ENSV2_SEPOLIA.MockUSDC, abi: ERC20_ABI, functionName: "allowance", args: [me, ENSV2_SEPOLIA.ETHRegistrar] });
  if (allowance < price) {
    log("approving the registrar…");
    await send("approve", await wallet.writeContract({ address: ENSV2_SEPOLIA.MockUSDC, abi: ERC20_ABI, functionName: "approve", args: [ENSV2_SEPOLIA.ETHRegistrar, price * 2n] }));
  }

  // 2. Commit. Resolver and subregistry stay empty; setup-ens sets both.
  const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const commitment = await client.readContract({
    address: ENSV2_SEPOLIA.ETHRegistrar,
    abi: REGISTRAR_ABI,
    functionName: "makeCommitment",
    args: [label, me, secret, ZERO, ZERO, duration, ZERO32],
  });
  log("committing…");
  await send("commit", await wallet.writeContract({ address: ENSV2_SEPOLIA.ETHRegistrar, abi: REGISTRAR_ABI, functionName: "commit", args: [commitment] }));

  // 3. Wait out the commitment age (plus a margin for block time), then register.
  const minAge = await client.readContract({ address: ENSV2_SEPOLIA.ETHRegistrar, abi: REGISTRAR_ABI, functionName: "MIN_COMMITMENT_AGE" });
  const waitS = Number(minAge) + 15;
  log(`waiting ${waitS}s (commit-reveal)…`);
  await new Promise((r) => setTimeout(r, waitS * 1000));

  log("registering…");
  await send(
    "register",
    await wallet.writeContract({
      address: ENSV2_SEPOLIA.ETHRegistrar,
      abi: REGISTRAR_ABI,
      functionName: "register",
      args: [label, me, secret, ZERO, ZERO, duration, ENSV2_SEPOLIA.MockUSDC, ZERO32],
    }),
  );

  const expiry = await client.readContract({ address: ENSV2_SEPOLIA.ETHRegistry, abi: REGISTRY_ABI, functionName: "getExpiry", args: [BigInt(labelhash(label))] });
  return { expiry: new Date(Number(expiry) * 1000), txs };
}
