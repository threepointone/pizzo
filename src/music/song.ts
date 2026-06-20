import { Chord, Note, Scale } from "@tonaljs/tonal";
import { defaultVoice } from "../modular/registry";
import type { Patch } from "../modular/types";
import { diatonicDegree, guessKey, keyTheory } from "./theory";

export * from "./theory";

export type BassStyle = "root" | "octaves" | "rootFifth" | "offbeat" | "walking";
export type DrumStyle = "fourOnFloor" | "rock" | "funk" | "lofi" | "halftime";
export type DrumVoice = "kick" | "snare" | "hat" | "openhat" | "clap";
export type MelodyStyle = "arp" | "flowing" | "pop" | "ballad";

export const BASS_STYLES: { id: BassStyle; label: string }[] = [
  { id: "root", label: "Roots" },
  { id: "octaves", label: "Octaves" },
  { id: "rootFifth", label: "Root + 5th" },
  { id: "offbeat", label: "Offbeat" },
  { id: "walking", label: "Walking" },
];

export const DRUM_STYLES: { id: DrumStyle; label: string }[] = [
  { id: "fourOnFloor", label: "Four-on-floor" },
  { id: "rock", label: "Rock" },
  { id: "funk", label: "Funk" },
  { id: "lofi", label: "Lo-fi" },
  { id: "halftime", label: "Half-time" },
];

export const MELODY_STYLES: { id: MelodyStyle; label: string }[] = [
  { id: "arp", label: "Arpeggio" },
  { id: "flowing", label: "Flowing" },
  { id: "pop", label: "Pop hook" },
  { id: "ballad", label: "Ballad" },
];

export type BassSettings = { enabled: boolean; style: BassStyle; octave: number };
export type DrumSettings = { enabled: boolean; style: DrumStyle; busy: number };
export type MelodySettings = {
  enabled: boolean;
  style: MelodyStyle;
  instrument: string;
  /** Seed for the deterministic generator; bump it to "regenerate". */
  seed: number;
};

/**
 * One labelled chunk of a song (verse, chorus, bridge…). It carries its own
 * progression + how many times it repeats, plus per-section voice toggles so
 * arrangements can build dynamics (e.g. verse = chords+bass, chorus = the works).
 * The sonic palette (drum/bass/melody styles, instruments, tempo) stays global.
 */
export type Section = {
  id: string;
  name: string;
  chords: string[];
  repeats: number;
  drums: boolean;
  bass: boolean;
  melody: boolean;
  /** Drum density override (0..1) for this section. */
  busy: number;
};

/** An ordered list of sections — the song timeline. Off ⇒ single-loop behavior. */
export type Arrangement = {
  enabled: boolean;
  sections: Section[];
  /** Section id currently selected for editing in the Chord Lab. */
  current: string | null;
};

/** Per-track mixer channel: linear volume (0..1) plus mute/solo flags. */
export type TrackMix = { volume: number; mute: boolean; solo: boolean };

/** The whole band's mixer: one channel per role + a master fader (0..1). */
export type Mix = {
  chords: TrackMix;
  bass: TrackMix;
  drums: TrackMix;
  melody: TrackMix;
  master: number;
};

/**
 * Groove feel applied at playback time (not baked into the generators):
 * - `swing` (0..1) delays every other 8th note for a shuffle.
 * - `humanize` (0..1) jitters timing + velocity so it doesn't sound robotic.
 */
export type Groove = { swing: number; humanize: number };

/** Number of steps in the beat-machine grid (one bar of 16ths). */
export const SEQ_STEPS = 16;
/** Voices shown as rows in the step sequencer, top → bottom. */
export const BEAT_VOICES: DrumVoice[] = ["hat", "openhat", "clap", "snare", "kick"];

/** A hand-editable drum pattern (overrides the style groove when enabled). */
export type Beat = {
  enabled: boolean;
  steps: number;
  rows: Record<DrumVoice, boolean[]>;
};

/** A single percussion hit on the 16th-note grid. */
export type DrumHit = {
  voice: DrumVoice;
  /** Start time in quarter-note beats from the top of the loop. */
  startBeat: number;
  velocity: number;
};

