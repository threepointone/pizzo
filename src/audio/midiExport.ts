import { Midi } from "@tonejs/midi";
import { songDocFromState, type DrumVoice, type SongState } from "../music/song";

/** General-MIDI percussion key numbers (channel 10) for our drum voices. */
const GM_DRUM: Record<DrumVoice, number> = {
  kick: 36, // Bass Drum 1
  snare: 38, // Acoustic Snare
  hat: 42, // Closed Hi-hat
  openhat: 46, // Open Hi-hat
  clap: 39, // Hand Clap
};

/**
 * Render the current song to a Standard MIDI File. Reuses `songDocFromState`,
 * so arrangements, bass/drums/melody, and beat patterns all export exactly as
 * they play. Times are in seconds (derived from tempo); drums go to channel 10.
 */
export function songToMidiBytes(state: SongState): Uint8Array<ArrayBuffer> {
  const doc = songDocFromState(state);
  const midi = new Midi();
  midi.header.setTempo(doc.tempo);
  const secPerBeat = 60 / doc.tempo;

  for (const track of doc.tracks) {
    const t = midi.addTrack();
    t.name = track.name;
    for (const clip of track.clips) {
      for (const n of clip.notes) {
        t.addNote({
          midi: n.midi,
          time: n.startBeat * secPerBeat,
          duration: Math.max(0.05, n.durationBeats * secPerBeat),
          velocity: Math.max(0, Math.min(1, n.velocity)),
        });
      }
    }
  }

  if (doc.drumHits.length > 0) {
    const drums = midi.addTrack();
    drums.name = "Drums";
    drums.channel = 9; // 0-indexed → MIDI channel 10 (percussion)
    for (const hit of doc.drumHits) {
      drums.addNote({
        midi: GM_DRUM[hit.voice] ?? 38,
        time: hit.startBeat * secPerBeat,
        duration: 0.12,
        velocity: Math.max(0, Math.min(1, hit.velocity)),
      });
    }
  }

  const raw = midi.toArray();
  const bytes = new Uint8Array(raw.length);
  bytes.set(raw);
  return bytes;
}

/** Trigger a browser download of the song as a `.mid` file. */
export function downloadSongMidi(state: SongState, filename = "pizzo.mid"): void {
  const blob = new Blob([songToMidiBytes(state)], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".mid") ? filename : `${filename}.mid`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
