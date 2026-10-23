import { useCallback, useEffect, useRef, useState } from "react";
import type { SongState } from "./music/song";

const STAGE_KEY = "pizzo-stage";

function initialStage(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("stage")) {
      const v = params.get("stage");
      return v !== "0" && v !== "false";
    }
    return localStorage.getItem(STAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Stage mode: a projector-friendly reconfiguration. Sets `data-stage` on the
 * root (CSS scales every rem-based size) and lets the app hide secondary chrome
 * and force the dark theme. Enable with `?stage=1`; persists across reloads.
 */
export function useStageMode() {
  const [stage, setStage] = useState(initialStage);
  useEffect(() => {
    document.documentElement.setAttribute("data-stage", stage ? "on" : "off");
    try {
      localStorage.setItem(STAGE_KEY, String(stage));
    } catch {
      /* ignore */
    }
  }, [stage]);
  const toggle = useCallback(() => setStage((s) => !s), []);
  return { stage, toggle };
}

/** True briefly whenever `signature` changes (skips the first render). */
export function useFlash(signature: string, ms = 850): boolean {
  const [on, setOn] = useState(false);
  const prev = useRef(signature);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      prev.current = signature;
      return;
    }
    if (prev.current === signature) return;
    prev.current = signature;
    setOn(false);
    const raf = requestAnimationFrame(() => setOn(true));
    const timer = window.setTimeout(() => setOn(false), ms);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [signature, ms]);
  return on;
}

/** Human label for the first meaningful difference between two song states. */
export function describeSongChange(
  prev: SongState,
  next: SongState,
): string | null {
  const cx = (c: string[]) => (c.length ? c.join(" ") : "empty");
  if (cx(prev.chords) !== cx(next.chords)) {
    return `progression → ${cx(next.chords)}`;
  }
  if (prev.key !== next.key || prev.scale !== next.scale) {
    return `key → ${next.key} ${next.scale}`;
  }
  if (prev.tempo !== next.tempo) return `tempo → ${next.tempo} BPM`;
  if (prev.instrument !== next.instrument) {
    return `sound → ${next.instrument.replace(/_/g, " ")}`;
  }
  if (prev.bass.enabled !== next.bass.enabled || prev.bass.style !== next.bass.style) {
    return next.bass.enabled ? `bass → ${next.bass.style}` : "bass → off";
  }
  if (
    prev.drums.enabled !== next.drums.enabled ||
    prev.drums.style !== next.drums.style
  ) {
    return next.drums.enabled ? `drums → ${next.drums.style}` : "drums → off";
  }
  if (
    prev.melody.enabled !== next.melody.enabled ||
    prev.melody.style !== next.melody.style
  ) {
    return next.melody.enabled ? `melody → ${next.melody.style}` : "melody → off";
  }
  if (prev.arrangement.enabled !== next.arrangement.enabled) {
    return next.arrangement.enabled
      ? "arrangement → sections"
      : "arrangement → single loop";
  }
  if (prev.beat.enabled !== next.beat.enabled) {
    return next.beat.enabled ? "beat → custom pattern" : "beat → style groove";
  }
  if (JSON.stringify(prev.groove) !== JSON.stringify(next.groove)) {
    return "groove changed";
  }
  if (JSON.stringify(prev.mix) !== JSON.stringify(next.mix)) return "mix changed";
  if (JSON.stringify(prev.effects) !== JSON.stringify(next.effects)) {
    return "effects changed";
  }
  if (JSON.stringify(prev.patch) !== JSON.stringify(next.patch)) {
    return "synth patch changed";
  }
  return null;
}

/** Most recent song change as a label + monotonically increasing nonce. */
export function useSongChange(
  song: SongState | null,
): { label: string; nonce: number } | null {
  const prev = useRef<SongState | null>(song);
  const nonce = useRef(0);
  const [change, setChange] = useState<{ label: string; nonce: number } | null>(
    null,
  );
  useEffect(() => {
    const before = prev.current;
    prev.current = song;
    if (!before || !song) return;
    const label = describeSongChange(before, song);
    if (label) {
      nonce.current += 1;
      setChange({ label, nonce: nonce.current });
    }
  }, [song]);
  return change;
}
