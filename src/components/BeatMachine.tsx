import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Text } from "@cloudflare/kumo";
import { ArrowCounterClockwiseIcon, CompassToolIcon, SparkleIcon } from "@phosphor-icons/react";
import { engine } from "../audio/engine";
import { TransportControls } from "./TransportControls";
import {
  BEAT_VOICES,
  DRUM_STYLES,
  emptyBeat,
  euclid,
  euclidBeat,
  SEQ_STEPS,
  styleToBeat,
  type Beat,
  type DrumStyle,
  type DrumVoice,
  type SongState,
} from "../music/song";

const VOICE_LABELS: Record<DrumVoice, string> = {
  hat: "Hi-hat",
  openhat: "Open hat",
  clap: "Clap",
  snare: "Snare",
  kick: "Kick",
};

const VOICE_COLORS: Record<DrumVoice, string> = {
  hat: "bg-violet-300",
  openhat: "bg-teal-300",
  clap: "bg-pink-400",
  snare: "bg-rose-400",
  kick: "bg-violet-500",
};

/** Render a Euclidean pattern as an "x.x." string for the preview chip. */
function previewEuclid(pulses: number, steps: number, rotate: number): string {
  return euclid(pulses, steps, rotate)
    .map((on) => (on ? "x" : "."))
    .join("");
}

function EuclidNumber({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <Text size="xs" variant="secondary">
        {label}
      </Text>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isNaN(n)) return;
          onChange(Math.max(min, Math.min(max, Math.round(n))));
        }}
        className="w-14 px-2 py-1 rounded-md border border-kumo-line bg-kumo-elevated text-kumo-default text-sm text-center outline-none focus:ring-2 focus:ring-kumo-ring"
      />
    </label>
  );
}

