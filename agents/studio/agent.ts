import { Think } from "@cloudflare/think";
import { createWorkersAI } from "workers-ai-provider";
import { callable } from "agents";
import { defaultSongState, type SongState } from "../../src/music/song";
import {
  buildSongSearchIndex,
  loadSongSearchIndex,
  searchSongSearchIndex,
  serializeSongSearchIndex,
  songSearchHash,
  SONG_SEARCH_INDEX_VERSION,
  type SerializedSongSearchIndex,
  type SongSearchIndex,
} from "../../src/music/oramaSearch";
import {
  mergeAutoSongDetails,
  normalizeSearchMeta,
  type SongSearchResult,
} from "../../src/music/search";
import { Song } from "./agents/song/agent";

/** One row in the song sidebar. The full musical content lives in the Song facet. */
export type SongMeta = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  userEdited: {
    title: boolean;
    description: boolean;
    tags: boolean;
  };
  searchSummary: string;
  searchText: string;
  chatSummary: string;
  key: string;
  tempo: number;
  createdAt: number;
  updatedAt: number;
};

/** The Studio's broadcast state: just the song list (the sidebar). */
export type StudioState = { songs: SongMeta[] };

const initialStudioState: StudioState = { songs: [] };
const SEARCH_INDEX_STORAGE_KEY = "studio:search-index";

type PersistedSearchIndex = {
  version: number;
  hash: string;
  raw: SerializedSongSearchIndex;
};

type DurableObjectStorageLike = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
};

type DurableObjectContextLike = {
  storage: DurableObjectStorageLike;
  waitUntil?: (promise: Promise<unknown>) => void;
};

type SongDetailsPatch = Partial<Pick<SongMeta, "title" | "description" | "tags">>;
type SongDetailField = keyof SongMeta["userEdited"];
type SongSearchDocPatch = Partial<
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
>;

