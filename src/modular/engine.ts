import WebRenderer from "@elemaudio/web-renderer";
import { compilePatch, type Voice } from "./compile";
import type { Patch } from "./types";

const midiToFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

const POLYPHONY = 8;

type VoiceSlot = {
  /** MIDI note currently sounding, or null if free/releasing. */
  note: number | null;
  freq: number;
  gate: number;
  /** Allocation order, for voice stealing. */
  age: number;
};

/**
 * Drives the modular surface through Elementary. Holds its own AudioContext
 * (separate from the Chord Lab's Tone.js engine) and a WebRenderer. The current
 * patch compiles to a declarative graph; note input updates voice `freq`/`gate`
 * and re-renders — Elementary diffs and reconciles cheaply.
 *
 * Polyphonic: a fixed pool of `POLYPHONY` voice slots, each compiled as its own
 * subgraph. Notes are allocated to free slots (stealing the oldest when full).
 */
class ModularEngine {
  private ctx: AudioContext | null = null;
  private core: WebRenderer | null = null;
  private ready = false;
  private starting: Promise<void> | null = null;

  private patch: Patch | null = null;
  private voices: VoiceSlot[] = Array.from({ length: POLYPHONY }, () => ({
    note: null,
    freq: 0,
    gate: 0,
    age: 0,
  }));
  private clock = 0;

  async ensureStarted(): Promise<void> {
    if (this.ready) {
      if (this.ctx && this.ctx.state !== "running") await this.ctx.resume();
      return;
    }
    if (!this.starting) this.starting = this.boot();
    await this.starting;
  }

  private async boot(): Promise<void> {
    const ctx = new AudioContext();
    const core = new WebRenderer();
    const node = await core.initialize(ctx, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.connect(ctx.destination);
    this.ctx = ctx;
    this.core = core;
    this.ready = true;
    await ctx.resume();
    this.renderNow();
  }

  setPatch(patch: Patch): void {
    this.patch = patch;
    this.renderNow();
  }

  private renderNow(): void {
    if (!this.core || !this.patch) return;
    const voices: Voice[] = this.voices.map((v) => ({ freq: v.freq, gate: v.gate }));
    const sampleRate = this.ctx?.sampleRate ?? 44100;
    const { left, right } = compilePatch(this.patch, voices, sampleRate);
    void this.core.render(left, right);
  }

  noteOn(midi: number): void {
    // Re-use a slot already sounding this note, else a free slot, else steal oldest.
    let slot = this.voices.find((v) => v.note === midi) ?? this.voices.find((v) => v.note === null);
    if (!slot) {
      slot = this.voices.reduce((oldest, v) => (v.age < oldest.age ? v : oldest));
    }
    slot.note = midi;
    slot.freq = midiToFreq(midi);
    slot.gate = 1;
    slot.age = ++this.clock;
    void this.ensureStarted().then(() => this.renderNow());
  }

  noteOff(midi: number): void {
    for (const v of this.voices) {
      if (v.note === midi) {
        v.note = null;
        v.gate = 0; // keep freq for the release tail
      }
    }
    this.renderNow();
  }

  allNotesOff(): void {
    for (const v of this.voices) {
      v.note = null;
      v.gate = 0;
    }
    this.renderNow();
  }
}

export const modularEngine = new ModularEngine();