/**
 * Two representations:
 *
 * - `SongState` is the lightweight, shareable source of truth. It lives in the
 *   agent's broadcast `state` (and persists in the Durable Object), so the
 *   chat agent and every connected browser see the same song. It stores chord
 *   *names* so it round-trips cleanly.
 * - `SongDoc` (+ Track/Clip/NoteEvent) is the engine-facing structure derived
 *   from `SongState`: concrete MIDI notes the Tone.js engine schedules.
 */

export type SongState = {
  /** Chord progression as names, e.g. ["Am", "F", "C", "G"]. One per bar. */
  chords: string[];
  tempo: number;
  key: string;
  scale: string;
  /** Loop length in bars (4/4). */
  loopBars: number;
  /** Whether the transport should be running. Mirrored to the engine. */
  playing: boolean;
  /** Loop the song forever (true) or play through once and stop (false). */
  loopSong: boolean;
  /** General-MIDI instrument name for the chords track (smplr soundfont). */
  instrument: string;
  /** Generated bassline that follows the chord roots. */
  bass: BassSettings;
  /** Generated drum groove. */
  drums: DrumSettings;
  /** Generated lead/melody line over the chords. */
  melody: MelodySettings;
  /** Hand-programmed step pattern (beat machine surface). */
  beat: Beat;
  /** Song timeline. When enabled, sections drive playback instead of `chords`. */
  arrangement: Arrangement;
  /** Per-track volume / mute / solo + master level. */
  mix: Mix;
  /** Swing + humanize feel, applied live by the engine. */
  groove: Groove;
  /** Modular-surface synth patch (node graph). Shared/persisted like the rest. */
  patch: Patch;
};

export type NoteEvent = {
  /** MIDI note number (60 = middle C). */
  midi: number;
  /** Start time in quarter-note beats from the top of the loop. */
  startBeat: number;
  /** Duration in quarter-note beats. */
  durationBeats: number;
  /** 0..1 */
  velocity: number;
};

export type Clip = { notes: NoteEvent[] };
export type TrackRole = "chords" | "bass" | "drums" | "melody";
export type Track = {
  id: string;
  name: string;
  role: TrackRole;
  instrument: string;
  clips: Clip[];
};
export type SongDoc = {
  tempo: number;
  key: string;
  scale: string;
  loopBars: number;
  instrument: string;
  tracks: Track[];
  /** Percussion hits, rendered by the engine's synth drum kit. */
  drumHits: DrumHit[];
  /** Loop forever (true/undefined) or play once and stop (false). */
  loop: boolean;
};

/** Special instrument id: route the chords through the Modular synth patch. */
export const MODULAR_VOICE_ID = "modular_voice";

/**
 * Instruments offered in the UI picker. The GM ids are valid smplr soundfont
 * names; `modular_voice` is special-cased to play through the modular patch.
 */
export const INSTRUMENTS: { id: string; label: string }[] = [
  { id: "acoustic_grand_piano", label: "Grand Piano" },
  { id: "electric_piano_1", label: "Electric Piano" },
  { id: "rock_organ", label: "Organ" },
  { id: "acoustic_guitar_nylon", label: "Nylon Guitar" },
  { id: "vibraphone", label: "Vibraphone" },
  { id: "string_ensemble_1", label: "Strings" },
  { id: "pad_2_warm", label: "Warm Pad" },
  { id: "choir_aahs", label: "Choir" },
  { id: MODULAR_VOICE_ID, label: "Modular Synth" },
];

export const BEATS_PER_BAR = 4;

/** Voice a chord into ascending MIDI notes. Returns [] for unparseable input. */
export function chordToMidi(chordName: string, baseOctave = 4): number[] {
  const chord = Chord.get(chordName);
  if (chord.empty || chord.notes.length === 0) return [];

  const midis: number[] = [];
  let octave = baseOctave;
  let prevChroma = -1;
  for (const pc of chord.notes) {
    const chroma = Note.chroma(pc);
    if (chroma == null) continue;
    if (chroma <= prevChroma) octave += 1;
    prevChroma = chroma;
    const midi = Note.midi(`${pc}${octave}`);
    if (midi != null) midis.push(midi);
  }
  return midis;
}

/** One chord per bar → a single chords clip. */
export function progressionToClip(chords: string[]): Clip {
  const notes: NoteEvent[] = [];
  chords.forEach((name, bar) => {
    for (const midi of chordToMidi(name)) {
      notes.push({
        midi,
        startBeat: bar * BEATS_PER_BAR,
        durationBeats: BEATS_PER_BAR,
        velocity: 0.7,
      });
    }
  });
  return { notes };
}

