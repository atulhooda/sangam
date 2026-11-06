import WebSocket from "ws";

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
 *  {type:"data",data:{transcript}}, ONE PER SPOKEN SEGMENT (a pause splits
 *  "रमेश के लिए … पाँच सौ" into two messages), so callers must append them.
 *  (vad_signals=true suppresses transcripts — events-only mode — so
 *  turn-taking is our own silence debounce.) */
export function sttUrl(sampleRate = 16000): string {
  const q = new URLSearchParams({
    model: process.env.SARVAM_STT_MODEL ?? "saaras:v4",
    mode: "codemix",
    language_code: "hi-IN",
    sample_rate: String(sampleRate),
    input_audio_codec: "wav",
  });
  return `wss://api.sarvam.ai/speech-to-text/ws?${q}`;
}

/** A streaming WAV header (unknown length) for mono PCM16 at `rate`. */
export function wavHeader(rate: number, dataBytes = 0xffffffff): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(dataBytes === 0xffffffff ? 0xffffffff : 36 + dataBytes, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/* ── LLM ── */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * One LLM call. Reasoning is switched OFF: Sarvam-105B otherwise "thinks"
 * for ~300 hidden tokens before answering a one-line parse (2-4 s per turn,
 * measured); without it the same answer comes back in ~0.35 s.
 */
export async function chat(messages: ChatMessage[], maxTokens = 300): Promise<string> {
  const res = await fetch(`${API}/v1/chat/completions`, {
    method: "POST",
    headers: { "api-subscription-key": key(), "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.SARVAM_LLM_MODEL ?? "sarvam-105b",
      messages,
      temperature: 0,
      reasoning_effort: null,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(12_000),
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

/* ── understanding a turn: one LLM call, the draft carried across turns ── */

const clean = (v: unknown): string | null => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null);
const normalise = (s: string) => s.toLowerCase().replace(/[\s.,!?।॥"'“”()₹-]+/g, "");
/** Digit groups the recogniser wrote ("₹2,500" → "2500"). */
const numbersIn = (s: string) => (s.replace(/(\d),(?=\d)/g, "$1").match(/\d+/g) ?? []).map(Number);

export type MerchantAction = "create" | "confirm" | "ask" | "cancel" | "chitchat";
export type MerchantTurn = { draft: InvoiceDraft; action: MerchantAction; reply: string | null };

const MERCHANT_SYSTEM = `You are Bolo (a woman: always feminine Hindi verb forms, "सकती हूँ", "करती हूँ"), a friendly voice assistant helping an Indian shopkeeper create an invoice (bill) for a customer, in Hindi/Hinglish.
Each turn you get the invoice draft so far, the conversation, and the shopkeeper's latest words (from speech recognition, may be imperfect).
Answer ONLY with JSON:
{"buyerName": string|null, "amountInr": number|null, "dueDays": number|null, "note": string|null, "action": "create"|"confirm"|"ask"|"cancel"|"chitchat", "reply": string}

Fields = the FULL updated draft:
- Keep every value already in the draft unless the shopkeeper changes it now ("nahi, chhe sau" changes the amount).
- buyerName: the customer the bill is FOR (usually before "ke liye"), copied exactly as written in their words, same script. Never invent or guess a name.
- amountInr: whole rupees as a number ("do hazaar paanch sau" / "₹2,500" → 2500). Never invent an amount.
- dueDays: "saat din" → 7. note: what the bill is for, if said. Otherwise keep / null.

action:
- "create": buyerName and amountInr are both known and clear. This includes the shopkeeper agreeing ("haan", "theek hai", "bana do") after you asked to check, or correcting a value.
- "confirm": both are known but one sounded unclear, garbled or unusual (odd name, strange amount, conflicting words).
- "ask": something is missing.
- "cancel": they want to stop / not make the bill.
- "chitchat": unrelated talk.
reply: only for "chitchat": one short, warm Hindi sentence in Devanagari that steers back to the bill. You only know about this bill: never state facts about anything else (weather, news, prices, people); say you can only help with bills. No numbers. Otherwise "".`;

/**
 * The shopkeeper's latest words, read against the draft so far: pieces said
 * across turns ("रमेश के लिए" … "पाँच सौ") add up, and corrections replace.
 * Guards stop the model inventing a name or amount the shopkeeper never said.
 */
export async function understandMerchant(input: { draft: InvoiceDraft; transcript: { who: "bolo" | "merchant"; text: string }[]; said: string }): Promise<MerchantTurn> {
  const convo = input.transcript.slice(-8).map((t) => `${t.who === "bolo" ? "Bolo" : "Shopkeeper"}: ${t.text}`).join("\n");
  const raw = await chat([
    { role: "system", content: MERCHANT_SYSTEM },
    { role: "user", content: `Draft so far: ${JSON.stringify(input.draft)}\nConversation:\n${convo || "(none)"}\nShopkeeper now said: "${input.said}"` },
  ]);
  const d = parseJson(raw);
  const prev = input.draft;
  const draft: InvoiceDraft = {
    buyerName: clean(d.buyerName) ?? prev.buyerName,
    amountInr: int(d.amountInr, 10_000_000) ?? prev.amountInr,
    dueDays: int(d.dueDays, 365) ?? prev.dueDays,
    note: clean(d.note) ?? prev.note,
  };
  let action: MerchantAction = (["create", "confirm", "ask", "cancel", "chitchat"] as const).includes(d.action as MerchantAction) ? (d.action as MerchantAction) : "ask";
  if (action === "cancel" || (saysNo(input.said) && !draft.amountInr && !draft.buyerName)) return { draft: { buyerName: null, amountInr: null, dueDays: null, note: null }, action: "cancel", reply: null };

  // Everything the shopkeeper actually said, to check the model against.
  const heard = input.transcript.filter((t) => t.who === "merchant").map((t) => t.text).concat(input.said).join(" ");
  const nameHeard = !draft.buyerName || normalise(heard).includes(normalise(draft.buyerName)) || draft.buyerName === prev.buyerName;
  if (!nameHeard) draft.buyerName = null; // a name nobody said is a hallucination: ask for it
  const numbers = numbersIn(heard);
  const amountNew = draft.amountInr !== prev.amountInr;
  const amountShaky = amountNew && draft.amountInr !== null && numbers.length > 0 && !numbers.includes(draft.amountInr);

  if (!draft.buyerName || !draft.amountInr) action = action === "chitchat" ? "chitchat" : "ask";
  else if (action === "create" && amountShaky) action = "confirm";
  else if (action === "ask" || action === "chitchat") action = "create";
  const reply = action === "chitchat" ? clean(d.reply) : null;
  return { draft, action, reply: reply && !/\d/.test(reply) && reply.length < 200 ? reply : null };
}

export type BuyerAction = "pay" | "amount" | "status" | "yes" | "no" | "chitchat";

const BUYER_SYSTEM = `You are Bolo (a woman: always feminine Hindi verb forms, "सकती हूँ", "करती हूँ"), a friendly voice assistant helping an Indian buyer with a bill (invoice) they owe, in Hindi/Hinglish.
Given the conversation and the buyer's latest words (from speech recognition), answer ONLY with JSON: {"action": "pay"|"amount"|"status"|"yes"|"no"|"chitchat", "reply": string}
- "pay": wants to pay now ("bhar do", "pay kar do", "de do").
- "amount": asks how much / whose bill. "status": asks whether it's paid.
- "yes" / "no": answering your last question ("haan", "theek hai" / "nahi", "abhi nahi", "ruko").
- "chitchat": anything else.
reply: only for "chitchat": one short, warm Hindi sentence in Devanagari steering back to the bill. You only know about this bill: never state facts about anything else; say you can only help with the bill. No numbers. Otherwise "".`;

/** The buyer's latest words → what they want. A spoken "no" always wins over pay/yes. */
export async function understandBuyer(input: { transcript: { who: "bolo" | "buyer"; text: string }[]; said: string }): Promise<{ action: BuyerAction; reply: string | null }> {
  const convo = input.transcript.slice(-6).map((t) => `${t.who === "bolo" ? "Bolo" : "Buyer"}: ${t.text}`).join("\n");
  const raw = await chat([
    { role: "system", content: BUYER_SYSTEM },
    { role: "user", content: `Conversation:\n${convo || "(none)"}\nBuyer now said: "${input.said}"` },
  ]);
  const d = parseJson(raw);
  let action: BuyerAction = (["pay", "amount", "status", "yes", "no", "chitchat"] as const).includes(d.action as BuyerAction) ? (d.action as BuyerAction) : "chitchat";
  if (saysNo(input.said) && (action === "pay" || action === "yes" || action === "chitchat")) action = "no";
  const reply = action === "chitchat" ? clean(d.reply) : null;
  return { action, reply: reply && !/\d/.test(reply) && reply.length < 200 ? reply : null };
}

/* ── TTS: text → mono PCM16 at the wire rate, cached ── */

/** Bolo's voice goes out at 24 kHz (Bulbul's native quality), not phone-band 8 kHz. */
export const OUT_RATE = 24000;
const ttsCache = new Map<string, Buffer>();

/** Bulbul renders `text` straight at `rate`. Repeated lines (greetings, prompts) come from a cache. */
export async function speakPcm(text: string, rate = OUT_RATE): Promise<Buffer> {
  const cacheKey = `${rate}|${text}`;
  const hit = ttsCache.get(cacheKey);
  if (hit) return hit;
  const res = await fetch(`${API}/text-to-speech`, {
    method: "POST",
    headers: { "api-subscription-key": key(), "content-type": "application/json" },
    body: JSON.stringify({
      text,
      target_language_code: "hi-IN",
      model: process.env.SARVAM_TTS_MODEL ?? "bulbul:v4-flash",
      speaker: process.env.SARVAM_TTS_SPEAKER ?? "simran_hi_assistant",
      speech_sample_rate: rate,
      pace: Number(process.env.SARVAM_TTS_PACE ?? 1.08),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Sarvam TTS failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { audios?: string[] };
  const b64 = data.audios?.[0];
  if (!b64) throw new Error("Sarvam TTS returned no audio");
  const { pcm, sampleRate } = decodeWav(Buffer.from(b64, "base64"));
  const out = resample(pcm, sampleRate, rate);
  if (ttsCache.size > 200) ttsCache.delete(ttsCache.keys().next().value!);
  ttsCache.set(cacheKey, out);
  return out;
}

/*
 * Streaming TTS: Bulbul over a WebSocket sends the first audio ~0.3 s after
 * the text (REST returns the whole clip after ~0.9 s), so Bolo starts talking
 * while the rest is still being synthesised. One connection is kept open and
 * ready, since opening one costs ~0.2 s.
 */
const TTS_WS = "wss://api.sarvam.ai/text-to-speech/ws";
let spare: { ws: Promise<WebSocket>; at: number } | null = null;

function openTtsSocket(): Promise<WebSocket> {
  const q = new URLSearchParams({ model: process.env.SARVAM_TTS_MODEL ?? "bulbul:v4-flash", send_completion_event: "true" });
  const ws = new WebSocket(`${TTS_WS}?${q}`, { headers: { "api-subscription-key": key() } });
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(`TTS socket refused (${res.statusCode})`)));
  });
}

/** A ready TTS socket: the warm spare if it's fresh, then a new spare starts opening. */
function takeTtsSocket(): Promise<WebSocket> {
  const fresh = spare && Date.now() - spare.at < 25_000 ? spare.ws : null;
  if (spare && !fresh) void spare.ws.then((w) => w.close()).catch(() => undefined);
  spare = { ws: openTtsSocket(), at: Date.now() };
  spare.ws.catch(() => (spare = null));
  return fresh ?? openTtsSocket();
}

/** Open a TTS socket ahead of Bolo's first line. */
export function warmSpeech() {
  if (!sarvamReady()) return;
  if (!spare || Date.now() - spare.at >= 25_000) {
    spare = { ws: openTtsSocket(), at: Date.now() };
    spare.ws.catch(() => (spare = null));
  }
}

/**
 * Speak `text` as PCM16 at `rate`, handing each piece to `onAudio` as soon as
 * it is synthesised. Falls back to the REST endpoint if streaming fails
 * before any audio arrived. Finished lines are cached.
 */
export async function streamSpeech(text: string, rate: number, onAudio: (pcm: Buffer) => void): Promise<void> {
  const cacheKey = `${rate}|${text}`;
  const hit = ttsCache.get(cacheKey);
  if (hit) return onAudio(hit);
  const parts: Buffer[] = [];
  let carry = Buffer.alloc(0); // keep 16-bit samples whole across chunk boundaries
  try {
    const ws = await takeTtsSocket();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("TTS stream timed out")), 15_000);
      const finish = (err?: Error) => {
        clearTimeout(timer);
        ws.removeAllListeners("message");
        ws.close();
        if (err) reject(err);
        else resolve();
      };
      ws.on("message", (raw: WebSocket.RawData) => {
        let m: { type?: string; data?: { audio?: string; event_type?: string; message?: string } };
        try {
          m = JSON.parse(raw.toString()) as typeof m;
        } catch {
          return;
        }
        if (m.type === "audio" && m.data?.audio) {
          const buf = Buffer.concat([carry, Buffer.from(m.data.audio, "base64")]);
          const whole = buf.length - (buf.length % 2);
          carry = buf.subarray(whole);
          const pcm = buf.subarray(0, whole);
          parts.push(pcm);
          onAudio(pcm);
        } else if (m.type === "event" && m.data?.event_type === "final") finish();
        else if (m.type === "error") finish(new Error(`TTS stream: ${m.data?.message ?? "error"}`));
      });
      ws.once("close", () => finish(parts.length ? undefined : new Error("TTS stream closed early")));
      ws.send(
        JSON.stringify({
          type: "config",
          data: {
            target_language_code: "hi-IN",
            speaker: process.env.SARVAM_TTS_SPEAKER ?? "simran_hi_assistant",
            speech_sample_rate: rate,
            pace: Number(process.env.SARVAM_TTS_PACE ?? 1.08),
            output_audio_codec: "linear16",
            min_buffer_size: 30,
            max_chunk_length: 150,
          },
        }),
      );
      ws.send(JSON.stringify({ type: "text", data: { text } }));
      ws.send(JSON.stringify({ type: "flush" }));
    });
  } catch (err) {
    if (parts.length) throw err; // part of the line already played; don't repeat it
    console.error(`[bolo] streaming TTS failed, using REST: ${(err as Error).message}`);
    return onAudio(await speakPcm(text, rate));
  }
  if (ttsCache.size > 200) ttsCache.delete(ttsCache.keys().next().value!);
  ttsCache.set(cacheKey, Buffer.concat(parts));
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

/** Linear resample of mono PCM16 (only used if Bulbul ever answers at another rate). */
export function resample(pcm: Buffer, from: number, to: number): Buffer {
  if (from === to) return pcm;
  const frames = Math.floor(pcm.length / 2);
  const step = from / to;
  const outFrames = Math.floor(frames / step);
  const out = Buffer.alloc(outFrames * 2);
  for (let i = 0; i < outFrames; i++) {
    const pos = i * step;
    const j = Math.floor(pos);
    const frac = pos - j;
    const a = pcm.readInt16LE(Math.min(j, frames - 1) * 2);
    const b = pcm.readInt16LE(Math.min(j + 1, frames - 1) * 2);
    out.writeInt16LE(Math.round(a + (b - a) * frac), i * 2);
  }
  return out;
}
