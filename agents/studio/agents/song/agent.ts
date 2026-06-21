import { Think } from "@cloudflare/think";
import { createWorkersAI } from "workers-ai-provider";
import { tool } from "ai";
import { z } from "zod";
import {
  analyzeRomanNumerals,
  applyVibe,
  BASS_STYLES,
  BEAT_VOICES,
  chordFunctions,
  DRUM_STYLES,
  defaultArrangement,
  defaultEffects,
  defaultGroove,
  defaultMelody,
  defaultMix,
  defaultSongState,
  EFFECT_PRESETS,
  emptyBeat,
  euclid,
  euclidBeat,
  guessKey,
  INSTRUMENTS,
  isChord,
  makeSection,
  MELODY_STYLES,
  normalizeEffects,
  parseProgression,
  reharmonize,
  SEQ_STEPS,
  songStateFromProgression,
  suggestNextChords,
  transposeProgression,
  VIBES,
  type BassStyle,
  type Beat,
  type DrumStyle,
  type DrumVoice,
  type EffectPreset,
  type EffectTrack,
  type MelodyStyle,
  type ReharmonizeStyle,
  type Section,
  type SongState,
  type TrackEffects,
} from "../../../../src/music/song";
import { LAUNCH_INTENTS } from "../../../../src/music/intents";
import { MODULE_TYPES, defaultVoice } from "../../../../src/modular/registry";
import {
  addModule,
  connect,
  describeModulePalette,
  removeModule,
  setModuleParam,
  summarizePatch,
} from "../../../../src/modular/edit";
import type { ModuleType, Patch } from "../../../../src/modular/types";

/** Models pass array args inconsistently — accept array, JSON string, or "Am F C G". */
function normalizeChords(input: string[] | string): string[] {
  if (Array.isArray(input)) return input;
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // not JSON — fall through to space/comma parsing
  }
  return parseProgression(input);
}

/** Resolve a model-supplied instrument string to a known GM id (by id or label). */
function resolveInstrument(input: string): string | null {
  const q = input.trim().toLowerCase();
  const byId = INSTRUMENTS.find((i) => i.id === q);
  if (byId) return byId.id;
  const byLabel = INSTRUMENTS.find(
    (i) => i.label.toLowerCase() === q || i.id.replace(/_/g, " ") === q,
  );
  if (byLabel) return byLabel.id;
  const fuzzy = INSTRUMENTS.find(
    (i) => i.label.toLowerCase().includes(q) || i.id.includes(q.replace(/ /g, "_")),
  );
  return fuzzy?.id ?? null;
}

/** Map a loose bass-style string to a known id (default "root"). */
function resolveBassStyle(input?: string): BassStyle {
  if (!input) return "root";
  const q = input.trim().toLowerCase();
  const match = BASS_STYLES.find(
    (s) =>
      s.id.toLowerCase() === q ||
      s.label.toLowerCase().includes(q) ||
      q.includes(s.id.toLowerCase()),
  );
  return (match?.id as BassStyle) ?? "root";
}

/** Map a loose drum-style string to a known id (default "rock"). */
function resolveDrumStyle(input?: string): DrumStyle {
  if (!input) return "rock";
  const q = input
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  const match = DRUM_STYLES.find((s) => {
    const id = s.id.toLowerCase();
    const label = s.label.toLowerCase().replace(/[\s_-]/g, "");
    return id === q || label.includes(q) || q.includes(id);
  });
  return (match?.id as DrumStyle) ?? "rock";
}

/** Map a loose melody-style string to a known id (default "flowing"). */
function resolveMelodyStyle(input?: string): MelodyStyle {
  if (!input) return "flowing";
  const q = input.trim().toLowerCase();
  const match = MELODY_STYLES.find(
    (s) =>
      s.id.toLowerCase() === q ||
      s.label.toLowerCase().includes(q) ||
      q.includes(s.id.toLowerCase()),
  );
  return (match?.id as MelodyStyle) ?? "flowing";
}

function resolveEffectPreset(input: string): EffectPreset | null {
  const q = input.trim().toLowerCase();
  const norm = q.replace(/[^a-z0-9]/g, "");
  return (
    EFFECT_PRESETS.find((preset) => preset.id === q) ??
    EFFECT_PRESETS.find((preset) => preset.id.replace(/[^a-z0-9]/g, "") === norm) ??
    EFFECT_PRESETS.find(
      (preset) => preset.label.toLowerCase().replace(/[^a-z0-9]/g, "") === norm,
    ) ??
    EFFECT_PRESETS.find(
      (preset) => preset.label.toLowerCase().includes(q) || preset.blurb.toLowerCase().includes(q),
    ) ??
    null
  );
}