/** MIDI for a pitch class at the given octave (e.g. "C", 2 → 36). */
function pcMidi(pc: string, octave: number): number | null {
  return Note.midi(`${pc}${octave}`);
}

/**
 * Generate a bassline from the chord roots, one bar per chord. Deterministic;
 * `walking` leads chromatically toward the next bar's root.
 */
export function generateBass(chords: string[], style: BassStyle, octave: number): NoteEvent[] {
  const notes: NoteEvent[] = [];
  const roots = chords.map((name) => {
    const c = Chord.get(name);
    return c.tonic ? pcMidi(c.tonic, octave) : null;
  });

  chords.forEach((name, bar) => {
    const root = roots[bar];
    if (root == null) return;
    const c = Chord.get(name);
    const base = bar * BEATS_PER_BAR;
    const at = (beat: number, midi: number, dur: number, vel = 0.85) =>
      notes.push({ midi, startBeat: base + beat, durationBeats: dur, velocity: vel });

    if (style === "root") {
      at(0, root, BEATS_PER_BAR);
    } else if (style === "octaves") {
      at(0, root, 2);
      at(2, root + 12, 2);
    } else if (style === "rootFifth") {
      at(0, root, 2);
      at(2, root + 7, 2);
    } else if (style === "offbeat") {
      for (let b = 0; b < BEATS_PER_BAR; b++) at(b + 0.5, root, 0.5, 0.75);
    } else if (style === "walking") {
      const third = c.notes[1] ? pcMidi(c.notes[1], octave) : null;
      const fifth = c.notes[2] ? pcMidi(c.notes[2], octave) : null;
      const nextRoot = roots[(bar + 1) % roots.length] ?? root;
      const approach = nextRoot + (nextRoot >= root ? -1 : 1); // chromatic lead-in
      const step = [root, third ?? root, fifth ?? root, approach];
      step.forEach((m, i) => at(i, m, 1, 0.8));
    }
  });
  return notes;
}

/** voice → 16th-step indices (per bar) for each drum pattern. */
const DRUM_PATTERNS: Record<DrumStyle, Partial<Record<DrumVoice, number[]>>> = {
  fourOnFloor: {
    kick: [0, 4, 8, 12],
    clap: [4, 12],
    hat: [2, 6, 10, 14],
    openhat: [6, 14],
  },
  rock: {
    kick: [0, 8, 10],
    snare: [4, 12],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
  },
  funk: {
    kick: [0, 3, 6, 10],
    snare: [4, 12],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
  },
  lofi: {
    kick: [0, 7],
    snare: [4, 12],
    hat: [0, 4, 8, 12],
  },
  halftime: {
    kick: [0],
    snare: [8],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
  },
};

const DRUM_VELOCITY: Record<DrumVoice, number> = {
  kick: 0.95,
  snare: 0.85,
  hat: 0.5,
  openhat: 0.5,
  clap: 0.75,
};

/**
 * Generate a looping drum groove. `busy` (0..1) adds 16th-note ghost hats
 * between the main hits for a busier feel.
 */
export function generateDrums(style: DrumStyle, bars: number, busy: number): DrumHit[] {
  const pattern = DRUM_PATTERNS[style];
  const hits: DrumHit[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const base = bar * BEATS_PER_BAR;
    for (const [voice, steps] of Object.entries(pattern) as [DrumVoice, number[]][]) {
      for (const step of steps) {
        hits.push({
          voice,
          startBeat: base + step * 0.25,
          velocity: DRUM_VELOCITY[voice],
        });
      }
    }
    // Ghost hats fill in the off-16ths as the groove gets busier.
    if (busy > 0) {
      const used = new Set(pattern.hat ?? []);
      const ghostSteps = busy >= 0.66 ? [1, 3, 5, 7, 9, 11, 13, 15] : [3, 7, 11, 15];
      for (const step of ghostSteps) {
        if (used.has(step)) continue;
        hits.push({ voice: "hat", startBeat: base + step * 0.25, velocity: 0.25 });
      }
    }
  }
  return hits;
}

