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

export type Preset = { id: string; label: string; make: () => Patch };

/** Built-in starting points — also a showcase of the module palette. */
export const PRESETS: Preset[] = [
  { id: "init", label: "Init voice", make: defaultVoice },
  {
    id: "acid",
    label: "Acid bass",
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
