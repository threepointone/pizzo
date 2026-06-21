import type * as ModularTypes from "./types";

export type SynthPreset = {
  id: string;
  label: string;
  blurb: string;
  patch: ModularTypes.Patch;
};

function mod(
  type: ModularTypes.ModuleType,
  id: string,
  x: number,
  y: number,
  params: Record<string, number | string> = {},
): ModularTypes.PatchModule {
  return { type, id, x, y, params };
}

function conn(
  id: string,
  from: [string, string],
  to: [string, string],
  strength = 1,
): ModularTypes.PatchConnection {
  return {
    id,
    from: { module: from[0], port: from[1] },
    to: { module: to[0], port: to[1] },
    strength,
  };
}

const commonOutput = (level = 0.78) => mod("output", "out", 1180, 180, { level });

type ClassicPresetOptions = {
  id: string;
  label: string;
  blurb: string;
  wave: string;
  tune?: number;
  subWave?: string;
  subTune?: number;
  cutoff: number;
  q: number;
  env: { attack: number; decay: number; sustain: number; release: number };
  output?: number;
  lfo?: { rate: number; depth: number; amount: number };
  drive?: { amount: number; level: number };
  delay?: { time: number; feedback: number; mix: number };
  reverb?: { size: number; damp: number; mix: number };
};

function classicPreset(opts: ClassicPresetOptions): SynthPreset {
  const modules: ModularTypes.PatchModule[] = [
    mod("keyboard", "kbd", 40, 230),
    mod("oscillator", "osc", 260, 130, { waveform: opts.wave, tune: opts.tune ?? 0 }),
  ];
  const connections: ModularTypes.PatchConnection[] = [
    conn("c1", ["kbd", "freq"], ["osc", "freq"]),
  ];
  let signal: [string, string] = ["osc", "out"];
  let c = 2;

  if (opts.subWave) {
    modules.push(
      mod("oscillator", "sub", 260, 300, {
        waveform: opts.subWave,
        tune: opts.subTune ?? -12,
      }),
      mod("mixer", "mix", 490, 210, { gainA: 0.7, gainB: 0.45 }),
    );
    connections.push(
      conn(`c${c++}`, ["kbd", "freq"], ["sub", "freq"]),
      conn(`c${c++}`, ["osc", "out"], ["mix", "a"]),
      conn(`c${c++}`, ["sub", "out"], ["mix", "b"]),
    );
    signal = ["mix", "out"];
  }

  modules.push(
    mod("filter", "filt", 700, 190, { mode: "lowpass", cutoff: opts.cutoff, q: opts.q }),
    mod("vca", "vca", 910, 190, { gain: 0 }),
    mod("adsr", "env", 700, 430, opts.env),
  );
  connections.push(
    conn(`c${c++}`, signal, ["filt", "in"]),
    conn(`c${c++}`, ["kbd", "gate"], ["env", "gate"]),
    conn(`c${c++}`, ["env", "env"], ["vca", "gain"]),
  );

  if (opts.lfo) {
    modules.push(
      mod("lfo", "lfo", 490, 430, { waveform: "sine", rate: opts.lfo.rate, depth: opts.lfo.depth }),
    );
    connections.push(conn(`c${c++}`, ["lfo", "out"], ["filt", "cutoff"], opts.lfo.amount));
  }

  let afterFilter: [string, string] = ["filt", "out"];
  if (opts.drive) {
    modules.push(mod("drive", "drive", 900, 60, opts.drive));
    connections.push(conn(`c${c++}`, afterFilter, ["drive", "in"]));
    afterFilter = ["drive", "out"];
  }
  connections.push(conn(`c${c++}`, afterFilter, ["vca", "in"]));

  let afterVca: [string, string] = ["vca", "out"];
  if (opts.delay) {
    modules.push(mod("delay", "delay", 1120, 90, opts.delay));
    connections.push(conn(`c${c++}`, afterVca, ["delay", "in"]));
    afterVca = ["delay", "out"];
  }
  if (opts.reverb) {
    modules.push(mod("reverb", "verb", 1120, 300, opts.reverb));
    connections.push(conn(`c${c++}`, afterVca, ["verb", "in"]));
    afterVca = ["verb", "out"];
  }
  modules.push(commonOutput(opts.output ?? 0.78));
  connections.push(conn(`c${c++}`, afterVca, ["out", "in"]));

  return {
    id: opts.id,
    label: opts.label,
    blurb: opts.blurb,
    patch: { modules, connections },
  };
}

