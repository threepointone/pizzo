import { useCallback, useEffect, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { Badge, Button } from "@cloudflare/kumo";
import { MagnifyingGlassIcon, MoonIcon, SunIcon, WaveformIcon, XIcon } from "@phosphor-icons/react";
import { SongList } from "./components/SongList";
import { SongView } from "./components/SongView";
import { useToast } from "./components/Toast";
import { engine } from "./audio/engine";
import type { SongSearchResult } from "./music/search";
import type { SongMeta, StudioState } from "../agents/studio/agent";

type Surface = "chords" | "beats" | "modular";

const STORAGE_KEY = "pizzo-session";
const ACTIVE_SONG_KEY = "pizzo-active-song";

function getSessionId(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, id);
  return id;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

function ModeToggle() {
  const [mode, setMode] = useState(() => localStorage.getItem("theme") || "light");
  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [mode]);
  return (
    <Button
      variant="ghost"
      shape="square"
      aria-label="Toggle theme"
      onClick={() => setMode((m) => (m === "light" ? "dark" : "light"))}
      icon={mode === "light" ? <MoonIcon size={16} /> : <SunIcon size={16} />}
    />
  );
}

function GlobalSearch({
  activeId,
  onSelect,
  onSearch,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
  onSearch: (query: string) => Promise<SongSearchResult[]>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SongSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void onSearch(trimmed)
        .then((next) => {
          if (!cancelled) setResults(next.slice(0, 6));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onSearch, query]);

  return (
    <div className="relative w-[360px] max-w-[42vw]">
      <label className="relative block">
        <span className="sr-only">Search songs and commands</span>
        <MagnifyingGlassIcon
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-kumo-inactive"
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs... Cmd+K"
          className="w-full rounded-lg border border-kumo-line bg-kumo-elevated py-2 pl-8 pr-8 text-sm text-kumo-default outline-none focus:ring-2 focus:ring-kumo-ring"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear global search"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-kumo-inactive hover:text-kumo-default"
          >
            <XIcon size={12} />
          </button>
        )}
      </label>
      {query.trim() && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-kumo-line bg-kumo-base shadow-xl">
          {searching && results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-kumo-inactive">Searching...</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-kumo-inactive">No matches.</div>
          ) : (
            results.map(({ song, matchedFields, snippet }) => (
              <button
                key={song.id}
                type="button"
                onClick={() => {
                  onSelect(song.id);
                  setQuery("");
                }}
                className={`block w-full px-3 py-2 text-left hover:bg-kumo-elevated ${
                  song.id === activeId ? "bg-kumo-elevated" : ""
                }`}
              >
                <div className="truncate text-sm font-medium text-kumo-default">{song.title}</div>
                <div className="truncate text-[10px] text-kumo-inactive">
                  {matchedFields.length > 0
                    ? `Matched: ${matchedFields.slice(0, 3).join(", ")}`
                    : snippet || `${song.key} · ${song.tempo} BPM`}
                </div>
              </button>
            ))
          )}
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.blur();
            }}
            className="block w-full border-t border-kumo-line px-3 py-2 text-left text-xs text-kumo-inactive hover:bg-kumo-elevated"
          >
            Press Enter in chat to ask the assistant about a song.
          </button>
        </div>
      )}
    </div>
  );
}

