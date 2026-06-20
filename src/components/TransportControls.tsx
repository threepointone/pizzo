import type { ReactNode } from "react";
import { Button, Text } from "@cloudflare/kumo";
import { PlayIcon, StopIcon } from "@phosphor-icons/react";

/** Shared play/stop + tempo row used by Chord Lab and Beats surfaces. */
export function TransportControls({
  isPlaying,
  onToggle,
  tempo,
  onTempoChange,
  tempoId = "tempo-bpm",
  children,
}: {
  isPlaying: boolean;
  onToggle: () => void;
  tempo: number;
  onTempoChange: (bpm: number) => void;
  /** Unique id when multiple transport rows may exist (a11y). */
  tempoId?: string;
  children?: ReactNode;
}) {
  return (
    <>
      <Button
        variant={isPlaying ? "secondary" : "primary"}
        shape="square"
        aria-label={isPlaying ? "Stop" : "Play"}
        onClick={onToggle}
        icon={
          isPlaying ? <StopIcon size={18} weight="fill" /> : <PlayIcon size={18} weight="fill" />
        }
      />
      <label className="flex items-center gap-2" htmlFor={tempoId}>
        <Text size="xs" variant="secondary">
          Tempo
        </Text>
        <input
          id={tempoId}
          type="number"
          min={40}
          max={240}
          value={tempo}
          onChange={(e) => onTempoChange(Number(e.target.value) || tempo)}
          aria-label="Tempo BPM"
          className="w-16 px-2 py-1 rounded-md border border-kumo-line bg-kumo-elevated text-kumo-default text-sm text-center outline-none focus:ring-2 focus:ring-kumo-ring"
        />
        <Text size="xs" variant="secondary">
          BPM
        </Text>
      </label>
      {children}
    </>
  );
}