/** Parse a 16-step pattern string ("x.x.x.x.") into booleans. */
function parsePattern(input: string): boolean[] {
  const chars = input.replace(/\s+/g, "").slice(0, SEQ_STEPS).split("");
  const row = Array(SEQ_STEPS).fill(false);
  chars.forEach((c, i) => {
    row[i] = c === "x" || c === "X" || c === "1" || c === "#";
  });
  return row;
}

/**
 * Pizzo's studio assistant.
 *
 * The Song is the agent's broadcast `state` (persisted in the Durable Object
 * and mirrored to every connected browser). Tools mutate that state with
 * deterministic music theory from `tonal`; the browser reacts to state changes
 * by re-rendering the timeline and driving the Tone.js engine — including the
 * `playing` flag, so "play it" works straight from chat.
 */
export class Song extends Think<Env, SongState> {
  override initialState = defaultSongState;

  override getModel() {
    return createWorkersAI({ binding: this.env.AI })("@cf/moonshotai/kimi-k2.7-code", {
      sessionAffinity: this.sessionAffinity,
    });
  }

  /** Read this song's full state (used by the Studio to duplicate a song). */
  getSong(): SongState {
    return this.song();
  }

  /** Overwrite this song's state (used when duplicating into a fresh facet). */
  replaceSong(state: SongState): void {
    this.setState(state);
  }

  private song(): SongState {
    return this.state ?? defaultSongState;
  }

  private patch(): Patch {
    return this.song().patch ?? defaultVoice();
  }

  private setPatch(patch: Patch): void {
    this.setState({ ...this.song(), patch });
  }

