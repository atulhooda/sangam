import "server-only";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { UntrustedPayeeError, type InvoiceOption, resolveMerchant } from "@sangam/ens";

/*
 * "Buy from any URL": the buyer pastes a link and the agent tries an x402
 * purchase. The link is untrusted input that the server will fetch, so it is
 * parsed strictly first — https only, no credentials, no oddball ports, and
 * never an address that points back at the machine or a private network
 * (SSRF). Then, once the 402 invoice names a Sangam merchant, the pasted
 * origin is checked against the merchant's registered ENS endpoint: a copycat
 * on another domain is refused before anything is signed.
 */

export class BadBuyUrlError extends Error {}

/** Loopback hosts the browser can reach but a server should not fetch for you. */
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "::1" ||
    h === "::"
  );
}

/** True when the address (IPv4 or IPv6 literal) is loopback or private. */
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map((n) => Number(n));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local (incl. cloud metadata)
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  // IPv4-mapped (::ffff:10.0.0.1): check the embedded v4.
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  const first = v6.split(":")[0] ?? "";
  return /^(f[cd]|fe[89ab])/.test(first); // fc00::/7 unique-local, fe80::/10 link-local
}

/**
 * Parse and vet a buyer-pasted link for the agent to fetch:
 *   - https only (the app's own origin, and loopback hosts in local dev, may
 *     be http so the demo can buy from itself);
 *   - no embedded credentials (user:pass@host), no non-443 ports off dev;
 *   - no loopback/private IP literals or lookalike hostnames;
 *   - the hostname must resolve, and every resolved address must be public.
 */
export async function parseAgentUrl(raw: string, selfOrigin: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new BadBuyUrlError("That doesn't look like a website link.");
  }

  const bare = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // The app fetching its own origin (and localhost in dev) is not an SSRF: it
  // is how the demo buys from itself over http.
  const devExempt = u.origin === selfOrigin || isLoopbackHost(u.hostname);

  if (u.protocol !== "https:" && !devExempt) {
    throw new BadBuyUrlError("Only https:// links — the agent won't send payment traffic over plain http.");
  }
  if (u.username || u.password) {
    throw new BadBuyUrlError("That link has credentials in it (user:pass@host), which the agent won't follow.");
  }
  if (!devExempt && u.port && u.port !== "443") {
    throw new BadBuyUrlError(`The agent only buys from https over its normal port, not :${u.port}.`);
  }
  if (!bare) throw new BadBuyUrlError("That link has no host in it.");

  if (isIP(bare)) {
    if (isPrivateAddress(bare)) throw new BadBuyUrlError("The agent won't buy from a private or loopback address.");
  } else if (!devExempt) {
    let addresses: { address: string }[];
    try {
      addresses = await lookup(bare, { all: true });
    } catch {
      throw new BadBuyUrlError(`Could not resolve ${bare} — is that the right address?`);
    }
    if (addresses.length === 0) throw new BadBuyUrlError(`Could not resolve ${bare}.`);
    if (addresses.some((a) => isPrivateAddress(a.address))) {
      throw new BadBuyUrlError(`${bare} resolves to a private address, so the agent won't fetch it.`);
    }
  }
  return u;
}

/**
 * The pasted URL must be the merchant's own registered website: when the
 * invoice names a Sangam merchant (extra.ensName), that merchant's ENS record
 * endpoint must be on the very host the buyer pasted. A site that names a real
 * merchant but lives on another domain is a copycat — refused as
 * "origin-mismatch" before anything is signed.
 */
export async function assertUrlMerchantOrigin(url: URL, option: InvoiceOption): Promise<void> {
  const ensName = typeof option.extra?.ensName === "string" ? option.extra.ensName.trim().toLowerCase() : "";
  if (!ensName) return; // an invoice that names no merchant is the guard's job (no-name)
  let endpointHost: string;
  try {
    endpointHost = new URL((await resolveMerchant(ensName)).endpoint).host;
  } catch (err) {
    throw new UntrustedPayeeError(
      `Refused: could not read ${ensName} from ENS to check where its website lives (${(err as Error).message.split("\n")[0]}).`,
      "lookup-failed",
    );
  }
  if (endpointHost !== url.host) {
    throw new UntrustedPayeeError(
      `Refused: the invoice claims to be ${ensName}, whose registered website is ${endpointHost}, but this page is on ${url.host}. A copycat on someone else's domain.`,
      "origin-mismatch",
    );
  }
}
