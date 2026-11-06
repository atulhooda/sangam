import { productLabel, type ProductInput } from "@sangam/ens";

export type ParsedRow = { line: number; input?: ProductInput; label?: string; error?: string };

/** One CSV line into fields, honouring "quoted, fields" and "" escapes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse the merchant's product CSV: name, price_inr, description, image_url
 * (a header row is optional; description and image are optional). Returns one
 * result per line so the upload page can flag bad rows before anything is
 * published.
 */
export function parseProductCsv(text: string): ParsedRow[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const rows: ParsedRow[] = [];
  const seen = new Map<string, number>();
  lines.forEach((raw, idx) => {
    if (!raw.trim()) return;
    const cells = splitCsvLine(raw);
    const [name = "", price = "", description = "", image = ""] = cells;
    if (idx === 0 && /^name$/i.test(name) && /price/i.test(price)) return; // header
    const line = idx + 1;
    if (!name) return rows.push({ line, error: "missing product name" });
    if (name.length > 80) return rows.push({ line, error: "name is longer than 80 characters" });
    const rupees = Number(price.replace(/[₹,\s]/g, ""));
    if (!Number.isFinite(rupees) || rupees < 1 || rupees > 100_000) return rows.push({ line, error: `price "${price}" must be between ₹1 and ₹1,00,000` });
    if (image && !/^https:\/\/\S+$/i.test(image)) return rows.push({ line, error: "image must be an https:// link" });
    const label = productLabel(name);
    const dupe = seen.get(label);
    if (dupe) return rows.push({ line, error: `same name as line ${dupe} (${label})` });
    seen.set(label, line);
    rows.push({ line, label, input: { title: name, priceInrPaise: Math.round(rupees * 100), description: description.slice(0, 280), image } });
  });
  return rows;
}

