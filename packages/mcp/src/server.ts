import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveMerchant, assertVerifiedPayee } from "@sangam/ens";
import { createPayingFetch, hashscanTxUrl } from "@sangam/hedera";
import { envOr, formatUsdc, type Settlement } from "@sangam/shared";
import { z } from "zod";

/*
 * Sangam as an MCP server: any MCP client (Claude Code, Claude Desktop, an
 * IDE agent) can discover merchants on ENS, search ONDC, buy with USDC on
 * Hedera over x402, and check settlement status — no human in the loop.
 *
 * Run with `npm run mcp` (stdio). Connect with:
 *   claude mcp add sangam -- npm run mcp
 *
 * The web app's own buyer (POST /api/pay on the dashboard) enforces
 * CUSTOMER_TOTAL_BUDGET; this process signs directly with the CUSTOMER_* key,
 * so only the SDK's per-payment cap (CUSTOMER_MAX_PER_PAYMENT) applies here.
 */

const base = () => envOr("SANGAM_API_URL", "http://localhost:5173");

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (err: unknown) => ({
  content: [{ type: "text" as const, text: `error: ${(err as Error).message}` }],
  isError: true,
});

const server = new McpServer({ name: "sangam", version: "0.1.0" });

server.registerTool(
  "lookup_merchant",
  {
    title: "Look up a Sangam merchant",
    description:
      "Resolve a merchant's ENS name to what an agent needs to pay it: the x402 endpoint, the Hedera account to pay, the UPI handle, the network and the price. This is always step one before buying.",
    inputSchema: { ensName: z.string().describe("ENS name, e.g. tickets.sangam.eth") },
  },
  async ({ ensName }) => {
    try {
      return json(await resolveMerchant(ensName));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "search_catalog",
  {
    title: "Search the ONDC catalog",
    description:
      "Search ONDC (India's open commerce network) through Sangam. Returns goods an agent can buy in USDC, each with an orderUrl to pass to the buy tool.",
    inputSchema: {
      q: z.string().optional().describe("search text, e.g. atta or rice; default atta"),
    },
  },
  async ({ q }) => {
    try {
      const res = await fetch(`${base()}/merchant/ondc/catalog?q=${encodeURIComponent(q ?? "atta")}`, { cache: "no-store" });
      return json(await res.json());
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "buy",
  {
    title: "Buy with USDC on Hedera",
    description:
      "Buy at an x402 URL: the merchant answers 402, the agent signs a USDC transfer on Hedera and retries — no approval step. Only verified Sangam merchants get paid: the invoice must name a .sangam.eth merchant whose ENS record says sangam.status=verified and whose sangam.payTo matches the invoice, otherwise nothing is signed. Needs CUSTOMER_ACCOUNT_ID and CUSTOMER_PRIVATE_KEY in .env. Returns the Hedera transaction id, the HashScan link and the price paid.",
    inputSchema: {
      url: z.string().describe("the x402 URL to buy (an orderUrl from search_catalog, or a merchant endpoint)"),
      qty: z.number().int().positive().optional().describe("quantity, for ONDC order URLs (default 1)"),
    },
  },
  async ({ url, qty }) => {
    try {
      const target = new URL(url);
      if (qty) target.searchParams.set("qty", String(qty));
      const { buy } = createPayingFetch({ guard: assertVerifiedPayee });
      const purchase = await buy<Record<string, unknown>>(target);
      if (!purchase.settle?.success) {
        throw new Error(`purchase did not settle (HTTP ${purchase.status}): ${JSON.stringify(purchase.body)}`);
      }
      return json({
        priceUsdc: formatUsdc(purchase.price),
        hederaTxId: purchase.settle.transaction,
        hashscan: hashscanTxUrl(purchase.settle.transaction),
        body: purchase.body,
      });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "settlement_status",
  {
    title: "Check settlement status",
    description:
      "Sangam's settlement records: what was received in USDC, the 0G decision, the INR paid out over UPI, and the HCS receipt sequence. Filter by Hedera transaction id or payer account.",
    inputSchema: {
      hederaTxId: z.string().optional().describe("filter to one Hedera transaction"),
      payer: z.string().optional().describe("filter by payer Hedera account, e.g. 0.0.123456"),
      limit: z.number().int().positive().optional().describe("max rows to return (default 10, newest first)"),
    },
  },
  async ({ hederaTxId, payer, limit }) => {
    try {
      const res = await fetch(`${base()}/api/settlements`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Sangam API returned ${res.status} — is the web app running?`);
      let rows = (await res.json()) as Settlement[];
      if (hederaTxId) rows = rows.filter((s) => s.hederaTxId === hederaTxId);
      if (payer) rows = rows.filter((s) => s.payer === payer);
      rows = rows.slice(0, limit ?? 10);
      return json(
        rows.map((s) => ({
          hederaTxId: s.hederaTxId,
          merchant: s.merchant,
          usdcAmount: `${Number(s.usdcAmount) / 1e6} USDC`,
          status: s.status,
          decision: s.decision,
          payout: s.payoutPaise !== null ? `₹${s.payoutPaise / 100}` : null,
          hcsReceipt: s.hcsTopicId ? `${s.hcsTopicId} #${s.hcsSequence}` : null,
          refund: s.refund?.scheduleId ?? null,
          error: s.error,
        })),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

await server.connect(new StdioServerTransport());
