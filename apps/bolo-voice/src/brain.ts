import WebSocket from "ws";
import { sarvamReady, streamSpeech, sttUrl, warmSpeech, understandBuyer, understandMerchant, wavHeader, type InvoiceDraft } from "./sarvam";

/*
 * One live Bolo conversation. Mirrors Ritu's intake CallHandler: the wire
 * protocol is Ritu's /media-stream (connected → start → media/mark/stop up,
 * media/mark/clear/captions down), the brain is a per-role state machine over
 * streamed Saaras transcripts, and every turn is captioned back so the UI can
 * show what was heard.
 *
 *   merchant:  draft → speak back the parsed invoice → confirm → callback
 *   buyer:     amount/status read-out, or confirm-to-pay → callback
 *
 * Authority stays with the app: this server only converses and reports. The
 * web backend decides whether a confirmed invoice becomes a real one and
 * whether the buyer's agent actually pays — via the signed callback.
 */

export type Script = {
  role: "merchant" | "buyer";
  /** Merchant's ENS name, or the buyer's label. */
  actor: string;
  /** Buyer sessions: where to read the invoice status from. */
  statusUrl?: string;
  /** Buyer sessions: whom they're paying. */
  buyerName?: string;
};

export type CallbackResult = {
  status: "completed" | "failed" | "no_input" | "canceled";
  result?: {
    role: "merchant" | "buyer";
    invoice?: InvoiceDraft;
    intent?: "pay";
  };
};

const MAX_DURATION_MS = 5 * 60_000;
// Saaras sends one transcript per spoken segment, ~0.6 s after it ends. The
// turn ends this long after the latest one, unless the caller is still
// talking (see maybeEndTurn). Was a blind 1.1 s, which was both slow and
// split one sentence with a pause in it into two turns.
const UTTERANCE_SILENCE_MS = Number(process.env.BOLO_TURN_SILENCE_MS ?? 400);
/** The caller counts as still talking if their voice was heard this recently. */
const STILL_TALKING_MS = 450;
/** Wait at most this long for the words of speech heard after the last transcript. */
const MAX_TRANSCRIPT_WAIT_MS = 2500;

/*
 * Half-duplex, by design: while Bolo speaks she does not listen. Mic frames
 * that arrive during her playback (plus a short tail, so her own voice
 * echoing back from the speaker isn't heard) are replaced with silence
 * before Saaras sees them. No barge-in: it used to fire on that echo and cut
 * Bolo off mid-sentence.
 */
const ECHO_TAIL_MS = 400;

/*
 * "Listen to the loudest voice": a gate that follows the main speaker. It
 * tracks the recent peak level of the person at the mic and passes only
 * frames within ~10 dB of it; quieter voices in the room (and fan/street
 * noise) become silence. A short hangover keeps word endings intact.
 */
const NOISE_FLOOR = 0.012; // RMS below this is never speech
const GATE_RATIO = 0.35; // pass frames ≥ 35% of the speaker's recent peak (~-9 dB)
// The peak relaxes so a genuinely quieter speaker isn't locked out — but only
// while sound is actually arriving. Silence (Bolo thinking, Bolo talking, the
// caller pausing) says nothing about how loud the caller is, so it must not
// lower the bar; otherwise a quiet voice slips in right after a pause.
const PEAK_HALF_LIFE_MS = 6000; // of audible audio, not wall-clock time
const GATE_HANGOVER_MS = 350;
const GATE_PREROLL_MS = 250; // look-ahead, so a word's soft onset isn't clipped

/*
 * Smooth playback: 100 ms packets, kept ~300 ms ahead of real time so the
 * browser always has audio queued. 20 ms packets on a setTimeout loop were
 * jittery enough to starve the player, which is why Bolo stuttered.
 */
const PACKET_MS = 100;
const PREBUFFER_MS = 300;

type Wire = { send: (s: string) => void; close: (code?: number) => void };

