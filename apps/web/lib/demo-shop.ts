/* Shared by the demo shops' pages and backends (no server-only imports). */

/** The Hedera account the "hacker" would like the money sent to. */
export const HACKER_ACCOUNT = "0.0.6666666";
/** The attacker's address on Whitechain, for the hacked invoice's USDT line. */
export const HACKER_EVM_ADDRESS = "0x000000000000000000000000000000000000dEaD";

/** How much the hacked backend multiplies the real price by. */
export const OVERCHARGE_FACTOR = 10n;

export type Attack = "overcharge" | "redirect" | "both";

export const ATTACKS: { id: Attack; label: string; detail: string }[] = [
  { id: "overcharge", label: "Overcharge", detail: "Bills 10× the price, to the real merchant account" },
  { id: "redirect", label: "Redirect payout", detail: "Bills the right price, to the hacker's account" },
  { id: "both", label: "Both", detail: "10× the price, to the hacker's account" },
];

export const parseAttack = (v: string | null | undefined): Attack => (v === "redirect" || v === "both" ? v : "overcharge");

export type Variant = "honest" | "hacked";

export type ShopId = "rail" | "bakery";

/** The two demo shops: a railway ticket site (honest) and a bakery whose backend was hacked. */
export type ShopDef = {
  id: ShopId;
  variant: Variant;
  label: string;
  brand: string;
  /** What the browser frame's address bar shows. */
  address: string;
  product: { title: string; subtitle: string; detail: string };
};

export const SHOPS: Record<ShopId, ShopDef> = {
  rail: {
    id: "rail",
    variant: "honest",
    label: "Shop A · railway tickets · honest",
    brand: "RailKart",
    address: "railkart.in/book/CSMT-PUNE",
    product: { title: "CSMT → PUNE", subtitle: "Intercity Express · 12127", detail: "06:40 → 09:57 · Chair car" },
  },
  bakery: {
    id: "bakery",
    variant: "hacked",
    label: "Shop B · bakery · backend hacked",
    brand: "Crumbs & Co.",
    address: "crumbsandco.in/order/truffle-cake",
    product: { title: "Chocolate truffle cake", subtitle: "Celebration cakes · 500 g", detail: "Baked this morning · pickup in Bandra West" },
  },
};

export const parseShop = (v: string | null | undefined): ShopId => (v === "bakery" ? "bakery" : "rail");

/** One line of the agent's pre-payment check, as shown in the demo. */
export type Check = { label: string; ok: boolean; ens: string; invoice: string };

export type Inspection = {
  shop: ShopId;
  variant: Variant;
  attack: Attack | null;
  /** Where the agent read the invoice from. */
  invoiceUrl: string;
  ens: { name: string; priceInr: number; priceUsdc: string; payTo: string; network: string; status: string };
  invoice: { amountUsdc: string; amountInr: number; payTo: string; network: string; ensName: string };
  checks: Check[];
  verdict: "pay" | "refuse";
  /** The agent's own words when it refuses. */
  reason: string | null;
};