export const SYNTH_PRESETS: SynthPreset[] = [
  {
    id: "warm-poly-pad",
    label: "Warm Poly Pad",
    blurb: "Two detuned oscillators, slow envelope, reverb, and a little movement.",
    patch: {
      modules: [
        mod("keyboard", "kbd", 40, 230),
        mod("oscillator", "oscA", 260, 110, { waveform: "sawtooth", tune: -7 }),
        mod("oscillator", "oscB", 260, 270, { waveform: "triangle", tune: 0 }),
        mod("mixer", "mix", 480, 180, { gainA: 0.55, gainB: 0.65 }),
        mod("filter", "filt", 690, 180, { mode: "lowpass", cutoff: 1400, q: 1.1 }),
        mod("vca", "vca", 900, 180, { gain: 0 }),
        mod("adsr", "env", 690, 420, { attack: 0.7, decay: 0.8, sustain: 0.78, release: 2.4 }),
        mod("lfo", "lfo", 480, 420, { waveform: "sine", rate: 0.18, depth: 0.18 }),
        mod("reverb", "verb", 1040, 180, { size: 0.78, damp: 0.55, mix: 0.34 }),
        commonOutput(0.75),
      ],
      connections: [
        conn("c1", ["kbd", "freq"], ["oscA", "freq"]),
        conn("c2", ["kbd", "freq"], ["oscB", "freq"]),
        conn("c3", ["oscA", "out"], ["mix", "a"]),
        conn("c4", ["oscB", "out"], ["mix", "b"]),
        conn("c5", ["mix", "out"], ["filt", "in"]),
        conn("c6", ["lfo", "out"], ["filt", "cutoff"], 0.45),
        conn("c7", ["filt", "out"], ["vca", "in"]),
        conn("c8", ["kbd", "gate"], ["env", "gate"]),
        conn("c9", ["env", "env"], ["vca", "gain"]),
        conn("c10", ["vca", "out"], ["verb", "in"]),
        conn("c11", ["verb", "out"], ["out", "in"]),
      ],
    },
  },
  {
    id: "pluck-echo",
    label: "Pluck Echo",
    blurb: "Short bright pluck with tempo-friendly delay for arps and hooks.",
    patch: {
      modules: [
        mod("keyboard", "kbd", 40, 220),
        mod("oscillator", "osc", 280, 160, { waveform: "square", tune: 0 }),
        mod("filter", "filt", 520, 160, { mode: "lowpass", cutoff: 4200, q: 2.4 }),
        mod("vca", "vca", 740, 160, { gain: 0 }),
        mod("adsr", "env", 520, 390, { attack: 0.004, decay: 0.18, sustain: 0.18, release: 0.32 }),
        mod("delay", "delay", 940, 160, { time: 0.28, feedback: 0.42, mix: 0.32 }),
        commonOutput(0.82),
      ],
      connections: [
        conn("c1", ["kbd", "freq"], ["osc", "freq"]),
        conn("c2", ["osc", "out"], ["filt", "in"]),
        conn("c3", ["filt", "out"], ["vca", "in"]),
        conn("c4", ["kbd", "gate"], ["env", "gate"]),
        conn("c5", ["env", "env"], ["vca", "gain"]),
        conn("c6", ["vca", "out"], ["delay", "in"]),
        conn("c7", ["delay", "out"], ["out", "in"]),
      ],
    },
  },
  {
    id: "gritty-saw-lead",
    label: "Gritty Saw Lead",
    blurb: "Driven saw lead with filter bite and a fast envelope.",
    patch: {
      modules: [
        mod("keyboard", "kbd", 40, 220),
        mod("oscillator", "osc", 280, 140, { waveform: "sawtooth", tune: 0 }),
        mod("filter", "filt", 520, 140, { mode: "lowpass", cutoff: 2400, q: 5 }),
        mod("drive", "drive", 740, 140, { amount: 8, level: 0.65 }),
        mod("vca", "vca", 940, 140, { gain: 0 }),
        mod("adsr", "env", 520, 370, { attack: 0.006, decay: 0.14, sustain: 0.62, release: 0.24 }),
        mod("lfo", "lfo", 280, 370, { waveform: "sine", rate: 5.2, depth: 0.08 }),
        commonOutput(0.72),
      ],
      connections: [
        conn("c1", ["kbd", "freq"], ["osc", "freq"]),
        conn("c2", ["osc", "out"], ["filt", "in"]),
        conn("c3", ["lfo", "out"], ["filt", "cutoff"], 0.22),
        conn("c4", ["filt", "out"], ["drive", "in"]),
        conn("c5", ["drive", "out"], ["vca", "in"]),
        conn("c6", ["kbd", "gate"], ["env", "gate"]),
        conn("c7", ["env", "env"], ["vca", "gain"]),
        conn("c8", ["vca", "out"], ["out", "in"]),
      ],
    },
  },
  {
    id: "glass-keys",
    label: "Glass Keys",
    blurb: "Sine/triangle keys with a soft tail for delicate chord colors.",
    patch: {
      modules: [
        mod("keyboard", "kbd", 40, 230),
        mod("oscillator", "oscA", 270, 130, { waveform: "sine", tune: 0 }),
        mod("oscillator", "oscB", 270, 290, { waveform: "triangle", tune: 12 }),
        mod("mixer", "mix", 500, 200, { gainA: 0.78, gainB: 0.22 }),
        mod("vca", "vca", 720, 200, { gain: 0 }),
        mod("adsr", "env", 500, 430, { attack: 0.012, decay: 0.35, sustain: 0.25, release: 1.1 }),
        mod("reverb", "verb", 940, 200, { size: 0.56, damp: 0.7, mix: 0.26 }),
        commonOutput(0.8),
      ],
      connections: [
        conn("c1", ["kbd", "freq"], ["oscA", "freq"]),
        conn("c2", ["kbd", "freq"], ["oscB", "freq"]),
        conn("c3", ["oscA", "out"], ["mix", "a"]),
        conn("c4", ["oscB", "out"], ["mix", "b"]),
        conn("c5", ["mix", "out"], ["vca", "in"]),
        conn("c6", ["kbd", "gate"], ["env", "gate"]),
        conn("c7", ["env", "env"], ["vca", "gain"]),
        conn("c8", ["vca", "out"], ["verb", "in"]),
        conn("c9", ["verb", "out"], ["out", "in"]),
      ],
    },
  },
  classicPreset({
    id: "analog-brass",
    label: "Analog Brass",
    blurb: "Bold two-oscillator brass stab with a medium envelope and warm filter.",
    wave: "sawtooth",
    subWave: "square",
    subTune: -7,
    cutoff: 1800,
    q: 1.6,
    env: { attack: 0.03, decay: 0.26, sustain: 0.62, release: 0.42 },
    drive: { amount: 2.6, level: 0.72 },
    reverb: { size: 0.35, damp: 0.6, mix: 0.12 },
    output: 0.74,
  }),
  classicPreset({
    id: "rubber-bass",
    label: "Rubber Bass",
    blurb: "Round square-wave bass with envelope bite and light saturation.",
    wave: "square",
    subWave: "sine",
    subTune: -12,
    cutoff: 620,
    q: 5.2,
    env: { attack: 0.004, decay: 0.16, sustain: 0.35, release: 0.18 },
    drive: { amount: 5.5, level: 0.72 },
    output: 0.78,
  }),
  classicPreset({
    id: "deep-sub",
    label: "Deep Sub",
    blurb: "Clean low sine/triangle body for simple bass support.",
    wave: "sine",
    subWave: "triangle",
    subTune: -12,
    cutoff: 520,
    q: 0.8,
    env: { attack: 0.01, decay: 0.2, sustain: 0.9, release: 0.28 },
    output: 0.82,
  }),
  classicPreset({
    id: "velvet-lead",
    label: "Velvet Lead",
    blurb: "Smooth triangle lead with slow vibrato and a small room.",
    wave: "triangle",
    cutoff: 3200,
    q: 1.1,
    env: { attack: 0.018, decay: 0.18, sustain: 0.72, release: 0.38 },
    lfo: { rate: 4.8, depth: 0.08, amount: 0.16 },
    reverb: { size: 0.42, damp: 0.55, mix: 0.18 },
    output: 0.8,
  }),
  classicPreset({
    id: "neon-hook",
    label: "Neon Hook",
    blurb: "Bright saw hook with slap delay for synth-pop melodies.",
    wave: "sawtooth",
    subWave: "square",
    subTune: 12,
    cutoff: 5200,
    q: 2.2,
    env: { attack: 0.006, decay: 0.2, sustain: 0.5, release: 0.22 },
    delay: { time: 0.18, feedback: 0.28, mix: 0.24 },
    output: 0.72,
  }),
  classicPreset({
    id: "dark-drone-pad",
    label: "Dark Drone Pad",
    blurb: "Slow, low, filtered pad with long release and dark reverb.",
    wave: "sawtooth",
    subWave: "triangle",
    subTune: -12,
    cutoff: 760,
    q: 1.8,
    env: { attack: 1.2, decay: 1.2, sustain: 0.86, release: 3.5 },
    lfo: { rate: 0.09, depth: 0.28, amount: 0.35 },
    reverb: { size: 0.88, damp: 0.72, mix: 0.42 },
    output: 0.68,
  }),
  classicPreset({
    id: "choir-machine",
    label: "Choir Machine",
    blurb: "Soft sine/saw blend shaped like a synthetic vocal pad.",
    wave: "sine",
    subWave: "sawtooth",
    subTune: 7,
    cutoff: 1700,
    q: 0.9,
    env: { attack: 0.55, decay: 0.7, sustain: 0.82, release: 2.2 },
    reverb: { size: 0.82, damp: 0.48, mix: 0.38 },
    output: 0.74,
  }),
  classicPreset({
    id: "lofi-warble",
    label: "Lo-fi Warble",
    blurb: "Muted triangle keys with slow filter drift and tape-like delay.",
    wave: "triangle",
    cutoff: 1300,
    q: 1.4,
    env: { attack: 0.02, decay: 0.42, sustain: 0.46, release: 0.9 },
    lfo: { rate: 0.42, depth: 0.36, amount: 0.26 },
    delay: { time: 0.32, feedback: 0.24, mix: 0.18 },
    output: 0.78,
  }),
  classicPreset({
    id: "ice-bell",
    label: "Ice Bell",
    blurb: "High sine/triangle bell with shimmer-like reverb tail.",
    wave: "sine",
    subWave: "triangle",
    subTune: 19,
    cutoff: 7000,
    q: 0.7,
    env: { attack: 0.002, decay: 1.1, sustain: 0.08, release: 1.9 },
    reverb: { size: 0.72, damp: 0.3, mix: 0.35 },
    output: 0.7,
  }),
  classicPreset({
    id: "fm-ish-tines",
    label: "FM-ish Tines",
    blurb: "Metallic electric-piano flavor from a high sine layer.",
    wave: "sine",
    subWave: "sine",
    subTune: 24,
    cutoff: 5600,
    q: 1,
    env: { attack: 0.004, decay: 0.7, sustain: 0.18, release: 1.1 },
    reverb: { size: 0.38, damp: 0.45, mix: 0.16 },
    output: 0.78,
  }),
  classicPreset({
    id: "space-arp",
    label: "Space Arp",
    blurb: "Narrow pulse-like arp sound with bright delay trails.",
    wave: "square",
    cutoff: 3600,
    q: 3.1,
    env: { attack: 0.003, decay: 0.12, sustain: 0.22, release: 0.24 },
    delay: { time: 0.42, feedback: 0.48, mix: 0.34 },
    reverb: { size: 0.46, damp: 0.5, mix: 0.16 },
    output: 0.74,
  }),
  classicPreset({
    id: "industrial-pulse",
    label: "Industrial Pulse",
    blurb: "Aggressive square tone with drive, resonance, and a tight envelope.",
    wave: "square",
    subWave: "sawtooth",
    subTune: -12,
    cutoff: 980,
    q: 8.5,
    env: { attack: 0.002, decay: 0.1, sustain: 0.18, release: 0.11 },
    drive: { amount: 13, level: 0.58 },
    output: 0.66,
  }),
  classicPreset({
    id: "acid-sequence",
    label: "Acid Sequence",
    blurb: "Resonant saw bass with stepped filter motion from the modular sequencer.",
    wave: "sawtooth",
    subWave: "square",
    subTune: -12,
    cutoff: 420,
    q: 12,
    env: { attack: 0.003, decay: 0.12, sustain: 0.08, release: 0.1 },
    drive: { amount: 9, level: 0.62 },
    output: 0.68,
  }),
  {
    id: "folded-bell",
    label: "Folded Bell",
    blurb: "West-coast metallic bell using the wavefolder and a short envelope.",
    patch: {
      modules: [
        mod("keyboard", "kbd", 40, 220),
        mod("oscillator", "osc", 270, 160, { waveform: "sine", tune: 0 }),
        mod("wavefolder", "fold", 500, 160, { fold: 6.5, bias: 0.14, level: 0.58 }),
        mod("vca", "vca", 730, 160, { gain: 0 }),
        mod("adsr", "env", 500, 390, { attack: 0.002, decay: 0.9, sustain: 0.05, release: 1.6 }),
        mod("reverb", "verb", 950, 160, { size: 0.7, damp: 0.28, mix: 0.34 }),
        commonOutput(0.72),
      ],
      connections: [
        conn("c1", ["kbd", "freq"], ["osc", "freq"]),
        conn("c2", ["osc", "out"], ["fold", "in"]),
        conn("c3", ["fold", "out"], ["vca", "in"]),
        conn("c4", ["kbd", "gate"], ["env", "gate"]),
        conn("c5", ["env", "env"], ["vca", "gain"]),
        conn("c6", ["vca", "out"], ["verb", "in"]),
        conn("c7", ["verb", "out"], ["out", "in"]),
      ],
    },
  },
  {
    id: "random-filter-pad",
    label: "Random Filter Pad",
    blurb: "Slow pad with sample-and-hold filter movement and chorus width.",
    patch: {
      modules: [
        mod("keyboard", "kbd", 40, 250),
        mod("oscillator", "oscA", 260, 120, { waveform: "sawtooth", tune: -12 }),
        mod("oscillator", "oscB", 260, 290, { waveform: "triangle", tune: 7 }),
        mod("mixer", "mix", 490, 200, { gainA: 0.55, gainB: 0.5 }),
        mod("filter", "filt", 720, 200, { mode: "lowpass", cutoff: 1200, q: 1.8 }),
        mod("sampleHold", "rand", 490, 450, { rate: 0.55, depth: 0.34, offset: 0.08 }),
        mod("vca", "vca", 950, 200, { gain: 0 }),
        mod("adsr", "env", 720, 450, { attack: 0.9, decay: 1.1, sustain: 0.8, release: 3.2 }),
        mod("chorus", "chorus", 1160, 120, { rate: 0.38, depth: 0.65, delay: 0.018, mix: 0.44 }),
        mod("reverb", "verb", 1160, 320, { size: 0.82, damp: 0.58, mix: 0.35 }),
        commonOutput(0.68),
      ],
      connections: [
        conn("c1", ["kbd", "freq"], ["oscA", "freq"]),
        conn("c2", ["kbd", "freq"], ["oscB", "freq"]),
        conn("c3", ["oscA", "out"], ["mix", "a"]),
        conn("c4", ["oscB", "out"], ["mix", "b"]),
        conn("c5", ["mix", "out"], ["filt", "in"]),
        conn("c6", ["rand", "out"], ["filt", "cutoff"], 0.55),
        conn("c7", ["filt", "out"], ["vca", "in"]),
        conn("c8", ["kbd", "gate"], ["env", "gate"]),
        conn("c9", ["env", "env"], ["vca", "gain"]),
        conn("c10", ["vca", "out"], ["chorus", "in"]),
        conn("c11", ["chorus", "out"], ["verb", "in"]),
        conn("c12", ["verb", "out"], ["out", "in"]),
      ],
    },
  },
  {
    id: "step-arp-pluck",
    label: "Step Arp Pluck",
    blurb: "Sequencer-driven pitch pattern with a short plucky envelope.",
    patch: {
      modules: [
        mod("keyboard", "kbd", 40, 220),
        mod("sequencer", "seq", 40, 450, {
          rate: 5.5,
          steps: 8,
          gate: 0.35,
          s1: 0,
          s2: 0.2,
          s3: 0.45,
          s4: 0.7,
          s5: 0.45,
          s6: 0.2,
          s7: -0.1,
          s8: 0.25,
        }),
        mod("slew", "glide", 260, 450, { time: 0.03 }),
        mod("oscillator", "osc", 310, 160, { waveform: "square", tune: 0 }),
        mod("filter", "filt", 540, 160, { mode: "lowpass", cutoff: 3600, q: 2.7 }),
        mod("vca", "vca", 770, 160, { gain: 0 }),
        mod("adsr", "env", 540, 390, { attack: 0.002, decay: 0.11, sustain: 0.16, release: 0.18 }),
        mod("delay", "delay", 980, 160, { time: 0.28, feedback: 0.36, mix: 0.32 }),
        commonOutput(0.72),
      ],
      connections: [
        conn("c1", ["kbd", "freq"], ["osc", "freq"]),
        conn("c2", ["seq", "cv"], ["glide", "in"]),
        conn("c3", ["glide", "out"], ["osc", "freq"], 0.22),
        conn("c4", ["osc", "out"], ["filt", "in"]),
        conn("c5", ["filt", "out"], ["vca", "in"]),
        conn("c6", ["kbd", "gate"], ["env", "gate"]),
        conn("c7", ["seq", "gate"], ["env", "gate"], 0.65),
        conn("c8", ["env", "env"], ["vca", "gain"]),
        conn("c9", ["vca", "out"], ["delay", "in"]),
        conn("c10", ["delay", "out"], ["out", "in"]),
      ],
    },
  },
  {
    id: "wide-juno-pad",
    label: "Wide Juno Pad",
    blurb: "Soft chorus pad inspired by classic poly synth strings.",
    patch: {
      modules: [
        mod("keyboard", "kbd", 40, 230),
        mod("oscillator", "oscA", 260, 120, { waveform: "sawtooth", tune: -7 }),
        mod("oscillator", "oscB", 260, 290, { waveform: "sawtooth", tune: 7 }),
        mod("mixer", "mix", 490, 200, { gainA: 0.52, gainB: 0.52 }),
        mod("filter", "filt", 720, 200, { mode: "lowpass", cutoff: 1800, q: 0.9 }),
        mod("vca", "vca", 940, 200, { gain: 0 }),
        mod("adsr", "env", 720, 430, { attack: 0.55, decay: 0.8, sustain: 0.82, release: 2.5 }),
        mod("chorus", "chorus", 1160, 200, { rate: 0.72, depth: 0.72, delay: 0.016, mix: 0.52 }),
        commonOutput(0.7),
      ],
      connections: [
        conn("c1", ["kbd", "freq"], ["oscA", "freq"]),
        conn("c2", ["kbd", "freq"], ["oscB", "freq"]),
        conn("c3", ["oscA", "out"], ["mix", "a"]),
        conn("c4", ["oscB", "out"], ["mix", "b"]),
        conn("c5", ["mix", "out"], ["filt", "in"]),
        conn("c6", ["filt", "out"], ["vca", "in"]),
        conn("c7", ["kbd", "gate"], ["env", "gate"]),
        conn("c8", ["env", "env"], ["vca", "gain"]),
        conn("c9", ["vca", "out"], ["chorus", "in"]),
        conn("c10", ["chorus", "out"], ["out", "in"]),
      ],
    },
  },
  classicPreset({
    id: "hollow-wood-bass",
    label: "Hollow Wood Bass",
    blurb: "Muted triangle bass with woody resonance and a short tail.",
    wave: "triangle",
    subWave: "sine",
    subTune: -12,
    cutoff: 430,
    q: 6.6,
    env: { attack: 0.004, decay: 0.22, sustain: 0.22, release: 0.16 },
    drive: { amount: 3.5, level: 0.7 },
    output: 0.78,
  }),
  classicPreset({
    id: "laser-lead",
    label: "Laser Lead",
    blurb: "High-resonance saw lead with fast movement and delay.",
    wave: "sawtooth",
    cutoff: 2900,
    q: 7.5,
    env: { attack: 0.002, decay: 0.1, sustain: 0.54, release: 0.16 },
    lfo: { rate: 6.8, depth: 0.18, amount: 0.24 },
    delay: { time: 0.16, feedback: 0.3, mix: 0.18 },
    output: 0.68,
  }),
  classicPreset({
    id: "slow-morph-pad",
    label: "Slow Morph Pad",
    blurb: "Long-release pad with very slow filter movement.",
    wave: "triangle",
    subWave: "sawtooth",
    subTune: -5,
    cutoff: 980,
    q: 1.4,
    env: { attack: 1.6, decay: 1.2, sustain: 0.88, release: 4.5 },
    lfo: { rate: 0.06, depth: 0.48, amount: 0.42 },
    reverb: { size: 0.9, damp: 0.65, mix: 0.45 },
    output: 0.65,
  }),
  classicPreset({
    id: "paper-organ",
    label: "Paper Organ",
    blurb: "Thin, reedy organ tone with a small room.",
    wave: "square",
    subWave: "sine",
    subTune: 12,
    cutoff: 2600,
    q: 0.8,
    env: { attack: 0.01, decay: 0.08, sustain: 0.96, release: 0.28 },
    reverb: { size: 0.3, damp: 0.5, mix: 0.14 },
    output: 0.74,
  }),
  classicPreset({
    id: "noise-swell",
    label: "Noise Swell",
    blurb: "Breathy texture bed with a soft attack and dark filter.",
    wave: "sine",
    cutoff: 650,
    q: 0.7,
    env: { attack: 1.8, decay: 0.6, sustain: 0.72, release: 3.8 },
    lfo: { rate: 0.11, depth: 0.35, amount: 0.32 },
    reverb: { size: 0.86, damp: 0.78, mix: 0.5 },
    output: 0.58,
  }),
  {
    id: "folded-bass",
    label: "Folded Bass",
    blurb: "Aggressive wavefolded bass with tight low-end punch.",
    patch: {
      modules: [
        mod("keyboard", "kbd", 40, 220),
        mod("oscillator", "osc", 270, 160, { waveform: "triangle", tune: -12 }),
        mod("wavefolder", "fold", 500, 160, { fold: 5.2, bias: -0.08, level: 0.62 }),
        mod("filter", "filt", 730, 160, { mode: "lowpass", cutoff: 720, q: 5.8 }),
        mod("vca", "vca", 950, 160, { gain: 0 }),
        mod("adsr", "env", 730, 390, { attack: 0.003, decay: 0.15, sustain: 0.42, release: 0.14 }),
        commonOutput(0.72),
      ],
      connections: [
        conn("c1", ["kbd", "freq"], ["osc", "freq"]),
        conn("c2", ["osc", "out"], ["fold", "in"]),
        conn("c3", ["fold", "out"], ["filt", "in"]),
        conn("c4", ["filt", "out"], ["vca", "in"]),
        conn("c5", ["kbd", "gate"], ["env", "gate"]),
        conn("c6", ["env", "env"], ["vca", "gain"]),
        conn("c7", ["env", "env"], ["filt", "cutoff"], 0.5),
        conn("c8", ["vca", "out"], ["out", "in"]),
      ],
    },
  },
  {
    id: "generative-burble",
    label: "Generative Burble",
    blurb: "Sample-and-hold pitch/filter motion for playful random patterns.",
    patch: {
      modules: [
        mod("keyboard", "kbd", 40, 230),
        mod("sampleHold", "randPitch", 40, 460, { rate: 3.2, depth: 0.55, offset: 0 }),
        mod("slew", "slew", 260, 460, { time: 0.055 }),
        mod("oscillator", "osc", 300, 160, { waveform: "triangle", tune: 0 }),
        mod("filter", "filt", 540, 160, { mode: "bandpass", cutoff: 1400, q: 4.2 }),
        mod("vca", "vca", 770, 160, { gain: 0.18 }),
        mod("delay", "delay", 980, 160, { time: 0.24, feedback: 0.42, mix: 0.32 }),
        commonOutput(0.62),
      ],
      connections: [
        conn("c1", ["kbd", "freq"], ["osc", "freq"]),
        conn("c2", ["randPitch", "out"], ["slew", "in"]),
        conn("c3", ["slew", "out"], ["osc", "freq"], 0.28),
        conn("c4", ["randPitch", "out"], ["filt", "cutoff"], 0.5),
        conn("c5", ["osc", "out"], ["filt", "in"]),
        conn("c6", ["filt", "out"], ["vca", "in"]),
        conn("c7", ["vca", "out"], ["delay", "in"]),
        conn("c8", ["delay", "out"], ["out", "in"]),
      ],
    },
  },
  classicPreset({
    id: "soft-square-keys",
    label: "Soft Square Keys",
    blurb: "Rounded square keys for gentle chord comping.",
    wave: "square",
    cutoff: 1800,
    q: 1,
    env: { attack: 0.012, decay: 0.34, sustain: 0.36, release: 0.72 },
    reverb: { size: 0.44, damp: 0.62, mix: 0.2 },
    output: 0.78,
  }),
  classicPreset({
    id: "big-room-lead",
    label: "Big Room Lead",
    blurb: "Wide saw lead with delay and long reverb tail.",
    wave: "sawtooth",
    subWave: "square",
    subTune: 7,
    cutoff: 4300,
    q: 1.8,
    env: { attack: 0.006, decay: 0.18, sustain: 0.72, release: 0.35 },
    delay: { time: 0.22, feedback: 0.38, mix: 0.24 },
    reverb: { size: 0.68, damp: 0.45, mix: 0.28 },
    output: 0.68,
  }),
  classicPreset({
    id: "glass-pluck",
    label: "Glass Pluck",
    blurb: "Bright short pluck with a reflective room tail.",
    wave: "triangle",
    subWave: "sine",
    subTune: 19,
    cutoff: 6200,
    q: 1.2,
    env: { attack: 0.002, decay: 0.42, sustain: 0.04, release: 0.72 },
    reverb: { size: 0.58, damp: 0.3, mix: 0.28 },
    output: 0.72,
  }),
  classicPreset({
    id: "berlin-seq-bass",
    label: "Berlin Seq Bass",
    blurb: "Tight, pulsing saw bass for classic sequenced patterns.",
    wave: "sawtooth",
    subWave: "square",
    subTune: -12,
    cutoff: 680,
    q: 8.2,
    env: { attack: 0.002, decay: 0.1, sustain: 0.12, release: 0.08 },
    drive: { amount: 6.2, level: 0.68 },
    output: 0.7,
  }),
  classicPreset({
    id: "cathedral-drone",
    label: "Cathedral Drone",
    blurb: "Huge dark sustaining texture with slow movement and a long space.",
    wave: "sawtooth",
    subWave: "sine",
    subTune: -12,
    cutoff: 540,
    q: 1.2,
    env: { attack: 2.3, decay: 1.4, sustain: 0.9, release: 5 },
    lfo: { rate: 0.045, depth: 0.52, amount: 0.48 },
    reverb: { size: 0.95, damp: 0.76, mix: 0.54 },
    output: 0.56,
  }),
  classicPreset({
    id: "chip-lead",
    label: "Chip Lead",
    blurb: "Square-wave video-game lead with tiny attack and crisp release.",
    wave: "square",
    cutoff: 5200,
    q: 0.6,
    env: { attack: 0.001, decay: 0.07, sustain: 0.74, release: 0.08 },
    delay: { time: 0.12, feedback: 0.2, mix: 0.16 },
    output: 0.66,
  }),
  classicPreset({
    id: "tape-keys",
    label: "Tape Keys",
    blurb: "Dulled triangle keys with slow drift and a soft room.",
    wave: "triangle",
    cutoff: 1250,
    q: 1.1,
    env: { attack: 0.03, decay: 0.38, sustain: 0.5, release: 0.86 },
    lfo: { rate: 0.23, depth: 0.18, amount: 0.14 },
    reverb: { size: 0.34, damp: 0.72, mix: 0.2 },
    output: 0.78,
  }),
  classicPreset({
    id: "siren-pad",
    label: "Siren Pad",
    blurb: "Haunting interval pad with a vocal-ish filter color.",
    wave: "sine",
    subWave: "triangle",
    subTune: 7,
    cutoff: 1500,
    q: 3.4,
    env: { attack: 1.1, decay: 0.7, sustain: 0.86, release: 3 },
    lfo: { rate: 0.08, depth: 0.4, amount: 0.32 },
    reverb: { size: 0.84, damp: 0.48, mix: 0.4 },
    output: 0.66,
  }),
  classicPreset({
    id: "noir-bass",
    label: "Noir Bass",
    blurb: "Dark sine-square bass for moody downtempo sketches.",
    wave: "sine",
    subWave: "square",
    subTune: -12,
    cutoff: 360,
    q: 3.8,
    env: { attack: 0.012, decay: 0.24, sustain: 0.68, release: 0.34 },
    drive: { amount: 2.2, level: 0.76 },
    output: 0.82,
  }),
  classicPreset({
    id: "thin-reed-lead",
    label: "Thin Reed Lead",
    blurb: "Nasal pulse lead with enough edge to cut through a mix.",
    wave: "square",
    subWave: "triangle",
    subTune: 12,
    cutoff: 2400,
    q: 5.4,
    env: { attack: 0.006, decay: 0.15, sustain: 0.62, release: 0.22 },
    delay: { time: 0.2, feedback: 0.26, mix: 0.2 },
    output: 0.66,
  }),
  {
    id: "sequence-bass-riff",
    label: "Sequence Bass Riff",
    blurb: "Eight-step CV riff patched into pitch and filter.",
    patch: {
      modules: [
        mod("keyboard", "kbd", 40, 220),
        mod("sequencer", "seq", 40, 440, {
          rate: 4,
          steps: 8,
          gate: 0.5,
          s1: 0,
          s2: -0.2,
          s3: 0.35,
          s4: 0,
          s5: 0.55,
          s6: 0.25,
          s7: -0.1,
          s8: 0.4,
        }),
        mod("oscillator", "osc", 300, 160, { waveform: "sawtooth", tune: -12 }),
        mod("filter", "filt", 540, 160, { mode: "lowpass", cutoff: 560, q: 7.5 }),
        mod("drive", "drive", 760, 160, { amount: 7, level: 0.62 }),
        mod("vca", "vca", 960, 160, { gain: 0 }),
        mod("adsr", "env", 540, 390, { attack: 0.002, decay: 0.12, sustain: 0.18, release: 0.12 }),
        commonOutput(0.68),
      ],
      connections: [
        conn("c1", ["kbd", "freq"], ["osc", "freq"]),
        conn("c2", ["seq", "cv"], ["osc", "freq"], 0.26),
        conn("c3", ["osc", "out"], ["filt", "in"]),
        conn("c4", ["seq", "cv"], ["filt", "cutoff"], 0.55),
        conn("c5", ["filt", "out"], ["drive", "in"]),
        conn("c6", ["drive", "out"], ["vca", "in"]),
        conn("c7", ["seq", "gate"], ["env", "gate"]),
        conn("c8", ["env", "env"], ["vca", "gain"]),
        conn("c9", ["vca", "out"], ["out", "in"]),
      ],
    },
  },
];

