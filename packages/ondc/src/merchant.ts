/** The ENS subname Sangam issues an ONDC seller: ondc-<provider>.sangam.eth. */
export function ondcLabel(providerId: string): string {
  const slug = providerId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `ondc-${slug}`.slice(0, 63).replace(/-+$/, "");
}
