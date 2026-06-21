import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { Badge, Button } from "@cloudflare/kumo";
import { CaretLeftIcon, RobotIcon } from "@phosphor-icons/react";
import { Workspace } from "./Workspace";
import { ModularSurface } from "./ModularSurface";
import { BeatMachine } from "./BeatMachine";
import { ChatPanel } from "./ChatPanel";
import { engine } from "../audio/engine";
import { modularEngine } from "../modular/engine";
import {
  arrangementBars,
  defaultSongState,
  emptyBeat,
  instrumentLabel,
  MODULAR_VOICE_ID,
  normalizeEffects,
  songDocFromState,
  type SongState,
} from "../music/song";
import { makeSnapshot, type SongSnapshot } from "../music/variations";
import { buildAutoSongDetails, buildSongSearchDoc } from "../music/search";
import type { Patch } from "../modular/types";
import type { ConnectionStatus } from "../client";
import type { SongMeta } from "../../agents/studio/agent";
import { useToast } from "./Toast";

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
    effects: normalizeEffects(next.effects),
    groove: next.groove ?? defaultSongState.groove,
    patch: next.patch ?? defaultSongState.patch,
  };
}

type Surface = "chords" | "beats" | "modular";
const CHAT_SIDEBAR_COLLAPSED_KEY = "pizzo-chat-sidebar-collapsed";
const HISTORY_LIMIT = 20;
const snapshotsKey = (songId: string) => `pizzo-song-snapshots-${songId}`;

type SongHistoryEntry = {
  id: string;
  label: string;
  before: SongState;
  after: SongState;
};

function songSig(song: SongState): string {
  return JSON.stringify(song);
}

function describeSongChange(before: SongState, after: SongState): string {
  if (before.chords.join(" ") !== after.chords.join(" ")) {
    return `Progression: ${before.chords.join(" ") || "empty"} -> ${after.chords.join(" ") || "empty"}`;
  }
  if (before.tempo !== after.tempo) return `Tempo: ${before.tempo} -> ${after.tempo} BPM`;
  if (before.instrument !== after.instrument) {
    return `Sound: ${instrumentLabel(before.instrument)} -> ${instrumentLabel(after.instrument)}`;
  }
  if (before.beat.enabled !== after.beat.enabled) {
    return after.beat.enabled ? "Custom beat enabled" : "Returned to style groove";
  }
  if (before.arrangement.enabled !== after.arrangement.enabled) {
    return after.arrangement.enabled ? "Arrangement enabled" : "Returned to loop mode";
  }
  if (before.melody.seed !== after.melody.seed) return "Melody regenerated";
  return "Song updated";
}

function SongMap({
  song,
  surface,
  onSurfaceChange,
  onUseStyleGroove,
  onUseModular,
}: {
  song: SongState;
  surface: Surface;
  onSurfaceChange: (surface: Surface) => void;
  onUseStyleGroove: () => void;
  onUseModular: () => void;
}) {
  const arrangementOn = song.arrangement.enabled && song.arrangement.sections.length > 0;
  const sectionLabel = arrangementOn
    ? `${song.arrangement.sections.length} sections · ${arrangementBars(song.arrangement)} bars`
    : `${song.chords.length || 0} chord loop`;
  const modularActive = song.instrument === MODULAR_VOICE_ID;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-kumo-line bg-kumo-base/80 px-5 py-2 text-xs">
      <span className="font-semibold text-kumo-subtle">Song map</span>
      <button
        type="button"
        onClick={() => onSurfaceChange("chords")}
        className={`rounded-full border px-2 py-0.5 ${
          surface === "chords"
            ? "border-kumo-contrast bg-kumo-contrast text-kumo-inverse"
            : "border-kumo-line text-kumo-subtle hover:border-kumo-accent"
        }`}
      >
        {sectionLabel}
      </button>
      <button
        type="button"
        onClick={() => onSurfaceChange("beats")}
        className={`rounded-full border px-2 py-0.5 ${
          surface === "beats"
            ? "border-kumo-contrast bg-kumo-contrast text-kumo-inverse"
            : "border-kumo-line text-kumo-subtle hover:border-kumo-accent"
        }`}
      >
        {song.beat.enabled ? "Custom beat overrides drums" : `${song.drums.style} drums`}
      </button>
      {song.beat.enabled && (
        <button
          type="button"
          onClick={onUseStyleGroove}
          className="rounded-full border border-kumo-line px-2 py-0.5 text-kumo-inactive hover:border-kumo-accent hover:text-kumo-accent"
        >
          Use style groove
        </button>
      )}
      <button
        type="button"
        onClick={() => onSurfaceChange("modular")}
        className={`rounded-full border px-2 py-0.5 ${
          surface === "modular"
            ? "border-kumo-contrast bg-kumo-contrast text-kumo-inverse"
            : "border-kumo-line text-kumo-subtle hover:border-kumo-accent"
        }`}
      >
        {modularActive ? "Modular is chord sound" : instrumentLabel(song.instrument)}
      </button>
      {!modularActive && (
        <button
          type="button"
          onClick={onUseModular}
          className="rounded-full border border-kumo-line px-2 py-0.5 text-kumo-inactive hover:border-kumo-accent hover:text-kumo-accent"
        >
          Use modular
        </button>
      )}
    </div>
  );
}

