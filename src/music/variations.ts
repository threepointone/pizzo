import type { SongState } from "./song";

export type SongSnapshot = {
  id: string;
  name: string;
  createdAt: number;
  song: SongState;
};

export function makeSnapshot(name: string, song: SongState): SongSnapshot {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || "Snapshot",
    createdAt: Date.now(),
    song,
  };
}
