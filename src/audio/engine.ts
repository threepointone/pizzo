import * as Tone from "tone";
import { Soundfont } from "smplr";
import {
  BEATS_PER_BAR,
  MODULAR_VOICE_ID,
  type DrumHit,
  type DrumVoice,
  type Mix,
  type SongDoc,
} from "../music/song";
import { modularEngine } from "../modular/engine";

/** Mixer role → its own gain node between the sources and the master bus. */
type MixRole = "chords" | "bass" | "drums" | "melody";

type SmplrInstrument = ReturnType<typeof Soundfont>;

type ScheduledEvent = {
  time: string;
  midi: number;
  durationBeats: number;
  velocity: number;
};

type ScheduledHit = { time: string; voice: DrumVoice; velocity: number };

/** Synth drum kit + bass voice, built lazily from Tone primitives. */
type Kit = {
  kick: Tone.MembraneSynth;
  snare: Tone.NoiseSynth;
  hat: Tone.NoiseSynth;
  openhat: Tone.NoiseSynth;
  clap: Tone.NoiseSynth;
  bass: Tone.MonoSynth;
};

/** beat index (quarter notes) → Tone "bars:beats:sixteenths" */
function beatsToBarsBeats(beat: number): string {
  const bar = Math.floor(beat / BEATS_PER_BAR);
  const beatInBar = beat - bar * BEATS_PER_BAR;
  return `${bar}:${beatInBar}:0`;
}

/**
 * Local MusyngKite soundfonts live in `public/soundfonts/MusyngKite/`, served
 * at this path. mp3 is used for universal browser support.
 */
const KIT_BASE = "/soundfonts/MusyngKite";
const soundfontUrl = (name: string) => `${KIT_BASE}/${name}-mp3.js`;

/**
 * Tone.js drives timing (transport, tempo, loop); sound comes from `smplr`
 * General-MIDI soundfonts loaded from our own `public/` folder into Tone's
 * AudioContext, so the two share one clock.
 */
class AudioEngine {
  private part: Tone.Part<ScheduledEvent> | null = null;
  private bassPart: Tone.Part<ScheduledEvent> | null = null;
  private melodyPart: Tone.Part<ScheduledEvent> | null = null;
  private melody: SmplrInstrument | null = null;
  private drumPart: Tone.Part<ScheduledHit> | null = null;
  /** Scheduled auto-stop event id (play-once mode). */
  private endEventId: number | null = null;
  /** Called when a non-looping song reaches its end (so the UI can un-set playing). */
  onSongEnd: (() => void) | null = null;
  /** Single master bus everything routes through, so we can tap it for capture. */
  private master: GainNode | null = null;
  /** Per-role gain nodes (chords/bass/drums/melody) → master, driven by the mixer. */
  private gains: Record<MixRole, GainNode> | null = null;
  /** Loop length (bars) of the last rendered doc — used to size an audio capture. */
  private loopBarsValue = 4;
  /** Humanize amount (0..1) applied live to note/drum timing + velocity. */
  private humanizeAmt = 0;
  private kit: Kit | null = null;
  private instruments = new Map<string, SmplrInstrument>();
  private loading = new Map<string, Promise<SmplrInstrument | null>>();
  private currentName = "acoustic_grand_piano";
  private current: SmplrInstrument | null = null;

  private get transport() {
    return Tone.getTransport();
  }

  private get rawContext(): AudioContext {
    return Tone.getContext().rawContext as unknown as AudioContext;
  }

  /** Master bus → speakers. Tapping this captures the whole band + samples. */
  private ensureMaster(): GainNode {
    if (!this.master) {
      this.master = this.rawContext.createGain();
      this.master.connect(this.rawContext.destination);
    }
    return this.master;
  }

  /** Per-role gain nodes (volume/mute/solo), each summing into the master bus. */
  private ensureGains(): Record<MixRole, GainNode> {
    if (!this.gains) {
      const master = this.ensureMaster();
      const make = () => {
        const g = this.rawContext.createGain();
        g.connect(master);
        return g;
      };
      this.gains = { chords: make(), bass: make(), drums: make(), melody: make() };
    }
    return this.gains;
  }