let counter = 0;
function newSongId(): string {
  counter += 1;
  return `song-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Per-user directory ("studio"). A Think accumulator whose own chat machinery
 * stays dormant — it just owns the song list and spawns one {@link Song} facet
 * per song (each facet has its own SongState + chat history). The browser
 * addresses a song via `useAgent({ agent: "studio", name: userId,
 * sub: [{ agent: "song", name: songId }] })`.
 */
export class Studio extends Think<Env, StudioState> {
  override initialState = initialStudioState;
  private searchCache: { hash: string; db: SongSearchIndex } | null = null;
  private persistSearchPromise: Promise<void> | null = null;

  // Never used for chat (the directory is an accumulator), but Think wants a model.
  override getModel() {
    return createWorkersAI({ binding: this.env.AI })("@cf/moonshotai/kimi-k2.7-code", {
      sessionAffinity: this.sessionAffinity,
    });
  }

  // Strict registry gate: clients can only reach songs this studio spawned.
  override async onBeforeSubAgent(
    _request: Request,
    { className, name }: { className: string; name: string },
  ): Promise<Response | void> {
    if (!this.hasSubAgent(className as never, name)) {
      return new Response("Not found", { status: 404 });
    }
  }

  private studio(): StudioState {
    const s = this.state as StudioState | undefined;
    return s && Array.isArray(s.songs)
      ? { songs: s.songs.map((song) => normalizeSearchMeta(song)) }
      : initialStudioState;
  }

  private setSongs(songs: SongMeta[]): void {
    const normalized = songs.map((song) => normalizeSearchMeta(song));
    this.setState({ songs: normalized });
    this.searchCache = null;
    this.schedulePersistSearchIndex(normalized);
  }

  private durableObjectContext(): DurableObjectContextLike {
    return (this as unknown as { ctx: DurableObjectContextLike }).ctx;
  }

  private async readPersistedSearchIndex(): Promise<PersistedSearchIndex | null> {
    try {
      return (
        (await this.durableObjectContext().storage.get<PersistedSearchIndex>(
          SEARCH_INDEX_STORAGE_KEY,
        )) ?? null
      );
    } catch {
      return null;
    }
  }

  private async writePersistedSearchIndex(songs: SongMeta[]): Promise<void> {
    const normalized = songs.map((song) => normalizeSearchMeta(song));
    const hash = songSearchHash(normalized);
    const db = await buildSongSearchIndex(normalized);
    const persisted: PersistedSearchIndex = {
      version: SONG_SEARCH_INDEX_VERSION,
      hash,
      raw: serializeSongSearchIndex(db),
    };
    await this.durableObjectContext().storage.put(SEARCH_INDEX_STORAGE_KEY, persisted);
    this.searchCache = { hash, db };
  }

  private schedulePersistSearchIndex(songs: SongMeta[]): void {
    const persist = this.writePersistedSearchIndex(songs).catch(async () => {
      try {
        await this.durableObjectContext().storage.delete(SEARCH_INDEX_STORAGE_KEY);
      } catch {
        // Search index persistence is only a cache; canonical state is StudioState.songs.
      }
    });
    const tracked = persist.finally(() => {
      if (this.persistSearchPromise === tracked) this.persistSearchPromise = null;
    });
    this.persistSearchPromise = tracked;
    this.durableObjectContext().waitUntil?.(tracked);
  }

  private async ensureSearchIndex(songs: SongMeta[]): Promise<SongSearchIndex> {
    const normalized = songs.map((song) => normalizeSearchMeta(song));
    const hash = songSearchHash(normalized);
    if (this.searchCache?.hash === hash) return this.searchCache.db;

    const persisted = await this.readPersistedSearchIndex();
    if (persisted?.version === SONG_SEARCH_INDEX_VERSION && persisted.hash === hash) {
      try {
        const db = await loadSongSearchIndex(persisted.raw);
        this.searchCache = { hash, db };
        return db;
      } catch {
        await this.durableObjectContext()
          .storage.delete(SEARCH_INDEX_STORAGE_KEY)
          .catch(() => {});
      }
    }

    const db = await buildSongSearchIndex(normalized);
    this.searchCache = { hash, db };
    await this.durableObjectContext()
      .storage.put(SEARCH_INDEX_STORAGE_KEY, {
        version: SONG_SEARCH_INDEX_VERSION,
        hash,
        raw: serializeSongSearchIndex(db),
      } satisfies PersistedSearchIndex)
      .catch(() => {});
    return db;
  }

  @callable()
  async createSong(title?: string): Promise<SongMeta> {
    const id = newSongId();
    // Spawn the facet (idempotent) so it exists + passes the registry gate.
    await this.subAgent(Song, id);
    const meta: SongMeta = {
      id,
      title: title?.trim() || `Song ${this.studio().songs.length + 1}`,
      description: "",
      tags: [],
      userEdited: {
        title: Boolean(title?.trim()),
        description: false,
        tags: false,
      },
      searchSummary: "",
      searchText: "",
      chatSummary: "",
      key: defaultSongState.key,
      tempo: defaultSongState.tempo,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.setSongs([...this.studio().songs, meta]);
    return meta;
  }

  @callable()
  async renameSong(id: string, title: string): Promise<void> {
    const next = title.trim();
    if (!next) return;
    this.setSongs(
      this.studio().songs.map((s) =>
        s.id === id
          ? {
              ...s,
              title: next,
              userEdited: { ...s.userEdited, title: true },
              updatedAt: Date.now(),
            }
          : s,
      ),
    );
  }

  @callable()
  async updateSongDetails(id: string, patch: SongDetailsPatch): Promise<void> {
    const songs = this.studio().songs;
    const next = songs.map((song) =>
      song.id === id
        ? normalizeSearchMeta({
            ...song,
            ...patch,
            title: patch.title?.trim() || song.title,
            description: patch.description ?? song.description,
            tags: patch.tags ?? song.tags,
            userEdited: {
              ...song.userEdited,
              title: patch.title !== undefined ? true : song.userEdited.title,
              description: patch.description !== undefined ? true : song.userEdited.description,
              tags: patch.tags !== undefined ? true : song.userEdited.tags,
            },
            updatedAt: Date.now(),
          })
        : song,
    );
    this.setSongs(next);
  }

  @callable()
  async resetSongDetails(id: string, fields: SongDetailField[]): Promise<void> {
    const reset = new Set(fields);
    if (reset.size === 0) return;
    const songs = this.studio().songs;
    const next = songs.map((song) =>
      song.id === id
        ? normalizeSearchMeta({
            ...song,
            userEdited: {
              ...song.userEdited,
              title: reset.has("title") ? false : song.userEdited.title,
              description: reset.has("description") ? false : song.userEdited.description,
              tags: reset.has("tags") ? false : song.userEdited.tags,
            },
            updatedAt: Date.now(),
          })
        : song,
    );
    this.setSongs(next);
  }

  @callable()
  async duplicateSong(id: string): Promise<SongMeta | null> {
    const src = this.studio().songs.find((s) => s.id === id);
    if (!src) return null;
    const srcFacet = await this.subAgent(Song, id);
    const srcState: SongState = await srcFacet.getSong();
    const newId = newSongId();
    const dstFacet = await this.subAgent(Song, newId);
    await dstFacet.replaceSong({ ...srcState, playing: false });
    const meta: SongMeta = {
      id: newId,
      title: `${src.title} copy`,
      description: src.description,
      tags: [...src.tags],
      userEdited: {
        title: true,
        description: src.userEdited.description,
        tags: src.userEdited.tags,
      },
      searchSummary: src.searchSummary,
      searchText: src.searchText,
      chatSummary: src.chatSummary,
      key: srcState.key,
      tempo: srcState.tempo,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.setSongs([...this.studio().songs, meta]);
    return meta;
  }

  @callable()
  async deleteSong(id: string): Promise<void> {
    if (!this.studio().songs.some((s) => s.id === id)) return;
    await this.deleteSubAgent(Song, id);
    this.setSongs(this.studio().songs.filter((s) => s.id !== id));
  }

  /**
   * Keep the sidebar's key/tempo preview fresh. Called by the active song's
   * client whenever it receives new facet state.
   */
  @callable()
  async updateSongMeta(
    id: string,
    patch: Partial<Pick<SongMeta, "title" | "key" | "tempo">>,
  ): Promise<void> {
    const songs = this.studio().songs;
    if (!songs.some((s) => s.id === id)) return;
    this.setSongs(songs.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s)));
  }

  @callable()
  async updateSongSearchDoc(id: string, doc: SongSearchDocPatch): Promise<void> {
    const songs = this.studio().songs;
    let changed: SongMeta | null = null;
    const next = songs.map((song) => {
      if (song.id !== id) return song;
      const mergedDetails = mergeAutoSongDetails(song, doc);
      changed = normalizeSearchMeta({
        ...mergedDetails,
        searchSummary: doc.searchSummary ?? song.searchSummary,
        searchText: doc.searchText ?? song.searchText,
        chatSummary: doc.chatSummary ?? song.chatSummary,
        key: doc.key ?? song.key,
        tempo: doc.tempo ?? song.tempo,
        userEdited: song.userEdited,
        updatedAt: Date.now(),
      });
      return changed;
    });
    if (!changed) return;
    this.setSongs(next);
  }

  @callable()
  async refreshChatSummary(id: string): Promise<void> {
    const song = this.studio().songs.find((s) => s.id === id);
    if (!song?.chatSummary) return;
    await this.updateSongSearchDoc(id, {
      chatSummary: song.chatSummary,
    });
  }

  @callable()
  async searchSongs(query: string): Promise<SongSearchResult[]> {
    const songs = this.studio().songs;
    if (!query.trim()) {
      return songs.map((song) => ({
        song,
        score: 0,
        matchedFields: [],
        snippet: song.searchSummary || song.description || undefined,
      }));
    }
    const db = await this.ensureSearchIndex(songs);
    return searchSongSearchIndex(db, songs, query);
  }
}
