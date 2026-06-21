import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { Badge, Button, Text } from "@cloudflare/kumo";
import { Workspace } from "./Workspace";
import { ModularSurface } from "./ModularSurface";
import { BeatMachine } from "./BeatMachine";
import { ChatPanel } from "./ChatPanel";
import { engine } from "../audio/engine";
import { modularEngine } from "../modular/engine";
import {
  arrangementBars,
  defaultSongState,
  guessKey,
  makeSection,
  normalizeEffects,
  parseProgression,
  songDocFromState,
  type Arrangement,
  type Section,
  type SongState,
} from "../music/song";
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
    effects: normalizeEffects(next.effects),
    groove: next.groove ?? defaultSongState.groove,
    patch: next.patch ?? defaultSongState.patch,
  };
}

type Surface = "chords" | "beats" | "modular";

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

const voiceLabels: Array<keyof Pick<Section, "bass" | "drums" | "melody">> = [
  "bass",
  "drums",
  "melody",
];

function sectionProgression(section: Section): string {
  return section.chords.join(" ");
}

function deriveArrangementSongState(song: SongState, arrangement: Arrangement): SongState {
  const current =
    arrangement.sections.find((section) => section.id === arrangement.current) ??
    arrangement.sections[0] ??
    null;
  if (!current) return { ...song, arrangement };
  const keyGuess = guessKey(current.chords);
  return {
    ...song,
    arrangement: {
      ...arrangement,
      current: current.id,
    },
    chords: current.chords,
    key: keyGuess.key,
    scale: keyGuess.scale,
  };
}

