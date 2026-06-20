import { el } from "@elemaudio/core";
import type { Patch, PatchModule } from "./types";

type Node = ReturnType<typeof el.const>;

/** Live values for one synth voice, fed in at compile time. */
export type Voice = {
  /** Current note frequency in Hz (0 when nothing held). */
  freq: number;
  /** 1 while a key is held, 0 otherwise — drives envelopes. */
  gate: number;
};

/** Additive cutoff-modulation range in Hz for a unit CV signal. */
const CUTOFF_MOD_RANGE = 5000;

function osc(wave: string, freq: Node | number): Node {
  switch (wave) {
    case "square":
      return el.blepsquare(freq);
    case "triangle":
      return el.bleptriangle(freq);
    case "sine":
      return el.cycle(freq);
    case "sawtooth":
    default:
      return el.blepsaw(freq);
  }
}

/**
 * Compile one voice of a patch graph to a mono Elementary signal.
 *
 * Resolution is lazy + memoized, starting from the `output` module and walking
 * backwards through connections. Each connection's `strength` scales its
 * source signal before it's summed into the destination port (ZOIA-style).
 * Cycles are guarded (return silence) — feedback comes later.
 *
 * The keyboard's freq/gate consts are keyed per voice index, so each voice
 * forks into its own distinct DSP (oscillators, filters, envelopes). Nodes that
 * don't depend on the keyboard (e.g. a shared LFO) are structurally identical
 * across voices and get deduped by Elementary into one instance.
 */
