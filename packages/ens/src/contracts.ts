import { parseAbi } from "viem";

/**
 * ENSv2 on Sepolia (docs.ens.domains/learn/deployments). The Sepolia ENS app
 * and Universal Resolver resolve through these contracts.
 */
export const ENSV2_SEPOLIA = {
  ETHRegistry: "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4",
  VerifiableFactory: "0xda70306c98e97ece36f997a21368e53298572991",
  UserRegistryImpl: "0x9bd8a88719068d09ecee662f36c0e3856708366a",
  PermissionedResolverImpl: "0x115eb53f0c60696633855f90b138178fb40b2b2c",
} as const;

/** Registry roles (contracts-v2 RegistryRolesLib). Admin role = role << 128. */
export const REGISTRY_ROLES = {
  ROLE_REGISTRAR: 1n << 0n,
  ROLE_RENEW: 1n << 16n,
  ROLE_SET_SUBREGISTRY: 1n << 20n,
  ROLE_SET_RESOLVER: 1n << 24n,
  ROLE_CAN_TRANSFER_ADMIN: (1n << 28n) << 128n,
} as const;

/** Every role plus its admin role, for the deployer of a new registry/resolver. */
export const ALL_ROLES = 0x1111111111111111111111111111111111111111111111111111111111111111n;

export const FACTORY_ABI = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);

export const USER_REGISTRY_INIT_ABI = parseAbi(["function initialize((address account, uint256 roleBitmap)[] grants)"]);
export const RESOLVER_INIT_ABI = parseAbi(["function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)"]);

/** IStandardRegistry + IRegistry (contracts-v2). Shared by ETHRegistry and UserRegistry. */
export const REGISTRY_ABI = parseAbi([
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256 tokenId)",
  "function renew(uint256 anyId, uint64 newExpiry)",
  "function setSubregistry(uint256 anyId, address registry)",
  "function setResolver(uint256 anyId, address resolver)",
  "function setParent(address parent, string label)",
  "function getExpiry(uint256 anyId) view returns (uint64)",
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
  "error LabelAlreadyRegistered(string label)",
]);

/** PermissionedResolver setters take the DNS-encoded name, not a namehash. */
export const RESOLVER_ABI = parseAbi([
  "function setText(bytes name, string key, string value)",
  "function multicall(bytes[] calls) returns (bytes[])",
]);
