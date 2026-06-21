import { useCallback, useState, type ReactNode } from "react";
import { Badge, Button, Text } from "@cloudflare/kumo";
import {
  ArrowsClockwiseIcon,
  DownloadSimpleIcon,
  MusicNotesIcon,
  PlusIcon,
  RepeatIcon,
  RepeatOnceIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "@phosphor-icons/react";
import { exportSongWav } from "../audio/audioExport";
import { downloadSongMidi } from "../audio/midiExport";
import { Arrangement } from "./Arrangement";
import { Playhead } from "./Playhead";
import { TransportControls } from "./TransportControls";
import { useToast } from "./Toast";
import {
  analyzeRomanNumerals,
  applyVibe,
  BASS_STYLES,
  chordFunctions,
  chordRoots,
  defaultEffects,
  EFFECT_PRESETS,
  DRUM_STYLES,
  generateDrums,
  generateMelody,
  guessKey,
  instrumentLabel,
  INSTRUMENT_CATEGORIES,
  INSTRUMENTS,
  isChord,
  makeSection,
  MELODY_STYLES,
  MIX_TRACKS,
  MODULAR_VOICE_ID,
  parseProgression,
  songStateFromProgression,
  VIBES,
  type BassStyle,
  type DrumStyle,
  type DrumVoice,
  type EffectPreset,
  type EffectTrack,
  type HarmonicFunction,
  type MelodyStyle,
  type Mix,
  type Section,
  type SongState,
  type TrackEffects,
} from "../music/song";
import { LAUNCH_INTENTS, type LaunchIntent } from "../music/intents";
import { SYNTH_PRESETS, type SynthPreset } from "../modular/presets";

const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const QUALITIES = [
  { label: "maj", suffix: "" },
  { label: "min", suffix: "m" },
  { label: "7", suffix: "7" },
  { label: "maj7", suffix: "maj7" },
  { label: "min7", suffix: "m7" },
  { label: "dim", suffix: "dim" },
  { label: "sus4", suffix: "sus4" },
] as const;

const LANE_COLORS: Record<string, string> = {
  chords: "bg-orange-500/80",
  bass: "bg-sky-500/80",
  drums: "bg-violet-500/80",
  melody: "bg-emerald-500/80",
};

function InstrumentOptions() {
  return (
    <>
      {INSTRUMENT_CATEGORIES.map((category) => {
        const instruments = INSTRUMENTS.filter((instrument) => instrument.category === category.id);
        if (instruments.length === 0) return null;
        return (
          <optgroup key={category.id} label={category.label}>
            {instruments.map((instrument) => (
              <option key={instrument.id} value={instrument.id}>
                {instrument.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

function TransportBar({
  isPlaying,
  onToggle,
  tempo,
  onTempoChange,
  songKey,
  instrument,
  onInstrumentChange,
  onExport,
  onExportWav,
  exportingWav,
  loopSong,
  onToggleLoop,
}: {
  isPlaying: boolean;
  onToggle: () => void;
  tempo: number;
  onTempoChange: (bpm: number) => void;
  songKey: string;
  instrument: string;
  onInstrumentChange: (id: string) => void;
  onExport: () => void;
  onExportWav: () => void;
  exportingWav: boolean;
  loopSong: boolean;
  onToggleLoop: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 bg-kumo-base border-b border-kumo-line">
      <TransportControls
        isPlaying={isPlaying}
        onToggle={onToggle}
        tempo={tempo}
        onTempoChange={onTempoChange}
        tempoId="chord-lab-tempo"
      >
        <Button
          variant="ghost"
          size="sm"
          icon={loopSong ? <RepeatIcon size={15} /> : <RepeatOnceIcon size={15} />}
          onClick={onToggleLoop}
          title={
            loopSong ? "Looping the whole song - click to play once" : "Plays once - click to loop"
          }
        >
          {loopSong ? "Loop" : "Once"}
        </Button>
        <div className="flex items-center gap-2">
          <Text size="xs" variant="secondary">
            Key
          </Text>
          <Badge variant="secondary">{songKey}</Badge>
        </div>
        <label className="flex items-center gap-2">
          <Text size="xs" variant="secondary">
            Sound
          </Text>
          <select
            value={instrument}
            onChange={(e) => onInstrumentChange(e.target.value)}
            className="px-2 py-1 rounded-md border border-kumo-line bg-kumo-elevated text-kumo-default text-sm outline-none focus:ring-2 focus:ring-kumo-ring"
          >
            <InstrumentOptions />
          </select>
        </label>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          icon={<DownloadSimpleIcon size={16} />}
          onClick={onExport}
          title="Download the song as a MIDI file"
        >
          MIDI
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<DownloadSimpleIcon size={16} />}
          onClick={onExportWav}
          disabled={exportingWav}
          title="Render the song to a WAV audio file (plays through once)"
        >
          {exportingWav ? "Rendering..." : "WAV"}
        </Button>
      </TransportControls>
    </div>
  );
}

const FUNCTION_STYLE: Record<HarmonicFunction, { dot: string; label: string }> = {
  Tonic: { dot: "bg-emerald-400", label: "text-emerald-300" },
  Subdominant: { dot: "bg-sky-400", label: "text-sky-300" },
  Dominant: { dot: "bg-amber-400", label: "text-amber-300" },
  Chromatic: { dot: "bg-kumo-inactive", label: "text-kumo-inactive" },
};

/** A live mini theory lesson: Roman numeral + harmonic function per chord. */
function TheoryStrip({ chords, songKey }: { chords: string[]; songKey: string }) {
  if (chords.length === 0) return null;
  const romans = analyzeRomanNumerals(chords);
  const functions = chordFunctions(chords, songKey);
  return (
    <div className="px-5 pb-4 -mt-1">
      <div className="flex items-center gap-2 mb-2">
        <Text size="xs" variant="secondary" bold>
          Theory
        </Text>
        <Text size="xs" variant="secondary">
          {songKey}
        </Text>
      </div>
      <div className="flex flex-wrap gap-2">
        {chords.map((chord, i) => {
          const fn = functions[i] ?? "Chromatic";
          const style = FUNCTION_STYLE[fn];
          return (
            <div
              key={`${chord}-${i}`}
              className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg border border-kumo-line min-w-14"
              title={`${chord} — ${romans[i] ?? "?"} (${fn})`}
            >
              <span className="text-sm font-bold text-kumo-default leading-none">
                {romans[i] ?? "?"}
              </span>
              <span className={`flex items-center gap-1 text-[10px] ${style.label}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                {fn === "Chromatic" ? "—" : fn.slice(0, 4)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChordStrip({
  chords,
  onRemove,
  onClear,
}: {
  chords: string[];
  onRemove: (index: number) => void;
  onClear: () => void;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between mb-2">
        <Text size="xs" variant="secondary" bold>
          Progression
        </Text>
        {chords.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {chords.length === 0 && (
          <div className="text-sm text-kumo-inactive italic py-2">
            Add chords with the pads below, or type a progression like “Am F C G”.
          </div>
        )}
        {chords.map((chord, i) => (
          <div
            key={`${chord}-${i}`}
            className="group flex items-center gap-1.5 pl-3 pr-2 py-2 rounded-xl bg-kumo-contrast text-kumo-inverse"
          >
            <span className="text-xs opacity-60 tabular-nums">{i + 1}</span>
            <span className="font-semibold">{chord}</span>
            <button
              type="button"
              aria-label={`Remove ${chord}`}
              onClick={() => onRemove(i)}
              className="opacity-50 hover:opacity-100 transition-opacity"
            >
              <XIcon size={14} weight="bold" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChordInput({
  onAdd,
  onSetProgression,
}: {
  onAdd: (chord: string) => void;
  onSetProgression: (chords: string[]) => void;
}) {
  const [quality, setQuality] = useState<(typeof QUALITIES)[number]>(QUALITIES[0]);
  const [text, setText] = useState("");

  const submitText = useCallback(() => {
    const parsed = parseProgression(text);
    if (parsed.length > 0) {
      onSetProgression(parsed);
      setText("");
    }
  }, [text, onSetProgression]);

  return (
    <div className="px-5 py-4 border-t border-kumo-line space-y-3">
      <div>
        <Text size="xs" variant="secondary" bold>
          Quality
        </Text>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {QUALITIES.map((q) => (
            <button
              key={q.label}
              type="button"
              aria-pressed={quality.label === q.label}
              onClick={() => setQuality(q)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                quality.label === q.label
                  ? "bg-kumo-contrast text-kumo-inverse"
                  : "bg-kumo-elevated text-kumo-subtle hover:bg-kumo-line"
              }`}
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Text size="xs" variant="secondary" bold>
          Root
        </Text>
        <div className="grid grid-cols-12 gap-1.5 mt-1.5">
          {ROOTS.map((root) => (
            <button
              key={root}
              type="button"
              aria-label={`Add ${root}${quality.suffix || " major"} chord`}
              onClick={() => onAdd(`${root}${quality.suffix}`)}
              className={`py-2 rounded-lg text-sm font-semibold transition-colors ${
                root.includes("#")
                  ? "bg-kumo-contrast/90 text-kumo-inverse hover:bg-kumo-contrast"
                  : "bg-kumo-elevated text-kumo-default hover:bg-kumo-line"
              }`}
            >
              {root}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-2">
        <label className="flex-1">
          <Text size="xs" variant="secondary" bold>
            Or type a progression
          </Text>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitText();
              }
            }}
            placeholder="Am F C G"
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-kumo-line bg-kumo-elevated text-kumo-default text-sm outline-none focus:ring-2 focus:ring-kumo-ring"
          />
        </label>
        <Button
          variant="secondary"
          icon={<PlusIcon size={16} />}
          onClick={submitText}
          disabled={parseProgression(text).length === 0}
        >
          Set
        </Button>
      </div>
      {text.trim() !== "" && parseProgression(text).length === 0 && (
        <Text size="xs" variant="secondary">
          No recognizable chords yet — try names like Am, F, C, G7, Dm7.
        </Text>
      )}
    </div>
  );
}

function Lane({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-stretch gap-3">
      <div className="w-20 shrink-0 flex items-center">
        <Text size="xs" variant="secondary">
          {label}
        </Text>
      </div>
      <div className="flex-1 flex gap-1 min-h-12">{children}</div>
    </div>
  );
}

/** Drum grid for one bar — 3 rows (kick/snare/hats) × 16 steps. */
function DrumGrid({ style, busy }: { style: DrumStyle; busy: number }) {
  const hits = generateDrums(style, 1, busy);
  const rows: { label: string; voices: DrumVoice[]; color: string }[] = [
    { label: "K", voices: ["kick"], color: "bg-violet-400" },
    { label: "S", voices: ["snare", "clap"], color: "bg-pink-400" },
    { label: "H", voices: ["hat", "openhat"], color: "bg-violet-300" },
  ];
  const active = (voices: DrumVoice[], step: number) =>
    hits.some((h) => voices.includes(h.voice) && Math.round(h.startBeat / 0.25) === step);
  return (
    <div className="flex-1 flex flex-col gap-1">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-1">
          <span className="w-3 text-[10px] text-kumo-inactive">{row.label}</span>
          <div className="flex-1 grid grid-cols-16 gap-0.5">
            {Array.from({ length: 16 }, (_, step) => (
              <div
                key={step}
                className={`h-3 rounded-sm ${
                  active(row.voices, step)
                    ? row.color
                    : step % 4 === 0
                      ? "bg-kumo-line"
                      : "bg-kumo-elevated"
                }`}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Mini piano-roll preview of the generated melody line. */
function MelodyRoll({ song }: { song: SongState }) {
  const { chords, key, scale, melody } = song;
  const notes = generateMelody(chords, key, scale, melody.style, melody.seed);
  const totalBeats = Math.max(1, chords.length * 4);
  if (notes.length === 0) {
    return <div className="flex-1 rounded-md border border-dashed border-kumo-line" />;
  }
  const midis = notes.map((n) => n.midi);
  const lo = Math.min(...midis);
  const hi = Math.max(...midis);
  const span = Math.max(1, hi - lo);
  return (
    <div className="flex-1 relative h-12 rounded-md bg-kumo-elevated overflow-hidden">
      {chords.map((_, i) => (
        <div
          key={`bar-${i}`}
          className="absolute top-0 bottom-0 border-l border-kumo-line/60"
          style={{ left: `${(i / chords.length) * 100}%` }}
        />
      ))}
      {notes.map((n, i) => {
        const left = (n.startBeat / totalBeats) * 100;
        const width = (n.durationBeats / totalBeats) * 100;
        const top = ((hi - n.midi) / span) * 80 + 6;
        return (
          <div
            key={`${n.startBeat}-${i}`}
            className={`absolute h-2 rounded-sm ${LANE_COLORS.melody}`}
            style={{
              left: `${left}%`,
              width: `calc(${width}% - 2px)`,
              top: `${top}%`,
            }}
            title={`MIDI ${n.midi}`}
          />
        );
      })}
    </div>
  );
}

function StyleSelect<T extends string>({
  value,
  enabled,
  options,
  onChange,
  label,
}: {
  value: T;
  enabled: boolean;
  options: { id: T; label: string }[];
  onChange: (value: T | "off") => void;
  label: string;
}) {
  return (
    <select
      value={enabled ? value : "off"}
      aria-label={label}
      onChange={(e) => onChange(e.target.value as T | "off")}
      className="px-2 py-1 rounded-md border border-kumo-line bg-kumo-elevated text-kumo-default text-xs outline-none focus:ring-2 focus:ring-kumo-ring"
    >
      <option value="off">Off</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function TrackLanes({ song, playing, bars }: { song: SongState; playing: boolean; bars: number }) {
  const { chords, bass, drums, melody, beat } = song;
  const roots = chordRoots(chords);
  return (
    <div className="px-5 py-4 border-t border-kumo-line">
      <div className="flex flex-wrap items-center gap-2">
        <Text size="xs" variant="secondary" bold>
          Tracks
        </Text>
        {beat.enabled && <Badge variant="secondary">Custom beat overrides drum style</Badge>}
      </div>
      <div className="mt-2 space-y-2 relative">
        {playing &&
          chords.length > 0 && (
            // Overlay aligned to the cells region (after the w-20 label + gap-3).
            <div
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{ left: "92px", right: 0 }}
            >
              <div className="relative w-full h-full">
                <Playhead bars={bars} playing={playing} />
              </div>
            </div>
          )}
        <Lane label="Chords">
          {chords.length === 0 ? (
            <div className="flex-1 rounded-md border border-dashed border-kumo-line" />
          ) : (
            chords.map((chord, i) => (
              <div
                key={`${chord}-${i}`}
                className={`flex-1 rounded-md flex items-center justify-center text-xs font-semibold text-white h-12 ${LANE_COLORS.chords}`}
              >
                {chord}
              </div>
            ))
          )}
        </Lane>

        {bass.enabled && chords.length > 0 && (
          <Lane label="Bass">
            {roots.map((root, i) => (
              <div
                key={`${root}-${i}`}
                className={`flex-1 rounded-md flex items-center justify-center text-xs font-semibold text-white h-8 ${LANE_COLORS.bass}`}
              >
                {root}
              </div>
            ))}
          </Lane>
        )}

        {melody.enabled && chords.length > 0 && (
          <Lane label="Melody">
            <MelodyRoll song={song} />
          </Lane>
        )}

        {(drums.enabled || beat.enabled) && (
          <Lane label="Drums">
            {beat.enabled ? (
              <div className="flex-1 rounded-md border border-kumo-line bg-kumo-elevated px-3 py-2 text-xs text-kumo-subtle">
                Beat Machine pattern is active. Open Beats to edit the exact grid.
              </div>
            ) : (
              <DrumGrid style={drums.style} busy={drums.busy} />
            )}
          </Lane>
        )}
      </div>
    </div>
  );
}

function DirectionPanel({
  song,
  onChange,
  onSetProgression,
}: {
  song: SongState;
  onChange: (next: SongState) => void;
  onSetProgression: (chords: string[]) => void;
}) {
  const applyIntent = (intent: LaunchIntent) => {
    const vibe = intent.vibe ? VIBES.find((candidate) => candidate.id === intent.vibe) : null;
    const synthPreset = intent.synthPreset
      ? SYNTH_PRESETS.find((preset) => preset.id === intent.synthPreset)
      : null;
    const fxPreset = intent.effectPreset
      ? EFFECT_PRESETS.find((preset) => preset.id === intent.effectPreset)
      : null;
    const effects = { ...song.effects };
    if (fxPreset) {
      for (const [track, patch] of Object.entries(fxPreset.effects) as [
        EffectTrack,
        Partial<TrackEffects>,
      ][]) {
        effects[track] = { ...defaultEffects[track], ...patch };
      }
    }

    let next = vibe
      ? applyVibe(song, vibe)
      : songStateFromProgression([...intent.progression], song);
    next = {
      ...next,
      chords: [...intent.progression],
      instrument: intent.instrument ?? next.instrument,
      effects,
      groove: intent.groove ?? next.groove,
      bass: intent.bass
        ? {
            ...next.bass,
            ...intent.bass,
            style: (intent.bass.style as BassStyle) ?? next.bass.style,
          }
        : next.bass,
      drums: intent.drums
        ? {
            ...next.drums,
            ...intent.drums,
            style: (intent.drums.style as DrumStyle) ?? next.drums.style,
          }
        : next.drums,
      melody: intent.melody
        ? {
            ...next.melody,
            ...intent.melody,
            style: (intent.melody.style as MelodyStyle) ?? next.melody.style,
          }
        : next.melody,
      patch: synthPreset ? clonePreset(synthPreset) : next.patch,
    };

    if (intent.arrangement?.length) {
      const sections = intent.arrangement.map((section) =>
        makeSection(section.name, section.chords, {
          repeats: section.repeats,
          drums: section.drums,
          bass: section.bass,
          melody: section.melody,
          busy: section.busy,
        }),
      );
      const first = sections[0];
      const keyInfo = first ? guessKey(first.chords) : guessKey(next.chords);
      next = {
        ...next,
        key: keyInfo.key,
        scale: keyInfo.scale,
        arrangement: { enabled: true, sections, current: first?.id ?? null },
      };
    }

    onChange(next);
  };

  return (
    <section className="mx-5 mt-4 shrink-0 rounded-2xl border border-kumo-line bg-kumo-base p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Text size="sm" bold>
            Direction
          </Text>
          <p className="mt-1 max-w-2xl text-xs text-kumo-inactive">
            Pick the broad musical direction first. You can still change chords, sound, band, and
            mix below.
          </p>
        </div>
        <Badge variant="secondary">{song.tempo} BPM</Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {LAUNCH_INTENTS.map((intent) => (
          <button
            key={intent.id}
            type="button"
            onClick={() => {
              if (intent.id === "blank") {
                onSetProgression([...intent.progression]);
                return;
              }
              applyIntent(intent);
            }}
            className="rounded-xl border border-kumo-line bg-kumo-elevated px-3 py-2 text-left transition-colors hover:border-kumo-accent"
          >
            <span className="block text-sm font-semibold text-kumo-default">{intent.label}</span>
            <span className="mt-0.5 block text-[11px] text-kumo-inactive">{intent.hint}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function clonePreset(preset: SynthPreset) {
  return JSON.parse(JSON.stringify(preset.patch)) as SongState["patch"];
}

const RECOMMENDED_INSTRUMENTS = ["acoustic_grand_piano", "electric_piano_1", "string_ensemble_1"];

function effectsSummary(song: SongState): string {
  const active = MIX_TRACKS.flatMap((track) => {
    const fx = song.effects?.[track.id] ?? defaultEffects[track.id];
    const names = [
      fx.tone !== 0 && "tone",
      fx.drive > 0.05 && "drive",
      fx.chorus > 0.05 && "chorus",
      fx.delay > 0.05 && "delay",
      fx.reverb > 0.05 && "reverb",
    ].filter(Boolean);
    return names.length ? [`${track.label}: ${names.join(", ")}`] : [];
  });
  return active.slice(0, 2).join(" · ") || "Dry";
}

function SoundCard({ song, onChange }: { song: SongState; onChange: (next: SongState) => void }) {
  const [browseAll, setBrowseAll] = useState(false);
  const applyInstrument = (instrument: string) => onChange({ ...song, instrument });
  const applySynthPreset = (preset: SynthPreset) =>
    onChange({
      ...song,
      instrument: MODULAR_VOICE_ID,
      patch: clonePreset(preset),
    });
  const applyEffectPreset = (preset: EffectPreset) => {
    const effects = { ...song.effects };
    for (const [track, patch] of Object.entries(preset.effects) as [
      EffectTrack,
      Partial<TrackEffects>,
    ][]) {
      effects[track] = { ...defaultEffects[track], ...patch };
    }
    onChange({ ...song, effects });
  };
  const recommendedSynths = SYNTH_PRESETS.slice(0, 3);

  return (
    <section className="px-5 py-4 border-t border-kumo-line space-y-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        <div className="rounded-xl border border-kumo-line bg-kumo-base/40 p-3">
          <Text size="xs" variant="secondary" bold>
            Current Sound
          </Text>
          <div className="mt-2 text-sm font-semibold text-kumo-default">
            {instrumentLabel(song.instrument)}
          </div>
          <p className="mt-1 text-xs text-kumo-inactive">Effects: {effectsSummary(song)}</p>
        </div>

        <div className="rounded-xl border border-kumo-line bg-kumo-base/40 p-3">
          <Text size="xs" variant="secondary" bold>
            Quick Changes
          </Text>
          <div className="mt-2 flex flex-wrap gap-2">
            {RECOMMENDED_INSTRUMENTS.map((instrument) => (
              <button
                key={instrument}
                type="button"
                onClick={() => applyInstrument(instrument)}
                className="rounded-full border border-kumo-line bg-kumo-elevated px-2.5 py-1 text-xs text-kumo-default hover:border-kumo-accent"
              >
                {instrumentLabel(instrument)}
              </button>
            ))}
            {recommendedSynths.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applySynthPreset(preset)}
                className="rounded-full border border-kumo-line bg-kumo-elevated px-2.5 py-1 text-xs text-kumo-default hover:border-kumo-accent"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <Text size="xs" variant="secondary" bold>
          Effect Presets
        </Text>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {EFFECT_PRESETS.map((preset) => (
            <EffectPresetCard key={preset.id} preset={preset} onApply={applyEffectPreset} />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-kumo-line bg-kumo-base/40">
        <button
          type="button"
          aria-expanded={browseAll}
          onClick={() => setBrowseAll((next) => !next)}
          className="w-full px-3 py-2 text-left text-sm font-semibold text-kumo-default"
        >
          {browseAll ? "Hide full sound browser" : "Browse all sounds"}
        </button>
        {browseAll && (
          <div className="border-t border-kumo-line">
            <InstrumentBrowser song={song} onChange={onChange} />
            <EffectsPanel song={song} onChange={onChange} />
          </div>
        )}
      </div>
    </section>
  );
}

function InstrumentBrowser({
  song,
  onChange,
}: {
  song: SongState;
  onChange: (next: SongState) => void;
}) {
  const applyInstrument = (instrument: string) => onChange({ ...song, instrument });
  const applySynthPreset = (preset: SynthPreset) =>
    onChange({
      ...song,
      instrument: MODULAR_VOICE_ID,
      patch: clonePreset(preset),
    });

  return (
    <section className="px-5 py-4 border-t border-kumo-line space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Text size="xs" variant="secondary" bold>
            Instrument Browser
          </Text>
          <p className="mt-1 text-xs text-kumo-inactive">
            Curated sampled instruments are served locally; synth presets load editable modular
            patches.
          </p>
        </div>
        <Badge variant="secondary">{instrumentLabel(song.instrument)}</Badge>
      </div>

      <div className="space-y-3">
        {INSTRUMENT_CATEGORIES.map((category) => {
          const instruments = INSTRUMENTS.filter(
            (instrument) => instrument.category === category.id,
          );
          if (instruments.length === 0) return null;
          return (
            <div key={category.id}>
              <Text size="xs" variant="secondary" bold>
                {category.label}
              </Text>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {instruments.map((instrument) => {
                  const active = song.instrument === instrument.id;
                  return (
                    <button
                      key={instrument.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => applyInstrument(instrument.id)}
                      className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                        active
                          ? "border-kumo-contrast bg-kumo-contrast text-kumo-inverse"
                          : "border-kumo-line bg-kumo-elevated text-kumo-default hover:border-kumo-accent"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{instrument.label}</span>
                        <span
                          className={`text-[10px] ${
                            active ? "text-kumo-inverse/70" : "text-kumo-inactive"
                          }`}
                        >
                          {instrument.kit === "FluidR3_GM" ? "FluidR3" : instrument.kit}
                        </span>
                      </div>
                      <p
                        className={`mt-1 text-[11px] ${
                          active ? "text-kumo-inverse/70" : "text-kumo-inactive"
                        }`}
                      >
                        {instrument.blurb}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <Text size="xs" variant="secondary" bold>
          Synth Presets
        </Text>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {SYNTH_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applySynthPreset(preset)}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                song.instrument === MODULAR_VOICE_ID
                  ? "border-kumo-line bg-kumo-elevated text-kumo-default hover:border-kumo-accent"
                  : "border-kumo-line bg-kumo-elevated text-kumo-default hover:border-kumo-accent"
              }`}
            >
              <div className="text-sm font-semibold">{preset.label}</div>
              <p className="mt-1 text-[11px] text-kumo-inactive">{preset.blurb}</p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

const EFFECT_SLIDERS: { id: keyof TrackEffects; label: string; min: number; max: number }[] = [
  { id: "tone", label: "Tone", min: -1, max: 1 },
  { id: "drive", label: "Drive", min: 0, max: 1 },
  { id: "chorus", label: "Chorus", min: 0, max: 1 },
  { id: "delay", label: "Delay", min: 0, max: 1 },
  { id: "reverb", label: "Reverb", min: 0, max: 1 },
];

function EffectPresetCard({
  preset,
  onApply,
}: {
  preset: EffectPreset;
  onApply: (preset: EffectPreset) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onApply(preset)}
      className="rounded-xl border border-kumo-line bg-kumo-elevated px-3 py-2 text-left text-kumo-default transition-colors hover:border-kumo-accent"
    >
      <div className="text-sm font-semibold">{preset.label}</div>
      <p className="mt-1 text-[11px] text-kumo-inactive">{preset.blurb}</p>
    </button>
  );
}

function EffectsPanel({
  song,
  onChange,
}: {
  song: SongState;
  onChange: (next: SongState) => void;
}) {
  const effects = song.effects ?? defaultEffects;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const applyPreset = (preset: EffectPreset) => {
    const next = { ...effects };
    for (const [track, patch] of Object.entries(preset.effects) as [
      EffectTrack,
      Partial<TrackEffects>,
    ][]) {
      next[track] = { ...defaultEffects[track], ...patch };
    }
    onChange({ ...song, effects: next });
  };
  const setTrackEffect = (track: EffectTrack, key: keyof TrackEffects, value: number) =>
    onChange({
      ...song,
      effects: {
        ...effects,
        [track]: { ...effects[track], [key]: value },
      },
    });

  return (
    <section className="px-5 py-4 border-t border-kumo-line space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Text size="xs" variant="secondary" bold>
            Effect Presets
          </Text>
          <p className="mt-1 text-xs text-kumo-inactive">
            Shape sampled instruments, bass, and drums before they hit the mixer.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ ...song, effects: defaultEffects })}
          title="Reset every track to dry effects"
        >
          Dry
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {EFFECT_PRESETS.map((preset) => (
          <EffectPresetCard key={preset.id} preset={preset} onApply={applyPreset} />
        ))}
      </div>

      <div className="rounded-xl border border-kumo-line bg-kumo-base/40">
        <button
          type="button"
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((next) => !next)}
          className="w-full px-3 py-2 text-left text-sm font-semibold text-kumo-default"
        >
          {showAdvanced ? "Hide per-track effects" : "Advanced per-track effects"}
        </button>
        {showAdvanced && (
          <div className="grid gap-3 border-t border-kumo-line p-3 xl:grid-cols-2">
            {MIX_TRACKS.map((track) => (
              <div
                key={track.id}
                className="rounded-xl border border-kumo-line bg-kumo-base/40 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Text size="xs" variant="secondary" bold>
                    {track.label}
                  </Text>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...song,
                        effects: { ...effects, [track.id]: defaultEffects[track.id] },
                      })
                    }
                    className="text-[11px] text-kumo-inactive hover:text-kumo-accent"
                  >
                    reset
                  </button>
                </div>
                <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                  {EFFECT_SLIDERS.map((slider) => {
                    const value = effects[track.id][slider.id];
                    return (
                      <label key={slider.id} className="flex items-center gap-2">
                        <span className="w-12 text-[11px] text-kumo-subtle">{slider.label}</span>
                        <input
                          type="range"
                          min={slider.min}
                          max={slider.max}
                          step={0.01}
                          value={value}
                          onChange={(e) =>
                            setTrackEffect(track.id, slider.id, Number(e.target.value))
                          }
                          className="min-w-0 flex-1 accent-kumo-accent"
                        />
                        <span className="w-8 text-right text-[10px] text-kumo-inactive tabular-nums">
                          {slider.id === "tone"
                            ? `${value > 0 ? "+" : ""}${Math.round(value * 100)}`
                            : Math.round(value * 100)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function BandPanel({ song, onChange }: { song: SongState; onChange: (next: SongState) => void }) {
  const { bass, drums, melody, groove } = song;
  const [advanced, setAdvanced] = useState(false);
  const energy = Math.round(drums.busy * 100);
  const toggleButton = (
    label: string,
    enabled: boolean,
    onClick: () => void,
    description: string,
  ) => (
    <button
      type="button"
      aria-pressed={enabled}
      onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-left transition-colors ${
        enabled
          ? "border-kumo-contrast bg-kumo-contrast text-kumo-inverse"
          : "border-kumo-line bg-kumo-elevated text-kumo-default hover:border-kumo-accent"
      }`}
    >
      <span className="block text-sm font-semibold">{label}</span>
      <span
        className={enabled ? "text-[11px] text-kumo-inverse/70" : "text-[11px] text-kumo-inactive"}
      >
        {description}
      </span>
    </button>
  );
  return (
    <div className="px-5 py-4 border-t border-kumo-line space-y-3">
      <Text size="xs" variant="secondary" bold>
        Band
      </Text>
      <div className="grid gap-2 sm:grid-cols-3">
        {toggleButton(
          "Drums",
          drums.enabled,
          () => onChange({ ...song, drums: { ...drums, enabled: !drums.enabled } }),
          drums.enabled ? "Groove is playing" : "No drum part",
        )}
        {toggleButton(
          "Bass",
          bass.enabled,
          () => onChange({ ...song, bass: { ...bass, enabled: !bass.enabled } }),
          bass.enabled ? "Follows the roots" : "No bass part",
        )}
        {toggleButton(
          "Melody",
          melody.enabled,
          () => onChange({ ...song, melody: { ...melody, enabled: !melody.enabled } }),
          melody.enabled ? "Generated lead line" : "No melody part",
        )}
      </div>

      <label className="flex items-center gap-3 rounded-xl border border-kumo-line bg-kumo-base/40 px-3 py-2">
        <span className="w-16 text-xs font-semibold text-kumo-subtle">Energy</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={drums.busy}
          onChange={(e) =>
            onChange({
              ...song,
              drums: { ...drums, busy: Number(e.target.value) },
            })
          }
          className="min-w-0 flex-1 accent-kumo-accent"
        />
        <span className="w-9 text-right text-xs text-kumo-inactive tabular-nums">{energy}</span>
      </label>

      <button
        type="button"
        onClick={() => setAdvanced((next) => !next)}
        className="text-xs font-semibold text-kumo-subtle hover:text-kumo-accent"
      >
        {advanced ? "Hide advanced band controls" : "Advanced band controls"}
      </button>

      {advanced && (
        <div className="space-y-3 rounded-xl border border-kumo-line bg-kumo-base/40 p-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-2">
              <Text size="xs" variant="secondary">
                Drums
              </Text>
              <StyleSelect
                label="Drums style"
                value={drums.style}
                enabled={drums.enabled}
                options={DRUM_STYLES}
                onChange={(v) =>
                  onChange(
                    v === "off"
                      ? { ...song, drums: { ...drums, enabled: false } }
                      : { ...song, drums: { ...drums, enabled: true, style: v as DrumStyle } },
                  )
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <Text size="xs" variant="secondary">
                Bass
              </Text>
              <StyleSelect
                label="Bass style"
                value={bass.style}
                enabled={bass.enabled}
                options={BASS_STYLES}
                onChange={(v) =>
                  onChange(
                    v === "off"
                      ? { ...song, bass: { ...bass, enabled: false } }
                      : { ...song, bass: { ...bass, enabled: true, style: v as BassStyle } },
                  )
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <Text size="xs" variant="secondary">
                Melody
              </Text>
              <StyleSelect
                label="Melody style"
                value={melody.style}
                enabled={melody.enabled}
                options={MELODY_STYLES}
                onChange={(v) =>
                  onChange(
                    v === "off"
                      ? { ...song, melody: { ...melody, enabled: false } }
                      : { ...song, melody: { ...melody, enabled: true, style: v as MelodyStyle } },
                  )
                }
              />
            </div>
            {melody.enabled && (
              <>
                <label className="flex items-center gap-2">
                  <Text size="xs" variant="secondary">
                    Lead sound
                  </Text>
                  <select
                    value={melody.instrument}
                    onChange={(e) =>
                      onChange({ ...song, melody: { ...melody, instrument: e.target.value } })
                    }
                    className="px-2 py-1 rounded-md border border-kumo-line bg-kumo-elevated text-kumo-default text-xs outline-none focus:ring-2 focus:ring-kumo-ring"
                  >
                    <InstrumentOptions />
                  </select>
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ArrowsClockwiseIcon size={14} />}
                  onClick={() =>
                    onChange({ ...song, melody: { ...melody, seed: melody.seed + 1 } })
                  }
                >
                  Regenerate
                </Button>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
            <Text size="xs" variant="secondary" bold>
              Feel
            </Text>
            <label
              className="flex items-center gap-2"
              title="Delay every other 8th note for a shuffle"
            >
              <Text size="xs" variant="secondary">
                Swing
              </Text>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={groove.swing}
                onChange={(e) =>
                  onChange({ ...song, groove: { ...groove, swing: Number(e.target.value) } })
                }
                className="w-28 accent-kumo-accent"
              />
              <Text size="xs" variant="secondary">
                {Math.round(groove.swing * 100)}%
              </Text>
            </label>
            <label
              className="flex items-center gap-2"
              title="Jitter timing + velocity so it sounds less robotic"
            >
              <Text size="xs" variant="secondary">
                Humanize
              </Text>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={groove.humanize}
                onChange={(e) =>
                  onChange({ ...song, groove: { ...groove, humanize: Number(e.target.value) } })
                }
                className="w-28 accent-kumo-accent"
              />
              <Text size="xs" variant="secondary">
                {Math.round(groove.humanize * 100)}%
              </Text>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

/** Per-track mixer: volume faders + mute/solo, plus a master fader. */
function Mixer({ song, onChange }: { song: SongState; onChange: (next: SongState) => void }) {
  const mix = song.mix;
  const setTrack = (id: keyof Omit<Mix, "master">, patch: Partial<Mix["chords"]>) =>
    onChange({ ...song, mix: { ...mix, [id]: { ...mix[id], ...patch } } });
  return (
    <div className="px-5 py-4 border-t border-kumo-line space-y-3">
      <div className="flex items-center gap-2">
        <SlidersHorizontalIcon size={14} className="text-kumo-accent" />
        <Text size="xs" variant="secondary" bold>
          Mixer
        </Text>
      </div>
      <div className="space-y-2">
        {MIX_TRACKS.map((track) => {
          const ch = mix[track.id];
          return (
            <div key={track.id} className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs text-kumo-subtle">{track.label}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={ch.volume}
                onChange={(e) => setTrack(track.id, { volume: Number(e.target.value) })}
                className="flex-1 max-w-64 accent-kumo-accent"
                aria-label={`${track.label} volume`}
              />
              <span className="w-9 text-right text-[10px] text-kumo-inactive tabular-nums">
                {Math.round(ch.volume * 100)}
              </span>
              <button
                type="button"
                onClick={() => setTrack(track.id, { mute: !ch.mute })}
                aria-pressed={ch.mute}
                aria-label={`${ch.mute ? "Unmute" : "Mute"} ${track.label}`}
                className={`w-7 h-6 rounded-md text-[10px] font-bold transition-colors ${
                  ch.mute
                    ? "bg-amber-500 text-white"
                    : "bg-kumo-elevated text-kumo-subtle hover:bg-kumo-line"
                }`}
                title="Mute"
              >
                M
              </button>
              <button
                type="button"
                onClick={() => setTrack(track.id, { solo: !ch.solo })}
                aria-pressed={ch.solo}
                aria-label={`${ch.solo ? "Unsolo" : "Solo"} ${track.label}`}
                className={`w-7 h-6 rounded-md text-[10px] font-bold transition-colors ${
                  ch.solo
                    ? "bg-emerald-500 text-white"
                    : "bg-kumo-elevated text-kumo-subtle hover:bg-kumo-line"
                }`}
                title="Solo"
              >
                S
              </button>
            </div>
          );
        })}
        <div className="flex items-center gap-3 pt-1 border-t border-kumo-line/60">
          <span className="w-16 shrink-0 text-xs font-semibold text-kumo-subtle">Master</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={mix.master}
            onChange={(e) => onChange({ ...song, mix: { ...mix, master: Number(e.target.value) } })}
            className="flex-1 max-w-64 accent-kumo-accent"
            aria-label="Master volume"
          />
          <span className="w-9 text-right text-[10px] text-kumo-inactive tabular-nums">
            {Math.round(mix.master * 100)}
          </span>
          <span className="w-[60px]" />
        </div>
      </div>
    </div>
  );
}

type FocusPanel = "chords" | "sound" | "band" | "arrange" | "mix";

const FOCUS_PANELS: { id: FocusPanel; label: string; hint: string }[] = [
  { id: "chords", label: "Chords", hint: "Progression" },
  { id: "sound", label: "Sound", hint: "Instrument + effects" },
  { id: "band", label: "Band", hint: "Generated parts" },
  { id: "arrange", label: "Arrange", hint: "Song form" },
  { id: "mix", label: "Mix", hint: "Levels" },
];

function TheoryNudge({ chords, songKey }: { chords: string[]; songKey: string }) {
  const [open, setOpen] = useState(false);
  if (chords.length === 0) return null;
  const functions = chordFunctions(chords, songKey);
  const dominantCount = functions.filter((fn) => fn === "Dominant").length;
  const nudge =
    dominantCount > 0
      ? "There is some dominant motion here, so the loop should feel like it wants to resolve."
      : "This loop mostly sits in stable color; add a V or VII chord if you want more pull.";
  return (
    <section className="mx-5 mb-4 shrink-0 rounded-xl border border-kumo-line bg-kumo-base px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
        className="text-xs font-semibold text-kumo-subtle hover:text-kumo-accent"
      >
        Why this works
      </button>
      {open && (
        <>
          <p className="mt-2 text-xs text-kumo-inactive">{nudge}</p>
          <TheoryStrip chords={chords} songKey={songKey} />
        </>
      )}
    </section>
  );
}

export function Workspace({
  song,
  onChange,
}: {
  song: SongState;
  onChange: (next: SongState) => void;
}) {
  const [exportingWav, setExportingWav] = useState(false);
  const [activePanel, setActivePanel] = useState<FocusPanel | null>(null);
  const { toast } = useToast();
  const arr = song.arrangement;
  const arrangementOn = arr.enabled && arr.sections.length > 0;
  const currentSection: Section | null = arrangementOn
    ? (arr.sections.find((s) => s.id === arr.current) ?? arr.sections[0])
    : null;
  const chords = currentSection ? currentSection.chords : song.chords;

  // In arrangement mode the lanes preview the selected section: its chords +
  // its own per-section voice toggles (which override the global enabled flags).
  const laneSong: SongState = currentSection
    ? {
        ...song,
        chords: currentSection.chords,
        ...guessKey(currentSection.chords),
        bass: { ...song.bass, enabled: currentSection.bass },
        drums: { ...song.drums, enabled: currentSection.drums, busy: currentSection.busy },
        melody: { ...song.melody, enabled: currentSection.melody },
      }
    : song;

  const setChords = useCallback(
    (next: string[]) => {
      if (currentSection) {
        const sections = arr.sections.map((s) =>
          s.id === currentSection.id ? { ...s, chords: next } : s,
        );
        const first = sections[0];
        const keyInfo = first ? guessKey(first.chords) : null;
        onChange({
          ...song,
          key: keyInfo?.key ?? song.key,
          scale: keyInfo?.scale ?? song.scale,
          arrangement: { ...arr, sections },
        });
      } else {
        onChange(songStateFromProgression(next, song));
      }
    },
    [arr, currentSection, onChange, song],
  );

  const addChord = useCallback(
    (chord: string) => {
      if (!isChord(chord)) return;
      setChords([...chords, chord]);
    },
    [chords, setChords],
  );

  const removeChord = useCallback(
    (index: number) => setChords(chords.filter((_, i) => i !== index)),
    [chords, setChords],
  );

  return (
    <main className="flex-1 flex flex-col overflow-y-auto bg-kumo-elevated">
      <TransportBar
        isPlaying={song.playing}
        onToggle={() => onChange({ ...song, playing: !song.playing })}
        tempo={song.tempo}
        onTempoChange={(tempo) => onChange({ ...song, tempo })}
        songKey={song.key}
        instrument={song.instrument}
        onInstrumentChange={(instrument) => onChange({ ...song, instrument })}
        onExport={() => {
          try {
            downloadSongMidi(song, `pizzo-${song.key.replace(/\s+/g, "-").toLowerCase()}.mid`);
            toast("Downloaded MIDI.", "success");
          } catch {
            toast("Couldn't export MIDI.", "error");
          }
        }}
        onExportWav={async () => {
          if (exportingWav) return;
          if (song.playing) onChange({ ...song, playing: false });
          setExportingWav(true);
          try {
            await exportSongWav(`pizzo-${song.key.replace(/\s+/g, "-").toLowerCase()}.wav`);
            toast("Rendered WAV.", "success");
          } catch {
            toast("Couldn't render WAV.", "error");
          } finally {
            setExportingWav(false);
          }
        }}
        exportingWav={exportingWav}
        loopSong={song.loopSong !== false}
        onToggleLoop={() => onChange({ ...song, loopSong: !(song.loopSong !== false) })}
      />

      <div className="flex shrink-0 items-center gap-2 px-5 pt-5">
        <MusicNotesIcon size={18} className="text-kumo-accent" />
        <Text size="sm" bold>
          Chord Lab
        </Text>
        {currentSection && <Badge variant="secondary">Editing: {currentSection.name}</Badge>}
      </div>

      <DirectionPanel song={song} onChange={onChange} onSetProgression={setChords} />

      <section className="mx-5 my-4 shrink-0 overflow-hidden rounded-2xl border border-kumo-line bg-kumo-base">
        <div className="border-b border-kumo-line px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Text size="sm" bold>
                Song sketch
              </Text>
              <p className="mt-1 text-xs text-kumo-inactive">
                Listen first. Open one focused panel only when you want to change something.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">{chords.length || 0} chords</Badge>
              <Badge variant="secondary">{instrumentLabel(song.instrument)}</Badge>
              <Badge variant="secondary">
                {arrangementOn ? `${arr.sections.length} sections` : "Loop"}
              </Badge>
            </div>
          </div>
        </div>
        <ChordStrip chords={chords} onRemove={removeChord} onClear={() => setChords([])} />
        <TrackLanes
          song={laneSong}
          playing={song.playing && !arrangementOn}
          bars={Math.max(chords.length, 1)}
        />
      </section>

      <section className="mx-5 mb-4 shrink-0 rounded-2xl border border-kumo-line bg-kumo-base p-3">
        <div className="grid gap-2 sm:grid-cols-5">
          {FOCUS_PANELS.map((panel) => {
            const active = activePanel === panel.id;
            return (
              <button
                key={panel.id}
                type="button"
                aria-pressed={active}
                onClick={() => setActivePanel(active ? null : panel.id)}
                className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-kumo-contrast bg-kumo-contrast text-kumo-inverse"
                    : "border-kumo-line bg-kumo-elevated text-kumo-default hover:border-kumo-accent"
                }`}
              >
                <span className="block text-sm font-semibold">{panel.label}</span>
                <span
                  className={
                    active ? "text-[11px] text-kumo-inverse/70" : "text-[11px] text-kumo-inactive"
                  }
                >
                  {panel.hint}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {activePanel && (
        <section className="mx-5 mb-4 shrink-0 overflow-visible rounded-2xl border border-kumo-line bg-kumo-base">
          {activePanel === "chords" && <ChordInput onAdd={addChord} onSetProgression={setChords} />}
          {activePanel === "sound" && <SoundCard song={song} onChange={onChange} />}
          {activePanel === "band" && <BandPanel song={song} onChange={onChange} />}
          {activePanel === "arrange" && (
            <Arrangement song={song} onChange={onChange} playing={song.playing} />
          )}
          {activePanel === "mix" && <Mixer song={song} onChange={onChange} />}
        </section>
      )}

      <TheoryNudge chords={chords} songKey={laneSong.key} />
    </main>
  );
}