  /**
   * Apply the mixer live (no re-render): volume per role, mute → 0, and solo
   * (any soloed role mutes the rest). Smoothed to avoid zipper noise.
   */
  applyMix(mix: Mix): void {
    const g = this.ensureGains();
    const roles: MixRole[] = ["chords", "bass", "drums", "melody"];
    const anySolo = roles.some((r) => mix[r].solo);
    const t = this.rawContext.currentTime;
    for (const role of roles) {
      const ch = mix[role];
      const level = ch.mute || (anySolo && !ch.solo) ? 0 : ch.volume;
      g[role].gain.setTargetAtTime(level, t, 0.02);
    }
    this.ensureMaster().gain.setTargetAtTime(mix.master, t, 0.02);
  }

  /** Apply swing (via the transport) + stash humanize for the note callbacks. */
  setGroove(swing: number, humanize: number): void {
    this.transport.swing = Math.max(0, Math.min(1, swing));
    this.transport.swingSubdivision = "8n";
    this.humanizeAmt = Math.max(0, Math.min(1, humanize));
  }

  /** Nudge a start time later by up to ~18ms at full humanize (forward-only so
   * monophonic voices keep strictly increasing times). */
  private hTime(time: number): number {
    if (this.humanizeAmt <= 0) return time;
    return time + Math.random() * this.humanizeAmt * 0.018;
  }

  /** Soften velocity by up to ~35% at full humanize so accents breathe. */
  private hVel(v: number): number {
    if (this.humanizeAmt <= 0) return v;
    return Math.max(0.05, Math.min(1, v * (1 - Math.random() * this.humanizeAmt * 0.35)));
  }

  async ensureStarted(): Promise<void> {
    await Tone.start();
    // Warm up the current soundfont so the first play is instant (the modular
    // voice has no soundfont — it's synthesized).
    if (this.currentName !== MODULAR_VOICE_ID) void this.loadInstrument(this.currentName, "chords");
  }

