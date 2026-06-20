import { Think } from "@cloudflare/think";
import { createWorkersAI } from "workers-ai-provider";
import { callable } from "agents";
import { defaultSongState, type SongState } from "../../src/music/song";
import { Song } from "./agents/song/agent";

/** One row in the song sidebar. The full musical content lives in the Song facet. */
export type SongMeta = {
  id: string;
  title: string;
  key: string;
  tempo: number;
  createdAt: number;
  updatedAt: number;
};

/** The Studio's broadcast state: just the song list (the sidebar). */
export type StudioState = { songs: SongMeta[] };

const initialStudioState: StudioState = { songs: [] };

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
    return s && Array.isArray(s.songs) ? s : initialStudioState;
  }

  @callable()
  async createSong(title?: string): Promise<SongMeta> {
    const id = newSongId();
    // Spawn the facet (idempotent) so it exists + passes the registry gate.
    await this.subAgent(Song, id);
    const meta: SongMeta = {
      id,
      title: title?.trim() || `Song ${this.studio().songs.length + 1}`,
      key: defaultSongState.key,
      tempo: defaultSongState.tempo,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.setState({ songs: [...this.studio().songs, meta] });
    return meta;
  }

  @callable()
  async renameSong(id: string, title: string): Promise<void> {
    const next = title.trim();
    if (!next) return;
    this.setState({
      songs: this.studio().songs.map((s) =>
        s.id === id ? { ...s, title: next, updatedAt: Date.now() } : s,
      ),
    });
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
      key: srcState.key,
      tempo: srcState.tempo,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.setState({ songs: [...this.studio().songs, meta] });
    return meta;
  }

  @callable()
  async deleteSong(id: string): Promise<void> {
    if (!this.studio().songs.some((s) => s.id === id)) return;
    await this.deleteSubAgent(Song, id);
    this.setState({ songs: this.studio().songs.filter((s) => s.id !== id) });
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
    this.setState({
      songs: songs.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s)),
    });
  }
}