export function synthPresetById(id: string): SynthPreset | undefined {
  return SYNTH_PRESETS.find((preset) => preset.id === id);
}
import { defaultVoice, makeModule } from "./registry";
import type { ModuleType, Patch } from "./types";

type ModSpec = [ModuleType, string];
type ConnSpec = [string, string, string, string, number?];

/** Compact patch builder: lay modules out in a grid and wire them up. */
function build(
  mods: ModSpec[],
  conns: ConnSpec[],
  params: Record<string, Record<string, number | string>> = {},
): Patch {
  const modules = mods.map(([type, id], i) => {
    const m = makeModule(type, id, 40 + (i % 4) * 250, 120 + Math.floor(i / 4) * 220);
    if (params[id]) m.params = { ...m.params, ...params[id] };
    return m;
  });
  const connections = conns.map(([fm, fp, tm, tp, s], i) => ({
    id: `c${i}`,
    from: { module: fm, port: fp },
    to: { module: tm, port: tp },
    strength: s ?? 1,
  }));
  return { modules, connections };
}

export type PresetCategory =
  | "Starter"
  | "Bass"
  | "Keys"
  | "Pads"
  | "Leads"
  | "Textures"
  | "Percussion";
export type Preset = { id: string; label: string; category: PresetCategory; make: () => Patch };

