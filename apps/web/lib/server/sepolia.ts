import "server-only";
import { randomBytes } from "node:crypto";
import { erc20Abi, formatEther, isAddressEqual, parseAbi, parseEther, parseEventLogs, parseSignature, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient } from "viem";
import { sepolia } from "viem/chains";
import { sangamWallet, sepoliaClient, sepoliaTransport } from "@sangam/ens";
import { envOr } from "@sangam/shared";

/*
 * The wallet rail: Sepolia USDC paid from the buyer's own MetaMask.
 *
 * The buyer connects MetaMask once and approves a spending limit for its
 * agent (a USDC allowance, enforced by the token contract, revocable from the
 * wallet). From then on the agent pays a merchant by ENS name with no prompt:
 * it resolves the name's standard address record (the merchant's deposit
 * address, the same one MetaMask itself resolves) and moves USDC from the
 * buyer's wallet with transferFrom. Sangam sees it land, checks it on chain,
 * pays rupees on UPI and writes the receipt to Hedera.
 *
 * Sepolia is where ENS lives, so wallets resolve merchant names natively here.
 */

export const SEPOLIA_CHAIN_ID = 11155111;
export const sepoliaUsdc = () => envOr("SEPOLIA_USDC", "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238") as Hex;
/** Circle USDC's EIP-712 domain (checked against its DOMAIN_SEPARATOR). */
export const SEPOLIA_USDC_EIP712 = { name: "USDC", version: "2" } as const;
export const sepoliaTxUrl = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;
export const sepoliaAddressUrl = (address: string) => `https://sepolia.etherscan.io/address/${address}`;

/** The agent's gas comes from Sangam's Sepolia key, topped up when it runs low (Sepolia gas is near zero). */
const MIN_AGENT_GAS = parseEther("0.0002");
const AGENT_TOP_UP = parseEther("0.001");

const walletFor = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain: sepolia, transport: sepoliaTransport() });

export async function usdcBalance(address: Hex): Promise<bigint> {
  return sepoliaClient().readContract({ address: sepoliaUsdc(), abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

export async function usdcAllowance(owner: Hex, spender: Hex): Promise<bigint> {
  return sepoliaClient().readContract({ address: sepoliaUsdc(), abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
}

/** Make sure the agent can pay its own (tiny) gas. */
async function ensureAgentGas(agent: Hex): Promise<Hex | null> {
  const client = sepoliaClient();
  if ((await client.getBalance({ address: agent })) >= MIN_AGENT_GAS) return null;
  const hash = await sangamWallet().sendTransaction({ to: agent, value: AGENT_TOP_UP });
  await client.waitForTransactionReceipt({ hash });
  return hash;
}

export class WalletPayError extends Error {}

/**
 * The agent pays `to` from the buyer's wallet, within the allowance the buyer
 * granted it. Checks balance and allowance first so a shortfall is a clear
 * message, not a reverted transaction.
 */
export async function agentPayFromWallet(opts: { agentKey: Hex; owner: Hex; to: Hex; amount: bigint }): Promise<{ hash: Hex; agent: Hex }> {
  const agent = privateKeyToAccount(opts.agentKey).address;
  const [balance, allowance] = await Promise.all([usdcBalance(opts.owner), usdcAllowance(opts.owner, agent)]);
  if (balance < opts.amount) throw new WalletPayError(`Your wallet has ${Number(balance) / 1e6} USDC; this costs ${Number(opts.amount) / 1e6}. Get test USDC at faucet.circle.com (Ethereum Sepolia).`);
  if (allowance < opts.amount) throw new WalletPayError(`Your agent may spend ${Number(allowance) / 1e6} more USDC from your wallet; this costs ${Number(opts.amount) / 1e6}. Raise the limit in MetaMask.`);
  await ensureAgentGas(agent);
  const wallet = walletFor(opts.agentKey);
  const hash = await wallet.writeContract({ address: sepoliaUsdc(), abi: erc20Abi, functionName: "transferFrom", args: [opts.owner, opts.to, opts.amount] });
  const receipt = await sepoliaClient().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new WalletPayError(`the payment ${hash} reverted`);
  return { hash, agent };
}

/** On-chain check: did `txHash` move at least `claimed` USDC into `payTo`? */
export async function confirmPayment(txHash: string, payTo: string, claimed: bigint): Promise<{ credited: bigint; payer: string | null }> {
  const receipt = await sepoliaClient().waitForTransactionReceipt({ hash: txHash as Hex, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error(`transaction ${txHash} reverted`);
  const usdc = sepoliaUsdc();
  const toMerchant = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).filter(
    (l) => isAddressEqual(l.address, usdc) && isAddressEqual(l.args.to, payTo as Hex),
  );
  const credited = toMerchant.reduce((s, t) => s + t.args.value, 0n);
  if (credited < claimed) throw new Error(`deposit address credited ${credited} USDC units, notice claimed ${claimed}`);
  return { credited, payer: toMerchant[0]?.args.from ?? null };
}

const EIP3009_ABI = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
]);
const AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** Refund from a merchant deposit address without it holding gas: its key signs, Sangam's key submits. */
export async function gaslessRefund(fromKey: Hex, to: Hex, amount: bigint): Promise<Hex> {
  const from = privateKeyToAccount(fromKey);
  const now = Math.floor(Date.now() / 1000);
  const message = { from: from.address, to, value: amount, validAfter: BigInt(now - 60), validBefore: BigInt(now + 600), nonce: toHex(randomBytes(32)) };
  const sig = await from.signTypedData({
    domain: { ...SEPOLIA_USDC_EIP712, chainId: SEPOLIA_CHAIN_ID, verifyingContract: sepoliaUsdc() },
    types: AUTH_TYPES,
    primaryType: "TransferWithAuthorization",
    message,
  });
  const { r, s, v, yParity } = parseSignature(sig);
  const hash = await sangamWallet().writeContract({
    address: sepoliaUsdc(),
    abi: EIP3009_ABI,
    functionName: "transferWithAuthorization",
    args: [message.from, message.to, message.value, message.validAfter, message.validBefore, message.nonce, Number(v ?? BigInt(yParity + 27)), r, s],
  });
  const receipt = await sepoliaClient().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`refund ${hash} reverted`);
  return hash;
}

/** USDC Transfer logs into any of `addresses` between two blocks (the deposit watcher). */
export async function transfersTo(addresses: Hex[], fromBlock: bigint, toBlock: bigint) {
  const logs = await sepoliaClient().getLogs({
    address: sepoliaUsdc(),
    event: erc20Abi.find((x) => x.type === "event" && x.name === "Transfer")! as Extract<(typeof erc20Abi)[number], { type: "event"; name: "Transfer" }>,
    args: { to: addresses },
    fromBlock,
    toBlock,
  });
  return parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs });
}

export const sepoliaBlockNumber = () => sepoliaClient().getBlockNumber();
export const ethBalance = async (address: Hex) => formatEther(await sepoliaClient().getBalance({ address }));
