import { useCallback, useEffect, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { Button, Text } from "@cloudflare/kumo";
import { Workspace } from "./Workspace";
import { ModularSurface } from "./ModularSurface";
import { BeatMachine } from "./BeatMachine";
import { ChatPanel } from "./ChatPanel";
import { engine } from "../audio/engine";
import { modularEngine } from "../modular/engine";
import { defaultSongState, songDocFromState, type SongState } from "../music/song";
import { buildAutoSongDetails, buildSongSearchDoc } from "../music/search";
import type { Patch } from "../modular/types";
import type { ConnectionStatus } from "../client";
import type { SongMeta } from "../../agents/studio/agent";

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

function SongDetails({
  song,
  onChange,
  onRefreshChatSummary,
}: {
  song: SongMeta;
  onChange: (patch: Partial<Pick<SongMeta, "title" | "description" | "tags">>) => void;
  onRefreshChatSummary: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(song.title);
  const [description, setDescription] = useState(song.description);
  const [tags, setTags] = useState(song.tags.join(", "));

  useEffect(() => {
    setTitle(song.title);
    setDescription(song.description);
    setTags(song.tags.join(", "));
  }, [song.description, song.tags, song.title]);

  const save = () => {
    const nextTags = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const patch: Partial<Pick<SongMeta, "title" | "description" | "tags">> = {};
    if (title.trim() !== song.title) patch.title = title;
    if (description !== song.description) patch.description = description;
    if (nextTags.join("\0") !== song.tags.join("\0")) patch.tags = nextTags;
    if (Object.keys(patch).length > 0) onChange(patch);
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
            <label className="block">
              <Text size="xs" variant="secondary" bold>
                Title {song.userEdited.title ? "" : "(auto)"}
              </Text>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-kumo-line bg-kumo-elevated px-3 py-2 text-sm text-kumo-default outline-none focus:ring-2 focus:ring-kumo-ring"
              />
            </label>
            <label className="block">
              <Text size="xs" variant="secondary" bold>
                Description {song.userEdited.description ? "" : "(auto)"}
              </Text>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Dreamy minor synthwave sketch..."
                className="mt-1 w-full rounded-lg border border-kumo-line bg-kumo-elevated px-3 py-2 text-sm text-kumo-default outline-none focus:ring-2 focus:ring-kumo-ring"
              />
            </label>
            <label className="block">
              <Text size="xs" variant="secondary" bold>
                Tags {song.userEdited.tags ? "" : "(auto)"}
              </Text>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="lofi, modular, chorus idea"
                className="mt-1 w-full rounded-lg border border-kumo-line bg-kumo-elevated px-3 py-2 text-sm text-kumo-default outline-none focus:ring-2 focus:ring-kumo-ring"
              />
            </label>
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
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={save} disabled={!title.trim()}>
                  Save
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
  onSearchDoc,
  onRefreshChatSummary,
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
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [hasLoadedSong, setHasLoadedSong] = useState(false);
  const [song, setSong] = useState<SongState>(defaultSongState);
  const patch = song.patch ?? defaultSongState.patch;

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
        setSong(norm);
        onMetaRef.current(songId, norm.key, norm.tempo);
      },
      [songId],
    ),
    onError: useCallback((error: Event) => {
      console.error("WebSocket error:", error);
    }, []),
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
  const updateChatSummary = useCallback(
    (chatSummary: string) => onSearchDoc(songId, { chatSummary }),
    [onSearchDoc, songId],
  );

  const searchDocKey = JSON.stringify([
    songMeta.title,
    songMeta.description,
    songMeta.tags,
    songMeta.chatSummary,
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

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-5 py-2 bg-kumo-base border-b border-kumo-line grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <SongDetails
          song={songMeta}
          onChange={(patch) => onDetailsChange(songId, patch)}
          onRefreshChatSummary={() => onRefreshChatSummary(songId)}
        />
        <SurfaceTabs surface={surface} onChange={onSurfaceChange} />
        <div />
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
        <ChatPanel
          agent={agent}
          connectionStatus={connectionStatus}
          onChatSummary={updateChatSummary}
        />
      </div>
    </div>
  );
}
