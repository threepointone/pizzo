import { describe, expect, it } from "vitest";
import { emptyBeat, euclid, euclidBeat, generateDrums, styleToBeat } from "./song";
import { guessKey, parseProgression, reharmonize, transposeProgression } from "./theory";

const pattern = (steps: boolean[]) => steps.map((on) => (on ? "x" : ".")).join("");

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
