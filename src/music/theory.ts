import { Chord, Interval, Key, Note, Progression, transpose } from "@tonaljs/tonal";

/** True if a token is a chord tonal can understand (e.g. "Am", "F", "G7"). */
export function isChord(token: string): boolean {
  return !Chord.get(token).empty;
}

/** Root pitch-class of each chord (for the bass lane labels). */
export function chordRoots(chords: string[]): string[] {
  return chords.map((name) => Chord.get(name).tonic || "?");
}

/** Parse "Am F C G" (commas/spaces) into the chord tokens tonal understands. */
export function parseProgression(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter(isChord);
}

/**
 * Naive key guess: interpret the first chord as the tonic. Deterministic and
 * good enough until real detection (tonal/Essentia) lands.
 */
export function guessKey(chords: string[]): { key: string; scale: string } {
  if (chords.length === 0) return { key: "\u2014", scale: "major" };
  const first = Chord.get(chords[0]);
  if (first.empty || !first.tonic) return { key: "\u2014", scale: "major" };
  const minor = /minor|diminished/i.test(first.quality ?? "");
  return {
    key: `${first.tonic} ${minor ? "minor" : "major"}`,
    scale: minor ? "minor" : "major",
  };
}

/** Transpose a chord progression by N semitones (preserving chord quality). */
export function transposeProgression(chords: string[], semitones: number): string[] {
  const interval = Interval.fromSemitones(semitones);
  return chords.map((name) => {
    const chord = Chord.get(name);
    if (chord.empty || !chord.tonic) return name;
    const newTonic = transpose(chord.tonic, interval);
    const suffix = name.slice(chord.tonic.length);
    return `${newTonic}${suffix}`;
  });
}

/** Roman-numeral analysis of the progression in its guessed key. */
export function analyzeRomanNumerals(chords: string[]): string[] {
  if (chords.length === 0) return [];
  const first = Chord.get(chords[0]);
  const tonic = first.tonic || "C";
  return Progression.toRomanNumerals(tonic, chords);
}

export type HarmonicFunction = "Tonic" | "Subdominant" | "Dominant" | "Chromatic";

/** Tonal function by diatonic scale degree (0-indexed): I/iii/vi = tonic, etc. */
const FUNCTION_BY_DEGREE: HarmonicFunction[] = [
  "Tonic",
  "Subdominant",
  "Tonic",
  "Subdominant",
  "Dominant",
  "Tonic",
  "Dominant",
];

/** The diatonic chords (triads + sevenths) + scale of a "Tonic mode" key. */
export function keyTheory(key: string): {
  scale: string[];
  triads: string[];
  sevenths: string[];
} {
  const [tonic, mode] = key.split(" ");
  if (/minor/i.test(mode ?? "")) {
    const k = Key.minorKey(tonic || "C").natural;
    return {
      scale: k.scale as string[],
      triads: k.triads as string[],
      sevenths: k.chords as string[],
    };
  }
  const k = Key.majorKey(tonic || "C");
  return {
    scale: k.scale as string[],
    triads: k.triads as string[],
    sevenths: k.chords as string[],
  };
}

/** Diatonic scale degree (0-indexed) of a chord root in a key, or -1 if chromatic. */
export function diatonicDegree(root: string, scale: string[]): number {
  const chroma = Note.chroma(root);
  if (chroma == null) return -1;
  return scale.findIndex((pc) => Note.chroma(pc) === chroma);
}

/** Harmonic function (Tonic/Subdominant/Dominant/Chromatic) of each chord. */
export function chordFunctions(chords: string[], key: string): HarmonicFunction[] {
  const { scale } = keyTheory(key);
  return chords.map((name) => {
    const root = Chord.get(name).tonic;
    if (!root) return "Chromatic";
    const deg = diatonicDegree(root, scale);
    return deg >= 0 ? FUNCTION_BY_DEGREE[deg] : "Chromatic";
  });
}

export type ReharmonizeStyle = "jazz" | "simple";

/**
 * Reharmonize a progression within its key. "jazz" upgrades each diatonic chord
 * to its seventh; "simple" reduces to plain triads.
 */
export function reharmonize(chords: string[], key: string, style: ReharmonizeStyle): string[] {
  const { scale, triads, sevenths } = keyTheory(key);
  const table = style === "jazz" ? sevenths : triads;
  return chords.map((name) => {
    const root = Chord.get(name).tonic;
    if (!root) return name;
    const deg = diatonicDegree(root, scale);
    return deg >= 0 && table[deg] ? table[deg] : name;
  });
}