/** Small deterministic PRNG (mulberry32) so a seed → the same melody. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** MIDI for a pitch class placed in the octave nearest a reference note. */
function pcNearest(pc: string, ref: number, lo = 55, hi = 86): number {
  const chroma = Note.chroma(pc);
  if (chroma == null) return ref;
  let best = ref;
  let bestDist = Infinity;
  for (let octave = 2; octave <= 7; octave++) {
    const midi = (octave + 1) * 12 + chroma;
    if (midi < lo || midi > hi) continue;
    const d = Math.abs(midi - ref);
    if (d < bestDist) {
      bestDist = d;
      best = midi;
    }
  }
  return best;
}

type Slot = { start: number; dur: number };
const slot = (start: number, dur: number): Slot => ({ start, dur });

/** A one-bar rhythm template for a melody style (some are randomized per bar). */
function melodyRhythm(style: MelodyStyle, rng: () => number): Slot[] {
  if (style === "arp") {
    return Array.from({ length: 8 }, (_, i) => slot(i * 0.5, 0.5));
  }
  if (style === "flowing") {
    return [slot(0, 1), slot(1, 0.5), slot(1.5, 0.5), slot(2, 1), slot(3, 0.5), slot(3.5, 0.5)];
  }
  if (style === "ballad") {
    return rng() < 0.5 ? [slot(0, 2), slot(2, 2)] : [slot(0, 3), slot(3, 1)];
  }
  // pop — pick one of a few catchy bars
  const options: Slot[][] = [
    [slot(0, 0.5), slot(0.5, 0.5), slot(1.5, 0.5), slot(2, 1), slot(3, 1)],
    [slot(0, 1), slot(1.5, 0.5), slot(2, 0.5), slot(2.5, 0.5), slot(3.5, 0.5)],
    [slot(0, 0.5), slot(1, 0.5), slot(1.5, 0.5), slot(2, 1), slot(3, 0.5), slot(3.5, 0.5)],
  ];
  return options[Math.floor(rng() * options.length)];
}

/** Pick a scale pitch class a step or two away from the previous note. */
function stepScalePc(scalePcs: string[], prevMidi: number, rng: () => number): string {
  if (scalePcs.length === 0) return "C";
  const prevChroma = ((prevMidi % 12) + 12) % 12;
  let idx = scalePcs.findIndex((pc) => Note.chroma(pc) === prevChroma);
  if (idx < 0) {
    // nearest scale degree by chroma distance
    let bestDist = Infinity;
    scalePcs.forEach((pc, i) => {
      const c = Note.chroma(pc);
      if (c == null) return;
      const d = Math.min(Math.abs(c - prevChroma), 12 - Math.abs(c - prevChroma));
      if (d < bestDist) {
        bestDist = d;
        idx = i;
      }
    });
  }
  const dir = rng() < 0.5 ? -1 : 1;
  const amount = rng() < 0.7 ? 1 : 2;
  const ni = (idx + dir * amount + scalePcs.length * 2) % scalePcs.length;
  return scalePcs[ni];
}

/**
 * Generate a singable lead line over the progression. Deterministic for a given
 * (chords, key, scale, style, seed): strong beats land on chord tones, weak
 * beats step through the scale, so it stays consonant and connected.
 */
export function generateMelody(
  chords: string[],
  key: string,
  scale: string,
  style: MelodyStyle,
  seed: number,
): NoteEvent[] {
  const tonic = key.split(" ")[0] || "C";
  let scalePcs = Scale.get(`${tonic} ${scale}`).notes;
  if (scalePcs.length === 0) scalePcs = Scale.get(`${tonic} major`).notes;

  const rng = mulberry32(seed);
  const notes: NoteEvent[] = [];
  let prev = 72; // around C5

  chords.forEach((name, bar) => {
    const chord = Chord.get(name);
    const chordPcs = chord.notes.length > 0 ? chord.notes : scalePcs;
    const base = bar * BEATS_PER_BAR;
    const rhythm = melodyRhythm(style, rng);
    let arpOctave = 5;

    rhythm.forEach((sl, i) => {
      const strong = Number.isInteger(sl.start);
      let midi: number;

      if (style === "arp") {
        const pc = chordPcs[i % chordPcs.length];
        if (i > 0 && i % chordPcs.length === 0) arpOctave += 1;
        if (arpOctave > 6) arpOctave = 5;
        midi = pcMidi(pc, arpOctave) ?? prev;
      } else if (style === "ballad") {
        const pc = i === 0 ? chordPcs[0] : (chordPcs[2] ?? chordPcs[chordPcs.length - 1]);
        midi = pcNearest(pc, prev);
      } else {
        const pc =
          strong || rng() < 0.4
            ? chordPcs[Math.floor(rng() * chordPcs.length)]
            : stepScalePc(scalePcs, prev, rng);
        midi = pcNearest(pc, prev);
      }

      const velocity = Math.min(1, (strong ? 0.82 : 0.66) + rng() * 0.1);
      notes.push({ midi, startBeat: base + sl.start, durationBeats: sl.dur, velocity });
      prev = midi;
    });
  });

  return notes;
}