export class BoloSession {
  /** The id the server issued for this session — the callback must report it, not a fresh one. */
  readonly id: string;
  private startedAt = Date.now();
  private stt: WebSocket | null = null;
  /** Lines queued or being sent; Bolo is "speaking" while any are pending… */
  private pendingSays = 0;
  /** …and until her last line has finished playing, plus the echo tail. */
  private speakingUntil = 0;
  private synthQueue: Promise<void> = Promise.resolve();
  /** Loudest-voice gate state. */
  private voicePeak = 0;
  /** Audio-time (ms of mic audio received) and the gate's look-ahead queue. */
  private audioMs = 0;
  private lastLoudEnd = -Infinity;
  private delayLine: { pcm: Buffer; start: number; end: number; loud: boolean; muted: boolean }[] = [];
  private utterance = "";
  /** Wall-clock times of the caller's last audible speech and of the last transcript piece. */
  private lastVoiceAt = 0;
  private lastTranscriptAt = 0;
  private utterTimer: NodeJS.Timeout | null = null;
  /** The invoice so far: pieces said across turns add up. */
  private draft: InvoiceDraft = { buyerName: null, amountInr: null, dueDays: null, note: null };
  /** What Bolo asked last: a read-back she wants checked, or "pay?" for the buyer. */
  private awaiting: "check" | "pay" | null = null;
  /** Buyer sessions: the amount has been read out, so a "haan"/"bhar do" can pay straight away. */
  private amountHeard = false;
  private transcript: { who: "bolo" | "merchant" | "buyer"; text: string }[] = [];
  private busy = false;
  private ended = false;
  private maxTimer: NodeJS.Timeout;

  /**
   * `inRate`: the mic audio's sample rate (16 kHz from current browsers, 8 kHz
   * from older clients). `outRate`: what Bolo's voice is sent at; 24 kHz only
   * for clients that said they can play it, else 8 kHz as before.
   */
  constructor(
    private wire: Wire,
    readonly issuedId: string,
    private script: Script,
    private callbackUrl: string | null,
    private onEnded: (result: CallbackResult) => void,
    private inRate = 8000,
    private outRate = 8000,
  ) {
    this.id = issuedId;
    this.maxTimer = setTimeout(() => void this.end({ status: "no_input" }, "समय हो गया।"), MAX_DURATION_MS);
  }

  /** The `start` event arrived and the token checked out: open the STT stream and greet. */
  begin() {
    if (!sarvamReady()) {
      this.caption("bolo", "Bolo ka Sarvam key set nahi hai.");
      void this.end({ status: "failed" });
      return;
    }
    warmSpeech();
    this.openStt();
    const greeting =
      this.script.role === "merchant"
        ? "नमस्ते! मैं बोलो हूँ। बताइए, किसका बिल बनाना है और कितने का?"
        : "नमस्ते! मैं बोलो हूँ। बिल के बारे में पूछिए, या बोलिए तो भर दूँ।";
    this.say(greeting);
  }

  /** True while Bolo has lines queued, or her last line is still playing (+ echo tail). */
  private isSpeaking(): boolean {
    return this.pendingSays > 0 || Date.now() < this.speakingUntil;
  }

  /**
   * Mic audio from the browser (base64 PCM16 8 kHz). Every frame still goes
   * to Saaras — the stream must stay continuous — but as silence unless it
   * is the main speaker talking while Bolo is quiet.
   */
  onMedia(payload: string) {
    if (this.ended || !this.stt || this.stt.readyState !== WebSocket.OPEN) return;
    const pcm = Buffer.from(payload, "base64");
    const ms = (pcm.length / 2 / this.inRate) * 1000;
    // Muted frames (Bolo talking, or her echo tail) never pass, whatever their level.
    const muted = this.isSpeaking();
    const loud = !muted && this.isMainVoice(pcm, ms);
    if (loud) this.lastVoiceAt = Date.now();
    const start = this.audioMs;
    this.audioMs += ms;
    this.delayLine.push({ pcm, start, end: this.audioMs, loud, muted });
    this.flushDelayLine();
  }

  /**
   * The gate decides each frame GATE_PREROLL_MS late, by audio time (not wall
   * clock, so bursty network arrival can't skew it). That look-ahead lets the
   * soft onset of a word — the "h" of "हाँ" — through when loud speech follows,
   * instead of clipping it; the hangover keeps word endings.
   */
  private flushDelayLine() {
    for (;;) {
      const next = this.delayLine[0];
      if (!next || next.end > this.audioMs - GATE_PREROLL_MS) break;
      const head = this.delayLine.shift()!;
      if (head.loud) this.lastLoudEnd = head.end;
      const loudAhead = this.delayLine.some((f) => f.loud && f.start - head.end < GATE_PREROLL_MS);
      const inHangover = head.start - this.lastLoudEnd < GATE_HANGOVER_MS;
      const pass = !head.muted && (head.loud || loudAhead || inHangover);
      const data = pass ? head.pcm.toString("base64") : Buffer.alloc(head.pcm.length).toString("base64");
      this.stt!.send(JSON.stringify({ audio: { data, encoding: "audio/wav", sample_rate: this.inRate } }));
    }
  }

