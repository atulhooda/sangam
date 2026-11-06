/*
 * Bolo voice server's Sarvam AI client: streaming STT (Saaras, with VAD),
 * one-shot STT, the Indic LLM, and Bulbul TTS decoded to the wire format
 * the /media-stream protocol carries (mono PCM16, 8 kHz).
 *
 * Self-contained on purpose: this service deploys to Railway with
 * --path-as-root, so it takes no workspace dependencies.
 */

const API = "https://api.sarvam.ai";

const key = (): string => {
  const k = process.env.SARVAM_API_KEY?.trim();
  if (!k) throw new Error("Missing SARVAM_API_KEY");
  return k;
};

export const sarvamReady = () => Boolean(process.env.SARVAM_API_KEY?.trim());

/** wss://…/speech-to-text/ws with Saaras v4 in codemix mode. Verified against
 *  the live API: audio messages are {audio:{data,encoding:"audio/wav",sample_rate}}
 *  with one WAV header streamed first; transcripts come back as
 *  {type:"data",data:{transcript}}. (vad_signals=true suppresses transcripts —
 *  events-only mode — so turn-taking is our own silence debounce.) */
export function sttUrl(sampleRate = 8000): string {
  const q = new URLSearchParams({
    model: process.env.SARVAM_STT_MODEL ?? "saaras:v4",
    mode: "codemix",
    language_code: "hi-IN",
    sample_rate: String(sampleRate),
    input_audio_codec: "wav",
  });
  return `wss://api.sarvam.ai/speech-to-text/ws?${q}`;
}