  /**
   * Load a soundfont and route it to its mixer channel. Cached per (role, name)
   * so chords + melody get distinct instances even when they share a sound,
   * keeping their mixer faders independent.
   */
  private loadInstrument(name: string, role: "chords" | "melody"): Promise<SmplrInstrument | null> {
    const cacheKey = `${role}:${name}`;
    const cached = this.instruments.get(cacheKey);
    if (cached) return Promise.resolve(cached);
    const inflight = this.loading.get(cacheKey);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const inst = Soundfont(this.rawContext, {
          instrumentUrl: soundfontUrl(name),
          volume: 100,
          destination: this.ensureGains()[role],
        });
        await inst.ready;
        this.instruments.set(cacheKey, inst);
        return inst;
      } catch (err) {
        console.error(`smplr failed to load "${name}" (will retry next time)`, err);
        this.loading.delete(cacheKey); // allow a fresh retry after a transient failure
        return null;
      }
    })();
    this.loading.set(cacheKey, promise);
    return promise;
  }

  /** Build the synth drum kit + bass voice once, lazily. */
  private ensureKit(): Kit {
    if (this.kit) return this.kit;
    const gains = this.ensureGains();
    const drumBus = gains.drums;
    const kick = new Tone.MembraneSynth({
      octaves: 6,
      pitchDecay: 0.05,
      envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.2 },
    }).connect(drumBus);

    const noise = (decay: number) =>
      new Tone.NoiseSynth({
        noise: { type: "white" },
        envelope: { attack: 0.001, decay, sustain: 0 },
      });

    const snare = noise(0.2);
    snare.connect(new Tone.Filter(1800, "bandpass").connect(drumBus));
    const clap = noise(0.12);
    clap.connect(new Tone.Filter(1200, "bandpass").connect(drumBus));

    const hatHp = new Tone.Filter(7000, "highpass").connect(drumBus);
    const hat = noise(0.04);
    hat.connect(hatHp);
    const openhat = noise(0.3);
    openhat.connect(hatHp);

    const bass = new Tone.MonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", Q: 1 },
      filterEnvelope: {
        attack: 0.01,
        decay: 0.2,
        sustain: 0.4,
        release: 0.3,
        baseFrequency: 120,
        octaves: 2.6,
      },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.3 },
    }).connect(gains.bass);
    bass.volume.value = -4;

    this.kit = { kick, snare, hat, openhat, clap, bass };
    return this.kit;
  }

  /** Last scheduled time per drum voice — the kit's synths are monophonic and
   * Tone requires strictly increasing start times, so we nudge coincident hits. */
  private lastHit: Partial<Record<DrumVoice, number>> = {};

  private triggerDrum(voice: DrumVoice, rawTime: number, velocity: number): void {
    const kit = this.ensureKit();
    const last = this.lastHit[voice] ?? 0;
    const time = rawTime <= last ? last + 0.001 : rawTime;
    this.lastHit[voice] = time;
    switch (voice) {
      case "kick":
        kit.kick.triggerAttackRelease("C1", "8n", time, velocity);
        break;
      case "snare":
        kit.snare.triggerAttackRelease("16n", time, velocity);
        break;
      case "hat":
        kit.hat.triggerAttackRelease("32n", time, velocity);
        break;
      case "openhat":
        kit.openhat.triggerAttackRelease("8n", time, velocity);
        break;
      case "clap":
        kit.clap.triggerAttackRelease("16n", time, velocity);
        break;
    }
  }

  setTempo(bpm: number): void {
    this.transport.bpm.value = bpm;
  }

  /** Start all scheduled parts (only call while transport is running). */
  private startParts(): void {
    this.part?.start(0);
    this.bassPart?.start(0);
    this.melodyPart?.start(0);
    this.drumPart?.start(0);
  }

  /** Stop all scheduled parts without disposing them. */
  private stopParts(): void {
    this.part?.stop(0);
    this.bassPart?.stop(0);
    this.melodyPart?.stop(0);
    this.drumPart?.stop(0);
  }

  async renderDoc(doc: SongDoc): Promise<void> {
    await this.ensureStarted();
    this.setTempo(doc.tempo);

    this.currentName = doc.instrument || this.currentName;
    // The modular voice routes through Elementary instead of a soundfont.
    const useModular = this.currentName === MODULAR_VOICE_ID;
    this.current = useModular ? null : await this.loadInstrument(this.currentName, "chords");
    if (useModular) void modularEngine.ensureStarted();

    this.loopBarsValue = doc.loopBars;
    const transport = this.transport;
    transport.loop = doc.loop !== false;
    transport.loopStart = 0;
    transport.loopEnd = `${doc.loopBars}m`;

    // Play-once: stop the transport (and reset) when the song reaches its end.
    if (this.endEventId != null) {
      transport.clear(this.endEventId);
      this.endEventId = null;
    }
    if (doc.loop === false) {
      this.endEventId = transport.scheduleOnce((t) => {
        Tone.getDraw().schedule(() => {
          this.stop();
          this.onSongEnd?.();
        }, t);
      }, `${doc.loopBars}m`);
    }

    const wasPlaying = this.isPlaying;
    this.stopParts();
    this.part?.dispose();
    this.bassPart?.dispose();
    this.melodyPart?.dispose();
    this.drumPart?.dispose();
    // Drum voices are monophonic; reset their last-scheduled times so a new
    // doc's hits aren't nudged against the previous song's timeline.
    this.lastHit = {};

    const toEvents = (role: string): ScheduledEvent[] => {
      const events: ScheduledEvent[] = [];
      for (const track of doc.tracks) {
        if (track.role !== role) continue;
        for (const clip of track.clips) {
          for (const n of clip.notes) {
            events.push({
              time: beatsToBarsBeats(n.startBeat),
              midi: n.midi,
              durationBeats: n.durationBeats,
              velocity: n.velocity,
            });
          }
        }
      }
      return events;
    };

    const draw = Tone.getDraw();
    this.part = new Tone.Part<ScheduledEvent>((time, ev) => {
      const dur = ev.durationBeats * (60 / transport.bpm.value);
      const at = this.hTime(time);
      if (useModular) {
        // Elementary runs on its own clock; defer the trigger to ~audio time.
        draw.schedule(() => modularEngine.noteOn(ev.midi), at);
        draw.schedule(() => modularEngine.noteOff(ev.midi), at + dur);
        return;
      }
      if (!this.current) return;
      this.current.start({
        note: ev.midi,
        time: at,
        duration: dur,
        velocity: Math.round(this.hVel(ev.velocity) * 127),
      });
    }, toEvents("chords"));
    // Parts are NOT started here — starting them while the transport is stopped
    // still fires beat-0 chord callbacks (the phantom chord on song switch).

    const bassEvents = toEvents("bass");
    if (bassEvents.length > 0) {
      this.bassPart = new Tone.Part<ScheduledEvent>((time, ev) => {
        const kit = this.ensureKit();
        const dur = ev.durationBeats * (60 / transport.bpm.value);
        kit.bass.triggerAttackRelease(
          Tone.Frequency(ev.midi, "midi").toNote(),
          dur,
          this.hTime(time),
          this.hVel(ev.velocity),
        );
      }, bassEvents);
    }

    const melodyTrack = doc.tracks.find((t) => t.role === "melody");
    const melodyEvents = toEvents("melody");
    if (melodyTrack && melodyEvents.length > 0) {
      const melodyName = melodyTrack.instrument;
      const melodyModular = melodyName === MODULAR_VOICE_ID;
      this.melody = melodyModular ? null : await this.loadInstrument(melodyName, "melody");
      if (melodyModular) void modularEngine.ensureStarted();
      this.melodyPart = new Tone.Part<ScheduledEvent>((time, ev) => {
        const dur = ev.durationBeats * (60 / transport.bpm.value);
        const at = this.hTime(time);
        if (melodyModular) {
          draw.schedule(() => modularEngine.noteOn(ev.midi), at);
          draw.schedule(() => modularEngine.noteOff(ev.midi), at + dur);
          return;
        }
        this.melody?.start({
          note: ev.midi,
          time: at,
          duration: dur,
          velocity: Math.round(this.hVel(ev.velocity) * 127),
        });
      }, melodyEvents);
    }

    if (doc.drumHits.length > 0) {
      const hits: ScheduledHit[] = doc.drumHits.map((h: DrumHit) => ({
        time: beatsToBarsBeats(h.startBeat),
        voice: h.voice,
        velocity: h.velocity,
      }));
      this.drumPart = new Tone.Part<ScheduledHit>((time, hit) => {
        this.triggerDrum(hit.voice, this.hTime(time), this.hVel(hit.velocity));
      }, hits);
    }

    // If we were mid-playback when the doc changed, re-attach parts to the
    // running transport (without resetting position).
    if (wasPlaying) this.startParts();
  }

  /** Current step index within the bar, for sequencer playheads. */
  currentStep(steps: number): number {
    const ticksPerStep = (this.transport.PPQ * BEATS_PER_BAR) / steps;
    return Math.floor(this.transport.ticks / ticksPerStep) % steps;
  }

  /** Fraction (0..1) through the whole song loop, for the timeline playhead. */
  songProgress(loopBars: number): number {
    if (loopBars <= 0) return 0;
    const loopTicks = this.transport.PPQ * BEATS_PER_BAR * loopBars;
    if (loopTicks <= 0) return 0;
    return (this.transport.ticks % loopTicks) / loopTicks;
  }

  get isPlaying(): boolean {
    return this.transport.state === "started";
  }

  async play(): Promise<void> {
    await this.ensureStarted();
    this.transport.position = 0;
    this.startParts();
    this.transport.start();
  }

  stop(): void {
    this.stopParts();
    this.transport.stop();
    this.transport.position = 0;
    modularEngine.allNotesOff();
  }

  /**
   * Render the song to audio by playing one pass in real time and capturing the
   * master bus via MediaRecorder, then decoding to an AudioBuffer. Captures the
   * Tone/sampled band; the separate-context modular voice is not included.
   */
  async captureBuffer(tailSeconds = 0.5): Promise<AudioBuffer> {
    await this.ensureStarted();
    const ctx = this.rawContext;
    const master = this.ensureMaster();
    const streamDest = ctx.createMediaStreamDestination();
    master.connect(streamDest);

    const recorder = new MediaRecorder(streamDest.stream);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const recorded = new Promise<Blob>((resolve) => {
      recorder.onstop = () =>
        resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    });

    const bpm = this.transport.bpm.value;
    const seconds = (this.loopBarsValue * BEATS_PER_BAR * 60) / bpm;

    // Play exactly one pass from the top (no loop, no interference).
    if (this.endEventId != null) {
      this.transport.clear(this.endEventId);
      this.endEventId = null;
    }
    this.transport.stop();
    this.transport.position = 0;
    const prevLoop = this.transport.loop;
    this.transport.loop = false;
    modularEngine.allNotesOff();

    recorder.start();
    this.startParts();
    this.transport.start();
    await new Promise((r) => setTimeout(r, (seconds + tailSeconds) * 1000));
    this.transport.stop();
    this.transport.position = 0;
    this.transport.loop = prevLoop;
    recorder.stop();

    const blob = await recorded;
    master.disconnect(streamDest);
    return ctx.decodeAudioData(await blob.arrayBuffer());
  }
}

export const engine = new AudioEngine();
