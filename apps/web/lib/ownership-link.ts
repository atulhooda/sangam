/** The message a merchant signs to take ownership of its ENS name with this wallet. Shared by the page and the server. */
export function ownershipMessage(ensName: string, address: string, issuedAt: string) {
  return `Make this wallet the owner of ${ensName}.\n\nOnly this wallet will be able to change its prices, UPI handle and payout addresses. Sangam keeps only the verified stamp.\n\nWallet: ${address}\nIssued: ${issuedAt}`;
}
