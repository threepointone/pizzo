import { useEffect, useState } from "react";

export type MidiNoteEvent = { type: "on" | "off"; note: number; velocity: number };
export type MidiStatus = "idle" | "unsupported" | "requesting" | "ready" | "denied";
type NoteHandler = (e: MidiNoteEvent) => void;

/**
 * Thin Web MIDI singleton. Components subscribe to note events; the UI can
 * subscribe to status/device changes. One shared access object so multiple
 * surfaces can listen to the same hardware.
 */
class WebMidi {
  status: MidiStatus =
    typeof navigator !== "undefined" && "requestMIDIAccess" in navigator ? "idle" : "unsupported";
  inputs: { id: string; name: string }[] = [];

  private access: MIDIAccess | null = null;
  private noteHandlers = new Set<NoteHandler>();
  private stateListeners = new Set<() => void>();

  async enable(): Promise<void> {
    if (this.status === "unsupported" || this.status === "ready") return;
    this.setStatus("requesting");
    try {
      this.access = await navigator.requestMIDIAccess();
      this.access.onstatechange = () => this.refreshInputs();
      this.refreshInputs();
      this.setStatus("ready");
    } catch {
      this.setStatus("denied");
    }
  }

  private refreshInputs(): void {
    if (!this.access) return;
    const inputs: { id: string; name: string }[] = [];
    this.access.inputs.forEach((input) => {
      input.onmidimessage = (e) => this.onMessage(e as MIDIMessageEvent);
      inputs.push({ id: input.id, name: input.name ?? "MIDI device" });
    });
    this.inputs = inputs;
    this.stateListeners.forEach((l) => l());
  }

  private onMessage(e: MIDIMessageEvent): void {
    if (!e.data || e.data.length < 3) return;
    const [status, note, velocity] = e.data;
    const command = status & 0xf0;
    if (command === 0x90 && velocity > 0) {
      this.emit({ type: "on", note, velocity: velocity / 127 });
    } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
      this.emit({ type: "off", note, velocity: 0 });
    }
  }

  private emit(ev: MidiNoteEvent): void {
    this.noteHandlers.forEach((h) => h(ev));
  }

  private setStatus(s: MidiStatus): void {
    this.status = s;
    this.stateListeners.forEach((l) => l());
  }

  subscribeNotes(handler: NoteHandler): () => void {
    this.noteHandlers.add(handler);
    return () => this.noteHandlers.delete(handler);
  }

  subscribeState(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }
}

export const webMidi = new WebMidi();

/** React hook exposing live MIDI status + devices, and an `enable()` action. */
export function useWebMidi() {
  const [, force] = useState(0);
  useEffect(() => webMidi.subscribeState(() => force((n) => n + 1)), []);
  return {
    status: webMidi.status,
    inputs: webMidi.inputs,
    enable: () => webMidi.enable(),
  };
}
