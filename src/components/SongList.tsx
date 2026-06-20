import { useEffect, useMemo, useState } from "react";
import { Button, Text } from "@cloudflare/kumo";
import {
  CopyIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { SongMeta } from "../../agents/studio/agent";
import type { SongSearchResult } from "../music/search";

/** Left rail listing the user's songs, with create / rename / duplicate / delete. */
export function SongList({
  songs,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onSearch,
}: {
  songs: SongMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onSearch: (query: string) => Promise<SongSearchResult[]>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SongSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const shownSongs = query.trim() ? results.map((result) => result.song) : songs;
  const resultById = useMemo(
    () => new Map(results.map((result) => [result.song.id, result])),
    [results],
  );

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
          if (!cancelled) setResults(next);
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

  const startRename = (song: SongMeta) => {
    setEditingId(song.id);
    setDraft(song.title);
  };
  const commitRename = () => {
    if (editingId && draft.trim()) onRename(editingId, draft.trim());
    setEditingId(null);
  };

  return (
    <aside className="w-56 shrink-0 flex flex-col h-full border-r border-kumo-line bg-kumo-base">
      <div className="px-3 py-3 border-b border-kumo-line flex items-center justify-between">
        <Text size="sm" bold>
          Songs
        </Text>
        <Button
          variant="ghost"
          shape="square"
          size="sm"
          aria-label="New song"
          icon={<PlusIcon size={16} weight="bold" />}
          onClick={onCreate}
        />
      </div>

      <div className="p-2 border-b border-kumo-line">
        <label className="relative block">
          <span className="sr-only">Search songs</span>
          <MagnifyingGlassIcon
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-kumo-inactive"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search songs..."
            className="w-full rounded-lg border border-kumo-line bg-kumo-elevated py-2 pl-8 pr-8 text-sm text-kumo-default outline-none focus:ring-2 focus:ring-kumo-ring"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear song search"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-kumo-inactive hover:text-kumo-default"
            >
              <XIcon size={12} />
            </button>
          )}
        </label>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {songs.length === 0 && (
          <div className="px-2 py-4 text-xs text-kumo-inactive italic">No songs yet.</div>
        )}
        {songs.length > 0 && searching && shownSongs.length === 0 && (
          <div className="px-2 py-4 text-xs text-kumo-inactive italic">Searching...</div>
        )}
        {songs.length > 0 && !searching && shownSongs.length === 0 && (
          <div className="px-2 py-4 text-xs text-kumo-inactive italic">
            No matches for "{query}".
          </div>
        )}
        {shownSongs.map((song) => {
          const active = song.id === activeId;
          const result = resultById.get(song.id);
          const matchedFields = result?.matchedFields.filter((field) => field !== "chords");
          return (
            <div
              key={song.id}
              className={`group rounded-lg px-2.5 py-2 transition-colors ${
                active
                  ? "bg-kumo-contrast text-kumo-inverse"
                  : "hover:bg-kumo-elevated text-kumo-default"
              }`}
            >
              {editingId === song.id ? (
                <input
                  aria-label={`Rename ${song.title}`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="w-full px-1.5 py-0.5 rounded-md border border-kumo-line bg-kumo-base text-kumo-default text-sm outline-none"
                />
              ) : (
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => onSelect(song.id)}
                    className="min-w-0 flex-1 text-left rounded-md outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring"
                  >
                    <div className="text-sm font-medium truncate">{song.title}</div>
                    <div
                      className={`text-[10px] tabular-nums ${
                        active ? "text-kumo-inverse/70" : "text-kumo-inactive"
                      }`}
                    >
                      {song.key} · {song.tempo} BPM
                    </div>
                    {query.trim() && result && (
                      <div
                        className={`mt-0.5 text-[10px] line-clamp-2 ${
                          active ? "text-kumo-inverse/70" : "text-kumo-inactive"
                        }`}
                      >
                        {matchedFields && matchedFields.length > 0
                          ? `Matched: ${matchedFields.slice(0, 3).join(", ")}`
                          : result.snippet}
                      </div>
                    )}
                  </button>
                  <div
                    className={`flex items-center gap-0.5 ${
                      active
                        ? ""
                        : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                    } transition-opacity`}
                  >
                    <button
                      type="button"
                      aria-label="Rename song"
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(song);
                      }}
                      className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10"
                    >
                      <PencilSimpleIcon size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label="Duplicate song"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicate(song.id);
                      }}
                      className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10"
                    >
                      <CopyIcon size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete song"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          songs.length > 1 &&
                          window.confirm(
                            `Delete "${song.title}"? This permanently removes its saved song and chat.`,
                          )
                        ) {
                          onDelete(song.id);
                        }
                      }}
                      disabled={songs.length <= 1}
                      className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30"
                    >
                      <TrashIcon size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
