import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@sangam/shared";
import { setMerchantCert, updateMerchantShop, type MerchantCert } from "@/lib/server/identity";
import { provisionMerchant } from "@/lib/server/provision";
import { currentUser, homeFor } from "@/lib/server/session";

export const dynamic = "force-dynamic";
// Provisioning sends a Hedera account create and one or two Sepolia transactions.
export const maxDuration = 120;

/*
 * A merchant's company certificate (certificate of incorporation, GST
 * registration, shop licence…) and shop details (UPI handle, price, optional
 * own x402 endpoint). Uploaded once after the Self sign-in. The certificate is
 * stored in DATA_DIR/certs, which is the Railway volume in production, and
 * served back only to the merchant who uploaded it.
 *
 * Then Sangam provisions the merchant: its own Hedera deposit account and its
 * <label>.sangam.eth records, marked sangam.status = verified.
 */

const CERT_DIR = path.join(DATA_DIR, "certs");
const MAX_BYTES = 5 * 1024 * 1024;

class Bad extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** The type from the file's first bytes, not from its name or the browser's claim. */
function sniff(buf: Buffer): { mime: MerchantCert["mime"]; ext: string } | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  return null;
}

async function requireMerchant() {
  const me = await currentUser();
  return me && me.session.role === "merchant" ? me : null;
}

function shopFields(form: FormData) {
  const upiHandle = String(form.get("upiHandle") ?? "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,64}@[a-z0-9]{2,32}$/.test(upiHandle)) throw new Bad("Enter the UPI handle payouts go to, e.g. myshop@okaxis.");
  const priceInr = Number(String(form.get("priceInr") ?? "").trim());
  if (!Number.isFinite(priceInr) || priceInr < 1 || priceInr > 100_000) throw new Bad("Enter a price per order between ₹1 and ₹1,00,000.");
  const raw = String(form.get("endpoint") ?? "").trim();
  let endpoint: string | null = null;
  if (raw) {
    let u: URL | null = null;
    try {
      u = new URL(raw);
    } catch {
      /* handled below */
    }
    if (!u || u.protocol !== "https:") throw new Bad("Your own x402 endpoint must be an https:// URL, or leave it blank to use Sangam's pay link.");
    endpoint = u.toString();
  }
  return { upiHandle, priceInrPaise: Math.round(priceInr * 100), endpoint };
}

async function storeCertFile(file: File): Promise<Pick<MerchantCert, "fileName" | "mime" | "size" | "sha256" | "storedAs">> {
  if (file.size > MAX_BYTES) throw new Bad("The certificate must be 5 MB or smaller.", 413);
  const buf = Buffer.from(await file.arrayBuffer());
  const type = sniff(buf);
  if (!type) throw new Bad("Upload a PDF, PNG or JPEG.", 415);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  // Named by content hash: nothing about the person or company in the path.
  const storedAs = `${sha256}.${type.ext}`;
  await mkdir(CERT_DIR, { recursive: true });
  await writeFile(path.join(CERT_DIR, storedAs), buf, { mode: 0o600 });
  return { fileName: path.basename(file.name).slice(0, 120) || storedAs, mime: type.mime, size: buf.length, sha256, storedAs };
}

export async function POST(req: Request) {
  const me = await requireMerchant();
  if (!me) return Response.json({ error: "Sign in as a merchant first." }, { status: 401 });

  try {
    const form = await req.formData().catch(() => null);
    if (!form) throw new Bad("Send the form as multipart/form-data.");
    const companyName = String(form.get("companyName") ?? "").trim().slice(0, 160);
    const registrationNumber = String(form.get("registrationNumber") ?? "").trim().toUpperCase().slice(0, 40);
    if (!companyName) throw new Bad("Enter the registered company name.");
    if (!/^[A-Z0-9/-]{5,40}$/.test(registrationNumber)) throw new Bad("Enter the GSTIN, CIN or registration number (letters, digits, / and -).");
    const shop = shopFields(form);

    // A merchant editing details may keep the file already on record.
    const file = form.get("file");
    const hasFile = file instanceof File && file.size > 0;
    if (!hasFile && !me.identity.cert) throw new Bad("Attach the certificate file.");
    const stored = hasFile ? await storeCertFile(file) : me.identity.cert!;

    await setMerchantCert(me.identity.nullifier, {
      ...stored,
      companyName,
      registrationNumber,
      uploadedAt: hasFile ? new Date().toISOString() : me.identity.cert!.uploadedAt,
      status: "submitted",
    });

    const prev = me.identity.shop;
    const changed = !prev || prev.upiHandle !== shop.upiHandle || prev.priceInrPaise !== shop.priceInrPaise || prev.endpoint !== shop.endpoint;
    let identity = await updateMerchantShop(me.identity.nullifier, { ...shop, ...(changed ? { provisionedAt: undefined } : {}) });
    if (!identity.shop?.provisionedAt) identity = await provisionMerchant(me.identity.nullifier);

    return Response.json({ ok: true, provisioned: !!identity.shop?.provisionedAt, error: identity.shop?.error ?? null, redirect: homeFor(identity) });
  } catch (err) {
    if (err instanceof Bad) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

/** The signed-in merchant's own certificate file. */
export async function GET() {
  const me = await requireMerchant();
  if (!me) return Response.json({ error: "Sign in as a merchant first." }, { status: 401 });
  const cert = me.identity.cert;
  if (!cert) return Response.json({ error: "No certificate uploaded yet." }, { status: 404 });
  try {
    const buf = await readFile(path.join(CERT_DIR, path.basename(cert.storedAs)));
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": cert.mime,
        "content-disposition": `inline; filename="${cert.fileName.replace(/[^\w.\- ]/g, "_")}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "The certificate file is missing. Upload it again." }, { status: 404 });
  }
}
