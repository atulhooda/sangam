/** The message a buyer signs in MetaMask to link that wallet to their agent. Shared by the page and the server. */
export function linkMessage(agent: string, address: string, issuedAt: string) {
  return `Link this wallet to my Sangam shopping agent.\n\nWallet: ${address}\nAgent: ${agent}\nIssued: ${issuedAt}`;
}
export const SEPOLIA_CHAIN_HEX = "0xaa36a7";
export const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