export function App() {
  const { toast } = useToast();
  const userId = getSessionId();
  const [songs, setSongs] = useState<SongMeta[]>([]);
  const [activeSongId, setActiveSongId] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_SONG_KEY),
  );
  const [surface, setSurface] = useState<Surface>("chords");
  const [gotState, setGotState] = useState(false);
  const seededRef = useRef(false);

  const studio = useAgent<StudioState>({
    agent: "studio",
    name: userId,
    onStateUpdate: useCallback((next: StudioState) => {
      setSongs(next.songs ?? []);
      setGotState(true);
    }, []),
    onError: useCallback(
      (error: Event) => {
        console.error("Studio WebSocket error:", error);
        toast("Lost connection to your studio.", "error");
      },
      [toast],
    ),
  });

  // Seed the first song once we've received the studio's real (empty) state, so
  // a brand-new studio is never empty. Gating on `gotState` (not merely a live
  // connection) avoids seeding during the window before the song list arrives.
  useEffect(() => {
    if (gotState && songs.length === 0 && !seededRef.current) {
      seededRef.current = true;
      void studio.call("createSong").catch(() => {
        seededRef.current = false;
        toast("Couldn't create your first song.", "error");
      });
    }
  }, [gotState, songs.length, studio, toast]);

  // Keep a valid active song selected (fall back to the first one).
  useEffect(() => {
    if (songs.length === 0) return;
    if (!activeSongId || !songs.some((s) => s.id === activeSongId)) {
      setActiveSongId(songs[0].id);
    }
  }, [songs, activeSongId]);

  useEffect(() => {
    if (activeSongId) localStorage.setItem(ACTIVE_SONG_KEY, activeSongId);
  }, [activeSongId]);

  // Resume the AudioContext on the first user interaction anywhere, so that
  // playback triggered later (e.g. by the chat agent) can actually start.
  useEffect(() => {
    const unlock = () => void engine.ensureStarted();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const handleCreate = useCallback(async () => {
    try {
      const meta = (await studio.call("createSong")) as SongMeta;
      if (meta?.id) setActiveSongId(meta.id);
    } catch {
      toast("Couldn't create a new song.", "error");
    }
  }, [studio, toast]);

  const handleRename = useCallback(
    (id: string, title: string) => {
      void studio.call("renameSong", [id, title]).catch(() => {
        toast("Couldn't rename the song.", "error");
      });
    },
    [studio, toast],
  );

  const handleDetails = useCallback(
    (id: string, patch: Partial<Pick<SongMeta, "title" | "description" | "tags">>) => {
      void studio.call("updateSongDetails", [id, patch]).catch(() => {
        toast("Couldn't update song details.", "error");
      });
    },
    [studio, toast],
  );

  const handleDuplicate = useCallback(
    async (id: string) => {
      try {
        const meta = (await studio.call("duplicateSong", [id])) as SongMeta | null;
        if (meta?.id) setActiveSongId(meta.id);
      } catch {
        toast("Couldn't duplicate the song.", "error");
      }
    },
    [studio, toast],
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (activeSongId === id) setActiveSongId(null);
      void studio.call("deleteSong", [id]).catch(() => {
        toast("Couldn't delete the song.", "error");
      });
    },
    [studio, activeSongId, toast],
  );

  const handleMeta = useCallback(
    (id: string, key: string, tempo: number) => {
      const cur = songs.find((s) => s.id === id);
      if (cur && cur.key === key && cur.tempo === tempo) return;
      void studio.call("updateSongMeta", [id, { key, tempo }]).catch(() => {
        toast("Couldn't update the song preview.", "error");
      });
    },
    [studio, songs, toast],
  );

  const handleSearchDoc = useCallback(
    (
      id: string,
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
    ) => {
      void studio.call("updateSongSearchDoc", [id, doc]).catch(() => {
        toast("Couldn't update the song search index.", "error");
      });
    },
    [studio, toast],
  );

  const handleRefreshChatSummary = useCallback(
    (id: string) => {
      void studio.call("refreshChatSummary", [id]).catch(() => {
        toast("Couldn't refresh the chat summary.", "error");
      });
    },
    [studio, toast],
  );

  const handleSearchSongs = useCallback(
    async (query: string): Promise<SongSearchResult[]> => {
      try {
        return (await studio.call("searchSongs", [query])) as SongSearchResult[];
      } catch {
        toast("Couldn't search songs.", "error");
        return [];
      }
    },
    [studio, toast],
  );

  const activeSong = songs.find((song) => song.id === activeSongId) ?? null;

  return (
    <div className="flex flex-col h-screen bg-kumo-elevated">
      <header className="px-5 py-3 bg-kumo-base border-b border-kumo-line flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <WaveformIcon size={20} weight="bold" className="text-kumo-accent" />
          <h1 className="text-lg font-semibold text-kumo-default">Pizzo</h1>
          <Badge variant="secondary">AI studio</Badge>
        </div>
        <div className="flex items-center gap-3">
          <GlobalSearch
            activeId={activeSongId}
            onSelect={setActiveSongId}
            onSearch={handleSearchSongs}
          />
          <ModeToggle />
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <SongList
          songs={songs}
          activeId={activeSongId}
          onSelect={setActiveSongId}
          onCreate={() => void handleCreate()}
          onRename={handleRename}
          onDuplicate={(id) => void handleDuplicate(id)}
          onDelete={handleDelete}
          onSearch={handleSearchSongs}
        />
        {activeSongId && activeSong ? (
          <SongView
            key={activeSongId}
            userId={userId}
            songId={activeSongId}
            songMeta={activeSong}
            surface={surface}
            onSurfaceChange={setSurface}
            onMeta={handleMeta}
            onDetailsChange={handleDetails}
            onSearchDoc={handleSearchDoc}
            onRefreshChatSummary={handleRefreshChatSummary}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-kumo-inactive">
            Loading your studio…
          </div>
        )}
      </div>
    </div>
  );
}
