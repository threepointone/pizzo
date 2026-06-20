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
