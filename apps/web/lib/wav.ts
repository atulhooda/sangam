"use client";

/*
 * Mic → 16 kHz mono WAV, no dependencies. Sarvam's Saaras takes common
 * formats, but MediaRecorder's container/codec differs per browser; asking
 * the AudioContext for 16 kHz PCM and encoding the WAV ourselves makes the
 * upload identical everywhere (and small: ~32 KB/s).
 */

const TARGET_RATE = 16_000;

export class WavRecorder {
  private ctx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private chunks: Float32Array[] = [];

  async start(): Promise<void> {
    this.chunks = [];
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    // Some browsers ignore the sampleRate hint, so we downsample manually below.
    this.ctx = new AudioContext({ sampleRate: TARGET_RATE });
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(input));
    };
    source.connect(this.processor);
    // ScriptProcessor needs a destination to pull samples; mute it so nothing echoes.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.processor.connect(mute);
    mute.connect(this.ctx.destination);
  }

  /** Stop and return the recording as a WAV blob (or null if nothing was said). */
  async stop(): Promise<Blob | null> {
    this.processor && (this.processor.onaudioprocess = null);
    this.stream?.getTracks().forEach((t) => t.stop());
    const sampleRate = this.ctx?.sampleRate ?? TARGET_RATE;
    this.processor?.disconnect();
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.processor = null;
    this.stream = null;
    const pcm = this.chunks;
    this.chunks = [];
    const length = pcm.reduce((n, c) => n + c.length, 0);
    if (length < TARGET_RATE / 4) return null; // under 250 ms of audio
    return new Blob([encodeWav(flatResample(pcm, sampleRate), TARGET_RATE)], { type: "audio/wav" });
  }
}

/** Concatenate chunks and, if the context ran at another rate, linear-resample to 16 kHz. */
function flatResample(chunks: Float32Array[], rate: number): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  if (rate === TARGET_RATE) {
    const out = new Float32Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
  const raw = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    raw.set(c, at);
    at += c.length;
  }
  const ratio = rate / TARGET_RATE;
  const out = new Float32Array(Math.floor(total / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const frac = pos - j;
    const a = raw[j] ?? 0;
    const b = raw[j + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let at = 44;
  for (let i = 0; i < samples.length; i++, at += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}