/** An empty step-sequencer grid (all voices, all steps off). */
export function emptyBeat(): Beat {
  const rows = {} as Record<DrumVoice, boolean[]>;
  for (const v of BEAT_VOICES) rows[v] = Array(SEQ_STEPS).fill(false);
  return { enabled: false, steps: SEQ_STEPS, rows };
}

/** Render an editable beat grid into looping drum hits across all bars. */
export function beatToHits(beat: Beat, bars: number): DrumHit[] {
  const hits: DrumHit[] = [];
  const stepBeats = BEATS_PER_BAR / beat.steps;
  for (let bar = 0; bar < bars; bar++) {
    for (const voice of BEAT_VOICES) {
      const row = beat.rows[voice] ?? [];
      row.forEach((on, step) => {
        if (on) {
          hits.push({
            voice,
            startBeat: bar * BEATS_PER_BAR + step * stepBeats,
            velocity: DRUM_VELOCITY[voice],
          });
        }
      });
    }
  }
  return hits;
}

/**
 * Euclidean rhythm: distribute `pulses` as evenly as possible across `steps`,
 * then rotate. E(3,8) → "x..x..x." (tresillo), E(2,5) → "x..x.", etc. Always
 * lands a pulse on the downbeat (before rotation).
 */
export function euclid(pulses: number, steps: number, rotate = 0): boolean[] {
  const n = Math.max(1, Math.floor(steps));
  const k = Math.max(0, Math.min(n, Math.floor(pulses)));
  const base: boolean[] = [];
  for (let i = 0; i < n; i++) base.push((i * k) % n < k);
  const r = ((Math.floor(rotate) % n) + n) % n;
  return base.map((_, i) => base[(i + r) % n]);
}

/**
 * Write a Euclidean pattern into one voice of a beat grid, tiled to fill the
 * 16-step bar (so an E(3,8) repeats twice, E(5,16) fills exactly, etc.).
 */
export function euclidBeat(
  beat: Beat,
  voice: DrumVoice,
  pulses: number,
  steps: number,
  rotate = 0,
): Beat {
  const pattern = euclid(pulses, steps, rotate);
  const n = pattern.length;
  const row = Array.from({ length: SEQ_STEPS }, (_, i) => pattern[i % n]);
  return { ...beat, enabled: true, rows: { ...beat.rows, [voice]: row } };
}

/** Seed a beat grid from a one-bar style pattern (the "fill from style" button). */
export function styleToBeat(style: DrumStyle): Beat {
  const beat = emptyBeat();
  beat.enabled = true;
  for (const hit of generateDrums(style, 1, 0)) {
    const step = Math.round(hit.startBeat / (BEATS_PER_BAR / SEQ_STEPS));
    if (beat.rows[hit.voice] && step >= 0 && step < SEQ_STEPS) {
      beat.rows[hit.voice][step] = true;
    }
  }
  return beat;
}

/** Typical next scale degrees by current degree (common-practice voice flow). */
const NEXT_DEGREES: Record<number, number[]> = {
  0: [3, 4, 5], // I → IV, V, vi
  1: [4, 0], // ii → V, I
  2: [5, 3], // iii → vi, IV
  3: [4, 0, 1], // IV → V, I, ii
  4: [0, 5], // V → I, vi
  5: [1, 3], // vi → ii, IV
  6: [0], // vii° → I
};

/** Suggest a few musical next chords given the progression's last chord + key. */
export function suggestNextChords(chords: string[], key: string): string[] {
  const { scale, triads } = keyTheory(key);
  const last = chords[chords.length - 1];
  const deg = last ? diatonicDegree(Chord.get(last).tonic || "", scale) : -1;
  const degrees = deg >= 0 ? (NEXT_DEGREES[deg] ?? [0, 3, 4, 5]) : [0, 3, 4, 5];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of degrees) {
    const chord = triads[d];
    if (chord && !seen.has(chord)) {
      seen.add(chord);
      out.push(chord);
    }
  }
  return out;
}

