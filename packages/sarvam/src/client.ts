import { envOr, hasEnv } from "@sangam/shared";

/*
 * Sarvam AI — the Indic voice stack behind Bolo Sangam.
 *
 *   Saaras v4      speech-to-text: Hindi + 22 Indian languages, with a
 *                  codemix mode for the Hinglish merchants actually speak
 *                  ("Ramesh ke liye 2500 ka invoice, saat din")
 *   Bulbul v4      text-to-speech: spoken confirmations back to the merchant
 *                  ("invoice ban gaya") and invoice read-outs to buyers
 *   Sarvam-105B    chat: the transcript → structured-invoice parse
 *
 * The API key never leaves the server: these run only in route handlers and
 * node scripts. Browser audio comes in as a multipart upload, audio goes
 * back out as base64 WAV.
 */

const API = "https://api.sarvam.ai";

const STT_MODEL = () => envOr("SARVAM_STT_MODEL", "saaras:v4");
const TTS_MODEL = () => envOr("SARVAM_TTS_MODEL", "bulbul:v4-flash");
const TTS_SPEAKER = () => envOr("SARVAM_TTS_SPEAKER", "simran_en_customer");
const LLM_MODEL = () => envOr("SARVAM_LLM_MODEL", "sarvam-105b");

/** True when SARVAM_API_KEY is set — gates the Bolo panels in the UI. */
export const sarvamEnabled = () => hasEnv("SARVAM_API_KEY");

/** The key, or a helpful error. Never logged, never sent to the browser. */
function key(): string {
  const k = process.env.SARVAM_API_KEY?.trim();
  if (!k) throw new Error("Missing SARVAM_API_KEY. Add it to .env to use Bolo Sangam.");
  return k;
}

const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) =>
  fetch(`${API}${path}`, {
    method: "POST",
    headers: { "api-subscription-key": key(), ...headers },
    body,
    // A slow STT call still beats a panel that hangs the demo.
    signal: AbortSignal.timeout(30_000),
  });

export type Transcription = {
  transcript: string;
  languageCode: string | null;
  raw: unknown;
};

/**
 * Speech → text. `mode` picks how Saaras answers: "codemix" keeps Hinglish
 * as spoken (product names stay in English, the rest in Devanagari);
 * "translit" gives romanised Hindi; "transcribe" is plain transcription.
 */
export async function transcribe(
  audio: Blob,
  opts: { mode?: "transcribe" | "translit" | "codemix"; languageCode?: string } = {},
): Promise<Transcription> {
  const form = new FormData();
  form.set("model", STT_MODEL());
  form.set("mode", opts.mode ?? "codemix");
  if (opts.languageCode) form.set("language_code", opts.languageCode);
  form.set("file", audio, "speech.wav");
  const res = await post("/speech-to-text", form);
  if (!res.ok) throw new Error(`Sarvam STT failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as Record<string, unknown>;
  // Different Saaras versions shape this slightly differently; be defensive.
  const transcript =
    (typeof data.transcript === "string" && data.transcript) ||
    (Array.isArray(data.transcripts) && typeof data.transcripts[0] === "string" && data.transcripts[0]) ||
    (typeof data.text === "string" && data.text) ||
    "";
  return {
    transcript: transcript.trim(),
    languageCode: typeof data.language_code === "string" ? data.language_code : null,
    raw: data,
  };
}

/** Text → speech. Returns WAV bytes (Sarvam answers base64 in `audios[]`). */
export async function speak(text: string, languageCode = "hi-IN"): Promise<Buffer> {
  const res = await post(
    "/text-to-speech",
    JSON.stringify({ text, target_language_code: languageCode, language_code: languageCode, model: TTS_MODEL(), speaker: TTS_SPEAKER() }),
    { "content-type": "application/json" },
  );
  if (!res.ok) throw new Error(`Sarvam TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { audios?: string[] };
  const b64 = data.audios?.[0];
  if (!b64) throw new Error("Sarvam TTS returned no audio");
  return Buffer.from(b64, "base64");
}

/** One chat completion with the Indic-tuned LLM. Returns the message text. */
export async function chat(system: string, user: string): Promise<string> {
  const res = await post(
    "/v1/chat/completions",
    JSON.stringify({ model: LLM_MODEL(), messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0 }),
    { "content-type": "application/json" },
  );
  if (!res.ok) throw new Error(`Sarvam chat failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/* ── the two parses Bolo Sangam needs ── */

export type InvoiceDraft = {
  buyerName: string | null;
  /** Whole rupees the invoice is for; null when unheard. */
  amountInr: number | null;
  dueDays: number | null;
  note: string | null;
  /** The speaker said a yes-word ("haan", "theek hai", "confirm") — for voice confirm flows. */
  confirm: boolean;
};

export type BuyerIntent = "pay" | "amount" | "status" | "unknown";

const JSON_ONLY = (what: string) =>
  [
    `You parse what an Indian ${what} said, spoken in Hindi or Hinglish, into JSON.`,
    "Answer with ONLY a JSON object — no markdown, no explanation, no code fences.",
    "Transcripts come from speech recognition, so numbers may be digits (\"2500\"), Hindi words in Devanagari (\"पच्चीस सौ\") or romanised (\"pachis sau\").",
  ].join(" ");

const parse = (raw: string): unknown => {
  // The model is told JSON-only; strip fences if it forgot.
  const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`Sarvam chat returned no JSON: ${raw.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1)) as unknown;
};

const int = (v: unknown, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n) : null;
};

