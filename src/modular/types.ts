/**
 * The modular surface's data model — a freeform node graph, ZOIA-style.
 *
 * A `Patch` is the shareable source of truth (lives in agent state alongside
 * the song). It is a graph of `modules` (nodes) wired by `connections`
 * (cables). Audio and CV (control voltage) both flow through connections;
 * every connection carries a `strength` (its amount / attenuverter), mirroring
 * the ZOIA model. The patch compiles to a single Elementary `el` expression.
 */

export type ModuleType =
  | "keyboard"
  | "oscillator"
  | "noise"
  | "filter"
  | "drive"
  | "vca"
  | "adsr"
  | "lfo"
  | "sampleHold"
  | "sequencer"
  | "slew"
  | "delay"
  | "reverb"
  | "wavefolder"
  | "chorus"
  | "mixer"
  | "output";

export type PatchModule = {
  id: string;
  type: ModuleType;
  /** Canvas position. */
  x: number;
  y: number;
  /** Parameter values keyed by the param ids declared in the registry. */
  params: Record<string, number | string>;
};

export type PortRef = {
  module: string;
  port: string;
};

export type PatchConnection = {
  id: string;
  from: PortRef;
  to: PortRef;
  /**
   * Connection amount. For CV it scales the modulation (think attenuverter,
   * roughly -1..1+); for audio it acts as a gain (default 1).
   */
  strength: number;
};

export type Patch = {
  modules: PatchModule[];
  connections: PatchConnection[];
};
