import type { ModuleType, Patch, PatchModule } from "./types";

export type PortKind = "audio" | "cv";

export type PortDef = {
  id: string;
  label: string;
  kind: PortKind;
};

export type ParamDef =
  | {
      id: string;
      label: string;
      kind: "number";
      min: number;
      max: number;
      step: number;
      default: number;
      /** Slider response: linear or exponential (for frequencies). */
      curve?: "linear" | "exp";
      unit?: string;
    }
  | {
      id: string;
      label: string;
      kind: "enum";
      options: string[];
      default: string;
    };

export type ModuleCategory = "interface" | "audio" | "control" | "output";

export type ModuleDef = {
  type: ModuleType;
  label: string;
  category: ModuleCategory;
  /** Accent color (hex) used on the canvas node + ports. */
  color: string;
  blurb: string;
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamDef[];
};

const WAVEFORMS = ["sawtooth", "square", "triangle", "sine"];

export const MODULES: Record<ModuleType, ModuleDef> = {
  keyboard: {
    type: "keyboard",
    label: "Keyboard",
    category: "interface",
    color: "#22c55e",
    blurb: "Note source. Outputs pitch (Hz) and a gate when keys are held.",
    inputs: [],
    outputs: [
      { id: "freq", label: "pitch", kind: "cv" },
      { id: "gate", label: "gate", kind: "cv" },
    ],
    params: [],
  },
  oscillator: {
    type: "oscillator",
    label: "Oscillator",
    category: "audio",
    color: "#f97316",
    blurb: "Generates a raw waveform at the incoming pitch.",
    inputs: [{ id: "freq", label: "pitch", kind: "cv" }],
    outputs: [{ id: "out", label: "audio", kind: "audio" }],
    params: [
      { id: "waveform", label: "Wave", kind: "enum", options: WAVEFORMS, default: "sawtooth" },
      {
        id: "tune",
        label: "Tune",
        kind: "number",
        min: -24,
        max: 24,
        step: 1,
        default: 0,
        unit: "st",
      },
    ],
  },
  noise: {
    type: "noise",
    label: "Noise",
    category: "audio",
    color: "#94a3b8",
    blurb: "White or pink noise — great for percussion, wind, and texture.",
    inputs: [],
    outputs: [{ id: "out", label: "audio", kind: "audio" }],
    params: [
      { id: "type", label: "Color", kind: "enum", options: ["white", "pink"], default: "white" },
    ],
  },
  filter: {
    type: "filter",
    label: "Filter",
    category: "audio",
    color: "#38bdf8",
    blurb: "State-variable filter. Modulate the cutoff for sweeps.",
    inputs: [
      { id: "in", label: "audio", kind: "audio" },
      { id: "cutoff", label: "cutoff", kind: "cv" },
    ],
    outputs: [{ id: "out", label: "audio", kind: "audio" }],
    params: [
      {
        id: "mode",
        label: "Mode",
        kind: "enum",
        options: ["lowpass", "highpass", "bandpass"],
        default: "lowpass",
      },
      {
        id: "cutoff",
        label: "Cutoff",
        kind: "number",
        min: 20,
        max: 18000,
        step: 1,
        default: 1200,
        curve: "exp",
        unit: "Hz",
      },
      { id: "q", label: "Reso", kind: "number", min: 0.5, max: 18, step: 0.1, default: 1.5 },
    ],
  },
  drive: {
    type: "drive",
    label: "Drive",
    category: "audio",
    color: "#ef4444",
    blurb: "Saturating overdrive (tanh). Push the amount for warmth or grit.",
    inputs: [{ id: "in", label: "audio", kind: "audio" }],
    outputs: [{ id: "out", label: "audio", kind: "audio" }],
    params: [
      {
        id: "amount",
        label: "Drive",
        kind: "number",
        min: 1,
        max: 40,
        step: 0.1,
        default: 4,
        curve: "exp",
      },
      { id: "level", label: "Level", kind: "number", min: 0, max: 1, step: 0.01, default: 0.8 },
    ],
  },
  vca: {
    type: "vca",
    label: "VCA",
    category: "audio",
    color: "#a78bfa",
    blurb: "Voltage-controlled amplifier. Drive the gain with an envelope or LFO.",
    inputs: [
      { id: "in", label: "audio", kind: "audio" },
      { id: "gain", label: "gain", kind: "cv" },
    ],
    outputs: [{ id: "out", label: "audio", kind: "audio" }],
    params: [{ id: "gain", label: "Gain", kind: "number", min: 0, max: 1, step: 0.01, default: 0 }],
  },
  adsr: {
    type: "adsr",
    label: "ADSR",
    category: "control",
    color: "#f43f5e",
    blurb: "Envelope. Shapes how a sound rises and falls when a gate fires.",
    inputs: [{ id: "gate", label: "gate", kind: "cv" }],
    outputs: [{ id: "env", label: "env", kind: "cv" }],
    params: [
      {
        id: "attack",
        label: "Attack",
        kind: "number",
        min: 0.001,
        max: 4,
        step: 0.001,
        default: 0.01,
        curve: "exp",
        unit: "s",
      },
      {
        id: "decay",
        label: "Decay",
        kind: "number",
        min: 0.001,
        max: 4,
        step: 0.001,
        default: 0.2,
        curve: "exp",
        unit: "s",
      },
      { id: "sustain", label: "Sustain", kind: "number", min: 0, max: 1, step: 0.01, default: 0.7 },
      {
        id: "release",
        label: "Release",
        kind: "number",
        min: 0.001,
        max: 6,
        step: 0.001,
        default: 0.4,
        curve: "exp",
        unit: "s",
      },
    ],
  },
  lfo: {
    type: "lfo",
    label: "LFO",
    category: "control",
    color: "#eab308",
    blurb: "Low-frequency oscillator for modulation (vibrato, sweeps, tremolo).",
    inputs: [],
    outputs: [{ id: "out", label: "cv", kind: "cv" }],
    params: [
      { id: "waveform", label: "Wave", kind: "enum", options: WAVEFORMS, default: "sine" },
      {
        id: "rate",
        label: "Rate",
        kind: "number",
        min: 0.01,
        max: 30,
        step: 0.01,
        default: 4,
        curve: "exp",
        unit: "Hz",
      },
      { id: "depth", label: "Depth", kind: "number", min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
  },
  delay: {
    type: "delay",
    label: "Delay",
    category: "audio",
    color: "#06b6d4",
    blurb: "Echo. Feedback repeats it; mix blends wet against dry.",
    inputs: [{ id: "in", label: "audio", kind: "audio" }],
    outputs: [{ id: "out", label: "audio", kind: "audio" }],
    params: [
      {
        id: "time",
        label: "Time",
        kind: "number",
        min: 0.02,
        max: 1.2,
        step: 0.01,
        default: 0.3,
        curve: "exp",
        unit: "s",
      },
      {
        id: "feedback",
        label: "Feedback",
        kind: "number",
        min: 0,
        max: 0.95,
        step: 0.01,
        default: 0.35,
      },
      { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, step: 0.01, default: 0.3 },
    ],
  },
  reverb: {
    type: "reverb",
    label: "Reverb",
    category: "audio",
    color: "#2dd4bf",
    blurb: "Space. Size sets the tail length, damp rolls off the highs.",
    inputs: [{ id: "in", label: "audio", kind: "audio" }],
    outputs: [{ id: "out", label: "audio", kind: "audio" }],
    params: [
      { id: "size", label: "Size", kind: "number", min: 0, max: 1, step: 0.01, default: 0.6 },
      { id: "damp", label: "Damp", kind: "number", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, step: 0.01, default: 0.3 },
    ],
  },
  mixer: {
    type: "mixer",
    label: "Mixer",
    category: "audio",
    color: "#cbd5e1",
    blurb: "Blend two audio sources with independent levels.",
    inputs: [
      { id: "a", label: "a", kind: "audio" },
      { id: "b", label: "b", kind: "audio" },
    ],
    outputs: [{ id: "out", label: "audio", kind: "audio" }],
    params: [
      { id: "gainA", label: "Gain A", kind: "number", min: 0, max: 1, step: 0.01, default: 0.8 },
      { id: "gainB", label: "Gain B", kind: "number", min: 0, max: 1, step: 0.01, default: 0.8 },
    ],
  },
  output: {
    type: "output",
    label: "Output",
    category: "output",
    color: "#e5e7eb",
    blurb: "The speakers. Whatever reaches here is what you hear.",
    inputs: [{ id: "in", label: "audio", kind: "audio" }],
    outputs: [],
    params: [
      { id: "level", label: "Level", kind: "number", min: 0, max: 1, step: 0.01, default: 0.8 },
    ],
  },
};

export const MODULE_TYPES = Object.keys(MODULES) as ModuleType[];

/** Default parameter object for a freshly placed module. */
export function defaultParams(type: ModuleType): Record<string, number | string> {
  const params: Record<string, number | string> = {};
  for (const p of MODULES[type].params) params[p.id] = p.default;
  return params;
}

export function makeModule(type: ModuleType, id: string, x: number, y: number): PatchModule {
  return { id, type, x, y, params: defaultParams(type) };
}

/**
 * The canonical starter: a classic subtractive voice.
 * keyboard → oscillator → filter → vca → output, with adsr → vca.gain and
 * lfo → filter.cutoff.
 */
export function defaultVoice(): Patch {
  const m = (type: ModuleType, id: string, x: number, y: number) => makeModule(type, id, x, y);
  return {
    modules: [
      m("keyboard", "kbd", 40, 220),
      m("oscillator", "osc", 300, 120),
      m("filter", "filt", 560, 120),
      m("vca", "vca", 820, 120),
      m("adsr", "env", 560, 360),
      m("lfo", "lfo", 300, 360),
      m("output", "out", 1080, 140),
    ],
    connections: [
      {
        id: "c1",
        from: { module: "kbd", port: "freq" },
        to: { module: "osc", port: "freq" },
        strength: 1,
      },
      {
        id: "c2",
        from: { module: "osc", port: "out" },
        to: { module: "filt", port: "in" },
        strength: 1,
      },
      {
        id: "c3",
        from: { module: "filt", port: "out" },
        to: { module: "vca", port: "in" },
        strength: 1,
      },
      {
        id: "c4",
        from: { module: "vca", port: "out" },
        to: { module: "out", port: "in" },
        strength: 1,
      },
      {
        id: "c5",
        from: { module: "kbd", port: "gate" },
        to: { module: "env", port: "gate" },
        strength: 1,
      },
      {
        id: "c6",
        from: { module: "env", port: "env" },
        to: { module: "vca", port: "gain" },
        strength: 1,
      },
      {
        id: "c7",
        from: { module: "lfo", port: "out" },
        to: { module: "filt", port: "cutoff" },
        strength: 0.5,
      },
    ],
  };
}

/** Look up a port definition for a module instance. */
export function portDef(type: ModuleType, port: string): (PortDef & { dir: "in" | "out" }) | null {
  const def = MODULES[type];
  const input = def.inputs.find((p) => p.id === port);
  if (input) return { ...input, dir: "in" };
  const output = def.outputs.find((p) => p.id === port);
  if (output) return { ...output, dir: "out" };
  return null;
}
