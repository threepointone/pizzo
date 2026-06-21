import { describe, expect, it } from "vitest";
import {
  defaultSongState,
  emptyBeat,
  euclid,
  euclidBeat,
  generateDrums,
  beatToHits,
  styleToBeat,
} from "./song";
import {
  buildSongSearchIndex,
  loadSongSearchIndex,
  searchSongSearchIndex,
  searchSongsWithOrama,
  serializeSongSearchIndex,
  songSearchHash,
} from "./oramaSearch";
import {
  buildAutoSongDetails,
  buildSongSearchDoc,
  mergeAutoSongDetails,
  normalizeSearchMeta,
  type SearchDocInput,
} from "./search";
import { guessKey, parseProgression, reharmonize, transposeProgression } from "./theory";
import type { SongMeta } from "../../agents/studio/agent";

const pattern = (steps: boolean[]) => steps.map((on) => (on ? "x" : ".")).join("");
const songMeta = (meta: Partial<SongMeta>): SongMeta => normalizeSearchMeta(meta);

describe("theory helpers", () => {
  it("parses recognized chord tokens from typed progressions", () => {
    expect(parseProgression("Am, F C nope G7")).toEqual(["Am", "F", "C", "G7"]);
  });

  it("guesses the first chord tonic and mode", () => {
    expect(guessKey(["Am", "F", "C", "G"])).toEqual({
      key: "A minor",
      scale: "minor",
    });
    expect(guessKey(["C", "F", "G"])).toEqual({
      key: "C major",
      scale: "major",
    });
  });

  it("transposes chord roots while preserving suffixes", () => {
    expect(transposeProgression(["Am", "F", "C", "G7"], 2)).toEqual(["Bm", "G", "D", "A7"]);
  });

  it("reharmonizes diatonic chords without changing chromatic chords", () => {
    expect(reharmonize(["C", "F", "G", "Db"], "C major", "jazz")).toEqual([
      "Cmaj7",
      "Fmaj7",
      "G7",
      "Db",
    ]);
  });
});

describe("beat helpers", () => {
  it("creates an empty 16-step grid for every drum voice", () => {
    const beat = emptyBeat();
    expect(beat.enabled).toBe(false);
    expect(beat.steps).toBe(16);
    expect(Object.values(beat.rows).every((row) => row.length === 16)).toBe(true);
    expect(Object.values(beat.rows).every((row) => row.every((on) => !on))).toBe(true);
  });

  it("distributes Euclidean pulses evenly", () => {
    expect(pattern(euclid(3, 8))).toBe("x..x..x.");
    expect(pattern(euclid(3, 8, 1))).toBe("..x..x.x");
  });

  it("writes a tiled Euclidean pattern into one voice", () => {
    const beat = euclidBeat(emptyBeat(), "kick", 3, 8);
    expect(beat.enabled).toBe(true);
    expect(pattern(beat.rows.kick)).toBe("x..x..x.x..x..x.");
  });

  it("renders accented beat steps louder than normal steps", () => {
    const beat = emptyBeat();
    beat.enabled = true;
    beat.rows.kick[0] = true;
    beat.rows.kick[4] = true;
    beat.accents!.kick[4] = true;

    const hits = beatToHits(beat, 1).filter((hit) => hit.voice === "kick");
    expect(hits).toHaveLength(2);
    expect(hits[1].velocity).toBeGreaterThan(hits[0].velocity);
  });

  it("generates deterministic drum style hits and beat grids", () => {
    const hits = generateDrums("fourOnFloor", 1, 0);
    expect(hits.filter((hit) => hit.voice === "kick").map((hit) => hit.startBeat)).toEqual([
      0, 1, 2, 3,
    ]);

    const beat = styleToBeat("rock");
    expect(beat.enabled).toBe(true);
    expect(beat.rows.kick[0]).toBe(true);
    expect(beat.rows.snare[4]).toBe(true);
    expect(beat.rows.snare[12]).toBe(true);
  });
});