export function BeatMachine({
  song,
  onChange,
}: {
  song: SongState;
  onChange: (next: SongState) => void;
}) {
  const beat = song.beat;
  const [step, setStep] = useState(-1);
  const [euc, setEuc] = useState({
    voice: "kick" as DrumVoice,
    pulses: 4,
    steps: 16,
    rotate: 0,
  });

  // Drive the playhead while the transport runs.
  const raf = useRef(0);
  useEffect(() => {
    if (!song.playing) {
      setStep(-1);
      return;
    }
    const tick = () => {
      setStep(engine.currentStep(SEQ_STEPS));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [song.playing]);

  const setBeat = useCallback((next: Beat) => onChange({ ...song, beat: next }), [onChange, song]);

  const toggle = useCallback(
    (voice: DrumVoice, i: number) => {
      const rows = { ...beat.rows };
      const row = [...(rows[voice] ?? [])];
      row[i] = !row[i];
      rows[voice] = row;
      setBeat({ ...beat, rows, enabled: true });
    },
    [beat, setBeat],
  );

  const clear = useCallback(() => setBeat(emptyBeat()), [setBeat]);
  const fillFromStyle = useCallback(
    () => setBeat(styleToBeat(song.drums.style)),
    [setBeat, song.drums.style],
  );
  const applyEuclid = useCallback(() => {
    setBeat(euclidBeat(beat, euc.voice, euc.pulses, euc.steps, euc.rotate));
  }, [beat, euc, setBeat]);
  const seedStyle: DrumStyle = song.drums.style;

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-kumo-elevated">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 bg-kumo-base border-b border-kumo-line">
        <TransportControls
          isPlaying={song.playing}
          onToggle={() => onChange({ ...song, playing: !song.playing })}
          tempo={song.tempo}
          onTempoChange={(tempo) => onChange({ ...song, tempo })}
          tempoId="beat-machine-tempo"
        >
          <Badge variant={beat.enabled ? "primary" : "secondary"}>
            {beat.enabled ? "Pattern on" : "Pattern off"}
          </Badge>
          <div className="flex-1" />
          <Button
            variant="secondary"
            size="sm"
            icon={<SparkleIcon size={14} />}
            onClick={fillFromStyle}
          >
            Fill from {DRUM_STYLES.find((d) => d.id === seedStyle)?.label ?? "style"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowCounterClockwiseIcon size={14} />}
            onClick={clear}
          >
            Clear
          </Button>
        </TransportControls>
      </div>

      <div className="flex items-center gap-2 px-5 pt-5">
        <Text size="sm" bold>
          Beat machine
        </Text>
        <Text size="xs" variant="secondary">
          click cells to program a 16-step groove — it drives the drums on every surface
        </Text>
      </div>

      <div className="mx-5 mt-3 flex flex-wrap items-end gap-x-4 gap-y-2 rounded-lg border border-kumo-line bg-kumo-base px-4 py-3">
        <div className="flex items-center gap-1.5">
          <CompassToolIcon size={15} className="text-kumo-accent" />
          <Text size="xs" bold>
            Euclidean fill
          </Text>
        </div>
        <label className="flex items-center gap-2">
          <Text size="xs" variant="secondary">
            Voice
          </Text>
          <select
            value={euc.voice}
            onChange={(e) => setEuc((s) => ({ ...s, voice: e.target.value as DrumVoice }))}
            className="px-2 py-1 rounded-md border border-kumo-line bg-kumo-elevated text-kumo-default text-xs outline-none focus:ring-2 focus:ring-kumo-ring"
          >
            {BEAT_VOICES.map((v) => (
              <option key={v} value={v}>
                {VOICE_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
        <EuclidNumber
          label="Pulses"
          value={euc.pulses}
          min={0}
          max={euc.steps}
          onChange={(pulses) => setEuc((s) => ({ ...s, pulses }))}
        />
        <EuclidNumber
          label="Steps"
          value={euc.steps}
          min={1}
          max={16}
          onChange={(steps) => setEuc((s) => ({ ...s, steps, pulses: Math.min(s.pulses, steps) }))}
        />
        <EuclidNumber
          label="Rotate"
          value={euc.rotate}
          min={0}
          max={Math.max(0, euc.steps - 1)}
          onChange={(rotate) => setEuc((s) => ({ ...s, rotate }))}
        />
        <code className="px-2 py-1 rounded bg-kumo-elevated text-kumo-subtle text-xs tracking-widest">
          {previewEuclid(euc.pulses, euc.steps, euc.rotate)}
        </code>
        <Button variant="primary" size="sm" onClick={applyEuclid}>
          Apply to {VOICE_LABELS[euc.voice]}
        </Button>
      </div>

      <div className="p-5 overflow-x-auto">
        <div className="inline-flex flex-col gap-1.5">
          {BEAT_VOICES.map((voice) => (
            <div key={voice} className="flex items-center gap-2">
              <div className="w-16 shrink-0 text-right">
                <Text size="xs" variant="secondary">
                  {VOICE_LABELS[voice]}
                </Text>
              </div>
              <div className="flex gap-1">
                {Array.from({ length: SEQ_STEPS }, (_, i) => {
                  const on = beat.rows[voice]?.[i] ?? false;
                  const isBeatStart = i % 4 === 0;
                  const isHead = i === step;
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-label={`${VOICE_LABELS[voice]} step ${i + 1}`}
                      aria-pressed={on}
                      onClick={() => toggle(voice, i)}
                      className={`h-8 w-8 rounded-md border transition-colors ${
                        on
                          ? `${VOICE_COLORS[voice]} border-transparent`
                          : isBeatStart
                            ? "bg-kumo-base border-kumo-line"
                            : "bg-kumo-elevated border-kumo-line/50"
                      } ${isHead ? "ring-2 ring-kumo-accent" : ""}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 mt-1">
            <div className="w-16 shrink-0" />
            <div className="flex gap-1">
              {Array.from({ length: SEQ_STEPS }, (_, i) => (
                <div
                  key={i}
                  className="w-8 text-center text-[10px] text-kumo-inactive tabular-nums"
                >
                  {i % 4 === 0 ? i / 4 + 1 : ""}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
