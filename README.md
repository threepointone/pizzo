# Pizzo

**An AI-assisted, web-based music studio.** Pizzo isn't an audio _generator_ —
it's a MIDI/arrangement workstation where the AI is your **music-theory brain,
arranger, and bandmate**. You express intent in plain language ("make it
dreamier", "give me a walking bassline", "brighter filter, slow wobble") and the
app does the correct music theory for you with real, deterministic libraries.
You can also do everything by hand.

It runs as a [Think](https://www.npmjs.com/package/@cloudflare/think) agent on
Cloudflare Workers, with a React 19 front end.

---

## Highlights

- **Chat-driven or hands-on.** Every action is available both as a chat command
  (the agent calls tools) and as a direct UI control. They edit the same shared,
  persisted song state.
- **Deterministic theory.** The LLM only translates intent into structured tool
  calls; chords, keys, voice-leading and transposition are computed by
  [`@tonaljs/tonal`](https://github.com/tonaljs/tonal), so it's fast, cheap, and
  never musically "wrong."
- **Local-first I/O.** Web MIDI and microphone input stay in the browser.
- **Three surfaces** sharing one song:
  - **Chord Lab** — a chord progression + a "band" (bass + drums) and a sound.
  - **Beats** — a 16-step drum-machine grid.
  - **Modular** — a freeform, patchable synth voice (ZOIA / Max-style).

## The three surfaces

### Chord Lab

Build a progression with chord pads (root × quality) or by typing `Am F C G`.
Pizzo guesses the key, shows roman-numeral analysis, and plays it back with a
General-MIDI instrument (sampled via [`smplr`](https://github.com/danigb/smplr),
served locally from `public/soundfonts/`) **or** through your Modular patch.

Then **build a band**:

- **Bass** that follows the chord roots: roots / octaves / root+5th / offbeat /
  walking (with chromatic lead-ins).
- **Drums** in five styles (four-on-floor, rock, funk, lo-fi, half-time) with a
  `busy` control for ghost-note energy.

Both are deterministic generators rendered live by the synth engine, with track
lanes that visualize the result.

### Beats

A 5-voice × 16-step grid (kick / snare / clap / hi-hat / open hat) with a live
playhead. A custom beat **overrides** the Chord Lab's style groove and drives the
drums on every surface. "Fill from <style>" seeds the grid from a style preset so
you can start from a groove and tweak it.

### Modular

A node-graph synth built on [Elementary Audio](https://www.elementary.audio/)
(`@elemaudio/core`) and rendered with [React Flow](https://reactflow.dev/). Drag
from a port to wire modules into a voice; audio cables are solid, CV cables are
dashed with an adjustable strength (attenuverter).

- **Modules:** keyboard, oscillator, noise (white/pink), filter, drive,
  VCA, ADSR, LFO, delay, reverb, mixer, output.
- **Polyphonic** (8-voice) with per-voice FX, parameter smoothing (no zipper
  noise), and voice-stealing.
- **Play it** with the on-screen piano, your computer keyboard (A–K white keys,
  W/E/T/Y/U sharps), a **Web MIDI** device, or **Audio in** — your mic/instrument
  pitch is detected (autocorrelation) and drives the synth monophonically.
- **Presets** (Init / Acid bass / Dream pad / Noise perc / Dub echo), plus
  Save (localStorage) and Copy/Paste patch JSON for sharing.

## Quick start

```sh
npm install
npm run dev
```

Open the printed URL. Click **Play**, type a vibe into the chat ("sad lo-fi in A
minor with a chill beat"), or start clicking pads and grid cells.

> Audio starts on first interaction (browser autoplay policy). Web MIDI and mic
> input require granting browser permission.

## Talking to the assistant

The agent mutates the shared song through tools — it never claims a change
without making it. Examples:

- "Give me a dreamy progression in D and play it" → `setProgression` + `play`
- "Add a funky beat and a walking bass" → `addDrums` + `addBassline`
- "Program a four-on-the-floor kick with claps on 2 and 4" → `programBeat`
- "Make the synth brighter with a slow filter wobble" → `setSynthParam` (filter
  cutoff up, add/raise an LFO into cutoff)
- "Transpose up a step" → `transposeSong`

Tools include: `setProgression`, `setTempo`, `transposeSong`, `analyzeSong`,
`setInstrument`, `play`/`stop`, `addDrums`/`removeDrums`,
`addBassline`/`removeBassline`, `programBeat`/`clearBeat`, and the modular set
(`setSynthParam`, `addSynthModule`, `connectSynth`, `removeSynthModule`,
`resetSynth`).

## Architecture

```
agents/studio/agent.ts      Studio Durable Object: owns the song list and
                            spawns/tears down Song facets.
agents/studio/agents/song/
  agent.ts                  Per-song Think sub-agent: model, system prompt,
                            tools, chat history, and persisted `SongState`.

src/
  client.tsx                Root React app: layout, Studio connection, song
                            selection, and global app chrome.
  components/SongView.tsx   Per-song facet connection, surface tabs, and the
                            central engine render/transport effects.
  music/song.ts             SongState/SongDoc data model + deterministic music:
                            chord voicing, bass & drum generators, beat grid.
  music/search.ts           Search document metadata; Studio queries it through
                            server-side Orama for sidebar/global search.
  audio/
    engine.ts               Tone.js transport + sampled instruments + synth
                            drum kit + bass voice; schedules chord/bass/drum parts.
    pitch.ts                Mic → AnalyserNode → autocorrelation pitch tracker.
  modular/
    types.ts, registry.ts   Module/port/param definitions; default voice.
    compile.ts              Compiles a patch graph → Elementary `el` expression.
    engine.ts               Elementary WebRenderer wrapper (polyphony, notes).
    edit.ts, presets.ts     Patch edit helpers (used by tools) + factory presets.
  components/
    Workspace.tsx           Chord Lab surface.
    BeatMachine.tsx         Step-sequencer surface.
    ModularSurface.tsx      Modular node-canvas surface.
    ChatPanel.tsx           Docked chat.

design/index.md             Living design notes / decision log.
```

**One source of truth per song.** The Studio Durable Object only broadcasts
sidebar metadata. Each Song facet owns its `SongState` (chords, tempo, key,
instrument, bass, drums, beat, arrangement, mix, and the modular `patch`) and
persists it with that song's chat history. The browser reacts to facet state
changes by re-rendering the UI and driving the audio engines, including the
`playing` flag, so "play it" works straight from chat.

Two audio engines run side by side: **Tone.js** (transport, samples, drum/bass
synths) and **Elementary Audio** (the modular voice, on its own clock). When the
Chord Lab instrument is set to "Modular Synth", chord events are bridged to the
Elementary engine.

## Tech stack

- **Runtime:** Cloudflare Workers + Think + Durable Objects
- **Model:** Workers AI `@cf/moonshotai/kimi-k2.7-code` (swap in `getModel()`)
- **UI:** React 19, `@cloudflare/kumo`, Tailwind v4, Vite
- **Audio:** Tone.js, `smplr` soundfonts, Elementary Audio, React Flow
- **Theory:** `@tonaljs/tonal`
- **Search:** Server-side Orama index rebuilt from Studio metadata on demand
- **Tools/validation:** `ai` SDK + `zod`

## Develop

```sh
npm run dev       # vite dev server
npm run build     # production build
npm run deploy    # build + wrangler deploy
npm run types     # regenerate Think types after changing agents/bindings
```

After changing agents or bindings, run `npm run types` — don't hand-edit
`think.d.ts` / `env.d.ts`. Add a new song facet under
`agents/studio/agents/<name>/agent.ts` so Think registers it as a Studio
sub-agent.

## Roadmap status

All of the initial roadmap (A–F) is shipped: polyphonic modular engine, Web MIDI,
Chord Lab ↔ Modular bridge, the synth band, a deepened modular voice with FX and
presets, the beat-machine surface, and audio-in pitch tracking. See
`design/index.md` for the full decision log and "as-built" notes.

## Future

- **Future:** Undo for chord and patch edits.
- **Future:** Keyboard shortcut help overlay (`?`).
- **Future:** MIDI/WAV export from the Beat Machine surface.