/**
 * A one-shot "vibe" preset: tempo + sounds + band styles + a fitting
 * progression, so "make it lo-fi" lands a whole feel in a single move. Styles
 * are the global palette; sections (if any) keep their own chords + voices.
 */
export type Vibe = {
  id: string;
  label: string;
  tempo: number;
  instrument: string;
  drumStyle: DrumStyle;
  drumBusy: number;
  bassStyle: BassStyle;
  bassOctave: number;
  melodyStyle: MelodyStyle;
  melodyInstrument: string;
  /** Groove feel for the preset (swing + humanize, 0..1 each). */
  swing: number;
  humanize: number;
  /** Suggested progression (applied only when no arrangement is active). */
  chords: string[];
};

export const VIBES: Vibe[] = [
  {
    id: "lofi",
    label: "Lo-fi",
    tempo: 75,
    instrument: "electric_piano_1",
    drumStyle: "lofi",
    drumBusy: 0.3,
    bassStyle: "root",
    bassOctave: 2,
    melodyStyle: "flowing",
    melodyInstrument: "vibraphone",
    swing: 0.35,
    humanize: 0.5,
    chords: ["Dm7", "G7", "Cmaj7", "Am7"],
  },
  {
    id: "bossa",
    label: "Bossa",
    tempo: 128,
    instrument: "acoustic_guitar_nylon",
    drumStyle: "halftime",
    drumBusy: 0.2,
    bassStyle: "rootFifth",
    bassOctave: 2,
    melodyStyle: "pop",
    melodyInstrument: "vibraphone",
    swing: 0.18,
    humanize: 0.3,
    chords: ["Am7", "D7", "Gmaj7", "Cmaj7"],
  },
  {
    id: "synthwave",
    label: "Synthwave",
    tempo: 110,
    instrument: "pad_2_warm",
    drumStyle: "fourOnFloor",
    drumBusy: 0.4,
    bassStyle: "octaves",
    bassOctave: 2,
    melodyStyle: "arp",
    melodyInstrument: "vibraphone",
    swing: 0,
    humanize: 0.1,
    chords: ["Am", "F", "C", "G"],
  },
  {
    id: "house",
    label: "House",
    tempo: 124,
    instrument: "rock_organ",
    drumStyle: "fourOnFloor",
    drumBusy: 0.5,
    bassStyle: "offbeat",
    bassOctave: 2,
    melodyStyle: "pop",
    melodyInstrument: "electric_piano_1",
    swing: 0,
    humanize: 0.05,
    chords: ["Am7", "Dm7", "Em7", "Am7"],
  },
  {
    id: "cinematic",
    label: "Cinematic",
    tempo: 80,
    instrument: "string_ensemble_1",
    drumStyle: "halftime",
    drumBusy: 0.1,
    bassStyle: "root",
    bassOctave: 2,
    melodyStyle: "ballad",
    melodyInstrument: "choir_aahs",
    swing: 0,
    humanize: 0.4,
    chords: ["Cmaj7", "Em7", "Am7", "Fmaj7"],
  },
  {
    id: "ballad",
    label: "Ballad",
    tempo: 70,
    instrument: "acoustic_grand_piano",
    drumStyle: "halftime",
    drumBusy: 0.1,
    bassStyle: "root",
    bassOctave: 2,
    melodyStyle: "ballad",
    melodyInstrument: "vibraphone",
    swing: 0,
    humanize: 0.45,
    chords: ["C", "G", "Am", "F"],
  },
];

/** Apply a vibe preset: set the band palette + tempo (+ progression if no arrangement). */
export function applyVibe(state: SongState, vibe: Vibe): SongState {
  let next: SongState = {
    ...state,
    tempo: vibe.tempo,
    instrument: vibe.instrument,
    bass: { enabled: true, style: vibe.bassStyle, octave: vibe.bassOctave },
    drums: { enabled: true, style: vibe.drumStyle, busy: vibe.drumBusy },
    melody: {
      ...state.melody,
      enabled: true,
      style: vibe.melodyStyle,
      instrument: vibe.melodyInstrument,
      seed: (state.melody?.seed ?? 1) + 1,
    },
    groove: { swing: vibe.swing, humanize: vibe.humanize },
  };
  if (vibe.chords.length > 0 && !state.arrangement?.enabled) {
    const { key, scale } = guessKey(vibe.chords);
    next = {
      ...next,
      chords: vibe.chords,
      key,
      scale,
      loopBars: Math.max(vibe.chords.length, 1),
    };
  }
  return next;
}

