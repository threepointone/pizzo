export type LaunchIntent = {
  id: string;
  label: string;
  hint: string;
  prompt: string;
  vibe?: string;
  instrument?: string;
  synthPreset?: string;
  effectPreset?: string;
  groove?: { swing: number; humanize: number };
  bass?: { enabled: boolean; style?: string };
  drums?: { enabled: boolean; style?: string; busy?: number };
  melody?: { enabled: boolean; style?: string; instrument?: string };
  progression: string[];
  arrangement?: {
    name: string;
    chords: string[];
    repeats?: number;
    drums?: boolean;
    bass?: boolean;
    melody?: boolean;
    busy?: number;
  }[];
};

export const LAUNCH_INTENTS: LaunchIntent[] = [
  {
    id: "sad-piano",
    label: "Sad Piano Sketch",
    hint: "Minor keys, sparse band, soft room",
    prompt: "Start a sad piano sketch with a simple minor progression and gentle space.",
    vibe: "ballad",
    instrument: "acoustic_grand_piano",
    effectPreset: "dream-hall",
    groove: { swing: 0.04, humanize: 0.24 },
    progression: ["Am", "F", "C", "G"],
  },
  {
    id: "lofi-loop",
    label: "Lo-fi Loop",
    hint: "Warm keys, tape wobble, lazy drums",
    prompt: "Make a warm lo-fi loop with electric piano, tape color, bass, and a lazy beat.",
    vibe: "lofi",
    instrument: "electric_piano_1",
    effectPreset: "lofi-tape",
    groove: { swing: 0.32, humanize: 0.45 },
    progression: ["Am", "F", "C", "G"],
  },
  {
    id: "cinematic-build",
    label: "Cinematic Build",
    hint: "Verse to lift, strings, wide reverb",
    prompt: "Create a cinematic build with a quiet verse and bigger chorus.",
    vibe: "cinematic",
    instrument: "string_ensemble_1",
    effectPreset: "dream-hall",
    groove: { swing: 0, humanize: 0.28 },
    progression: ["Am", "F", "C", "G"],
    arrangement: [
      { name: "Intro", chords: ["Am", "F"], repeats: 2, drums: false, bass: false, melody: false },
      {
        name: "Lift",
        chords: ["C", "G", "Am", "F"],
        repeats: 1,
        drums: true,
        bass: true,
        melody: false,
        busy: 0.3,
      },
      {
        name: "Chorus",
        chords: ["F", "G", "Am", "C"],
        repeats: 2,
        drums: true,
        bass: true,
        melody: true,
        busy: 0.65,
      },
    ],
  },
  {
    id: "funk-jam",
    label: "Funk Jam",
    hint: "Clav bite, active bass, tight feel",
    prompt: "Start a funky clav jam with active bass and tight drums.",
    vibe: "funk",
    instrument: "clavinet",
    effectPreset: "gritty-organ",
    groove: { swing: 0.08, humanize: 0.18 },
    progression: ["Dm7", "G7", "Cmaj7", "A7"],
  },
  {
    id: "synthwave-hook",
    label: "Synthwave Hook",
    hint: "Neon lead, octave bass, wide chorus",
    prompt: "Make a synthwave hook with big chords, octave bass, crisp drums, and a neon synth.",
    vibe: "synthwave",
    instrument: "modular_voice",
    synthPreset: "neon-hook",
    effectPreset: "wide-chorus",
    groove: { swing: 0.04, humanize: 0.16 },
    progression: ["Am", "F", "C", "G"],
  },
  {
    id: "dub-sketch",
    label: "Dub Sketch",
    hint: "Organ stabs, dark echo, relaxed groove",
    prompt: "Make a dub sketch with organ stabs, dark echoes, and a relaxed groove.",
    vibe: "reggae",
    instrument: "drawbar_organ",
    effectPreset: "dub-echo",
    groove: { swing: 0.18, humanize: 0.3 },
    progression: ["Am", "G", "F", "G"],
  },
  {
    id: "ambient-pad",
    label: "Ambient Pad",
    hint: "Slow movement, modular texture, no drums",
    prompt: "Start an ambient pad idea with slow harmonic movement and no drums.",
    instrument: "modular_voice",
    synthPreset: "slow-morph-pad",
    effectPreset: "dream-hall",
    groove: { swing: 0, humanize: 0.18 },
    bass: { enabled: false },
    drums: { enabled: false, busy: 0 },
    melody: { enabled: false },
    progression: ["Cmaj7", "Em7", "Am7", "Fmaj7"],
  },
  {
    id: "blank",
    label: "Blank",
    hint: "Keep it simple and start from chords",
    prompt: "Start from a blank four-chord sketch.",
    progression: ["Am", "F", "C", "G"],
  },
];
