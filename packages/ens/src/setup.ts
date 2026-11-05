import { encodeAbiParameters, encodeFunctionData, keccak256, labelhash, namehash, parseEventLogs, toHex, type Hex } from "viem";
import { normalize } from "viem/ens";
import { sepoliaClient } from "./client.ts";
import {
  ALL_ROLES,
  ENSV2_SEPOLIA,
  FACTORY_ABI,
  REGISTRY_ABI,
  RESOLVER_INIT_ABI,
  USER_REGISTRY_INIT_ABI,
} from "./contracts.ts";
import { parentName, sangamWallet } from "./wallet.ts";

/*
 * One-off: turn sangam.eth into Sangam's merchant registry on ENSv2.
 *
 *   1. deploy a PermissionedResolver (holds every merchant's records)
 *   2. deploy a UserRegistry for sangam.eth (each merchant = an ERC-1155 subname)
 *   3. on the ETHRegistry, point sangam.eth at both
 *
 * Both are UUPS proxies from the ENS VerifiableFactory, at deterministic
 * addresses, so anyone can verify they run the official ENS implementations.
 * Prerequisite: Sangam's key already owns sangam.eth on ENSv2 Sepolia.
 */

export type SetupResult = { registry: Hex; resolver: Hex; steps: { step: string; tx: Hex }[] };

export async function setupSangamRegistry(log: (msg: string) => void = () => undefined): Promise<SetupResult> {
  const wallet = sangamWallet();
  const client = sepoliaClient();
  const me = wallet.account.address;
  const parent = normalize(parentName());
  const [label, tld] = parent.split(".");
  if (!label || tld !== "eth" || parent.split(".").length !== 2) throw new Error(`ENS_PARENT_NAME must be a second-level .eth name, got ${parent}`);
  const parentId = BigInt(labelhash(label));
  const steps: SetupResult["steps"] = [];

  const expiry = await client.readContract({ address: ENSV2_SEPOLIA.ETHRegistry, abi: REGISTRY_ABI, functionName: "getExpiry", args: [parentId] });
  if (expiry * 1000n < BigInt(Date.now())) throw new Error(`${parent} isn't registered on ENSv2 Sepolia (or has expired). Register it at sepolia.app.ens.domains first.`);

  async function deploy(kind: "resolver" | "registry"): Promise<Hex> {
    const salt =
      kind === "resolver"
        ? BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint256" }], [keccak256(toHex("OwnedResolver")), me, 0n])))
        : BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }], [keccak256(toHex("UserRegistry")), namehash(parent), 0n])));
    const grants = [{ account: me, roleBitmap: ALL_ROLES }];
    const data =
      kind === "resolver"
        ? encodeFunctionData({ abi: RESOLVER_INIT_ABI, functionName: "initialize", args: [grants, []] })
        : encodeFunctionData({ abi: USER_REGISTRY_INIT_ABI, functionName: "initialize", args: [grants] });
    const impl = kind === "resolver" ? ENSV2_SEPOLIA.PermissionedResolverImpl : ENSV2_SEPOLIA.UserRegistryImpl;

    log(`deploying ${kind}…`);
    const tx = await wallet.writeContract({ address: ENSV2_SEPOLIA.VerifiableFactory, abi: FACTORY_ABI, functionName: "deployProxy", args: [impl, salt, data] });
    const receipt = await client.waitForTransactionReceipt({ hash: tx });
    const [event] = parseEventLogs({ abi: FACTORY_ABI, eventName: "ProxyDeployed", logs: receipt.logs });
    if (!event) throw new Error(`no ProxyDeployed event in ${tx}`);
    steps.push({ step: `deploy ${kind}`, tx });
    log(`  ${kind} ${event.args.proxyAddress}  (${tx})`);
    return event.args.proxyAddress;
  }

  const resolver = await deploy("resolver");
  const registry = await deploy("registry");

  const calls = [
    { step: `registry.setParent(ETHRegistry, "${label}")`, address: registry, functionName: "setParent" as const, args: [ENSV2_SEPOLIA.ETHRegistry, label] as const },
    { step: `ETHRegistry.setSubregistry(${parent})`, address: ENSV2_SEPOLIA.ETHRegistry, functionName: "setSubregistry" as const, args: [parentId, registry] as const },
    { step: `ETHRegistry.setResolver(${parent})`, address: ENSV2_SEPOLIA.ETHRegistry, functionName: "setResolver" as const, args: [parentId, resolver] as const },
  ];
  for (const c of calls) {
    log(`${c.step}…`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = await wallet.writeContract({ address: c.address, abi: REGISTRY_ABI, functionName: c.functionName, args: c.args as any });
    await client.waitForTransactionReceipt({ hash: tx });
    steps.push({ step: c.step, tx });
    log(`  done (${tx})`);
  }

  return { registry, resolver, steps };
}
