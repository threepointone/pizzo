export type PitchResult = {
  /** Detected fundamental in Hz, or -1 if none. */
  freq: number;
  /** RMS level of the frame (0..~1). */
  rms: number;
  /** Confidence 0..1 (autocorrelation peak ratio). */
  clarity: number;
};

const MIN_FREQ = 50;
const MAX_FREQ = 1200;

/**
 * Autocorrelation pitch detection over one time-domain frame. Restricted to a
 * musical lag range for speed. Returns freq=-1 when the frame is too quiet or
 * too noisy to call.
 */
function detectPitch(buf: Float32Array, sampleRate: number): PitchResult {
  const size = buf.length;
  let rms = 0;
  for (let i = 0; i < size; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / size);
  if (rms < 0.01) return { freq: -1, rms, clarity: 0 };

  const minLag = Math.floor(sampleRate / MAX_FREQ);
  const maxLag = Math.min(size - 1, Math.ceil(sampleRate / MIN_FREQ));

  const c0 = (() => {
    let s = 0;
    for (let i = 0; i < size; i++) s += buf[i] * buf[i];
    return s || 1;
  })();

  let bestLag = -1;
  let bestVal = 0;
  let prev = 0;
  let descended = false;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < size - lag; i++) sum += buf[i] * buf[i + lag];
    // Wait for the correlation to dip below the zero-lag peak before hunting,
    // so we don't lock onto lag≈0.
    if (!descended) {
      if (sum < prev) descended = true;
      prev = sum;
      continue;
    }
    if (sum > bestVal) {
      bestVal = sum;
      bestLag = lag;
    }
    prev = sum;
  }

  if (bestLag < 0) return { freq: -1, rms, clarity: 0 };
  const clarity = bestVal / c0;
  return { freq: sampleRate / bestLag, rms, clarity };
}

/**
 * Streams mic/instrument input through an analyser and reports pitch + level
 * each animation frame. Its own AudioContext, independent of playback engines.
 */
export class PitchTracker {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> = new Float32Array(2048);
  private raf = 0;
  private running = false;

  onResult: ((r: PitchResult) => void) | null = null;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buf = new Float32Array(this.analyser.fftSize);
    source.connect(this.analyser);
    this.running = true;
    this.loop();
  }

  private loop = (): void => {
    if (!this.running || !this.analyser || !this.ctx) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    this.onResult?.(detectPitch(this.buf, this.ctx.sampleRate));
    this.raf = requestAnimationFrame(this.loop);
  };

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
  }
}

/** Nearest MIDI note for a frequency. */
export function freqToMidi(freq: number): number {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}
