import { useCallback, useEffect, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { Workspace } from "./Workspace";
import { ModularSurface } from "./ModularSurface";
import { BeatMachine } from "./BeatMachine";
import { ChatPanel } from "./ChatPanel";
import { engine } from "../audio/engine";
import { modularEngine } from "../modular/engine";
import { defaultSongState, songDocFromState, type SongState } from "../music/song";
import type { Patch } from "../modular/types";
import type { ConnectionStatus } from "../client";

/** Fill in fields a persisted (older) SongState may be missing. */
function normalizeSong(next: Partial<SongState>): SongState {
  return {
    ...defaultSongState,
    ...next,
    bass: next.bass ?? defaultSongState.bass,
    drums: next.drums ?? defaultSongState.drums,
    melody: next.melody ?? defaultSongState.melody,
    beat: next.beat ?? defaultSongState.beat,
    arrangement: next.arrangement ?? defaultSongState.arrangement,
    mix: next.mix ?? defaultSongState.mix,
    groove: next.groove ?? defaultSongState.groove,
    patch: next.patch ?? defaultSongState.patch,
  };
}

type Surface = "chords" | "beats" | "modular";

function SurfaceTabs({ surface, onChange }: { surface: Surface; onChange: (s: Surface) => void }) {
  const tabs: { id: Surface; label: string }[] = [
    { id: "chords", label: "Chord Lab" },
    { id: "beats", label: "Beats" },
    { id: "modular", label: "Modular" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Song surfaces"
      className="flex items-center gap-1 p-0.5 rounded-lg bg-kumo-elevated border border-kumo-line"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`surface-tab-${t.id}`}
          aria-selected={surface === t.id}
          aria-controls={`surface-panel-${t.id}`}
          tabIndex={surface === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
            surface === t.id
              ? "bg-kumo-contrast text-kumo-inverse"
              : "text-kumo-subtle hover:text-kumo-default"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One song: connects to the `Song` facet under the user's `Studio`
 * (`studio/<userId>/sub/song/<songId>`), drives the shared audio engine from
 * that song's state, and renders the three surfaces + the per-song chat.
 *
 * Mounted with a `key={songId}` by the parent, so switching songs remounts the
 * whole subtree (fresh facet connection + clean engine state).
 */
export function SongView({
  userId,
  songId,
  surface,
  onSurfaceChange,
  onMeta,
}: {
  userId: string;
  songId: string;
  surface: Surface;
  onSurfaceChange: (s: Surface) => void;
  onMeta: (songId: string, key: string, tempo: number) => void;
}) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [hasLoadedSong, setHasLoadedSong] = useState(false);
  const [song, setSong] = useState<SongState>(defaultSongState);
  const patch = song.patch ?? defaultSongState.patch;

  // Stable ref so the state callback below doesn't need to re-subscribe.
  const onMetaRef = useRef(onMeta);
  onMetaRef.current = onMeta;

  // `agent` is assigned just below; the state callback reaches it via this ref.
  const agentRef = useRef<{ setState: (s: SongState) => void } | null>(null);
  // Audio never survives opening a song, so a persisted `playing: true` is
  // stale on first load — reconcile it to false once, on the live connection
  // (rather than racing a write against the closing socket on unmount).
  const reconciledRef = useRef(false);

  const agent = useAgent<SongState>({
    agent: "studio",
    name: userId,
    sub: [{ agent: "song", name: songId }],
    onOpen: useCallback(() => setConnectionStatus("connected"), []),
    onClose: useCallback(() => setConnectionStatus("disconnected"), []),
    onStateUpdate: useCallback(
      (next: SongState) => {
        let norm = normalizeSong(next);
        setHasLoadedSong(true);
        if (!reconciledRef.current) {
          reconciledRef.current = true;
          if (norm.playing) {
            norm = { ...norm, playing: false };
            agentRef.current?.setState(norm);
          }
        }
        setSong(norm);
        onMetaRef.current(songId, norm.key, norm.tempo);
      },
      [songId],
    ),
    onError: useCallback((error: Event) => console.error("WebSocket error:", error), []),
  });
  agentRef.current = agent;

  // Keep the modular engine in sync with the patch regardless of which surface
  // is open, so the Chord Lab's "Modular Synth" voice plays the current patch.
  useEffect(() => {
    modularEngine.setPatch(patch);
  }, [patch]);

  // Re-render the engine doc when the musical content changes.
  const docKey = JSON.stringify([
    song.chords,
    song.tempo,
    song.loopBars,
    song.loopSong,
    song.instrument,
    song.bass,
    song.drums,
    song.melody,
    song.beat,
    song.arrangement,
  ]);
  useEffect(() => {
    void engine.renderDoc(songDocFromState(song));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // Mixer + groove apply live (no re-render/restart).
  const mixKey = JSON.stringify(song.mix);
  useEffect(() => {
    engine.applyMix(song.mix);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixKey]);
  useEffect(() => {
    engine.setGroove(song.groove.swing, song.groove.humanize);
  }, [song.groove.swing, song.groove.humanize]);

  const wasPlaying = useRef(false);
  useEffect(() => {
    if (song.playing && !wasPlaying.current) void engine.play();
    else if (!song.playing && wasPlaying.current) engine.stop();
    wasPlaying.current = song.playing;
  }, [song.playing]);

  // Stop the transport and silence the shared modular engine when this song
  // unmounts (e.g. switching songs), so a voice left gated can't sound when the
  // next song re-renders the patch. (The stale `playing` flag is reconciled on
  // open instead — see `reconciledRef` above — since the socket is already
  // closing here.)
  useEffect(() => {
    return () => {
      engine.stop();
      modularEngine.allNotesOff();
    };
  }, []);

  const updateSong = useCallback(
    (next: SongState) => {
      setSong(next);
      agent.setState(next);
    },
    [agent],
  );

  // Play-once: when a non-looping song ends, the engine stops itself; mirror
  // that back into shared state so the transport button + agent stay in sync.
  useEffect(() => {
    engine.onSongEnd = () => {
      setSong((s) => {
        const next = { ...s, playing: false };
        agent.setState(next);
        return next;
      });
    };
    return () => {
      engine.onSongEnd = null;
    };
  }, [agent]);

  const updatePatch = useCallback(
    (p: Patch) => updateSong({ ...song, patch: p }),
    [song, updateSong],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        target?.isContentEditable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON"
      ) {
        return;
      }
      event.preventDefault();
      updateSong({ ...song, playing: !song.playing });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [song, updateSong]);

  const panelId = `surface-panel-${surface}`;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-5 py-2 bg-kumo-base border-b border-kumo-line flex items-center justify-center">
        <SurfaceTabs surface={surface} onChange={onSurfaceChange} />
      </div>
      <div className="flex-1 flex min-h-0 relative">
        <div
          id={panelId}
          role="tabpanel"
          aria-labelledby={`surface-tab-${surface}`}
          className="flex-1 flex min-w-0"
        >
          {surface === "chords" ? (
            <Workspace song={song} onChange={updateSong} />
          ) : surface === "beats" ? (
            <BeatMachine song={song} onChange={updateSong} />
          ) : (
            <ModularSurface patch={patch} onChange={updatePatch} />
          )}
        </div>
        {!hasLoadedSong && (
          <output className="absolute inset-0 z-10 flex items-center justify-center bg-kumo-elevated/80 text-sm text-kumo-inactive">
            Loading song…
          </output>
        )}
        <ChatPanel agent={agent} connectionStatus={connectionStatus} />
      </div>
    </div>
  );
}