function clonePatch(patch: ModularTypes.Patch): Patch {
  return JSON.parse(JSON.stringify(patch)) as Patch;
}

function presetCategory(preset: SynthPreset): PresetCategory {
  const text = `${preset.id} ${preset.label} ${preset.blurb}`.toLowerCase();
  if (/perc|drum|noise hit|industrial/.test(text)) return "Percussion";
  if (/bass|sub|acid|303|riff/.test(text)) return "Bass";
  if (/pad|drone|choir|swell|string/.test(text)) return "Pads";
  if (/lead|hook|arp|laser/.test(text)) return "Leads";
  if (/bell|tine|keys|organ|piano|pluck/.test(text)) return "Keys";
  if (/noise|burble|texture|morph|random|cinematic/.test(text)) return "Textures";
  return "Keys";
}

/** Built-in starting points — also a showcase of the module palette. */
export const PRESETS: Preset[] = [
  { id: "init", label: "Init voice", category: "Starter", make: defaultVoice },
  {
    id: "acid",
    label: "Acid bass",
    category: "Starter",
    make: () =>
      build(
        [
          ["keyboard", "kbd"],
          ["oscillator", "osc"],
          ["filter", "filt"],
          ["drive", "drv"],
          ["vca", "vca"],
          ["adsr", "env"],
          ["output", "out"],
        ],
        [
          ["kbd", "freq", "osc", "freq"],
          ["osc", "out", "filt", "in"],
          ["filt", "out", "drv", "in"],
          ["drv", "out", "vca", "in"],
          ["vca", "out", "out", "in"],
          ["kbd", "gate", "env", "gate"],
          ["env", "env", "vca", "gain"],
          ["env", "env", "filt", "cutoff", 0.6],
        ],
        {
          osc: { waveform: "sawtooth" },
          filt: { cutoff: 300, q: 12 },
          drv: { amount: 8, level: 0.8 },
          env: { attack: 0.005, decay: 0.18, sustain: 0.0, release: 0.12 },
        },
      ),
  },
  {
    id: "dreampad",
    label: "Dream pad",
    category: "Starter",
    make: () =>
      build(
        [
          ["keyboard", "kbd"],
          ["oscillator", "osc"],
          ["filter", "filt"],
          ["vca", "vca"],
          ["reverb", "rev"],
          ["adsr", "env"],
          ["lfo", "lfo"],
          ["output", "out"],
        ],
        [
          ["kbd", "freq", "osc", "freq"],
          ["osc", "out", "filt", "in"],
          ["filt", "out", "vca", "in"],
          ["vca", "out", "rev", "in"],
          ["rev", "out", "out", "in"],
          ["kbd", "gate", "env", "gate"],
          ["env", "env", "vca", "gain"],
          ["lfo", "out", "filt", "cutoff", 0.4],
        ],
        {
          osc: { waveform: "sawtooth" },
          filt: { cutoff: 2200, q: 1 },
          env: { attack: 0.8, decay: 0.4, sustain: 0.8, release: 1.6 },
          lfo: { rate: 0.3, depth: 0.5 },
          rev: { size: 0.8, damp: 0.4, mix: 0.45 },
        },
      ),
  },
  {
    id: "noiseperc",
    label: "Noise perc",
    category: "Starter",
    make: () =>
      build(
        [
          ["keyboard", "kbd"],
          ["noise", "noise"],
          ["filter", "filt"],
          ["vca", "vca"],
          ["adsr", "env"],
          ["output", "out"],
        ],
        [
          ["noise", "out", "filt", "in"],
          ["filt", "out", "vca", "in"],
          ["vca", "out", "out", "in"],
          ["kbd", "gate", "env", "gate"],
          ["env", "env", "vca", "gain"],
        ],
        {
          noise: { type: "white" },
          filt: { mode: "bandpass", cutoff: 4000, q: 4 },
          env: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.08 },
        },
      ),
  },
  {
    id: "dubecho",
    label: "Dub echo",
    category: "Starter",
    make: () =>
      build(
        [
          ["keyboard", "kbd"],
          ["oscillator", "osc"],
          ["filter", "filt"],
          ["vca", "vca"],
          ["delay", "dly"],
          ["adsr", "env"],
          ["output", "out"],
        ],
        [
          ["kbd", "freq", "osc", "freq"],
          ["osc", "out", "filt", "in"],
          ["filt", "out", "vca", "in"],
          ["vca", "out", "dly", "in"],
          ["dly", "out", "out", "in"],
          ["kbd", "gate", "env", "gate"],
          ["env", "env", "vca", "gain"],
        ],
        {
          osc: { waveform: "square" },
          filt: { cutoff: 1400, q: 2 },
          env: { attack: 0.005, decay: 0.25, sustain: 0, release: 0.2 },
          dly: { time: 0.38, feedback: 0.55, mix: 0.4 },
        },
      ),
  },
  ...SYNTH_PRESETS.map((preset) => ({
    id: `synth:${preset.id}`,
    label: preset.label,
    category: presetCategory(preset),
    make: () => clonePatch(preset.patch),
  })),
];

const STORE_INDEX = "pizzo-patches";
const STORE_PREFIX = "pizzo-patch:";

/** User-saved patch names (localStorage). */
export function savedPatchNames(): string[] {
  try {
    const raw = localStorage.getItem(STORE_INDEX);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function savePatch(name: string, patch: Patch): void {
  const names = savedPatchNames();
  if (!names.includes(name)) {
    localStorage.setItem(STORE_INDEX, JSON.stringify([...names, name]));
  }
  localStorage.setItem(STORE_PREFIX + name, JSON.stringify(patch));
}

export function loadPatch(name: string): Patch | null {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + name);
    return raw ? (JSON.parse(raw) as Patch) : null;
  } catch {
    return null;
  }
}

/** Validate that an unknown value is a usable patch. */
export function isPatch(value: unknown): value is Patch {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.modules) && Array.isArray(v.connections);
}