  override getSystemPrompt() {
    const s = this.song();
    const prompt = [
      "You are the studio assistant inside Pizzo, an AI-assisted music app.",
      "The user is a capable musician but an amateur at music theory — you are their theory brain and arranger.",
      "You work by calling tools that change the live song. Never claim you changed something without calling the matching tool.",
      "Prefer making concrete edits over long explanations. Keep replies short and encouraging.",
      "When the user describes a vibe (sad, dreamy, triumphant, lofi…), translate it into a real chord progression in a fitting key and call setProgression.",
      `Common launch intents: ${LAUNCH_INTENTS.map((intent) => `${intent.label} = ${intent.prompt}`).join(" | ")}. Use applyVibe plus concrete tools so chat-created starts match the UI cards.`,
      "To change the sound/timbre of the CHORDS, call setInstrument with one of the available instruments.",
      "To 'build a band' / add a groove: call addDrums (pick a style fitting the vibe) and addBassline (walking for jazzy, root/octaves for pop/rock). Use busy 0–1 on drums for how energetic. removeDrums/removeBassline strip them back.",
      "For a custom beat, use programBeat with 16-step 'x.'-patterns per voice (kick/snare/hat/openhat/clap); it overrides the style groove. clearBeat reverts.",
      "For algorithmic/world rhythms use euclidBeat (pulses over steps per voice): e.g. 3-over-8 = tresillo, 5-over-8 = cinquillo, 4-over-16 = four-on-floor; rotate shifts the accent. Great when the user asks for a clave, polyrhythm, or 'spread N hits evenly'.",
      "To add a tune/lead: call addMelody (style arp/flowing/pop/ballad; instrument optional). The line is written to fit the key and follows chord changes. regenerateMelody gives a fresh variation; removeMelody strips it.",
      "To turn a loop into a full SONG, use setArrangement with sections (verse/chorus/bridge…), each with its own chords + repeats + per-section voice toggles (drums/bass/melody) to build dynamics (quiet verse → big chorus). Drum/bass/melody styles + instruments stay global, so set those too. addSection appends; clearArrangement returns to a single loop.",
      `For a whole genre feel in one move, use applyVibe with a name (${VIBES.map((v) => v.id).join("/")}). It sets tempo + sounds + drum/bass/melody styles (and a fitting progression unless an arrangement is active). Great for "make it lo-fi" / "give me a synthwave vibe".`,
      "TEACHING is part of the mission — the user is an amateur without much theory. Use explainTheory to break down their progression (key, Roman numerals, Tonic/Subdominant/Dominant function) in plain language. reharmonize (jazz = sevenths, simple = triads) gives their chords a fresh harmonic color. suggestNextChord proposes musical next chords; explain WHY each works, then offer to add it. Always teach a little when you make harmonic changes.",
      "To BALANCE the mix, use setMix (per-track volume/mute/solo for chords/bass/drums/melody, or master level) — 'turn down the drums', 'solo the bass', 'mute the melody'. To shape the FEEL, use setGroove (swing shuffles off-beats; humanize loosens timing/velocity) — 'add some swing', 'make it groovier', 'tighten it up' (0).",
      "Use setLoopMode when the user asks to loop forever or play the song once.",
      `To color sampled instruments/the band, use applyEffectPreset (${EFFECT_PRESETS.map((p) => p.id).join("/")}) or setEffects for per-track tone/drive/chorus/delay/reverb. Effects are post-instrument and pre-mixer.`,
      "",
      "Pizzo has two surfaces: the Chord Lab (progression + GM instrument) and the Modular surface (a patchable synth voice built from modules).",
      "When the user asks to design/tweak a SYNTH SOUND on the modular surface (brighter, fatter, slower attack, add an LFO, etc.), use the modular tools (setSynthParam, addSynthModule, connectSynth, removeSynthModule, resetSynth). Prefer setSynthParam for timbral tweaks. e.g. 'brighter' → raise the filter cutoff; 'snappier' → shorter attack/decay; 'wobble' → add/raise an LFO into filter cutoff.",
      "",
      "Current song:",
      `- Progression: ${s.chords.length ? s.chords.join(" ") : "(empty)"}`,
      `- Key: ${s.key} (${s.scale})`,
      `- Tempo: ${s.tempo} BPM`,
      `- Instrument: ${s.instrument}`,
      `- Bass: ${s.bass?.enabled ? `${s.bass.style}` : "off"}`,
      `- Drums: ${s.drums?.enabled ? `${s.drums.style} (busy ${s.drums.busy})` : "off"}`,
      `- Melody: ${s.melody?.enabled ? `${s.melody.style} on ${s.melody.instrument}` : "off"}`,
      `- Beat machine: ${s.beat?.enabled ? "custom pattern active" : "off"}`,
      `- Arrangement: ${
        s.arrangement?.enabled && s.arrangement.sections.length > 0
          ? s.arrangement.sections
              .map((sec) => `${sec.name}${sec.repeats > 1 ? `×${sec.repeats}` : ""}`)
              .join(" → ")
          : "off (single loop)"
      }`,
      `- Groove: swing ${Math.round((s.groove?.swing ?? 0) * 100)}%, humanize ${Math.round((s.groove?.humanize ?? 0) * 100)}%`,
      `- Effects: ${["chords", "bass", "drums", "melody"]
        .map((t) => {
          const fx = normalizeEffects(s.effects)[t as EffectTrack];
          return `${t} tone ${Math.round(fx.tone * 100)} drive ${Math.round(fx.drive * 100)} chorus ${Math.round(fx.chorus * 100)} delay ${Math.round(fx.delay * 100)} reverb ${Math.round(fx.reverb * 100)}`;
        })
        .join("; ")}`,
      `- Mix: ${["chords", "bass", "drums", "melody"]
        .map((t) => {
          const ch = (s.mix ?? defaultMix)[t as "chords"];
          return `${t} ${ch.mute ? "muted" : ch.solo ? "SOLO" : Math.round(ch.volume * 100)}`;
        })
        .join(", ")}`,
      `- Transport: ${s.playing ? "playing" : "stopped"}`,
      "",
      `Available instruments: ${INSTRUMENTS.map((i) => `${i.id} (${i.label})`).join(", ")}.`,
      `Bass styles: ${BASS_STYLES.map((b) => b.id).join(", ")}. Drum styles: ${DRUM_STYLES.map((d) => d.id).join(", ")}. Melody styles: ${MELODY_STYLES.map((m) => m.id).join(", ")}.`,
      "",
      "Modular synth — current patch:",
      summarizePatch(this.patch()),
      "",
      "Modular module palette (type: inputs / outputs / params):",
      describeModulePalette(),
    ].join("\n");
    return prompt;
  }