describe("song search", () => {
  const meta: SearchDocInput = {
    title: "Night Drive",
    description: "Dreamy minor synthwave sketch with a big chorus",
    tags: ["synthwave", "modular"],
    chatSummary: "User wanted something dark and cinematic.",
  };

  it("builds a deterministic search document from song state and metadata", () => {
    const doc = buildSongSearchDoc(meta, {
      ...defaultSongState,
      chords: ["Am", "F", "C", "G"],
      key: "A minor",
      tempo: 92,
      bass: { ...defaultSongState.bass, enabled: true, style: "octaves" },
      drums: { ...defaultSongState.drums, enabled: true, style: "lofi" },
    });

    expect(doc.summary).toContain("Dreamy minor");
    expect(doc.text).toContain("Night Drive");
    expect(doc.text).toContain("Am F C G");
    expect(doc.text).toContain("lofi drums");
    expect(doc.fields.tags).toEqual(["synthwave", "modular"]);
  });

  it("builds generated metadata from musical state", () => {
    const song = {
      ...defaultSongState,
      chords: ["Am", "F", "C", "G"],
      key: "A minor",
      tempo: 92,
      bass: { ...defaultSongState.bass, enabled: true, style: "octaves" },
      drums: { ...defaultSongState.drums, enabled: true, style: "lofi" },
    };
    const doc = buildSongSearchDoc(meta, song);
    const details = buildAutoSongDetails(song, doc);

    expect(details.title).toContain("A minor");
    expect(details.description).toContain("Chords: Am F C G");
    expect(details.tags).toContain("92bpm");
    expect(details.tags).toContain("lofi");
  });

  it("applies generated metadata only to fields the user has not edited", () => {
    const original = songMeta({
      id: "song",
      title: "Hand Named",
      description: "Auto old",
      tags: ["old"],
      userEdited: {
        title: true,
        description: false,
        tags: true,
      },
    });

    const next = mergeAutoSongDetails(original, {
      title: "Generated title",
      description: "Generated description",
      tags: ["generated"],
    });

    expect(next.title).toBe("Hand Named");
    expect(next.description).toBe("Generated description");
    expect(next.tags).toEqual(["old"]);
    expect(next.userEdited).toEqual(original.userEdited);
  });

  it("ranks title and tag matches above description and musical text", async () => {
    const songs: SongMeta[] = [
      songMeta({
        id: "description",
        title: "Sketch 1",
        description: "Contains the word aurora in its notes",
        key: "C major",
        tempo: 100,
        createdAt: 1,
        updatedAt: 1,
      }),
      songMeta({
        id: "tag",
        title: "Sketch 2",
        tags: ["aurora"],
        key: "C major",
        tempo: 100,
        createdAt: 2,
        updatedAt: 2,
      }),
      songMeta({
        id: "title",
        title: "Aurora Theme",
        key: "C major",
        tempo: 100,
        createdAt: 3,
        updatedAt: 3,
      }),
      songMeta({
        id: "music",
        title: "Sketch 3",
        searchText: "aurora pad",
        key: "C major",
        tempo: 100,
        createdAt: 4,
        updatedAt: 4,
      }),
    ];

    expect((await searchSongsWithOrama(songs, "aurora")).map((result) => result.song.id)).toEqual([
      "title",
      "tag",
      "description",
      "music",
    ]);
  });

  it("matches useful musical terms like chords, key, tempo, and style", async () => {
    const songs: SongMeta[] = [
      songMeta({
        id: "match",
        title: "Loop",
        searchSummary: "A minor 92 BPM Chords Am F C G lofi drums",
        searchText: "A minor 92 bpm Am F C G lofi drums",
        key: "A minor",
        tempo: 92,
        createdAt: 1,
        updatedAt: 1,
      }),
    ];

    const [result] = await searchSongsWithOrama(songs, "Am lofi 92");
    expect(result.song.id).toBe("match");
    expect(result.matchedFields.length).toBeGreaterThan(0);
  });

  it("can search a serialized and reloaded Orama index", async () => {
    const songs: SongMeta[] = [
      songMeta({
        id: "night-drive",
        title: "Night Drive",
        description: "Dark cinematic synthwave",
        tags: ["synthwave"],
        searchSummary: "A minor 92 BPM",
        searchText: "Am F C G lofi drums",
        chatSummary: "User wanted neon tension.",
        key: "A minor",
        tempo: 92,
        createdAt: 1,
        updatedAt: 1,
      }),
    ];
    const db = await buildSongSearchIndex(songs);
    const restored = await loadSongSearchIndex(serializeSongSearchIndex(db));

    const [result] = await searchSongSearchIndex(restored, songs, "neon synthwave");
    expect(result.song.id).toBe("night-drive");
  });

  it("changes the persisted index hash when searchable metadata changes", () => {
    const base: SongMeta = songMeta({
      id: "song",
      title: "Sketch",
      key: "C major",
      tempo: 100,
      createdAt: 1,
      updatedAt: 1,
    });

    expect(songSearchHash([base])).not.toBe(
      songSearchHash([{ ...base, description: "new searchable notes" }]),
    );
  });
});
