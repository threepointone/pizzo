import {
  create,
  insertMultiple,
  load,
  save,
  search,
  type AnyOrama,
  type RawData,
} from "@orama/orama";
import { normalizeSearchMeta, normalizeSearchText, type SongSearchResult } from "./search";
import type { SongMeta } from "../../agents/studio/agent";

export const SONG_SEARCH_INDEX_VERSION = 1;

export type SearchDocument = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  key: string;
  tempo: number;
  searchSummary: string;
  searchText: string;
  chatSummary: string;
};

export type SongSearchIndex = AnyOrama;
export type SerializedSongSearchIndex = RawData;

const FIELD_LABELS: Record<keyof Omit<SearchDocument, "id" | "tempo"> | "tempo", string> = {
  title: "title",
  description: "description",
  tags: "tags",
  key: "key",
  tempo: "tempo",
  searchSummary: "summary",
  searchText: "music",
  chatSummary: "chat",
};

function documentFromSong(raw: SongMeta): SearchDocument {
  const song = normalizeSearchMeta(raw);
  return {
    id: song.id,
    title: song.title,
    description: song.description,
    tags: song.tags,
    key: song.key,
    tempo: song.tempo,
    searchSummary: song.searchSummary,
    searchText: song.searchText,
    chatSummary: song.chatSummary,
  };
}

function documentsFromSongs(rawSongs: SongMeta[]): SearchDocument[] {
  return rawSongs.map((song) => documentFromSong(song));
}

export function songSearchHash(rawSongs: SongMeta[]): string {
  const payload = documentsFromSongs(rawSongs)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((doc) => JSON.stringify(doc))
    .join("\n");
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) {
    hash = (hash * 33) ^ payload.charCodeAt(i);
  }
  return `${SONG_SEARCH_INDEX_VERSION}:${(hash >>> 0).toString(36)}`;
}

async function createSongSearchIndex(): Promise<SongSearchIndex> {
  return create({
    schema: {
      id: "string",
      title: "string",
      description: "string",
      tags: "string[]",
      key: "string",
      tempo: "number",
      searchSummary: "string",
      searchText: "string",
      chatSummary: "string",
    },
  });
}

export async function buildSongSearchIndex(rawSongs: SongMeta[]): Promise<SongSearchIndex> {
  const db = await createSongSearchIndex();
  const docs = documentsFromSongs(rawSongs);
  if (docs.length > 0) await insertMultiple(db, docs);
  return db;
}

export async function loadSongSearchIndex(
  raw: SerializedSongSearchIndex,
): Promise<SongSearchIndex> {
  const db = await createSongSearchIndex();
  load(db, raw);
  return db;
}

export function serializeSongSearchIndex(db: SongSearchIndex): SerializedSongSearchIndex {
  return save(db);
}

function snippetFor(song: SongMeta, query: string): string | undefined {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  const candidates = [song.description, song.searchSummary, song.chatSummary, song.searchText];
  for (const candidate of candidates) {
    const text = candidate.trim();
    if (!text) continue;
    const lower = normalizeSearchText(text);
    const token = tokens.find((t) => lower.includes(t));
    if (!token) continue;
    const start = Math.max(0, lower.indexOf(token) - 24);
    return `${start > 0 ? "..." : ""}${text.slice(start, start + 96)}${
      text.length > start + 96 ? "..." : ""
    }`;
  }
  return song.searchSummary || song.description || undefined;
}

function matchedFields(song: SongMeta, query: string): string[] {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const doc = documentFromSong(song);
  return Object.entries(doc)
    .filter(([field]) => field !== "id")
    .filter(([, value]) => {
      const text = Array.isArray(value) ? value.join(" ") : String(value);
      const normalized = normalizeSearchText(text);
      return tokens.some((token) => normalized.includes(token));
    })
    .map(([field]) => FIELD_LABELS[field as keyof typeof FIELD_LABELS] ?? field)
    .filter((field, index, arr) => arr.indexOf(field) === index);
}

export async function searchSongsWithOrama(
  rawSongs: SongMeta[],
  query: string,
): Promise<SongSearchResult[]> {
  const songs = rawSongs.map((song) => normalizeSearchMeta(song));
  if (!query.trim()) {
    return songs.map((song) => ({
      song,
      score: 0,
      matchedFields: [],
      snippet: song.searchSummary || song.description || undefined,
    }));
  }

  const db = await buildSongSearchIndex(songs);
  return searchSongSearchIndex(db, songs, query);
}

export async function searchSongSearchIndex(
  db: SongSearchIndex,
  songs: SongMeta[],
  query: string,
): Promise<SongSearchResult[]> {
  const results = await search(db, {
    term: query,
    limit: 20,
    properties: [
      "title",
      "tags",
      "description",
      "searchSummary",
      "key",
      "searchText",
      "chatSummary",
    ],
    boost: {
      title: 12,
      tags: 8,
      description: 6,
      searchSummary: 5,
      key: 4,
      searchText: 3,
      chatSummary: 3,
    },
  });

  const byId = new Map(songs.map((song) => [song.id, normalizeSearchMeta(song)]));
  return results.hits
    .map((hit) => {
      const doc = hit.document as SearchDocument;
      const song = byId.get(doc.id);
      if (!song) return null;
      const result: SongSearchResult = {
        song,
        score: hit.score,
        matchedFields: matchedFields(song, query),
      };
      const snippet = snippetFor(song, query);
      if (snippet) result.snippet = snippet;
      return result;
    })
    .filter((result): result is SongSearchResult => result !== null);
}
