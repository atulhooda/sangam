import { randomBytes } from "node:crypto";
import { erc20Abi, parseSignature, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { authorizationTypes, eip3009ABI } from "@x402/evm";
import { USDT_EIP712, WHITECHAIN_CHAIN_ID, relayerWallet, usdtAddress, whitechainClient } from "./chain.ts";

/** USDT balance of an address in atomic units (6 decimals). */
export async function usdtBalance(address: Hex): Promise<bigint> {
  return whitechainClient().readContract({ address: usdtAddress(), abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

/** WBT (gas) balance of an address, in wei. */
export const wbtBalance = (address: Hex) => whitechainClient().getBalance({ address });

/** Plain USDT transfer from the relayer (e.g. the buyer faucet). Returns the tx hash once mined. */
export async function sendUsdtFromRelayer(to: Hex, atomic: bigint): Promise<Hex> {
  const wallet = relayerWallet();
  const hash = await wallet.writeContract({ address: usdtAddress(), abi: erc20Abi, functionName: "transfer", args: [to, atomic] });
  const receipt = await wallet.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`USDT transfer ${hash} reverted`);
  return hash;
}

/**
 * Move USDT out of an address Sangam holds the key for (a merchant deposit
 * address) without that address ever holding gas: its key signs an EIP-3009
 * transferWithAuthorization and the relayer submits it. Used for refunds.
 */
export async function gaslessTransfer(fromKey: Hex, to: Hex, atomic: bigint, validForSeconds = 600): Promise<Hex> {
  const from = privateKeyToAccount(fromKey);
  const now = Math.floor(Date.now() / 1000);
  const message = {
    from: from.address,
    to,
    value: atomic,
    validAfter: BigInt(now - 60),
    validBefore: BigInt(now + validForSeconds),
    nonce: toHex(randomBytes(32)),
  };
  const signature = await from.signTypedData({
    domain: { ...USDT_EIP712, chainId: WHITECHAIN_CHAIN_ID, verifyingContract: usdtAddress() },
    types: authorizationTypes,
    primaryType: "TransferWithAuthorization",
    message,
  });
  const { r, s, v, yParity } = parseSignature(signature);
  const wallet = relayerWallet();
  const hash = await wallet.writeContract({
    address: usdtAddress(),
    abi: eip3009ABI,
    functionName: "transferWithAuthorization",
    args: [message.from, message.to, message.value, message.validAfter, message.validBefore, message.nonce, Number(v ?? BigInt(yParity + 27)), r, s],
  });
  const receipt = await wallet.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transferWithAuthorization ${hash} reverted`);
  return hash;
}