  override getTools() {
    return {
      setProgression: tool({
        description:
          "Replace the chord progression. Pass chords as an array of names like ['Am','F','C','G']. One chord per bar.",
        inputSchema: z.object({
          chords: z
            .union([z.array(z.string()), z.string()])
            .describe("Chord names, e.g. ['Am','F','C','G7','Dm7']"),
        }),
        execute: async ({ chords }) => {
          const valid = normalizeChords(chords).filter(isChord);
          if (valid.length === 0) {
            return {
              error: "No recognizable chords. Use names like Am, F, C, G7, Dm7.",
            };
          }
          const next = songStateFromProgression(valid, this.song());
          this.setState(next);
          return {
            chords: next.chords,
            key: next.key,
            scale: next.scale,
            romanNumerals: analyzeRomanNumerals(next.chords),
          };
        },
      }),

      setTempo: tool({
        description: "Set the song tempo in BPM (40–240).",
        inputSchema: z.object({ bpm: z.number() }),
        execute: async ({ bpm }) => {
          const tempo = Math.max(40, Math.min(240, Math.round(bpm)));
          this.setState({ ...this.song(), tempo });
          return { tempo };
        },
      }),

      transposeSong: tool({
        description:
          "Transpose the whole progression by a number of semitones (e.g. +2 up a step, -1 down a semitone).",
        inputSchema: z.object({ semitones: z.number() }),
        execute: async ({ semitones }) => {
          const current = this.song();
          const chords = transposeProgression(current.chords, semitones);
          const next = songStateFromProgression(chords, current);
          this.setState(next);
          return { chords: next.chords, key: next.key };
        },
      }),

      analyzeSong: tool({
        description:
          "Read the current progression and return its key and roman-numeral analysis. Use for theory questions; does not change anything.",
        inputSchema: z.object({}),
        execute: async () => {
          const s = this.song();
          return {
            chords: s.chords,
            key: s.key,
            scale: s.scale,
            tempo: s.tempo,
            romanNumerals: analyzeRomanNumerals(s.chords),
          };
        },
      }),

      setInstrument: tool({
        description:
          "Change the instrument/sound used to play the chords. Accepts a GM name or label like 'electric piano', 'warm pad', 'strings'.",
        inputSchema: z.object({ instrument: z.string() }),
        execute: async ({ instrument }) => {
          const id = resolveInstrument(instrument);
          if (!id) {
            return {
              error: `Unknown instrument. Options: ${INSTRUMENTS.map((i) => i.label).join(", ")}.`,
            };
          }
          this.setState({ ...this.song(), instrument: id });
          return { instrument: id };
        },
      }),

      play: tool({
        description: "Start playback of the looping song.",
        inputSchema: z.object({}),
        execute: async () => {
          this.setState({ ...this.song(), playing: true });
          return { playing: true };
        },
      }),

      stop: tool({
        description: "Stop playback.",
        inputSchema: z.object({}),
        execute: async () => {
          this.setState({ ...this.song(), playing: false });
          return { playing: false };
        },
      }),

      setLoopMode: tool({
        description: "Choose whether playback loops forever or plays through once and stops.",
        inputSchema: z.object({
          loop: z.boolean().describe("true = loop forever, false = play once"),
        }),
        execute: async ({ loop }) => {
          this.setState({ ...this.song(), loopSong: loop });
          return { loopSong: loop };
        },
      }),

      addDrums: tool({
        description:
          "Add (or change) a drum groove under the chords. style: fourOnFloor, rock, funk, lofi, halftime. busy 0–1 controls how many hats/ghost notes (energy).",
        inputSchema: z.object({
          style: z.string().optional(),
          busy: z.number().optional(),
        }),
        execute: async ({ style, busy }) => {
          const s = this.song();
          const drums = {
            enabled: true,
            style: resolveDrumStyle(style),
            busy: busy != null ? Math.max(0, Math.min(1, busy)) : (s.drums?.busy ?? 0),
          };
          this.setState({ ...s, drums });
          return { drums };
        },
      }),

      removeDrums: tool({
        description: "Remove the drum groove.",
        inputSchema: z.object({}),
        execute: async () => {
          const s = this.song();
          this.setState({ ...s, drums: { ...s.drums, enabled: false } });
          return { drums: { enabled: false } };
        },
      }),

      addBassline: tool({
        description:
          "Add (or change) a bassline that follows the chord roots. style: root, octaves, rootFifth, offbeat, walking (jazzy).",
        inputSchema: z.object({ style: z.string().optional() }),
        execute: async ({ style }) => {
          const s = this.song();
          const bass = {
            enabled: true,
            style: resolveBassStyle(style),
            octave: s.bass?.octave ?? 2,
          };
          this.setState({ ...s, bass });
          return { bass };
        },
      }),

      removeBassline: tool({
        description: "Remove the bassline.",
        inputSchema: z.object({}),
        execute: async () => {
          const s = this.song();
          this.setState({ ...s, bass: { ...s.bass, enabled: false } });
          return { bass: { enabled: false } };
        },
      }),

      addMelody: tool({
        description:
          "Add (or change) a lead/melody line over the chords. style: arp, flowing, pop, ballad. instrument is an optional sound (GM name/label, or 'modular'). The line is generated to fit the key and follows chord changes automatically.",
        inputSchema: z.object({
          style: z.string().optional(),
          instrument: z.string().optional(),
        }),
        execute: async ({ style, instrument }) => {
          const s = this.song();
          const prev = s.melody ?? defaultMelody;
          const resolvedInstrument = instrument
            ? (resolveInstrument(instrument) ?? prev.instrument)
            : prev.instrument;
          const melody = {
            enabled: true,
            style: resolveMelodyStyle(style),
            instrument: resolvedInstrument,
            // New style/instrument → fresh line; reseed so it feels intentional.
            seed: (prev.seed ?? 1) + 1,
          };
          this.setState({ ...s, melody });
          return { melody };
        },
      }),

      regenerateMelody: tool({
        description: "Generate a fresh variation of the melody (same style/instrument, new seed).",
        inputSchema: z.object({}),
        execute: async () => {
          const s = this.song();
          const prev = s.melody ?? defaultMelody;
          const melody = { ...prev, enabled: true, seed: (prev.seed ?? 1) + 1 };
          this.setState({ ...s, melody });
          return { melody };
        },
      }),

      removeMelody: tool({
        description: "Remove the melody line.",
        inputSchema: z.object({}),
        execute: async () => {
          const s = this.song();
          this.setState({ ...s, melody: { ...(s.melody ?? defaultMelody), enabled: false } });
          return { melody: { enabled: false } };
        },
      }),

      programBeat: tool({
        description:
          "Program the step sequencer (beat machine) directly. Pass each drum voice as a 16-character pattern of 'x' (hit) and '.' (rest), e.g. kick: 'x...x...x...x...'. Voices: kick, snare, hat, openhat, clap. This overrides the style-based groove. Set replace=true to clear other voices first.",
        inputSchema: z.object({
          kick: z.string().optional(),
          snare: z.string().optional(),
          hat: z.string().optional(),
          openhat: z.string().optional(),
          clap: z.string().optional(),
          replace: z.boolean().optional(),
        }),
        execute: async (rows) => {
          const s = this.song();
          const beat: Beat = rows.replace ? emptyBeat() : { ...s.beat, rows: { ...s.beat.rows } };
          for (const voice of BEAT_VOICES) {
            const pattern = rows[voice as keyof typeof rows];
            if (typeof pattern === "string") beat.rows[voice] = parsePattern(pattern);
          }
          beat.enabled = true;
          this.setState({ ...s, beat });
          return { steps: SEQ_STEPS, voices: BEAT_VOICES };
        },
      }),

      clearBeat: tool({
        description:
          "Clear the step sequencer and fall back to the style-based groove (or silence).",
        inputSchema: z.object({}),
        execute: async () => {
          this.setState({ ...this.song(), beat: emptyBeat() });
          return { beat: "cleared" };
        },
      }),

      euclidBeat: tool({
        description:
          "Write a Euclidean rhythm into one drum voice of the step sequencer: distribute `pulses` evenly across `steps` (e.g. 3 over 8 = tresillo 'x..x..x.', 5 over 8 = cinquillo). rotate shifts the pattern. The pattern tiles to fill the 16-step bar and overrides that voice's current row. Voices: kick, snare, hat, openhat, clap.",
        inputSchema: z.object({
          voice: z.enum(BEAT_VOICES as [string, ...string[]]),
          pulses: z.number().int().min(0).max(16),
          steps: z.number().int().min(1).max(16),
          rotate: z.number().int().optional(),
        }),
        execute: async ({ voice, pulses, steps, rotate }) => {
          const s = this.song();
          const beat = euclidBeat(s.beat, voice as DrumVoice, pulses, steps, rotate ?? 0);
          this.setState({ ...s, beat });
          return {
            voice,
            pattern: euclid(pulses, steps, rotate ?? 0)
              .map((on) => (on ? "x" : "."))
              .join(""),
          };
        },
      }),

      setArrangement: tool({
        description:
          "Build the song timeline from sections (verse/chorus/bridge/etc.), turning loops into a full song. Each section has its own chord progression, a repeat count, and per-section voice toggles to create dynamics (e.g. verse = bass only, chorus = the works). The drum/bass/melody STYLES and instruments stay global (set those with the other tools). Replaces any existing arrangement.",
        inputSchema: z.object({
          sections: z
            .array(
              z.object({
                name: z.string().optional(),
                chords: z.union([z.array(z.string()), z.string()]).optional(),
                repeats: z.number().int().min(1).max(16).optional(),
                drums: z.boolean().optional(),
                bass: z.boolean().optional(),
                melody: z.boolean().optional(),
                busy: z.number().min(0).max(1).optional(),
              }),
            )
            .min(1),
        }),
        execute: async ({ sections }) => {
          const built: Section[] = [];
          const skipped: string[] = [];
          for (const [index, sec] of sections.entries()) {
            if (sec.chords == null) {
              skipped.push(sec.name?.trim() || `section ${index + 1}`);
              continue;
            }
            const chords = normalizeChords(sec.chords).filter(isChord);
            if (chords.length === 0) {
              skipped.push(sec.name?.trim() || `section ${index + 1}`);
              continue;
            }
            built.push(
              makeSection(sec.name?.trim() || `Section ${index + 1}`, chords, {
                repeats: sec.repeats,
                drums: sec.drums,
                bass: sec.bass,
                melody: sec.melody,
                busy: sec.busy,
              }),
            );
          }
          if (built.length === 0) {
            return { error: "No sections had recognizable chords." };
          }
          const s = this.song();
          const { key, scale } = guessKey(built[0].chords);
          const bars = built.reduce(
            (sum, section) => sum + section.chords.length * Math.max(1, section.repeats),
            0,
          );
          this.setState({
            ...s,
            key,
            scale,
            arrangement: { enabled: true, sections: built, current: built[0].id },
          });
          return {
            arrangement: "enabled",
            sectionCount: built.length,
            sections: built.map((b) => b.name),
            bars,
            key,
            skipped,
          };
        },
      }),

      addSection: tool({
        description: "Append one section to the song timeline (enables arrangement if it was off).",
        inputSchema: z.object({
          name: z.string(),
          chords: z.union([z.array(z.string()), z.string()]),
          repeats: z.number().int().min(1).max(16).optional(),
          drums: z.boolean().optional(),
          bass: z.boolean().optional(),
          melody: z.boolean().optional(),
          busy: z.number().min(0).max(1).optional(),
        }),
        execute: async ({ name, chords, repeats, drums, bass, melody, busy }) => {
          const valid = normalizeChords(chords).filter(isChord);
          if (valid.length === 0) return { error: "No recognizable chords." };
          const s = this.song();
          const arr = s.arrangement ?? defaultArrangement;
          const section = makeSection(name, valid, { repeats, drums, bass, melody, busy });
          const sections = [...arr.sections, section];
          this.setState({
            ...s,
            arrangement: { ...arr, enabled: true, sections, current: section.id },
          });
          return { added: name, totalSections: sections.length };
        },
      }),

      clearArrangement: tool({
        description: "Turn off the arrangement and go back to a single looping progression.",
        inputSchema: z.object({}),
        execute: async () => {
          const s = this.song();
          const arr = s.arrangement ?? defaultArrangement;
          const sel = arr.sections.find((x) => x.id === arr.current) ?? arr.sections[0];
          this.setState({
            ...s,
            chords: sel?.chords ?? s.chords,
            arrangement: { ...arr, enabled: false },
          });
          return { arrangement: "off" };
        },
      }),

      reharmonize: tool({
        description:
          "Reharmonize the current progression within its key. style 'jazz' upgrades each diatonic chord to a seventh (Cmaj7, Dm7, G7…); 'simple' reduces to plain triads. Applies to the selected section when an arrangement is active, otherwise the main progression.",
        inputSchema: z.object({
          style: z.enum(["jazz", "simple"]).optional(),
        }),
        execute: async ({ style }) => {
          const s = this.song();
          const reStyle: ReharmonizeStyle = style ?? "jazz";
          const arr = s.arrangement;
          if (arr?.enabled && arr.sections.length > 0) {
            const cur = arr.sections.find((x) => x.id === arr.current) ?? arr.sections[0];
            const after = reharmonize(cur.chords, s.key, reStyle);
            const sections = arr.sections.map((x) =>
              x.id === cur.id ? { ...x, chords: after } : x,
            );
            this.setState({ ...s, arrangement: { ...arr, sections } });
            return { section: cur.name, before: cur.chords, after, style: reStyle };
          }
          const after = reharmonize(s.chords, s.key, reStyle);
          this.setState({ ...s, chords: after });
          return {
            before: s.chords,
            after,
            style: reStyle,
            romanNumerals: analyzeRomanNumerals(after),
          };
        },
      }),

      suggestNextChord: tool({
        description:
          "Suggest a few musical chords that would come next after the current progression (diatonic, common-practice voice flow). Read-only — returns suggestions to discuss; use setProgression or addSection to actually add one.",
        inputSchema: z.object({}),
        execute: async () => {
          const s = this.song();
          const arr = s.arrangement;
          const chords =
            arr?.enabled && arr.sections.length > 0
              ? (arr.sections.find((x) => x.id === arr.current) ?? arr.sections[0]).chords
              : s.chords;
          return { key: s.key, after: chords, suggestions: suggestNextChords(chords, s.key) };
        },
      }),

      explainTheory: tool({
        description:
          "Explain what's happening in the current progression — key, Roman numerals, and the harmonic function (Tonic/Subdominant/Dominant) of each chord. Use this to teach the user the theory behind their music. Read-only.",
        inputSchema: z.object({}),
        execute: async () => {
          const s = this.song();
          const arr = s.arrangement;
          const chords =
            arr?.enabled && arr.sections.length > 0
              ? (arr.sections.find((x) => x.id === arr.current) ?? arr.sections[0]).chords
              : s.chords;
          const romans = analyzeRomanNumerals(chords);
          const functions = chordFunctions(chords, s.key);
          return {
            key: s.key,
            analysis: chords.map((chord, i) => ({
              chord,
              roman: romans[i] ?? "?",
              function: functions[i] ?? "Chromatic",
            })),
          };
        },
      }),

      applyVibe: tool({
        description: `Apply a genre/vibe preset in one move — sets tempo, the chord instrument, drum/bass/melody styles + instruments, and (if no arrangement is active) a fitting progression. Available vibes: ${VIBES.map(
          (v) => v.id,
        ).join(", ")}.`,
        inputSchema: z.object({
          name: z
            .string()
            .describe(
              "Vibe name, e.g. 'lo-fi', 'bossa', 'synthwave', 'house', 'cinematic', 'ballad'",
            ),
        }),
        execute: async ({ name }) => {
          const norm = name.toLowerCase().replace(/[^a-z]/g, "");
          const vibe =
            VIBES.find((v) => v.id === norm) ??
            VIBES.find((v) => norm.includes(v.id) || v.id.includes(norm)) ??
            VIBES.find((v) => v.label.toLowerCase().replace(/[^a-z]/g, "") === norm);
          if (!vibe) {
            return { error: `Unknown vibe. Try one of: ${VIBES.map((v) => v.id).join(", ")}.` };
          }
          const s = this.song();
          this.setState(applyVibe(s, vibe));
          return {
            vibe: vibe.id,
            tempo: vibe.tempo,
            instrument: vibe.instrument,
            drums: vibe.drumStyle,
            bass: vibe.bassStyle,
            melody: `${vibe.melodyStyle} on ${vibe.melodyInstrument}`,
            chords: s.arrangement?.enabled ? "(kept your arrangement)" : vibe.chords,
          };
        },
      }),

      setMix: tool({
        description:
          "Adjust the mixer to balance the band. Set a track's volume (0..1), or toggle mute/solo. Tracks: chords, bass, drums, melody — or 'master' for overall level. Use for 'turn down the drums', 'solo the bass', 'mute the melody', 'make the chords quieter'.",
        inputSchema: z.object({
          track: z.enum(["chords", "bass", "drums", "melody", "master"]),
          volume: z.number().min(0).max(1).optional().describe("Linear volume 0..1."),
          mute: z.boolean().optional(),
          solo: z.boolean().optional(),
        }),
        execute: async ({ track, volume, mute, solo }) => {
          const s = this.song();
          const mix = s.mix ?? defaultMix;
          if (track === "master") {
            const next = { ...mix, master: volume ?? mix.master };
            this.setState({ ...s, mix: next });
            return { master: next.master };
          }
          const ch = { ...mix[track] };
          if (volume !== undefined) ch.volume = volume;
          if (mute !== undefined) ch.mute = mute;
          if (solo !== undefined) ch.solo = solo;
          const next = { ...mix, [track]: ch };
          this.setState({ ...s, mix: next });
          return { track, ...ch };
        },
      }),

      applyEffectPreset: tool({
        description: `Apply a named effect preset to the relevant tracks. Available presets: ${EFFECT_PRESETS.map(
          (preset) => `${preset.id} (${preset.label})`,
        ).join(
          ", ",
        )}. Use for requests like "make it dreamy", "add lo-fi tape", "dub echo", "wide chorus", or "tighten the bass".`,
        inputSchema: z.object({
          preset: z.string().describe("Effect preset id or label."),
        }),
        execute: async ({ preset }) => {
          const fxPreset = resolveEffectPreset(preset);
          if (!fxPreset) {
            return {
              error: `Unknown effect preset. Try one of: ${EFFECT_PRESETS.map((p) => p.label).join(", ")}.`,
            };
          }
          const s = this.song();
          const effects = normalizeEffects(s.effects);
          const next = { ...effects };
          for (const [track, patch] of Object.entries(fxPreset.effects) as [
            EffectTrack,
            Partial<TrackEffects>,
          ][]) {
            next[track] = { ...defaultEffects[track], ...patch };
          }
          this.setState({ ...s, effects: next });
          return { preset: fxPreset.id, effects: next };
        },
      }),

      setEffects: tool({
        description:
          "Set per-track effects before the mixer. Track is chords, bass, drums, or melody. tone ranges -1 dark to +1 bright; drive/chorus/delay/reverb range 0..1. Use for precise requests like 'more reverb on piano', 'less delay on melody', 'darken the drums', or 'remove effects from bass'.",
        inputSchema: z.object({
          track: z.enum(["chords", "bass", "drums", "melody"]),
          tone: z.number().min(-1).max(1).optional(),
          drive: z.number().min(0).max(1).optional(),
          chorus: z.number().min(0).max(1).optional(),
          delay: z.number().min(0).max(1).optional(),
          reverb: z.number().min(0).max(1).optional(),
          reset: z.boolean().optional().describe("Set this track back to dry/neutral effects."),
        }),
        execute: async ({ track, tone, drive, chorus, delay, reverb, reset }) => {
          const s = this.song();
          const effects = normalizeEffects(s.effects);
          const current = reset ? defaultEffects[track] : effects[track];
          const nextTrack = normalizeEffects({
            [track]: {
              ...current,
              ...(tone !== undefined ? { tone } : {}),
              ...(drive !== undefined ? { drive } : {}),
              ...(chorus !== undefined ? { chorus } : {}),
              ...(delay !== undefined ? { delay } : {}),
              ...(reverb !== undefined ? { reverb } : {}),
            },
          })[track];
          const next = { ...effects, [track]: nextTrack };
          this.setState({ ...s, effects: next });
          return { track, effects: nextTrack };
        },
      }),

      setGroove: tool({
        description:
          "Set the groove feel. swing (0..1) shuffles the off-beat 8th notes (e.g. lo-fi/jazz). humanize (0..1) loosens timing + velocity so it sounds less robotic. Use for 'add some swing', 'make it groovier', or 'tighten it up' (set both to 0).",
        inputSchema: z.object({
          swing: z.number().min(0).max(1).optional(),
          humanize: z.number().min(0).max(1).optional(),
        }),
        execute: async ({ swing, humanize }) => {
          const s = this.song();
          const groove = s.groove ?? defaultGroove;
          const next = {
            swing: swing ?? groove.swing,
            humanize: humanize ?? groove.humanize,
          };
          this.setState({ ...s, groove: next });
          return next;
        },
      }),

      setSynthParam: tool({
        description:
          "Tweak one parameter of a module in the modular synth voice. Use for timbral edits (brighter = filter cutoff up, snappier = shorter attack, etc.). Reference a module by id or type (e.g. 'filter', 'osc'). Returns the updated patch summary.",
        inputSchema: z.object({
          module: z.string().describe("Module id or type, e.g. 'filter', 'osc', 'env', 'lfo'."),
          param: z
            .string()
            .describe("Param id or label, e.g. 'cutoff', 'attack', 'waveform', 'rate'."),
          value: z
            .union([z.number(), z.string()])
            .describe("New value (number, or enum option name)."),
        }),
        execute: async ({ module, param, value }) => {
          const res = setModuleParam(this.patch(), module, param, value);
          if (res.error) return { error: res.error };
          this.setPatch(res.patch);
          return { applied: res.applied, patch: summarizePatch(res.patch) };
        },
      }),

      addSynthModule: tool({
        description:
          "Add a module to the modular synth voice. Returns its new id so you can wire it with connectSynth.",
        inputSchema: z.object({
          type: z.enum(MODULE_TYPES as [string, ...string[]]).describe("Module type to add."),
        }),
        execute: async ({ type }) => {
          const res = addModule(this.patch(), type as ModuleType);
          if (res.error) return { error: res.error };
          this.setPatch(res.patch);
          return { id: res.id, patch: summarizePatch(res.patch) };
        },
      }),

      connectSynth: tool({
        description:
          "Wire an output port of one module to an input port of another in the synth voice (a patch cable). Audio→audio or cv→cv only. strength is the amount (-1..1, default 1).",
        inputSchema: z.object({
          fromModule: z.string(),
          fromPort: z.string(),
          toModule: z.string(),
          toPort: z.string(),
          strength: z.number().optional(),
        }),
        execute: async ({ fromModule, fromPort, toModule, toPort, strength }) => {
          const res = connect(this.patch(), fromModule, fromPort, toModule, toPort, strength ?? 1);
          if (res.error) return { error: res.error };
          this.setPatch(res.patch);
          return { patch: summarizePatch(res.patch) };
        },
      }),

      removeSynthModule: tool({
        description: "Remove a module (and its cables) from the synth voice.",
        inputSchema: z.object({ module: z.string() }),
        execute: async ({ module }) => {
          const res = removeModule(this.patch(), module);
          if (res.error) return { error: res.error };
          this.setPatch(res.patch);
          return { patch: summarizePatch(res.patch) };
        },
      }),

      resetSynth: tool({
        description: "Reset the modular synth voice to the default subtractive patch.",
        inputSchema: z.object({}),
        execute: async () => {
          const voice = defaultVoice();
          this.setPatch(voice);
          return { patch: summarizePatch(voice) };
        },
      }),
    };
  }
}