  /** Loudest-voice test: is this frame the person at the mic (not a quieter voice behind them)? */
  private isMainVoice(pcm: Buffer, ms: number): boolean {
    const n = pcm.length >> 1;
    if (!n) return false;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const s = pcm.readInt16LE(i * 2) / 0x8000;
      sum += s * s;
    }
    const level = Math.sqrt(sum / n);
    // Only audible frames move the peak: they raise it, and they slowly relax it.
    if (level > NOISE_FLOOR) {
      this.voicePeak *= Math.pow(0.5, ms / PEAK_HALF_LIFE_MS);
      this.voicePeak = Math.max(this.voicePeak, level);
    }
    return level > NOISE_FLOOR && level >= this.voicePeak * GATE_RATIO;
  }

  /** The browser echoes our mark when its playback really reaches it: the truest "done speaking". */
  onMark(name: string) {
    if (name === "bolo_done" && this.pendingSays === 0) this.speakingUntil = Date.now() + ECHO_TAIL_MS;
  }

  /** `clear` from the browser: its playback was flushed (hang-up), so she isn't speaking. */
  onClear() {
    this.speakingUntil = 0;
  }

  stop() {
    void this.end({ status: "canceled" });
  }

  /* ── STT stream ── */

  private openStt() {
    const stt = new WebSocket(sttUrl(this.inRate), { headers: { "api-subscription-key": process.env.SARVAM_API_KEY!.trim() } });
    this.stt = stt;
    stt.on("open", () => {
      // One WAV header up front; every later frame is raw PCM appended to it —
      // as far as Saaras is concerned it is decoding one long WAV.
      stt.send(JSON.stringify({ audio: { data: wavHeader(this.inRate).toString("base64"), encoding: "audio/wav", sample_rate: this.inRate } }));
    });
    let sawData = false;
    stt.on("message", (raw: WebSocket.RawData) => {
      let msg: { type?: string; data?: { transcript?: string } };
      try {
        msg = JSON.parse(raw.toString()) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === "data" && typeof msg.data?.transcript === "string" && msg.data.transcript.trim()) {
        sawData = true;
        // Half-duplex: nothing heard while Bolo is talking counts as a turn.
        if (this.isSpeaking()) return;
        const text = msg.data.transcript.trim();
        // Each message is a new segment, not a revision: "रमेश के लिए।" then
        // "₹500 का invoice बनाओ।". Replacing (as this used to) lost the name.
        this.utterance = this.utterance ? `${this.utterance} ${text}` : text;
        this.caption(this.script.role, this.utterance);
        this.lastTranscriptAt = Date.now();
        this.scheduleTurn(UTTERANCE_SILENCE_MS);
      }
    });
    stt.on("close", (code: number, reason: Buffer) => {
      console.log(`[bolo] stt closed: code=${code} reason=${reason.toString().slice(0, 120)} sawData=${sawData}`);
      if (!this.ended && !sawData) this.end({ status: "failed" });
    });
    stt.on("error", (e: Error) => {
      console.error(`[bolo] stt error: ${e.message}`);
      stt.close();
    });
  }

  private scheduleTurn(ms: number) {
    if (this.utterTimer) clearTimeout(this.utterTimer);
    this.utterTimer = setTimeout(() => this.maybeEndTurn(), ms);
  }

  /**
   * End the caller's turn only once they've really stopped: not while their
   * voice is still coming in, and not while speech heard after the last
   * transcript piece is still being transcribed ("रमेश के लिए … पाँच सौ").
   */
  private maybeEndTurn() {
    const now = Date.now();
    const talking = now - this.lastVoiceAt < STILL_TALKING_MS;
    const wordsComing = this.lastVoiceAt > this.lastTranscriptAt && now - this.lastVoiceAt < MAX_TRANSCRIPT_WAIT_MS;
    if (talking || wordsComing) return this.scheduleTurn(150);
    void this.onUtterance();
  }

  /** The caller stopped talking: answer. */
  private async onUtterance() {
    const said = this.utterance.trim();
    if (!said || this.busy || this.ended || this.isSpeaking()) return;
    this.utterance = "";
    this.busy = true;
    const t0 = Date.now();
    try {
      if (this.script.role === "merchant") await this.merchantTurn(said);
      else await this.buyerTurn(said);
    } catch (err) {
      this.caption("bolo", `माफ़ कीजिए — ${(err as Error).message.slice(0, 80)}`);
      this.say("माफ़ कीजिए, कुछ गड़बड़ हुई। फिर बोलिए।");
    } finally {
      this.busy = false;
      this.transcript.push({ who: this.script.role, text: said });
      console.log(`[bolo] turn ${Date.now() - t0} ms: "${said.slice(0, 80)}"`);
    }
  }

  /* ── merchant brain ── */

  private async merchantTurn(said: string) {
    const turn = await understandMerchant({
      draft: this.draft,
      transcript: this.transcript as { who: "bolo" | "merchant"; text: string }[],
      said,
    });
    this.draft = turn.draft;
    const d = this.draft;
    const amount = d.amountInr ? `${d.amountInr.toLocaleString("en-IN")} रुपये` : "";
    switch (turn.action) {
      case "create": {
        this.awaiting = null;
        // No separate yes/no round: the read-back IS the confirmation, said as it's made.
        const readBack = `${d.buyerName} के लिए ${amount} का बिल${d.dueDays ? `, ${d.dueDays} दिन में` : ""} बना दिया।`;
        await this.end({ status: "completed", result: { role: "merchant", invoice: { ...d } } }, readBack, readBack);
        return;
      }
      case "confirm":
        this.awaiting = "check";
        this.say(`${d.buyerName} के लिए ${amount}, सही सुना?`);
        return;
      case "cancel":
        this.awaiting = null;
        this.say("ठीक है, नहीं बनाया। किसी और का बिल बनाना हो तो बताइए।");
        return;
      case "chitchat":
        this.say(turn.reply ?? "जी। बिल किसका बनाना है, और कितने का?");
        return;
      case "ask":
      default:
        this.awaiting = null;
        if (!d.buyerName && !d.amountInr) this.say("किसका बिल बनाना है, और कितने का?");
        else if (!d.buyerName) this.say(`${amount} का बिल किसके नाम बनाऊँ?`);
        else this.say(`${d.buyerName} का बिल कितने रुपये का बनाऊँ?`);
    }
  }

  /* ── buyer brain ── */

  private status: { status: string; buyer: string; amountPaise: number } | null | undefined;

  private async buyerTurn(said: string) {
    const [turn, s] = await Promise.all([
      understandBuyer({ transcript: this.transcript as { who: "bolo" | "buyer"; text: string }[], said }),
      this.status === undefined ? this.readStatus() : Promise.resolve(this.status),
    ]);
    this.status = s;
    const amount = s ? `${Math.round(s.amountPaise / 100).toLocaleString("en-IN")} रुपये` : "";
    const pay = async () => {
      this.awaiting = null;
      await this.end({ status: "completed", result: { role: "buyer", intent: "pay" } }, `ठीक है, ${amount} भर रही हूँ।`);
    };
    if (s?.status === "paid" && turn.action !== "chitchat") {
      this.say("यह बिल पहले ही भरा जा चुका है। धन्यवाद!");
      return;
    }
    switch (turn.action) {
      case "pay":
        // Money moves: pay at once only if they've heard the amount; otherwise say it first.
        if (this.amountHeard && s) return pay();
        if (!s) return this.say("बिल नहीं मिला — लिंक दोबारा चेक कीजिए।");
        this.amountHeard = true;
        this.awaiting = "pay";
        return this.say(`${s.buyer} जी, ${amount} भरने हैं। भर दूँ?`);
      case "yes":
        if (this.awaiting === "pay" && s) return pay();
        return this.say(s ? `${amount} का बिल है। भर दूँ?` : "बिल नहीं मिला — लिंक दोबारा चेक कीजिए।", () => {
          if (s) (this.amountHeard = true), (this.awaiting = "pay");
        });
      case "no":
        this.awaiting = null;
        return this.say("ठीक है, अभी नहीं भरती। और कुछ?");
      case "amount":
      case "status":
        if (!s) return this.say("बिल नहीं मिला — लिंक दोबारा चेक कीजिए।");
        this.amountHeard = true;
        this.awaiting = "pay";
        return this.say(`${s.buyer} जी, आपके ${amount} बाकी हैं। भर दूँ?`);
      default:
        return this.say(turn.reply ?? "जी। बिल के बारे में पूछिए, या बोलिए तो भर दूँ।");
    }
  }

  private async readStatus(): Promise<{ status: string; buyer: string; amountPaise: number } | null> {
    if (!this.script.statusUrl) return null;
    try {
      const res = await fetch(this.script.statusUrl, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return null;
      return (await res.json()) as { status: string; buyer: string; amountPaise: number };
    } catch {
      return null;
    }
  }

  /* ── speaking: Bulbul → PCM16 8 kHz → media events + captions ── */

  private say(text: string, after?: () => void) {
    this.caption("bolo", text);
    this.transcript.push({ who: "bolo", text });
    this.pendingSays++;
    // Anything half-heard before she starts talking is dropped, not answered later.
    this.utterance = "";
    if (this.utterTimer) clearTimeout(this.utterTimer);
    // Start synthesising now (streamed: audio arrives while the rest is still
    // being made), even if an earlier line is still being sent.
    const rate = this.outRate;
    const chunks: Buffer[] = [];
    let done = false;
    let wake: (() => void) | null = null;
    const poke = () => wake?.();
    void streamSpeech(text, rate, (pcm) => {
      chunks.push(pcm);
      poke();
    })
      .catch((err: Error) => console.error(`[bolo] tts failed: ${err.message}`))
      .finally(() => {
        done = true;
        poke();
      });
    const more = () =>
      new Promise<void>((r) => {
        wake = r;
        if (chunks.length || done) r();
      });

    this.synthQueue = this.synthQueue.then(async () => {
      try {
        const bytesPerPacket = (rate * 2 * PACKET_MS) / 1000;
        let pending = Buffer.alloc(0);
        let t0 = 0;
        let sentMs = 0;
        for (let i = 0; ; ) {
          await more();
          wake = null;
          if (chunks.length) pending = Buffer.concat([pending, ...chunks.splice(0)]);
          // Whole 100 ms packets as they fill; the last, short one once synthesis is done.
          while (pending.length >= bytesPerPacket || (done && !chunks.length && pending.length > 0)) {
            const packet = pending.subarray(0, Math.min(bytesPerPacket, pending.length));
            pending = pending.subarray(packet.length);
            if (!t0) t0 = Date.now();
            // Packet i is due at t0 + i·100 ms; send each PREBUFFER_MS early, so the
            // browser's queue never runs dry. The schedule is absolute, so timer
            // jitter can't accumulate into gaps.
            const wait = t0 + i * PACKET_MS - PREBUFFER_MS - Date.now();
            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
            this.wire.send(JSON.stringify({ event: "media", media: { payload: packet.toString("base64"), sample_rate: rate } }));
            i++;
            sentMs += (packet.length / 2 / rate) * 1000;
            // The mic stays muted until this line has finished playing, plus the echo tail.
            this.speakingUntil = Math.max(this.speakingUntil, t0 + sentMs + ECHO_TAIL_MS);
            if (chunks.length) pending = Buffer.concat([pending, ...chunks.splice(0)]);
          }
          if (done && !chunks.length && !pending.length) break;
        }
        this.wire.send(JSON.stringify({ event: "mark", mark: { name: "bolo_done" } }));
        after?.();
      } finally {
        this.pendingSays--;
      }
    });
  }

  private caption(role: "bolo" | "merchant" | "buyer", text: string) {
    this.wire.send(JSON.stringify({ event: "bolo_caption", role, text }));
  }

  /* ── ending: signed callback, then close ── */

  /** `lead`: a line that must be said whatever the app replies (the merchant's read-back). */
  private async end(result: CallbackResult, fallbackReply?: string, lead?: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.maxTimer);
    if (this.utterTimer) clearTimeout(this.utterTimer);
    this.stt?.close();
    let reply = fallbackReply;
    if (this.callbackUrl && result.status !== "failed") {
      const fromApp = await this.callback(result);
      if (fromApp) reply = lead && fromApp !== lead ? `${lead} ${fromApp}` : fromApp;
    }
    if (reply) this.say(reply);
    // Let the closing line play before the socket drops.
    await this.synthQueue;
    setTimeout(() => this.wire.close(1000), 1_500);
    this.onEnded(result);
  }

  private async callback(result: CallbackResult): Promise<string | null> {
    if (!this.callbackUrl) return null;
    const body = JSON.stringify({
      session_id: this.id,
      status: result.status,
      started_at: new Date(this.startedAt).toISOString(),
      ended_at: new Date().toISOString(),
      result: result.result,
    });
    const { sign } = await import("./hmac");
    const ts = String(Math.floor(Date.now() / 1000));
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(this.callbackUrl, {
          method: "POST",
          headers: { "content-type": "application/json", "X-Bolo-Timestamp": ts, "X-Bolo-Signature": sign(ts, body) },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as { reply?: string };
          return data.reply ?? null;
        }
      } catch (err) {
        console.error(`[bolo] callback attempt ${attempt} failed: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, attempt * 2_000));
    }
    return null;
  }
}