/** The 44-byte WAV header the STT socket expects first, announcing 8 kHz mono PCM16. */
export function wavHeader8k(): string {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(0xffffffff, 4); // unknown total length; a stream, not a file
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(16000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(0xffffffff, 40);
  return h.toString("base64");
}

/* ── LLM ── */

export async function chat(system: string, user: string): Promise<string> {
  const res = await fetch(`${API}/v1/chat/completions`, {
    method: "POST",
    headers: { "api-subscription-key": key(), "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.SARVAM_LLM_MODEL ?? "sarvam-105b",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Sarvam chat failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

const parseJson = (raw: string): Record<string, unknown> => {
  const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`no JSON in: ${raw.slice(0, 120)}`);
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
};

const int = (v: unknown, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n) : null;
};

// Yes/no fallbacks, romanised AND Devanagari (Saaras returns Devanagari).
// \b doesn't work on Devanagari, so those match as substrings. "No" always
// wins a tie: "मत बनाओ" contains "बनाओ" but must never read as yes.
const YES_LATIN = /\b(haan|ha|haanji|ji haan|theek|thik|confirm|pakka|pay kar|bhar do|bhar de|kar do|bana do|banao|yes|ok|okay)\b/i;
const NO_LATIN = /\b(nahi|nahin|na|mat|rok|rehne do|cancel|no)\b/i;
// Single words match whole words only ("ना" must not match inside "बना");
// multi-word phrases match as substrings.
const YES_WORDS = ["हाँ", "हां", "हा", "जी", "ठीक", "पक्का", "बनाओ", "ओके"];
const YES_PHRASES = ["बना दो", "बना दीजिए", "कर दो", "कर दीजिए", "भर दो", "भर दीजिए"];
const NO_WORDS = ["नहीं", "नही", "ना", "मत", "रोको", "कैंसल"];
const NO_PHRASES = ["रहने दो", "रहने दीजिए", "रोक दो"];
const words = (s: string) => s.split(/[\s,.!?।॥"'“”()-]+/).filter(Boolean);
const hasWord = (s: string, list: string[]) => words(s).some((w) => list.includes(w));
const hasPhrase = (s: string, list: string[]) => list.some((p) => s.includes(p));
export const saysNo = (s: string) => NO_LATIN.test(s) || hasWord(s, NO_WORDS) || hasPhrase(s, NO_PHRASES);
export const saysYes = (s: string) => !saysNo(s) && (YES_LATIN.test(s) || hasWord(s, YES_WORDS) || hasPhrase(s, YES_PHRASES));

export type InvoiceDraft = {
  buyerName: string | null;
  amountInr: number | null;
  dueDays: number | null;
  note: string | null;
};

export type BuyerIntent = "pay" | "amount" | "status" | "yes" | "no" | "unknown";

/** Merchant's utterance → invoice draft, or a yes/no when we asked for confirmation. */
export async function parseMerchant(utterance: string, expecting: "draft" | "confirm"): Promise<{ draft?: InvoiceDraft; yes?: boolean; no?: boolean }> {
  if (expecting === "confirm") {
    const raw = await chat(
      'You classify what an Indian merchant said in Hindi/Hinglish after being asked to confirm. Answer ONLY JSON: {"yes": boolean, "no": boolean}. "haan/theek hai/pakka/confirm/bana do/haan bana do" → yes. "nahi/mat banao/rehne do/cancel" → no. Both false if neither.',
      utterance,
    );
    const d = parseJson(raw);
    // A spoken "no" anywhere overrides the model; an unambiguous yes-word backs it up.
    const no = saysNo(utterance) || (d.no === true && !saysYes(utterance));
    return { yes: !no && (d.yes === true || saysYes(utterance)), no };
  }
  const raw = await chat(
    'You convert a Hindi/Hinglish voice invoice command into JSON. Answer ONLY: {"buyerName": string|null, "amountInr": number|null, "dueDays": number|null, "note": string|null}.' +
      ' buyerName = who the invoice is FOR (after "ke liye"), null if unheard. amountInr = whole rupees (digits, Devanagari words, or romanised — "do hazaar paanch sau" = 2500), null if unheard. dueDays from "saat din" = 7. note = anything else said about the work.',
    utterance,
  );
  const d = parseJson(raw);
  return {
    draft: {
      buyerName: typeof d.buyerName === "string" && d.buyerName.trim() ? d.buyerName.trim() : null,
      amountInr: int(d.amountInr, 10_000_000),
      dueDays: int(d.dueDays, 365),
      note: typeof d.note === "string" && d.note.trim() ? d.note.trim() : null,
    },
  };
}

/** Buyer's utterance → what they want. */
export async function parseBuyer(utterance: string): Promise<BuyerIntent> {
  const raw = await chat(
    'You classify what an Indian buyer said in Hindi/Hinglish about an invoice they owe. Answer ONLY JSON: {"intent": "pay"|"amount"|"status"|"yes"|"no"|"unknown"}.' +
      ' "pay" = wants to pay ("bhar do", "pay kar do"). "amount" = asking how much. "status" = asking if paid. "yes"/"no" = answering a yes/no question. Else "unknown".',
    utterance,
  );
  const d = parseJson(raw);
  const intent = d.intent;
  // A spoken "no" overrides the model for yes/pay — never pay on "mat bharo".
  if (saysNo(utterance) && (intent === "yes" || intent === "pay" || intent === undefined || intent === "unknown")) return "no";
  if (intent === "pay" || intent === "amount" || intent === "status" || intent === "yes" || intent === "no") return intent;
  if (saysYes(utterance)) return "yes";
  return "unknown";
}

/* ── TTS: text → mono PCM16 8 kHz, chunked for the media-stream protocol ── */

export async function speakPcm8k(text: string): Promise<{ pcm: Buffer; sampleRate: number }> {
  const res = await fetch(`${API}/text-to-speech`, {
    method: "POST",
    headers: { "api-subscription-key": key(), "content-type": "application/json" },
    body: JSON.stringify({
      text,
      language_code: "hi-IN",
      target_language_code: "hi-IN",
      model: process.env.SARVAM_TTS_MODEL ?? "bulbul:v4-flash",
      speaker: process.env.SARVAM_TTS_SPEAKER ?? "simran_en_customer",
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Sarvam TTS failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { audios?: string[] };
  const b64 = data.audios?.[0];
  if (!b64) throw new Error("Sarvam TTS returned no audio");
  return decodeWav(Buffer.from(b64, "base64"));
}

/** Minimal PCM WAV decoder → mono 16-bit samples. */
function decodeWav(buf: Buffer): { pcm: Buffer; sampleRate: number } {
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("not a WAV file");
  let at = 12;
  let sampleRate = 24000;
  let channels = 1;
  let bits = 16;
  let data: Buffer | null = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = buf.subarray(at + 8, at + 8 + size);
    if (id === "fmt ") {
      channels = body.readUInt16LE(2);
      sampleRate = body.readUInt32LE(4);
      bits = body.readUInt16LE(14);
    } else if (id === "data") {
      data = body;
    }
    at += 8 + size + (size % 2);
  }
  if (!data) throw new Error("WAV has no data chunk");
  if (bits !== 16) throw new Error(`unexpected ${bits}-bit WAV`);
  if (channels === 1) return { pcm: data, sampleRate };
  // Interleaved stereo → mono by averaging.
  const frames = Math.floor(data.length / 2 / channels);
  const mono = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += data.readInt16LE((i * channels + c) * 2);
    mono.writeInt16LE(Math.round(sum / channels), i * 2);
  }
  return { pcm: mono, sampleRate };
}

/** Linear resample mono PCM16 to 8 kHz. */
export function resample8k(pcm: Buffer, rate: number): Buffer {
  if (rate === 8000) return pcm;
  const frames = Math.floor(pcm.length / 2);
  const outFrames = Math.floor(frames / (rate / 8000));
  const out = Buffer.alloc(outFrames * 2);
  for (let i = 0; i < outFrames; i++) {
    const pos = i * (rate / 8000);
    const j = Math.floor(pos);
    const frac = pos - j;
    const a = pcm.readInt16LE(Math.min(j, frames - 1) * 2);
    const b = pcm.readInt16LE(Math.min(j + 1, frames - 1) * 2);
    out.writeInt16LE(Math.round(a + (b - a) * frac), i * 2);
  }
  return out;
}

/** One 20 ms media payload at 8 kHz: 160 samples = 320 bytes. */
export const CHUNK_BYTES = 320;
