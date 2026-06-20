import { summarizePatch } from "../modular/edit";
import type { SongMeta } from "../../agents/studio/agent";
import type { SongState } from "./song";

export type SearchDocInput = Pick<SongMeta, "title" | "description" | "tags" | "chatSummary">;
export type AutoSongDetails = Pick<SongMeta, "title" | "description" | "tags">;

export type SongSearchDoc = {
  summary: string;
  text: string;
  fields: {
    title: string;
    description: string;
    tags: string[];
    key: string;
    tempo: string;
    chords: string;
    arrangement: string;
    band: string;
    sound: string;
    patch: string;
    chat: string;
  };
};

export type SongSearchResult = {
  song: SongMeta;
  score: number;
  matchedFields: string[];
  snippet?: string;
};

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .trim();
}

export function normalizeSearchMeta(meta: Partial<SongMeta>): SongMeta {
  return {
    id: meta.id ?? "",
    title: meta.title?.trim() || "Untitled",
    description: meta.description?.trim() || "",
    tags: Array.isArray(meta.tags) ? uniq(meta.tags.map((tag) => tag.trim()).slice(0, 12)) : [],
    userEdited: {
      title: meta.userEdited?.title ?? false,
      description: meta.userEdited?.description ?? false,
      tags: meta.userEdited?.tags ?? false,
    },
    searchSummary: meta.searchSummary?.trim() || "",
    searchText: meta.searchText?.trim() || "",
    chatSummary: meta.chatSummary?.trim() || "",
    key: meta.key ?? "C major",
    tempo: meta.tempo ?? 96,
    createdAt: meta.createdAt ?? Date.now(),
    updatedAt: meta.updatedAt ?? Date.now(),
  };
}

function tagFrom(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, "-");
}

export function buildAutoSongDetails(song: SongState, doc: SongSearchDoc): AutoSongDetails {
  const mode = song.key.toLowerCase().includes("minor") ? "minor" : "major";
  const chordText = song.chords.length > 0 ? song.chords.join(" ") : "single-chord loop";
  const enabledParts = [
    song.bass.enabled && `${song.bass.style} bass`,
    song.drums.enabled && `${song.drums.style} drums`,
    song.melody.enabled && `${song.melody.style} melody`,
    song.beat.enabled && "custom beat",
  ].filter(Boolean);
  const primaryPart = enabledParts[0] ?? "minimal arrangement";
  const title = song.chords.length > 0 ? `${song.key} ${primaryPart}` : `${song.key} idea`;
  const description = [
    `${song.tempo} BPM ${mode} sketch`,
    `Chords: ${chordText}`,
    enabledParts.length > 0 ? `Parts: ${enabledParts.join(", ")}` : "Sparse starting point",
    doc.fields.patch && `Patch: ${doc.fields.patch}`,
  ]
    .filter(Boolean)
    .join(". ");
  const tags = uniq(
    [
      tagFrom(mode),
      `${song.tempo}bpm`,
      song.bass.enabled && tagFrom(song.bass.style),
      song.drums.enabled && tagFrom(song.drums.style),
      song.melody.enabled && tagFrom(song.melody.style),
      song.beat.enabled && "beat-machine",
      song.instrument && tagFrom(song.instrument),
    ].filter((tag): tag is string => Boolean(tag)),
  ).slice(0, 8);
  return { title, description, tags };
}

export function mergeAutoSongDetails(
  meta: SongMeta,
  generated: Partial<AutoSongDetails>,
): SongMeta {
  return normalizeSearchMeta({
    ...meta,
    title: meta.userEdited.title ? meta.title : (generated.title ?? meta.title),
    description: meta.userEdited.description
      ? meta.description
      : (generated.description ?? meta.description),
    tags: meta.userEdited.tags ? meta.tags : (generated.tags ?? meta.tags),
    userEdited: meta.userEdited,
  });
}

export function buildSongSearchDoc(meta: SearchDocInput, song: SongState): SongSearchDoc {
  const arrangement =
    song.arrangement?.enabled && song.arrangement.sections.length > 0
      ? song.arrangement.sections
          .map((section) => `${section.name} ${section.chords.join(" ")}`)
          .join(" ")
      : "single loop";
  const band = [
    song.bass.enabled ? `${song.bass.style} bass` : "bass off",
    song.drums.enabled ? `${song.drums.style} drums busy ${song.drums.busy}` : "drums off",
    song.melody.enabled ? `${song.melody.style} melody ${song.melody.instrument}` : "melody off",
    song.beat.enabled ? "custom beat machine pattern" : "beat off",
    `swing ${Math.round(song.groove.swing * 100)} humanize ${Math.round(song.groove.humanize * 100)}`,
  ].join(" ");
  const sound = `${song.instrument} ${song.mix ? "mixed" : ""}`;
  const patch = summarizePatch(song.patch);
  const chords = song.chords.join(" ");
  const summary = [
    meta.description,
    `${song.key} ${song.tempo} BPM`,
    chords && `Chords ${chords}`,
    arrangement !== "single loop" && `Arrangement ${arrangement}`,
    band,
    sound,
    patch,
    meta.chatSummary,
  ]
    .filter(Boolean)
    .join(" · ");
  const fields = {
    title: meta.title,
    description: meta.description,
    tags: meta.tags,
    key: song.key,
    tempo: `${song.tempo} bpm`,
    chords,
    arrangement,
    band,
    sound,
    patch,
    chat: meta.chatSummary,
  };
  return {
    summary,
    fields,
    text: [
      fields.title,
      fields.description,
      fields.tags.join(" "),
      fields.key,
      fields.tempo,
      fields.chords,
      fields.arrangement,
      fields.band,
      fields.sound,
      fields.patch,
      fields.chat,
    ]
      .filter(Boolean)
      .join(" "),
  };
}