export const defaultBass: BassSettings = { enabled: false, style: "root", octave: 2 };
export const defaultDrums: DrumSettings = {
  enabled: false,
  style: "rock",
  busy: 0,
};
export const defaultMelody: MelodySettings = {
  enabled: false,
  style: "flowing",
  instrument: "vibraphone",
  seed: 1,
};

export const defaultArrangement: Arrangement = {
  enabled: false,
  sections: [],
  current: null,
};

/** Balanced starting levels with a little headroom on master (avoids clipping). */
export const defaultMix: Mix = {
  chords: { volume: 0.8, mute: false, solo: false },
  bass: { volume: 0.85, mute: false, solo: false },
  drums: { volume: 0.9, mute: false, solo: false },
  melody: { volume: 0.8, mute: false, solo: false },
  master: 0.9,
};

export const defaultGroove: Groove = { swing: 0, humanize: 0 };

/** Mixer roles, in display order, with labels for the UI. */
export const MIX_TRACKS: { id: keyof Omit<Mix, "master">; label: string }[] = [
  { id: "chords", label: "Chords" },
  { id: "bass", label: "Bass" },
  { id: "drums", label: "Drums" },
  { id: "melody", label: "Melody" },
];

let sectionCounter = 0;
/** Build a section, defaulting its voice toggles from the current song. */
export function makeSection(
  name: string,
  chords: string[],
  opts?: Partial<Omit<Section, "id" | "name" | "chords">>,
): Section {
  sectionCounter += 1;
  return {
    id: `sec-${Date.now().toString(36)}-${sectionCounter}`,
    name,
    chords,
    repeats: opts?.repeats ?? 1,
    drums: opts?.drums ?? true,
    bass: opts?.bass ?? true,
    melody: opts?.melody ?? false,
    busy: opts?.busy ?? 0,
  };
}

/** Expand sections by their repeat counts into a flat play order. */
export function flattenSections(sections: Section[]): Section[] {
  const out: Section[] = [];
  for (const s of sections) {
    const reps = Math.max(1, Math.floor(s.repeats));
    for (let r = 0; r < reps; r++) out.push(s);
  }
  return out;
}

/** Total bars an arrangement spans (sum of chords × repeats). */
export function arrangementBars(arr: Arrangement): number {
  return arr.sections.reduce(
    (sum, s) => sum + Math.max(1, s.chords.length) * Math.max(1, Math.floor(s.repeats)),
    0,
  );
}

function offsetNotes(notes: NoteEvent[], beats: number): NoteEvent[] {
  return beats === 0 ? notes : notes.map((n) => ({ ...n, startBeat: n.startBeat + beats }));
}

function offsetHits(hits: DrumHit[], beats: number): DrumHit[] {
  return beats === 0 ? hits : hits.map((h) => ({ ...h, startBeat: h.startBeat + beats }));
}

export const defaultSongState: SongState = {
  chords: ["Am", "F", "C", "G"],
  tempo: 100,
  key: "A minor",
  scale: "minor",
  loopBars: 4,
  playing: false,
  loopSong: true,
  instrument: "acoustic_grand_piano",
  bass: defaultBass,
  drums: defaultDrums,
  melody: defaultMelody,
  beat: emptyBeat(),
  arrangement: defaultArrangement,
  mix: defaultMix,
  groove: defaultGroove,
  patch: defaultVoice(),
};

/** Build a fresh SongState from a chord progression, keeping tempo/playing/instrument. */
export function songStateFromProgression(chords: string[], prev?: Partial<SongState>): SongState {
  const { key, scale } = guessKey(chords);
  return {
    chords,
    tempo: prev?.tempo ?? 100,
    key,
    scale,
    loopBars: Math.max(chords.length, 1),
    playing: prev?.playing ?? false,
    loopSong: prev?.loopSong ?? true,
    instrument: prev?.instrument ?? "acoustic_grand_piano",
    bass: prev?.bass ?? defaultBass,
    drums: prev?.drums ?? defaultDrums,
    melody: prev?.melody ?? defaultMelody,
    beat: prev?.beat ?? emptyBeat(),
    arrangement: prev?.arrangement ?? defaultArrangement,
    mix: prev?.mix ?? defaultMix,
    groove: prev?.groove ?? defaultGroove,
    patch: prev?.patch ?? defaultVoice(),
  };
}