function compileVoice(patch: Patch, vi: number, ctx: Voice, sampleRate: number): Node {
  const byId = new Map(patch.modules.map((m) => [m.id, m]));
  const memo = new Map<string, Node>();
  const visiting = new Set<string>();

  const num = (m: PatchModule, id: string, fallback = 0): number => {
    const v = m.params[id];
    return typeof v === "number" ? v : fallback;
  };
  const pconst = (m: PatchModule, id: string, fallback = 0): Node =>
    el.const({ key: `${m.id}:${id}`, value: num(m, id, fallback) });
  /** Smoothed param const — kills zipper noise on knob/cable changes. */
  const psm = (m: PatchModule, id: string, fallback = 0): Node => el.sm(pconst(m, id, fallback));

  /** Sum of all sources feeding `module.port`, each scaled by its strength. */
  function inputSignal(moduleId: string, port: string): Node | null {
    const conns = patch.connections.filter((c) => c.to.module === moduleId && c.to.port === port);
    if (conns.length === 0) return null;
    const terms = conns.map((c) => {
      const src = output(c.from.module, c.from.port);
      return c.strength === 1 ? src : el.mul(src, el.const({ value: c.strength }));
    });
    return terms.reduce((a, b) => el.add(a, b));
  }

  function output(moduleId: string, port: string): Node {
    const key = `${moduleId}:${port}`;
    const cached = memo.get(key);
    if (cached) return cached;
    if (visiting.has(key)) return el.const({ value: 0 }); // cycle guard
    visiting.add(key);
    const mod = byId.get(moduleId);
    const result = mod ? compute(mod, port) : el.const({ value: 0 });
    visiting.delete(key);
    memo.set(key, result);
    return result;
  }

  function compute(m: PatchModule, port: string): Node {
    switch (m.type) {
      case "keyboard":
        return port === "gate"
          ? el.const({ key: `kbd_gate_${vi}`, value: ctx.gate })
          : el.const({ key: `kbd_freq_${vi}`, value: ctx.freq });

      case "oscillator": {
        const freqIn = inputSignal(m.id, "freq") ?? el.const({ value: 220 });
        const tune = num(m, "tune");
        const freq =
          tune === 0
            ? freqIn
            : el.mul(freqIn, el.sm(el.const({ key: `${m.id}:tunef`, value: 2 ** (tune / 12) })));
        return osc(String(m.params.waveform ?? "sawtooth"), freq);
      }

      case "noise":
        return String(m.params.type) === "pink" ? el.pinknoise() : el.noise();

      case "filter": {
        const input = inputSignal(m.id, "in") ?? el.const({ value: 0 });
        const mod = inputSignal(m.id, "cutoff");
        let fc: Node = psm(m, "cutoff", 1200);
        if (mod) fc = el.add(fc, el.mul(mod, el.const({ value: CUTOFF_MOD_RANGE })));
        fc = el.min(el.const({ value: 18000 }), el.max(el.const({ value: 20 }), fc));
        return el.svf({ mode: String(m.params.mode ?? "lowpass") }, fc, psm(m, "q", 1.5), input);
      }

      case "drive": {
        const input = inputSignal(m.id, "in") ?? el.const({ value: 0 });
        const driven = el.tanh(el.mul(input, psm(m, "amount", 4)));
        return el.mul(driven, psm(m, "level", 0.8));
      }

      case "vca": {
        const input = inputSignal(m.id, "in") ?? el.const({ value: 0 });
        const mod = inputSignal(m.id, "gain");
        let gain: Node = psm(m, "gain", 0);
        if (mod) gain = el.add(gain, mod);
        gain = el.min(el.const({ value: 1 }), el.max(el.const({ value: 0 }), gain));
        return el.mul(input, gain);
      }

      case "adsr": {
        const gate = inputSignal(m.id, "gate") ?? el.const({ value: 0 });
        return el.adsr(
          pconst(m, "attack", 0.01),
          pconst(m, "decay", 0.2),
          pconst(m, "sustain", 0.7),
          pconst(m, "release", 0.4),
          gate,
        );
      }

      case "lfo": {
        const wave = osc(String(m.params.waveform ?? "sine"), psm(m, "rate", 4));
        return el.mul(wave, psm(m, "depth", 0.5));
      }

      case "delay": {
        const input = inputSignal(m.id, "in") ?? el.const({ value: 0 });
        const lenSamples = Math.max(
          1,
          Math.min(1 << 16, Math.round(num(m, "time", 0.3) * sampleRate)),
        );
        const wet = el.delay(
          { size: 1 << 16, key: `${m.id}:dl:${vi}` },
          el.sm(el.const({ key: `${m.id}:len`, value: lenSamples })),
          psm(m, "feedback", 0.35),
          input,
        );
        const mix = psm(m, "mix", 0.3);
        return el.add(el.mul(input, el.sub(el.const({ value: 1 }), mix)), el.mul(wet, mix));
      }

      case "reverb": {
        const input = inputSignal(m.id, "in") ?? el.const({ value: 0 });
        const damp = num(m, "damp", 0.5);
        const damped = el.smooth(el.const({ key: `${m.id}:damp`, value: 0.2 + 0.7 * damp }), input);
        const fb = psm(m, "size", 0.6); // size → feedback amount
        const fbGain = el.add(el.const({ value: 0.7 }), el.mul(fb, el.const({ value: 0.28 })));
        const combTimes = [0.0297, 0.0371, 0.0411, 0.0437];
        const combs = combTimes.map((t, i) =>
          el.delay(
            { size: 1 << 13, key: `${m.id}:rv${i}:${vi}` },
            el.const({ key: `${m.id}:rl${i}`, value: Math.round(t * sampleRate) }),
            fbGain,
            damped,
          ),
        );
        const wet = el.mul(
          combs.reduce((a, b) => el.add(a, b)),
          el.const({ value: 0.25 }),
        );
        const mix = psm(m, "mix", 0.3);
        return el.add(el.mul(input, el.sub(el.const({ value: 1 }), mix)), el.mul(wet, mix));
      }

      case "mixer": {
        const a = inputSignal(m.id, "a") ?? el.const({ value: 0 });
        const b = inputSignal(m.id, "b") ?? el.const({ value: 0 });
        return el.add(el.mul(a, psm(m, "gainA", 0.8)), el.mul(b, psm(m, "gainB", 0.8)));
      }

      case "output": {
        const input = inputSignal(m.id, "in") ?? el.const({ value: 0 });
        return el.mul(input, psm(m, "level", 0.8));
      }

      default:
        return el.const({ value: 0 });
    }
  }

  const out = patch.modules.find((m) => m.type === "output");
  return out ? output(out.id, "in") : el.const({ value: 0 });
}

/**
 * Compile a patch into a stereo Elementary expression, summing all voices.
 * The graph structure stays fixed across notes (one subgraph per voice slot);
 * playing a note only changes that voice's freq/gate const values, so renders
 * are cheap reconciles rather than rebuilds.
 */
export function compilePatch(
  patch: Patch,
  voices: Voice[],
  sampleRate = 44100,
): { left: Node; right: Node } {
  if (voices.length === 0) {
    const silent = el.const({ value: 0 });
    return { left: silent, right: silent };
  }
  const summed = voices
    .map((v, i) => compileVoice(patch, i, v, sampleRate))
    .reduce((a, b) => el.add(a, b));
  // Headroom so stacked voices don't clip.
  const mono = el.mul(summed, el.const({ value: 1 / Math.sqrt(voices.length) }));
  return { left: mono, right: mono };
}