function SnapshotControls({
  snapshots,
  selectedId,
  comparing,
  onSelect,
  onCreate,
  onCompare,
  onRestore,
}: {
  snapshots: SongSnapshot[];
  selectedId: string;
  comparing: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onCompare: () => void;
  onRestore: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Button variant="ghost" size="sm" onClick={onCreate}>
        Snapshot
      </Button>
      {snapshots.length > 0 && (
        <>
          <select
            aria-label="Song snapshot"
            value={selectedId}
            onChange={(e) => onSelect(e.target.value)}
            className="max-w-32 rounded-md border border-kumo-line bg-kumo-elevated px-2 py-1 text-xs text-kumo-default outline-none focus:ring-2 focus:ring-kumo-ring"
          >
            {snapshots.map((snapshot) => (
              <option key={snapshot.id} value={snapshot.id}>
                {snapshot.name}
              </option>
            ))}
          </select>
          <Button variant="ghost" size="sm" onClick={onCompare}>
            {comparing ? "A/B: current" : "A/B"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onRestore}>
            Revert
          </Button>
        </>
      )}
    </div>
  );
}

function SongDetails({
  song,
  onChange,
  onReset,
  onRefreshChatSummary,
}: {
  song: SongMeta;
  onChange: (patch: Partial<Pick<SongMeta, "title" | "description" | "tags">>) => void;
  onReset: (fields: Array<keyof SongMeta["userEdited"]>) => void;
  onRefreshChatSummary: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(song.title);
  const [description, setDescription] = useState(song.description);
  const [tags, setTags] = useState(song.tags.join(", "));
  const [dirty, setDirty] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const tagsId = useId();

  useEffect(() => {
    setTitle(song.title);
    setDescription(song.description);
    setTags(song.tags.join(", "));
    setDirty(false);
  }, [song.description, song.tags, song.title]);

  useEffect(() => {
    if (!dirty) return;
    const timeout = window.setTimeout(() => {
      const nextTags = tags
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);
      const uniqueTags = [...new Set(nextTags)];
      const patch: Partial<Pick<SongMeta, "title" | "description" | "tags">> = {};
      if (title.trim() && title.trim() !== song.title) patch.title = title.trim();
      if (description !== song.description) patch.description = description;
      if (uniqueTags.join("\0") !== song.tags.join("\0")) patch.tags = uniqueTags;
      if (Object.keys(patch).length > 0) onChange(patch);
      setDirty(false);
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [description, dirty, onChange, song.description, song.tags, song.title, tags, title]);

  const resetField = (field: keyof SongMeta["userEdited"]) => {
    setDirty(false);
    onReset([field]);
  };

  const flushBeforeClose = () => {
    const nextTags = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const patch: Partial<Pick<SongMeta, "title" | "description" | "tags">> = {};
    if (title.trim() && title.trim() !== song.title) patch.title = title.trim();
    if (description !== song.description) patch.description = description;
    if (nextTags.join("\0") !== song.tags.join("\0")) patch.tags = nextTags;
    if (Object.keys(patch).length > 0) onChange(patch);
    setDirty(false);
    setOpen(false);
  };

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        className="max-w-72 truncate rounded-lg px-2 py-1 text-left text-sm font-semibold text-kumo-default hover:bg-kumo-elevated focus-visible:ring-2 focus-visible:ring-kumo-ring"
      >
        {song.title}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-80 rounded-xl border border-kumo-line bg-kumo-base p-3 shadow-xl">
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={titleId} className="text-xs font-semibold text-kumo-subtle">
                  Title
                </label>
                <button
                  type="button"
                  onClick={() => resetField("title")}
                  disabled={!song.userEdited.title}
                  className="text-[10px] text-kumo-inactive hover:text-kumo-default disabled:opacity-40"
                >
                  {song.userEdited.title ? "Reset to auto" : "Auto"}
                </button>
              </div>
              <input
                id={titleId}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setDirty(true);
                }}
                className="mt-1 w-full rounded-lg border border-kumo-line bg-kumo-elevated px-3 py-2 text-sm text-kumo-default outline-none focus:ring-2 focus:ring-kumo-ring"
              />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={descriptionId} className="text-xs font-semibold text-kumo-subtle">
                  Description
                </label>
                <button
                  type="button"
                  onClick={() => resetField("description")}
                  disabled={!song.userEdited.description}
                  className="text-[10px] text-kumo-inactive hover:text-kumo-default disabled:opacity-40"
                >
                  {song.userEdited.description ? "Reset to auto" : "Auto"}
                </button>
              </div>
              <textarea
                id={descriptionId}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDirty(true);
                }}
                rows={3}
                placeholder="Dreamy minor synthwave sketch..."
                className="mt-1 w-full rounded-lg border border-kumo-line bg-kumo-elevated px-3 py-2 text-sm text-kumo-default outline-none focus:ring-2 focus:ring-kumo-ring"
              />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={tagsId} className="text-xs font-semibold text-kumo-subtle">
                  Tags
                </label>
                <button
                  type="button"
                  onClick={() => resetField("tags")}
                  disabled={!song.userEdited.tags}
                  className="text-[10px] text-kumo-inactive hover:text-kumo-default disabled:opacity-40"
                >
                  {song.userEdited.tags ? "Reset to auto" : "Auto"}
                </button>
              </div>
              <input
                id={tagsId}
                value={tags}
                onChange={(e) => {
                  setTags(e.target.value);
                  setDirty(true);
                }}
                placeholder="lofi, modular, chorus idea"
                className="mt-1 w-full rounded-lg border border-kumo-line bg-kumo-elevated px-3 py-2 text-sm text-kumo-default outline-none focus:ring-2 focus:ring-kumo-ring"
              />
            </div>
            <p className="text-[10px] text-kumo-inactive">
              {dirty
                ? "Saving changes..."
                : "Manual edits autosave. Auto fields update from the song."}
            </p>
            {song.chatSummary && (
              <p className="rounded-lg bg-kumo-elevated px-3 py-2 text-xs text-kumo-subtle">
                Chat summary: {song.chatSummary}
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={onRefreshChatSummary}>
                Refresh chat summary
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={flushBeforeClose}
                  disabled={!title.trim()}
                >
                  Done
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
  songMeta,
  surface,
  onSurfaceChange,
  onMeta,
  onDetailsChange,
  onDetailsReset,
  onSearchDoc,
  onRefreshChatSummary,
  audioState,
}: {
  userId: string;
  songId: string;
  songMeta: SongMeta;
  surface: Surface;
  onSurfaceChange: (s: Surface) => void;
  onMeta: (songId: string, key: string, tempo: number) => void;
  onDetailsChange: (
    songId: string,
    patch: Partial<Pick<SongMeta, "title" | "description" | "tags">>,
  ) => void;
  onDetailsReset: (songId: string, fields: Array<keyof SongMeta["userEdited"]>) => void;
  audioState: AudioContextState;
  onSearchDoc: (
    songId: string,
    doc: Partial<
      Pick<
        SongMeta,
        | "title"
        | "description"
        | "tags"
        | "searchSummary"
        | "searchText"
        | "chatSummary"
        | "key"
        | "tempo"
      >
    >,
  ) => void;
  onRefreshChatSummary: (songId: string) => void;
}) {
  const { toast } = useToast();
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [hasLoadedSong, setHasLoadedSong] = useState(false);
  const [song, setSong] = useState<SongState>(defaultSongState);
  const [isRendering, setIsRendering] = useState(false);
  const [transportNote, setTransportNote] = useState("");
  const [chatCollapsed, setChatCollapsed] = useState(
    () => localStorage.getItem(CHAT_SIDEBAR_COLLAPSED_KEY) === "true",
  );
  const patch = song.patch ?? defaultSongState.patch;
  const [undoStack, setUndoStack] = useState<SongHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<SongHistoryEntry[]>([]);
  const [snapshots, setSnapshots] = useState<SongSnapshot[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(snapshotsKey(songId)) ?? "[]") as SongSnapshot[];
    } catch {
      return [];
    }
  });
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const [comparingSnapshot, setComparingSnapshot] = useState(false);
  const compareBaseRef = useRef<SongState | null>(null);
  const suppressHistoryRef = useRef(false);
  const pendingAiBeforeRef = useRef<SongState | null>(null);
  const pendingAiEntryIdRef = useRef<string | null>(null);

  // Stable ref so the state callback below doesn't need to re-subscribe.
  const onMetaRef = useRef(onMeta);
  onMetaRef.current = onMeta;
  const onSearchDocRef = useRef(onSearchDoc);
  onSearchDocRef.current = onSearchDoc;

  // `agent` is assigned just below; the state callback reaches it via this ref.
  const agentRef = useRef<{ setState: (s: SongState) => void } | null>(null);
  // Audio never survives opening a song, so a persisted `playing: true` is
  // stale on first load — reconcile it to false once, on the live connection
  // (rather than racing a write against the closing socket on unmount).
  const reconciledRef = useRef(false);
  const renderSeqRef = useRef(0);

  const agent = useAgent<SongState>({
    agent: "studio",
    name: userId,
    sub: [{ agent: "song", name: songId }],
    onOpen: useCallback(() => setConnectionStatus("connected"), []),
    onClose: useCallback(() => {
      setConnectionStatus("disconnected");
    }, []),
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
        const pendingBefore = pendingAiBeforeRef.current;
        if (
          !suppressHistoryRef.current &&
          pendingBefore &&
          songSig(pendingBefore) !== songSig(norm)
        ) {
          const id = pendingAiEntryIdRef.current ?? crypto.randomUUID();
          const entry = {
            id,
            label: describeSongChange(pendingBefore, norm),
            before: pendingBefore,
            after: norm,
          };
          pendingAiEntryIdRef.current = id;
          setUndoStack((stack) => {
            const withoutExisting = stack.filter((item) => item.id !== id);
            return [...withoutExisting, entry].slice(-HISTORY_LIMIT);
          });
          setRedoStack([]);
        }
        suppressHistoryRef.current = false;
        setSong(norm);
        onMetaRef.current(songId, norm.key, norm.tempo);
      },
      [songId],
    ),
    onError: useCallback(
      (error: Event) => {
        console.error("WebSocket error:", error);
        toast("Lost connection to this song.", "error");
      },
      [toast],
    ),
  });
  agentRef.current = agent;

  // Keep the modular engine in sync with the patch regardless of which surface
  // is open, so the Chord Lab's "Modular Synth" voice plays the current patch.
  useEffect(() => {
    modularEngine.setPatch(patch);
  }, [patch]);

  useEffect(() => {
    localStorage.setItem(CHAT_SIDEBAR_COLLAPSED_KEY, String(chatCollapsed));
  }, [chatCollapsed]);

  useEffect(() => {
    localStorage.setItem(snapshotsKey(songId), JSON.stringify(snapshots.slice(0, 12)));
  }, [snapshots, songId]);

  useEffect(() => {
    if (!selectedSnapshotId && snapshots[0]) setSelectedSnapshotId(snapshots[0].id);
    if (selectedSnapshotId && !snapshots.some((snapshot) => snapshot.id === selectedSnapshotId)) {
      setSelectedSnapshotId(snapshots[0]?.id ?? "");
    }
  }, [selectedSnapshotId, snapshots]);

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
    let cancelled = false;
    const seq = renderSeqRef.current + 1;
    renderSeqRef.current = seq;
    setIsRendering(true);
    void engine
      .renderDoc(songDocFromState(song))
      .catch(() => {
        if (!cancelled && renderSeqRef.current === seq)
          setTransportNote("Audio render failed. Try changing the song or reloading.");
      })
      .finally(() => {
        if (!cancelled && renderSeqRef.current === seq) setIsRendering(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // Mixer + groove apply live (no re-render/restart).
  const mixKey = JSON.stringify(song.mix);
  useEffect(() => {
    engine.applyMix(song.mix);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixKey]);
  const effectsKey = JSON.stringify(song.effects);
  useEffect(() => {
    engine.applyEffects(song.effects);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectsKey]);
  useEffect(() => {
    engine.setGroove(song.groove.swing, song.groove.humanize);
  }, [song.groove.swing, song.groove.humanize]);

  const wasPlaying = useRef(false);
  useEffect(() => {
    if (song.playing && !wasPlaying.current) {
      setTransportNote("Starting playback...");
      void engine
        .play()
        .then(() => setTransportNote(song.loopSong === false ? "Playing once." : "Playing."))
        .catch(() => {
          setTransportNote("Playback could not start. Click anywhere and try again.");
          setSong((s) => {
            const next = { ...s, playing: false };
            agent.setState(next);
            return next;
          });
        });
    } else if (!song.playing && wasPlaying.current) {
      engine.stop();
      setTransportNote("Stopped.");
    }
    wasPlaying.current = song.playing;
  }, [agent, song.loopSong, song.playing]);

  // Stop the transport and silence the shared modular engine when this song
  // unmounts (e.g. switching songs), so a voice left gated can't sound when the
  // next song re-renders the patch. (The stale `playing` flag is reconciled on
  // open instead — see `reconciledRef` above — since the socket is already
  // closing here.)
  useEffect(() => {
    return () => {
      engine.stop();
      modularEngine.allNotesOff();
      wasPlaying.current = false;
    };
  }, []);

  const commitSong = useCallback(
    (next: SongState, label?: string) => {
      pendingAiBeforeRef.current = null;
      pendingAiEntryIdRef.current = null;
      setUndoStack((stack) =>
        [
          ...stack,
          {
            id: crypto.randomUUID(),
            label: label ?? describeSongChange(song, next),
            before: song,
            after: next,
          },
        ].slice(-HISTORY_LIMIT),
      );
      setRedoStack([]);
      setSong(next);
      agent.setState(next);
    },
    [agent, song],
  );

  const updateSong = useCallback((next: SongState) => commitSong(next), [commitSong]);

  const restoreSong = useCallback(
    (next: SongState) => {
      suppressHistoryRef.current = true;
      setSong(next);
      agent.setState(next);
    },
    [agent],
  );

  const undoLastChange = useCallback(() => {
    const entry = undoStack.at(-1);
    if (!entry) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, entry].slice(-HISTORY_LIMIT));
    restoreSong(entry.before);
  }, [restoreSong, undoStack]);

  const redoLastChange = useCallback(() => {
    const entry = redoStack.at(-1);
    if (!entry) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, entry].slice(-HISTORY_LIMIT));
    restoreSong(entry.after);
  }, [redoStack, restoreSong]);

  const captureAiSnapshot = useCallback((before: SongState) => {
    pendingAiBeforeRef.current = before;
    pendingAiEntryIdRef.current = null;
  }, []);

  const createSnapshot = useCallback(() => {
    const name = window.prompt("Snapshot name:", `${song.key} ${new Date().toLocaleTimeString()}`);
    if (name === null) return;
    const snapshot = makeSnapshot(name, song);
    setSnapshots((items) => [snapshot, ...items].slice(0, 12));
    setSelectedSnapshotId(snapshot.id);
    toast("Snapshot saved.", "success");
  }, [song, toast]);

  const selectedSnapshot = snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? null;

  const compareSnapshot = useCallback(() => {
    if (!selectedSnapshot) return;
    if (!comparingSnapshot) {
      compareBaseRef.current = song;
      commitSong(selectedSnapshot.song, `Preview snapshot: ${selectedSnapshot.name}`);
      setComparingSnapshot(true);
    } else {
      const base = compareBaseRef.current;
      if (base) commitSong(base, "Return to current song");
      compareBaseRef.current = null;
      setComparingSnapshot(false);
    }
  }, [commitSong, comparingSnapshot, selectedSnapshot, song]);

  const restoreSnapshot = useCallback(() => {
    if (!selectedSnapshot) return;
    commitSong(selectedSnapshot.song, `Reverted to snapshot: ${selectedSnapshot.name}`);
    setComparingSnapshot(false);
    compareBaseRef.current = null;
  }, [commitSong, selectedSnapshot]);

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
  const updateChatSummary = useCallback(
    (chatSummary: string) => onSearchDoc(songId, { chatSummary }),
    [onSearchDoc, songId],
  );

  const searchDocKey = JSON.stringify([
    songMeta.title,
    songMeta.description,
    songMeta.tags,
    songMeta.chatSummary,
    songMeta.userEdited.title,
    songMeta.userEdited.description,
    songMeta.userEdited.tags,
    song.chords,
    song.key,
    song.tempo,
    song.instrument,
    song.bass,
    song.drums,
    song.melody,
    song.beat,
    song.arrangement,
    song.mix,
    song.effects,
    song.groove,
    song.patch,
  ]);
  const lastSearchDocSig = useRef("");
  useEffect(() => {
    if (!hasLoadedSong) return;
    const timeout = window.setTimeout(() => {
      const doc = buildSongSearchDoc(songMeta, song);
      const autoDetails = buildAutoSongDetails(song, doc);
      const sig = JSON.stringify([
        autoDetails.title,
        autoDetails.description,
        autoDetails.tags,
        doc.summary,
        doc.text,
        song.key,
        song.tempo,
      ]);
      if (sig === lastSearchDocSig.current) return;
      lastSearchDocSig.current = sig;
      onSearchDocRef.current(songId, {
        ...autoDetails,
        key: song.key,
        tempo: song.tempo,
        searchSummary: doc.summary,
        searchText: doc.text,
      });
    }, 500);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDocKey, hasLoadedSong, songId]);

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
  const statusLabel = isRendering
    ? "Rendering audio"
    : song.playing
      ? song.loopSong === false
        ? "Playing once"
        : "Playing"
      : "Stopped";
  const audioLabel =
    audioState === "running" ? "Sound ready" : "Click or press any key to enable sound";
  const lastUndo = undoStack.at(-1);
  const lastRedo = redoStack.at(-1);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-5 py-2 bg-kumo-base border-b border-kumo-line grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <SongDetails
          song={songMeta}
          onChange={(patch) => onDetailsChange(songId, patch)}
          onReset={(fields) => onDetailsReset(songId, fields)}
          onRefreshChatSummary={() => onRefreshChatSummary(songId)}
        />
        <SurfaceTabs surface={surface} onChange={onSurfaceChange} />
        <div className="flex min-w-0 items-center justify-end gap-2">
          <SnapshotControls
            snapshots={snapshots}
            selectedId={selectedSnapshotId}
            comparing={comparingSnapshot}
            onSelect={setSelectedSnapshotId}
            onCreate={createSnapshot}
            onCompare={compareSnapshot}
            onRestore={restoreSnapshot}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={undoLastChange}
            disabled={!lastUndo}
            title={lastUndo ? `Undo: ${lastUndo.label}` : "Nothing to undo"}
          >
            Undo
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={redoLastChange}
            disabled={!lastRedo}
            title={lastRedo ? `Redo: ${lastRedo.label}` : "Nothing to redo"}
          >
            Redo
          </Button>
          <Badge variant="secondary">{statusLabel}</Badge>
          <Badge variant={audioState === "running" ? "primary" : "secondary"}>{audioLabel}</Badge>
          {transportNote && (
            <span className="truncate text-[10px] text-kumo-inactive">{transportNote}</span>
          )}
        </div>
      </div>
      <SongMap
        song={song}
        surface={surface}
        onSurfaceChange={onSurfaceChange}
        onUseStyleGroove={() => updateSong({ ...song, beat: { ...emptyBeat(), enabled: false } })}
        onUseModular={() => updateSong({ ...song, instrument: MODULAR_VOICE_ID })}
      />
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
            <ModularSurface
              patch={patch}
              onChange={updatePatch}
              isUsedInChordLab={song.instrument === MODULAR_VOICE_ID}
              onUseInChordLab={() => updateSong({ ...song, instrument: MODULAR_VOICE_ID })}
            />
          )}
        </div>
        {!hasLoadedSong && (
          <output className="absolute inset-0 z-10 flex items-center justify-center bg-kumo-elevated/80 text-sm text-kumo-inactive">
            Loading song…
          </output>
        )}
        {chatCollapsed ? (
          <aside
            className="w-12 shrink-0 flex flex-col items-center gap-2 border-l border-kumo-line bg-kumo-base px-1.5 py-3"
            aria-label="Collapsed assistant sidebar"
          >
            <Button
              variant="ghost"
              shape="square"
              size="sm"
              aria-label="Expand assistant sidebar"
              title="Expand assistant sidebar"
              icon={<CaretLeftIcon size={15} weight="bold" />}
              onClick={() => setChatCollapsed(false)}
            />
            <RobotIcon size={17} weight="bold" className="text-kumo-accent" aria-hidden="true" />
          </aside>
        ) : (
          <ChatPanel
            agent={agent}
            song={song}
            connectionStatus={connectionStatus}
            onChatSummary={updateChatSummary}
            onBeforeUserMessage={captureAiSnapshot}
            onUndoLastChange={undoLastChange}
            lastActionLabel={lastUndo?.label}
            onCollapse={() => setChatCollapsed(true)}
          />
        )}
      </div>
    </div>
  );
}
