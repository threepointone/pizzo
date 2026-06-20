import { useCallback, useEffect, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { Badge, Button } from "@cloudflare/kumo";
import { MoonIcon, SunIcon, WaveformIcon } from "@phosphor-icons/react";
import { SongList } from "./components/SongList";
import { SongView } from "./components/SongView";
import { useToast } from "./components/Toast";
import { engine } from "./audio/engine";
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

  return (
    <div className="flex flex-col h-screen bg-kumo-elevated">
      <header className="px-5 py-3 bg-kumo-base border-b border-kumo-line flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <WaveformIcon size={20} weight="bold" className="text-kumo-accent" />
          <h1 className="text-lg font-semibold text-kumo-default">Pizzo</h1>
          <Badge variant="secondary">AI studio</Badge>
        </div>
        <ModeToggle />
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
        />
        {activeSongId ? (
          <SongView
            key={activeSongId}
            userId={userId}
            songId={activeSongId}
            surface={surface}
            onSurfaceChange={setSurface}
            onMeta={handleMeta}
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