/** Derive the engine-facing document (with MIDI notes) from a SongState. */
export function songDocFromState(state: SongState): SongDoc {
  if (state.arrangement?.enabled && state.arrangement.sections.length > 0) {
    return songDocFromArrangement(state);
  }

  const tracks: Track[] = [
    {
      id: "chords",
      name: "Chords",
      role: "chords",
      instrument: state.instrument,
      clips: [progressionToClip(state.chords)],
    },
  ];

  if (state.bass?.enabled) {
    tracks.push({
      id: "bass",
      name: "Bass",
      role: "bass",
      instrument: "bass_synth",
      clips: [{ notes: generateBass(state.chords, state.bass.style, state.bass.octave) }],
    });
  }

  if (state.melody?.enabled) {
    tracks.push({
      id: "melody",
      name: "Melody",
      role: "melody",
      instrument: state.melody.instrument,
      clips: [
        {
          notes: generateMelody(
            state.chords,
            state.key,
            state.scale,
            state.melody.style,
            state.melody.seed,
          ),
        },
      ],
    });
  }

  // A hand-programmed beat takes precedence over the style-based groove.
  const drumHits = state.beat?.enabled
    ? beatToHits(state.beat, state.loopBars)
    : state.drums?.enabled
      ? generateDrums(state.drums.style, state.loopBars, state.drums.busy)
      : [];

  return {
    tempo: state.tempo,
    key: state.key,
    scale: state.scale,
    loopBars: state.loopBars,
    instrument: state.instrument,
    tracks,
    drumHits,
    loop: state.loopSong !== false,
  };
}

/**
 * Flatten the arrangement's sections into one long timeline. Each section's
 * parts are generated independently (so per-section voice toggles + busy take
 * effect) and offset to its position in the song. Generators are pure functions
 * of chords + settings, so we just call them per section and shift the times.
 */
function songDocFromArrangement(state: SongState): SongDoc {
  const chordNotes: NoteEvent[] = [];
  const bassNotes: NoteEvent[] = [];
  const melodyNotes: NoteEvent[] = [];
  const drumHits: DrumHit[] = [];

  let bar = 0;
  for (const section of flattenSections(state.arrangement.sections)) {
    const chords = section.chords;
    const nBars = Math.max(chords.length, 1);
    const offset = bar * BEATS_PER_BAR;

    chordNotes.push(...offsetNotes(progressionToClip(chords).notes, offset));

    if (section.bass && state.bass) {
      bassNotes.push(
        ...offsetNotes(generateBass(chords, state.bass.style, state.bass.octave), offset),
      );
    }

    if (section.melody && state.melody) {
      // Fit the line to this section's own key (sections can change key).
      const { key, scale } = guessKey(chords);
      melodyNotes.push(
        ...offsetNotes(
          generateMelody(chords, key, scale, state.melody.style, state.melody.seed),
          offset,
        ),
      );
    }

    if (section.drums) {
      const hits = state.beat?.enabled
        ? beatToHits(state.beat, nBars)
        : generateDrums(state.drums.style, nBars, section.busy);
      drumHits.push(...offsetHits(hits, offset));
    }

    bar += nBars;
  }

  const tracks: Track[] = [
    {
      id: "chords",
      name: "Chords",
      role: "chords",
      instrument: state.instrument,
      clips: [{ notes: chordNotes }],
    },
  ];
  if (bassNotes.length > 0) {
    tracks.push({
      id: "bass",
      name: "Bass",
      role: "bass",
      instrument: "bass_synth",
      clips: [{ notes: bassNotes }],
    });
  }
  if (melodyNotes.length > 0) {
    tracks.push({
      id: "melody",
      name: "Melody",
      role: "melody",
      instrument: state.melody.instrument,
      clips: [{ notes: melodyNotes }],
    });
  }

  return {
    tempo: state.tempo,
    key: state.key,
    scale: state.scale,
    loopBars: Math.max(bar, 1),
    instrument: state.instrument,
    tracks,
    drumHits,
    loop: state.loopSong !== false,
  };
}