const YES = /\b(haan|ha|yes|theek|thik|confirm|packha|pakka|bhej|bhej do|kar do|kardo)\b/i;
const yes = (s: string) => YES.test(s);

/**
 * Merchant speech → invoice draft. "Ramesh ke liye 2500 ka invoice, saat din"
 * → { buyerName: "Ramesh", amountInr: 2500, dueDays: 7 }.
 */
export async function parseMerchantInvoice(transcript: string): Promise<InvoiceDraft> {
  const raw = await chat(
    JSON_ONLY("merchant") +
      ' Schema: {"buyerName": string|null, "amountInr": number|null, "dueDays": number|null, "note": string|null, "confirm": boolean}.' +
      ' "buyerName" is the person or shop the invoice is FOR (after "ke liye"); null if unheard. "amountInr" is the amount in whole rupees; null if unheard.' +
      ' "dueDays" is the payment window ("saat din" = 7); null if not said. "note" is any extra description, else null.' +
      ' "confirm" is true only if the sentence is agreeing to a previously stated draft ("haan theek hai"), not for a new invoice.',
    transcript,
  );
  const d = parse(raw) as Record<string, unknown>;
  return {
    buyerName: typeof d.buyerName === "string" && d.buyerName.trim() ? d.buyerName.trim() : null,
    amountInr: int(d.amountInr, 10_000_000),
    dueDays: int(d.dueDays, 365),
    note: typeof d.note === "string" && d.note.trim() ? d.note.trim() : null,
    confirm: d.confirm === true || yes(transcript),
  };
}

/** Buyer speech → what they want to do about an invoice. */
export async function parseBuyerIntent(transcript: string): Promise<{ intent: BuyerIntent; confirm: boolean }> {
  const raw = await chat(
    JSON_ONLY("buyer, talking about an invoice they owe") +
      ' Schema: {"intent": "pay"|"amount"|"status"|"unknown", "confirm": boolean}.' +
      ' "pay" = they want to pay it ("bhar do", "pay kar do", "dedo"). "amount" = asking how much ("kitna hai"). "status" = asking if it is paid. Otherwise "unknown".',
    transcript,
  );
  const d = parse(raw) as { intent?: string; confirm?: boolean };
  const intent = d.intent === "pay" || d.intent === "amount" || d.intent === "status" ? d.intent : "unknown";
  return { intent, confirm: d.confirm === true || yes(transcript) };
}