function ArrangementEditor({
  song,
  onChange,
}: {
  song: SongState;
  onChange: (song: SongState) => void;
}) {
  const arrangement = song.arrangement ?? defaultSongState.arrangement;
  const current =
    arrangement.sections.find((section) => section.id === arrangement.current) ??
    arrangement.sections[0] ??
    null;
  const [nameDraft, setNameDraft] = useState(current?.name ?? "");
  const [chordDraft, setChordDraft] = useState(current ? sectionProgression(current) : "");
  const [chordError, setChordError] = useState("");

  useEffect(() => {
    setNameDraft(current?.name ?? "");
    setChordDraft(current ? sectionProgression(current) : "");
    setChordError("");
  }, [current]);

  const applyArrangement = useCallback(
    (next: Arrangement) => onChange(deriveArrangementSongState(song, next)),
    [onChange, song],
  );

  const ensureEnabled = () => {
    const section =
      current ??
      makeSection("Section 1", song.chords.length > 0 ? song.chords : defaultSongState.chords, {
        bass: song.bass.enabled,
        drums: song.drums.enabled,
        melody: song.melody.enabled,
      });
    applyArrangement({ enabled: true, sections: [section], current: section.id });
  };

  const updateCurrent = (patch: Partial<Omit<Section, "id">>) => {
    if (!current) return;
    applyArrangement({
      ...arrangement,
      enabled: true,
      current: current.id,
      sections: arrangement.sections.map((section) =>
        section.id === current.id ? { ...section, ...patch } : section,
      ),
    });
  };

  const commitName = () => {
    if (!current) return;
    updateCurrent({ name: nameDraft.trim() || current.name });
  };

  const commitChords = () => {
    const parsed = parseProgression(chordDraft);
    if (parsed.length === 0) {
      setChordError("Enter at least one recognizable chord.");
      setChordDraft(current ? sectionProgression(current) : "");
      return;
    }
    setChordError("");
    updateCurrent({ chords: parsed });
  };

  const addSection = () => {
    const nextNumber = arrangement.sections.length + 1;
    const section = makeSection(
      `Section ${nextNumber}`,
      current?.chords ?? song.chords,
      current ?? undefined,
    );
    applyArrangement({
      enabled: true,
      sections: [...arrangement.sections, section],
      current: section.id,
    });
  };

  const duplicateSection = () => {
    if (!current) return;
    const index = arrangement.sections.findIndex((section) => section.id === current.id);
    const section = makeSection(`${current.name} copy`, current.chords, current);
    const sections = [...arrangement.sections];
    sections.splice(index + 1, 0, section);
    applyArrangement({ ...arrangement, enabled: true, sections, current: section.id });
  };

  const deleteSection = () => {
    if (!current || arrangement.sections.length <= 1) return;
    const index = arrangement.sections.findIndex((section) => section.id === current.id);
    const sections = arrangement.sections.filter((section) => section.id !== current.id);
    applyArrangement({
      ...arrangement,
      enabled: true,
      sections,
      current: sections[Math.max(0, index - 1)]?.id ?? sections[0]?.id ?? null,
    });
  };

  const moveSection = (direction: -1 | 1) => {
    if (!current) return;
    const index = arrangement.sections.findIndex((section) => section.id === current.id);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= arrangement.sections.length) return;
    const sections = [...arrangement.sections];
    [sections[index], sections[nextIndex]] = [sections[nextIndex], sections[index]];
    applyArrangement({ ...arrangement, enabled: true, sections, current: current.id });
  };

  if (!arrangement.enabled) {
    return (
      <div className="border-b border-kumo-line bg-kumo-base px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-kumo-line bg-kumo-elevated px-3 py-2">
          <div>
            <Text size="sm" bold>
              Arrangement
            </Text>
            <p className="mt-0.5 text-xs text-kumo-inactive">
              Build a song timeline from sections with their own chords and voices.
            </p>
          </div>
          <Button size="sm" variant="primary" onClick={ensureEnabled}>
            Enable arrangement
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section
      aria-label="Arrangement editor"
      className="border-b border-kumo-line bg-kumo-base px-5 py-3"
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(240px,1fr)_minmax(360px,1.4fr)]">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Text size="sm" bold>
                Arrangement
              </Text>
              <Badge variant="secondary">{arrangementBars(arrangement)} bars</Badge>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => applyArrangement({ ...arrangement, enabled: false })}
            >
              Disable
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Arrangement sections">
            {arrangement.sections.map((section, index) => {
              const selected = section.id === current?.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    applyArrangement({ ...arrangement, current: section.id, enabled: true })
                  }
                  className={`rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${
                    selected
                      ? "border-kumo-contrast bg-kumo-contrast text-kumo-inverse"
                      : "border-kumo-line bg-kumo-elevated text-kumo-default hover:bg-kumo-line"
                  }`}
                >
                  <span className="mr-1 tabular-nums opacity-60">{index + 1}</span>
                  {section.name || "Untitled"}
                  <span className="ml-1 opacity-60">x{section.repeats}</span>
                </button>
              );
            })}
          </div>
        </div>

        {current && (
          <div className="rounded-xl border border-kumo-line bg-kumo-elevated p-3">
            <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto]">
              <label className="block">
                <Text size="xs" variant="secondary" bold>
                  Section name
                </Text>
                <input
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onBlur={commitName}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") setNameDraft(current.name);
                  }}
                  className="mt-1 w-full rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-default outline-none focus:ring-2 focus:ring-kumo-ring"
                />
              </label>
              <label className="block">
                <Text size="xs" variant="secondary" bold>
                  Chords
                </Text>
                <input
                  value={chordDraft}
                  onChange={(event) => setChordDraft(event.target.value)}
                  onBlur={commitChords}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      setChordDraft(sectionProgression(current));
                      setChordError("");
                    }
                  }}
                  aria-invalid={Boolean(chordError)}
                  className="mt-1 w-full rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-default outline-none focus:ring-2 focus:ring-kumo-ring"
                />
                {chordError && <p className="mt-1 text-[10px] text-red-500">{chordError}</p>}
              </label>
              <label className="block">
                <Text size="xs" variant="secondary" bold>
                  Repeats
                </Text>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={current.repeats}
                  onChange={(event) =>
                    updateCurrent({
                      repeats: Math.max(1, Math.min(16, Number(event.target.value) || 1)),
                    })
                  }
                  className="mt-1 w-20 rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-default outline-none focus:ring-2 focus:ring-kumo-ring"
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {voiceLabels.map((voice) => (
                  <button
                    key={voice}
                    type="button"
                    aria-pressed={current[voice]}
                    onClick={() => updateCurrent({ [voice]: !current[voice] })}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize ${
                      current[voice]
                        ? "bg-kumo-contrast text-kumo-inverse"
                        : "bg-kumo-base text-kumo-inactive hover:text-kumo-default"
                    }`}
                  >
                    {voice}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={addSection}>
                  Add
                </Button>
                <Button size="sm" variant="ghost" onClick={duplicateSection}>
                  Duplicate
                </Button>
                <Button size="sm" variant="ghost" onClick={() => moveSection(-1)}>
                  Move up
                </Button>
                <Button size="sm" variant="ghost" onClick={() => moveSection(1)}>
                  Move down
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={deleteSection}
                  disabled={arrangement.sections.length <= 1}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
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
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [hasLoadedSong, setHasLoadedSong] = useState(false);
  const [song, setSong] = useState<SongState>(defaultSongState);
  const [isRendering, setIsRendering] = useState(false);
  const [transportNote, setTransportNote] = useState("");
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
    let cancelled = false;
    setIsRendering(true);
    void engine
      .renderDoc(songDocFromState(song))
      .catch(() => {
        if (!cancelled)
          setTransportNote("Audio render failed. Try changing the song or reloading.");
      })
      .finally(() => {
        if (!cancelled) setIsRendering(false);
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
          <Badge variant="secondary">{statusLabel}</Badge>
          <Badge variant="secondary">
            {audioState === "running" ? "Audio ready" : "Audio locked"}
          </Badge>
          {transportNote && (
            <span className="truncate text-[10px] text-kumo-inactive">{transportNote}</span>
          )}
        </div>
      </div>
      <ArrangementEditor song={song} onChange={updateSong} />
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
