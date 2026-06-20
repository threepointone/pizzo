# Pizzo — Design Notes

> Living design doc. We append and revise as we go. Nothing here is final;
> it's a record of decisions, ideas, and open questions so any future session
> can pick up where we left off. **This is meant to be fun and exploratory —
> we change our minds freely.**

Last updated: 2026-06-20

---

## 1. The vision (one paragraph)

An **AI-assisted DAW** for the web. Not an audio _generator_ — instead a
MIDI/arrangement workstation where the **AI is the music-theory brain, the
arranger, and eventually a live bandmate**. The user is a capable musician
(MIDI keyboards, controllers, guitars, voice) but an _amateur at theory_. The
app fills that gap: you express intent in natural language (and later, by
playing), and the app does the "correct music theory" for you. Web first; a
VST/DAW bridge (GarageBand, Ableton, etc.) is a possible later chapter.

## 1a. Where we are today (snapshot)

> Fast orientation for a fresh session. Details live in §13–§19; deferred ideas
> are tracked in §20.

**Three surfaces, one shared `SongState`** (agent broadcast state, persisted in
the Durable Object; `normalizeSong()` in `client.tsx` backfills new fields onto
older saved state):

1. **Chord Lab** — the band. A 4+ chord progression (pads / text / chat) →
   `tonal` names chords + infers key. Generates a **bassline**, **drum groove**,
   and a **melody/lead line**, each deterministic and chat-controllable. Plays
   back looped on **Tone.js** with sampled GM instruments (`smplr`, self-hosted
   soundfonts) or the modular voice, with a **moving playhead** and a **Loop /
   play-once** toggle. A live **Theory** strip shows each chord's Roman numeral +
   harmonic function (Tonic/Subdominant/Dominant). An **Arrangement** panel chains
   labelled **sections** (verse/chorus…) — each with its own progression, repeat
   count, and per-section voice toggles — into a full song. One-click **Vibe**
   presets (lo-fi/bossa/synthwave/house/cinematic/ballad) set the whole band feel.
   A **Mixer** (per-track volume/mute/solo + master) and a **Feel** control
   (swing + humanize) shape balance and groove live. The song exports to a
   **MIDI file** or a rendered **WAV**.
2. **Beats** — a 5-voice × 16-step drum machine (`SongState.beat`) that overrides
   the style groove when on. Hand-edit cells, "Fill from style", or **Euclidean
   fill** (pulses/steps/rotate per voice). Drives drums on every surface.
3. **Modular** — a ZOIA-inspired patchable synth (React Flow canvas → Elementary
   Audio). Polyphonic (8 voices), FX (noise/drive/delay/reverb/mixer), presets +
   save/copy/paste JSON. Playable by on-screen piano, computer keyboard, **Web
   MIDI**, and **mic pitch-in**.

**Two audio engines, one transport feel:** Tone.js (Chord Lab/Beats: transport,
samples, synth band) and Elementary Audio (Modular). When the Chord Lab voice is
"Modular Synth", scheduled notes are bridged to the Elementary engine via
`Tone.getDraw().schedule`.

**The agent** (`agents/assistant/agent.ts`, model `@cf/moonshotai/kimi-k2.7-code`)
maps natural language → server tools that mutate `SongState`. Tools today:
progression/key/tempo/transpose/analyze, play/stop, instrument, drums + bass,
beat (`programBeat`/`clearBeat`/`euclidBeat`), melody (`addMelody`/`regenerate`/
`remove`), arrangement (`setArrangement`/`addSection`/`clearArrangement`),
teaching (`explainTheory`/`reharmonize`/`suggestNextChord`), `applyVibe`,
mix/feel (`setMix`/`setGroove`), and the modular patch (`setSynthParam`/
`addSynthModule`/`connectSynth`/`removeSynthModule`/`resetSynth`).

**Roadmap A–H shipped** (§19), plus **I (arrangement), J (MIDI export), K
(teaching/reharmonization), L (playhead + play-once), M (vibe presets), N (WAV
export), O (mixer + groove)**. Active backlog in §20.

## 2. Guiding principles

- **The LLM translates intent → structured commands. It does NOT do theory in
  its head.** Real, deterministic libraries (`tonal`) compute correct chords,
  scales, voice-leading. This keeps it fast, cheap, and never "wrong."
- **No audio generation.** Sound = synths + samples + MIDI. We analyze and
  arrange; we don't hallucinate audio.
- **Local-first I/O.** Web MIDI and mic stay in the browser. Nothing uploaded
  to make sound or to analyze playing.
- **Chat is a command surface, not the only surface.** A visual timeline /
  piano roll is editable by hand too. Both edit the same document.
- **One source of truth:** the Song Document, persisted per project.
- **Exploratory.** Small, playable increments. We keep what's fun.

## 3. The platform we're building on (Think starter)

`pizzo` is a [Think](https://www.npmjs.com/package/@cloudflare/think) agent on
Cloudflare Workers. Relevant capabilities:

- **Durable Object per project** with its own SQLite DB → natural home for the
  Song Document (persistent, resumable, cheap while idle).
- **Tools** via `getTools()`, with optional `needsApproval` for human sign-off.
- **Client tools** — the agent can call a tool that _executes in the browser_.
  This is the linchpin: LLM says "add a piano playing this progression," the
  browser engine does it.
- **Session memory** via `configureSession()` + `withContext()` → remembers
  taste, gear, preferred keys.
- **Scheduled/proactive turns** + **webhooks** (`src/server.ts`) for later.
- **MCP** connections for outside data/tools.

Stack notes from the template:

- Model today: Workers AI `@cf/moonshotai/kimi-k2.7-code` (swappable in
  `getModel()`). Prefer Workers AI over third-party APIs.
- UI: React 19 + `@cloudflare/kumo` components + Tailwind v4, Vite.
- After changing agents/bindings: `npm run types`. Don't hand-edit `think.d.ts`
  / `env.d.ts`.
- One agent class per `agents/<name>/agent.ts`.

## 4. Web platform / library palette

What the browser gives us (no audio generation needed):

| Need                                                                  | Tool                               |
| --------------------------------------------------------------------- | ---------------------------------- |
| Live input from keyboards/controllers                                 | **Web MIDI API** (native)          |
| Audio engine: transport, sequencing, synths, FX                       | **Tone.js**                        |
| Realistic sampled instruments (piano/drums/guitar)                    | **smplr** / soundfonts             |
| Deterministic theory (scales, chords, keys, transpose, voice-leading) | **tonal** (`@tonaljs/tonal`)       |
| Analyze played/sung audio: key, BPM, chords, onsets, pitch→MIDI       | **Essentia.js** (WASM), **pitchy** |
| Notation rendering                                                    | **VexFlow** / **abcjs**            |
| MIDI file import/export                                               | **@tonejs/midi**                   |

## 5. Interaction model

Three surfaces, one shared Song Document:

1. **Chat / natural-language command bar** — intent ("do stuff").
2. **Visual timeline + piano roll** — tracks, clips, sections; hand-editable.
3. **Live I/O** — MIDI in (later), mic/guitar in for capture+analysis (later),
   audio out.

Bidirectional: chat edits doc → timeline re-renders → Tone.js replays; hand
edits doc → agent sees new state next turn.

## 6. Idea backlog (the wide brainstorm)

Grouped; not prioritized. Pull from here as we grow.

**Theory brain (fills the knowledge gap)**

- Live readout of detected key / chord / scale while you play.
- "Give me a sad/dreamy/triumphant progression in this key" → real chords.
- Harmonize a melody; add a chord-following bassline; smooth voice-leading.
- "Make this sadder/brighter" → major↔minor swaps, tempo, tension notes.

**Capture & understand (your gear is the input)**

- Hum/sing/play a riff → transcribed to editable MIDI; reassign instrument.
- Play 4 chords → agent names them, infers key, offers groove + bass.
- Detect tempo from strumming → set project tempo.

**Arranger / bandmate**

- **Jam mode**: reactive live backing band that follows your chords and obeys
  chat ("half-time," "drop drums 8 bars," "build into a chorus").
- "Add a bridge that modulates up a step." "Four-on-the-floor at 124."
- "Second verse is boring" → counter-melody, drop-outs, fills.
- Humanize stiff MIDI (swing, groove, velocity variation).

**Vibe → structure**

- "Bon Iver meets a video game" → tempo, key, instrument palette, chord
  vocabulary, FX chosen for you.

**Practice & songwriting**

- Loop bars; ramp metronome; backing track to solo over a ii–V–I.
- Lyric/melody co-writing: rhyme, meter, syllable-fitting melodies.

**Mixing as decisions (not generation)**

- "Vocal's muddy" → suggest+apply EQ cut ~300 Hz; explains why. Reverb/delay
  sends for "more space."

**Data sources / MCP**

- Sample/loop MCP (e.g. Freesound) — sampling, not generating.
- Reference/theory MCP — chord DBs, song-structure templates, genre norms.
- Later: VST/DAW bridge to drive GarageBand/Ableton over MIDI, or run as a
  plugin.

## 7. North-Star demos (the "whoa" moments)

1. **"Play 4 chords, get a band."** ← chosen MVP target.
2. "Hum it into existence" — sing → editable MIDI → any instrument.
3. "Conversational jam" — live AI band that follows you and reacts to chat.
4. "Vibe-to-song" — words → tempo/key/instruments/progression.

## 8. Decisions so far

| Decision           | Choice                                                                                                                                                                                                                                                                 | Date       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| North-Star MVP     | **"Play 4 chords → get a band"** (Chord Lab)                                                                                                                                                                                                                           | 2026-06-20 |
| First input method | **Mouse/keyboard + chat** (click/type chords; Web MIDI later)                                                                                                                                                                                                          | 2026-06-20 |
| Sound source       | **Tone.js synths** now, **sampled instruments** as upgrade                                                                                                                                                                                                             | 2026-06-20 |
| Theory engine      | **`tonal`** (deterministic), LLM only maps intent                                                                                                                                                                                                                      | 2026-06-20 |
| Audio philosophy   | **No audio generation**                                                                                                                                                                                                                                                | 2026-06-20 |
| Layout             | **DAW workspace center stage; chat docked as a side panel**                                                                                                                                                                                                            | 2026-06-20 |
| Phase 1 visual     | **Simple: 4-slot chord strip + track lanes (colored blocks) + transport**                                                                                                                                                                                              | 2026-06-20 |
| Chord input        | **Clickable chord pads (root + quality) + text box accepting `Am F C G`**                                                                                                                                                                                              | 2026-06-20 |
| Phase 1 drums      | **Synth drums (Tone.js), bass + drums only for the "band"**                                                                                                                                                                                                            | 2026-06-20 |
| Project model      | **Single song per project = one Durable Object** (multi-song later)                                                                                                                                                                                                    | 2026-06-20 |
| Product name       | **Keep "Pizzo"** (reads like pizzicato)                                                                                                                                                                                                                                | 2026-06-20 |
| Shared state       | **Song lives in agent `state` (`SongState`), broadcast to all clients**                                                                                                                                                                                                | 2026-06-20 |
| Action model       | **All chat actions = server tools that mutate `state`; client mirrors state → engine (incl. `playing`).** No fragile client-tool round-trip.                                                                                                                           | 2026-06-20 |
| Model              | **`@cf/moonshotai/kimi-k2.7-code`** — does native tool calling. `llama-3.3-70b-instruct-fp8-fast` emitted tool calls as TEXT via workers-ai-provider (rejected).                                                                                                       | 2026-06-20 |
| Sound              | **`smplr` GM soundfonts (MusyngKite) played through Tone's AudioContext**; served **locally** from `public/soundfonts/` (mp3), no runtime CDN/synth fallback. 8-instrument picker + `setInstrument` tool.                                                              | 2026-06-20 |
| App shape          | **Multi-surface playground** — not one UI. Pizzo hosts several _styles_ of sound creation; chat is the shared thread. First two surfaces: **Chord Lab** + **Modular** (ZOIA-inspired).                                                                                 | 2026-06-20 |
| Synthesis          | **Build-your-own-sound synth** via a **freeform node canvas** (modules + cables, Max/PD/Reaktor style — _not_ a fixed grid), inspired by the Empress ZOIA.                                                                                                             | 2026-06-20 |
| Synth engine       | **Elementary Audio** (`@elemaudio/core` + `@elemaudio/web-renderer`, MIT) — declarative graph → `core.render()`. Maps 1:1 to the node canvas; its own AudioContext, separate from the Chord Lab's Tone.js engine.                                                      | 2026-06-20 |
| Node canvas lib    | **React Flow** (`@xyflow/react` v12) — custom module nodes, port handles, cables with strength labels.                                                                                                                                                                 | 2026-06-20 |
| Generated parts    | **Bass/drums/melody are _derived_ from `SongState`, not stored as notes** — regenerated deterministically at render. Melody uses a **seed** (mulberry32); "regenerate" = bump the seed. Keeps them following chord/key changes automatically + round-tripping cleanly. | 2026-06-20 |
| Melody writing     | **Strong beats → chord tones, weak beats → scale steps** for singability; styles arp/flowing/pop/ballad. Lead instrument reuses the same 8-voice GM list (or the modular voice).                                                                                       | 2026-06-20 |
| Euclidean rhythms  | **Downbeat-first `(i*k)%n<k` distribution**, tiled to fill the 16-step bar, written into one beat voice (composes with the grid, stays hand-editable).                                                                                                                 | 2026-06-20 |

## 9. MVP spec — "Chord Lab"

**Core loop:** lay down a 4-chord progression (click on-screen keys/chord pads,
type `Am F C G`, or ask "give me a dreamy progression"). The agent then:

1. **Names chords + infers key/scale** (via `tonal`, deterministic).
2. **Builds a band** — bassline that follows the chords + a drum groove in a
   requested style, as MIDI clips.
3. **Plays it back, looped**, via Tone.js. Iterate by chat ("half-time,"
   "sadder," "add a bridge").

Deferred: live MIDI gear, mic capture, jam mode — they slot onto this
foundation later without redesign.

### Data model (lives in the Durable Object SQLite — source of truth)

```text
SongDoc { tempo, key, scale, loop, tracks[] }
Track   { id, name, role: chords|bass|drums|melody, instrument, clips[] }
Clip    { notes: [{ midi, startBeat, durationBeats, velocity }] }
```

### Tools

_Server tools (pure theory, run in the agent, backed by `tonal`):_
`nameChords`, `detectKey`, `generateProgression`, `makeBassline`,
`makeDrumPattern`, `transpose`, `suggestNext` → return structured notes.

_Client tools (run in the browser engine):_
`setTempo`, `setKey`, `addTrack`, `setInstrument`, `writeClip`, `play`, `stop`,
`setLoop`.

The Song Document is the contract between the two classes.

## 10. Build order (phased)

1. ✅ **Engine + doc + playback** — Song Document, Tone.js transport, a chord
   track you can hear and loop. _No AI yet — prove sound + timeline._ **DONE
   2026-06-20.** See §13 for the build map.
2. ✅ **Chat → tool loop** — typing/asking edits the progression; agent names
   chords + detects key; UI reflects it. **DONE 2026-06-20.** See §15.
3. ✅ **"Build a band"** — generate bass + drums under the chords; iterate by
   chat. **DONE 2026-06-20** (roadmap Phase C, §19).
4. ✅ **Sampled-instrument upgrade** — realistic GM soundfonts via `smplr`.
   **DONE 2026-06-20** (pulled ahead of Phase 3). See §17.
5. ✅ **Web MIDI live input → mic capture** — DONE (roadmap A + F, §19). Jam mode
   still open (§20).

> This early phased list is superseded by the **A–H roadmap in §19** (the order
> we actually built in). Kept here as historical record.

## 10a. Phase 1 detailed plan — "make sound + see it"

Goal: a playable, loopable chord progression with a visible workspace. **No AI
yet** — we prove the engine, the document, the layout, and the chord input.

### Screen layout

- **Left/center: workspace** (the DAW).
  - **Transport bar**: play / stop, loop toggle, tempo (BPM) field, key display.
  - **Chord strip**: 4 slots (extensible). Each slot shows its chord name; empty
    slots invite input.
  - **Chord input**: clickable pads (choose root C..B + quality maj/min/7/etc.)
    that fill the next slot; plus a text box that parses `Am F C G`.
  - **Track lanes**: one lane per track (starts with a single "Chords" track),
    drawn as colored blocks across the loop. Bass/drums lanes appear in Phase 3.
- **Right: chat panel** (docked). The existing Think chat UI, narrowed into a
  side panel. Wired but not yet driving tools in Phase 1.

### Audio engine (browser, Tone.js)

- A singleton `engine` module wrapping `Tone.Transport`.
- A `PolySynth` for the chords track; voices triggered per chord per bar.
- `play()` / `stop()` / `setLoop(bars)` / `setTempo(bpm)`.
- `renderDoc(songDoc)` — schedule notes from the document onto the transport.
- AudioContext starts on first user gesture (browser requirement).

### Song Document (client state in Phase 1; persisted to DO in Phase 2)

```ts
type Note = { midi: number; startBeat: number; durationBeats: number; velocity: number };
type Clip = { notes: Note[] };
type Track = {
  id: string;
  name: string;
  role: "chords" | "bass" | "drums" | "melody";
  instrument: string;
  clips: Clip[];
};
type SongDoc = { tempo: number; key: string; scale: string; loopBars: number; tracks: Track[] };
```

- Chord names → notes via `tonal` (`Chord.get("Am").notes` → MIDI). This is the
  first use of the deterministic theory engine.

### Deliverable for Phase 1

Type or pad in `Am F C G`, hit play, hear the 4 chords loop on a synth pad, and
see them as blocks on the Chords lane. Tempo + loop controls work. Chat panel is
present but inert.

### Explicitly NOT in Phase 1

Tool calling, key detection display, bass/drums, samples, persistence, MIDI in.

## 11. Open questions

Tracked in the conversation; will be answered and folded into "Decisions."
See the running list at the bottom as we resolve them.

## 12. Changelog

- 2026-06-20 — Initial dump: vision, principles, stack, idea backlog,
  North-Star choice, MVP spec ("Chord Lab"), data model, tools, build order.
- 2026-06-20 — Locked layout (workspace + docked chat), Phase 1 visual (chord
  strip + lanes + transport), chord input (pads + text), kept name "Pizzo";
  added detailed Phase 1 plan (§10a).
- 2026-06-20 — **Built & verified Phase 1.** Added `tone` + `@tonaljs/tonal`.
  New files (§13). Typecheck clean; ran in-browser: chords parse → loop on a
  synth, transport/tempo/loop work, chat panel docked (inert). Next: Phase 2.
- 2026-06-20 — **Built & verified Phase 2 (chat → tools).** Added `zod`. Song is
  now agent broadcast `state`; six `tonal`-backed server tools drive it; client
  mirrors state → engine. Chose `kimi-k2.7-code` (native tool calls) after
  `llama-3.3-70b` emitted tool calls as text. Verified multi-tool turns
  in-browser. See §15.
- 2026-06-20 — **Nicer sounds (Phase 4 pulled forward).** Added `smplr`;
  realistic GM soundfonts via Tone's AudioContext, synth fallback, 8-instrument
  picker + `setInstrument` tool. Verified soundfont fetch + live switching by
  dropdown and by chat ("switch to vibraphone"). See §17. Next: Phase 3 (band).
- 2026-06-20 — **Removed CDN/synth fallbacks** — soundfonts are self-hosted and
  always present, so the dead fallback paths were deleted (§17).
- 2026-06-20 — **Modular surface (ZOIA-inspired), first voice.** React Flow
  canvas + Elementary Audio engine; one subtractive voice playable by hand and
  by chat (`setSynthParam` et al.). See §18.
- 2026-06-20 — **Agreed roadmap A–F** and dove straight through (§19):
  - **A** Web MIDI + 8-voice polyphony for the modular engine.
  - **B** Bridged surfaces — Chord Lab can play through the modular voice.
  - **C** "Build a band" — derived bass + drum-groove generators, synth kit,
    Band panel + lanes, `addDrums`/`addBassline` (+ remove). The North-Star MVP.
  - **D** Deepened modular — noise/drive/delay/reverb/mixer modules, `el.sm`
    param smoothing, per-voice FX state, add-module palette + presets +
    save/copy/paste.
  - **E** Beats surface — 5×16 step machine (`SongState.beat`), `programBeat`/
    `clearBeat`, overrides the style groove on every surface.
  - **F** Audio-in — `PitchTracker` (mic → autocorrelation → MIDI) drives the
    modular voice; graceful mic-denial.
- 2026-06-20 — **Comprehensive README rewrite** covering all surfaces + arch.
- 2026-06-20 — **Phase G: melody / lead line.** Seeded, derived `generateMelody`
  (arp/flowing/pop/ballad), melody part in the engine, Band-panel controls +
  piano-roll lane, `addMelody`/`regenerateMelody`/`removeMelody`. See §19-G.
- 2026-06-20 — **Phase H: Euclidean rhythms.** `euclid` + `euclidBeat` in
  `song.ts`, Beats "Euclidean fill" strip (with live preview), `euclidBeat`
  chat tool. Verified E(3,8) tresillo on the kick. See §19-H. Deferred: a
  Euclidean _module_ on the Modular surface (gate triggers) — tracked in §20.
- 2026-06-20 — **Phase I: arrangement / song sections.** `Section`/`Arrangement`
  types + `makeSection`/`flattenSections` in `song.ts`; `songDocFromArrangement`
  flattens sections (chords × repeats) into one timeline, generating each
  section's parts independently and offsetting them (so per-section voice
  toggles + drum-busy + per-section key all apply). New `Arrangement.tsx` panel
  (proportional timeline + editable section cards: name/repeats/D·B·M toggles/
  reorder/duplicate/delete); Chord Lab now edits the **selected** section. Agent
  tools `setArrangement`/`addSection`/`clearArrangement`. The engine was
  unchanged — it already loops `loopBars`, now set to the total song length.
  Verified an 8-bar Verse→Section 2 song plays cleanly.
- 2026-06-20 — **Phase J: MIDI export.** `src/audio/midiExport.ts` renders the
  current `SongDoc` (so arrangements + band + beat all included) to a Standard
  MIDI File via `@tonejs/midi` — pitched tracks in seconds, drums on GM channel
  10 — and downloads it. "MIDI" button in the transport bar. Verified the blob is
  a valid `MThd` file. (Audio/WAV render deferred — see §20.)
- 2026-06-20 — **Phase K: teaching / reharmonization.** `song.ts` gains
  `chordFunctions` (Tonic/Subdominant/Dominant by scale degree), `reharmonize`
  (jazz = diatonic sevenths, simple = triads, via `tonal` `Key`), and
  `suggestNextChords` (common-practice degree-flow). Live **Theory** strip under
  the progression (Roman numeral + colored function per chord). Agent tools
  `explainTheory`/`reharmonize`/`suggestNextChord`, and a prompt nudge to teach a
  little on every harmonic change. Verified the Theory strip + `Key` shapes.
- 2026-06-20 — **Phase L: playhead + play-once.** Engine `songProgress(loopBars)`
  (ticks-modulo-loop, works looping or not); `SongDoc.loop` + `SongState.loopSong`
  drive `transport.loop`; play-once auto-stops via a scheduled `transport`
  event + `engine.onSongEnd` callback (mirrors `playing:false` back to shared
  state). New `Playhead.tsx` — a self-driven rAF now-line that mutates its own
  style (no 60fps subtree re-render); rendered over the arrangement timeline
  (whole-song) and over the track lanes in single-loop mode. Loop/Once toggle in
  the transport. Verified the line advances + loops and the toggle flips.
- 2026-06-20 — **Phase M: vibe presets.** `VIBES` table + `applyVibe` in
  `song.ts` (lo-fi/bossa/synthwave/house/cinematic/ballad → tempo + chord sound +
  drum/bass/melody styles & instruments + a fitting progression; keeps any active
  arrangement's chords). `VibeBar` chips in the Chord Lab + `applyVibe` chat tool.
  Verified Synthwave sets tempo 110 + warm pad + four-on-floor + octave bass +
  arp/vibraphone in one click.
- 2026-06-20 — **Phase N: WAV audio export.** All Tone/smplr output now routes
  through one master gain (`ensureMaster`) so it can be tapped. `engine.captureBuffer`
  plays one real-time pass into a `MediaRecorder` (MediaStreamDestination) and
  decodes to an AudioBuffer; `audioExport.ts` PCM-encodes a 16-bit `.wav` and
  downloads it. "WAV" button (with a "Rendering…" state) in the transport.
  Verified a valid stereo RIFF/WAVE (~19s, peak 1.0, RMS 0.29). Limitation: the
  separate-context **modular voice isn't captured** (tracked in §20).
- 2026-06-20 — **Phase O: mixer + groove.** The master bus now fans out into
  four **per-role gain nodes** (chords/bass/drums/melody); smplr instruments are
  cached per `(role, name)` so chords + melody get independent faders even when
  sharing a sound, and the synth kit routes to the drums/bass buses.
  `SongState.mix` (volume/mute/solo per track + master) is applied **live** via
  `engine.applyMix` (`setTargetAtTime` smoothing, solo mutes the rest) — no
  re-render, so dragging a fader never restarts playback. `SongState.groove`
  (`swing` + `humanize`) is applied live via `engine.setGroove`: swing uses
  `transport.swing` (`8n`), humanize jitters note/drum start times forward
  (≤18ms) + softens velocity (≤35%) in the Part callbacks. Both are off the
  `docKey` (live effects in `client.tsx`). UI: a **Mixer** panel + a **Feel**
  row in the Band panel; vibes carry a swing/humanize feel; agent tools `setMix`
  - `setGroove`. WAV capture taps the master, so the export reflects the mix.
    Verified live in-browser: swing 0→50% and a track mute both took effect during
    playback with no restart and no console errors.

## 13. Code map (as built)

| File                           | Role                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/music/song.ts`            | Song Document types + `tonal` helpers: `chordToMidi`, `parseProgression`, `progressionToClip`, `guessKey`, `songFromProgression`. The deterministic theory layer. |
| `src/audio/engine.ts`          | `engine` singleton over Tone.js: `ensureStarted` (gesture-safe AudioContext resume), `renderDoc`, `play`/`stop`, `setTempo`, loop. PolySynth, chords only.        |
| `src/components/Workspace.tsx` | DAW UI: TransportBar, ChordStrip, ChordInput (pads + text), TrackLanes. Owns `chords`/`tempo`/`isPlaying`; derives `SongDoc`; calls engine.                       |
| `src/components/ChatPanel.tsx` | The Think chat, moved into a 380px docked sidebar. Wired to the agent but not yet driving tools.                                                                  |
| `src/client.tsx`               | Layout shell: header (Pizzo brand + theme toggle) + Workspace + ChatPanel.                                                                                        |

### Phase 1 quirks / debts to revisit

- `key` is a **naive guess** from the first chord (`guessKey`). Replace with
  real detection in Phase 2.
- Progression lives in component state as `string[]`; `SongDoc` is derived. When
  the agent owns the doc (Phase 2), the doc should carry chord labels so the UI
  can round-trip them instead of keeping a parallel `chords` array.
- Lane rendering assumes one chord per bar; revisit when clips get richer.

## 15. Phase 2 — chat → tools (as built)

The Assistant now drives the studio in natural language. Verified in-browser:
"give me a dreamy progression in D, then play it" → `setProgression` +
`play`; "transpose up two semitones, then stop" → `transposeSong` + `stop`.
Multi-tool turns, deterministic theory, live UI + audio all work.

### Architecture chosen

- **`SongState`** (chords, tempo, key, scale, loopBars, **playing**) lives in
  the agent's broadcast `state` (Durable Object, persisted + multi-client).
- **All chat actions are server tools** that call `this.setState(...)`. The
  client subscribes via `useAgent({ onStateUpdate })`, renders the workspace
  from state, and **mirrors state → engine** (including `playing`).
- We deliberately did **not** use client tools (no-`execute` + `onToolCall`)
  for Phase 2 — the state-mirror approach is simpler, deterministic, and avoids
  tool round-trip timing/uncertainty. Revisit client tools for genuinely
  browser-only actions (mic capture, MIDI) in later phases.
- One shared `useAgent<SongState>` lives in `App` and is passed to both the
  Workspace (state + `setState`) and the ChatPanel (chat).
- A one-time global pointer/key listener resumes the AudioContext so
  chat-triggered `play` actually sounds.

### Tools (server, in `agents/assistant/agent.ts`)

`setProgression`, `setTempo`, `transposeSong`, `analyzeSong` (read-only),
`play`, `stop`. All backed by `tonal`. `setProgression` tolerates array OR
stringified-array OR "Am F C G" args (Workers AI models vary).

### Code map additions

| File                           | Phase 2 change                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `agents/assistant/agent.ts`    | `Think<Env, SongState>`, `initialState`, state-aware `getSystemPrompt`, six server tools, `normalizeChords`.                           |
| `src/music/song.ts`            | Added `SongState`, `defaultSongState`, `songStateFromProgression`, `songDocFromState`, `transposeProgression`, `analyzeRomanNumerals`. |
| `src/client.tsx`               | Shared `useAgent<SongState>`, `song` state via `onStateUpdate`, `updateSong` (local + `agent.setState`), global audio unlock.          |
| `src/components/Workspace.tsx` | Now `{ song, onChange }`-driven; mirrors content + `playing` to engine.                                                                |
| `src/components/ChatPanel.tsx` | Takes shared `agent` + `connectionStatus` props instead of its own connection.                                                         |

### Phase 2 debts / notes

- `setTempo` exists as a tool but there's no manual tempo→state echo issue; the
  number input writes through `onChange`. Fine.
- Tool result cards render raw JSON in chat — pretty but verbose. Could prettify
  later.
- Key is still the naive first-chord guess (`guessKey`); real detection remains
  a Phase 3+ item.

## 17. Nicer sounds — sampled instruments (as built)

Pulled Phase 4 forward. The chords now play through **realistic General-MIDI
soundfonts** instead of the synth.

- **`smplr`** loads GM instruments (kit **MusyngKite**) from our **own
  `public/soundfonts/MusyngKite/` folder** (served at `/soundfonts/...`),
  passed via smplr's `instrumentUrl`. The 8 `*-mp3.js` files (~19 MB total,
  mp3 for universal browser support) were downloaded once from the gleitz
  midi-js-soundfonts CDN and committed. **No CDN dependency at runtime.**
  Verified the local files serve (`200`, byte-identical to CDN) and decode.
- **No fallbacks.** Since the soundfonts are self-hosted and always present,
  the earlier CDN fallback and PolySynth offline-fallback were removed as dead
  code. If a load fails it logs and retries next time (no sound until then).
- Soundfont is created on **Tone's AudioContext** (`Tone.getContext().rawContext`)
  so Tone's transport and smplr share one clock; the `Tone.Part` callback calls
  `instrument.start({ note, time, duration, velocity })`.
- **8-instrument picker** in the transport bar (`INSTRUMENTS` in `song.ts`):
  Grand Piano, Electric Piano, Organ, Nylon Guitar, Vibraphone, Strings, Warm
  Pad, Choir. Instrument is part of `SongState`, so it persists + broadcasts.
- **`setInstrument` tool** lets chat change the sound ("switch to vibraphone",
  "warm pad"); `resolveInstrument` fuzzy-maps words → GM id. Verified live.
- Engine re-renders on instrument change (added to the Workspace effect deps),
  so the sound swaps mid-loop without stopping.

Files touched: `src/audio/engine.ts` (smplr integration, local soundfonts),
`src/music/song.ts` (`instrument` on SongState/SongDoc, `INSTRUMENTS`),
`src/components/Workspace.tsx` (Sound picker), `agents/assistant/agent.ts`
(`setInstrument` + `resolveInstrument` + prompt). Dep added: `smplr`.

### Debts / ideas

- Per-instrument volume/ADSR differs; could add a master gain or per-instrument
  trim. Vibraphone/choir decay long — fine for now.
- Soundfonts are now **local** (`public/soundfonts/MusyngKite/*-mp3.js`,
  ~19 MB in the repo); first note of a new instrument still waits on the
  initial fetch/decode (cached after). Could preload favorites, or trim the
  repo by fetching at build time instead of committing.

## 16. Next up — Phase 3 ("build a band")

- Generate a **bassline** that follows the chord roots (server tool
  `addBassline`, writes a bass track to state).
- Generate a **drum groove** by style (`addDrums({ style })`) — synth drums in
  the engine (kick/snare/hat).
- Engine: render bass + drums tracks (extend `renderDoc` beyond chords-only),
  add per-track instruments and a mixer-ish volume.
- UI: show bass/drums lanes (colors already defined in `LANE_COLORS`).
- Iterate by chat: "busier drums", "walking bass", "drop drums for 8 bars".

## 18. Modular surface — build-your-own-sound (ZOIA-inspired)

New direction (2026-06-20): Pizzo is a **multi-surface playground**, not a single
UI. The second surface is a **modular synth** you patch together yourself.

### Why ZOIA

The Empress ZOIA is a modular synth in a pedal: you're given primitives
(oscillators, filters, VCAs, envelopes, LFOs, logic, effects) and you _build_
the instrument by wiring them. Ideas worth stealing:

- **Everything is one signal world** — audio and **CV** (control voltage, 0→1 or
  −1→1) flow through the same patch cables; anything can modulate anything.
- **Connections carry an amount** ("connection strength", % for CV / dB for
  audio) + each CV input has a **bias** (resting/min/mid). The cable _is_ the
  attenuverter — no separate attenuator modules.
- **Two abstraction tiers**: drop a ready-made effect, or build it from
  primitives. (ZOIA's native UI is an 8×5 button grid; we deliberately chose a
  **freeform node canvas** instead — friendlier on screen, same concepts.)
- Patches are shareable artifacts (JSON for us).

### Our take (decisions)

- **UI**: freeform node canvas (React Flow) — drag modules, draw cables between
  port handles, cable label = strength.
- **Engine**: Elementary Audio. The canvas (nodes + edges) **compiles to one
  declarative `el` expression**; on any change we recompile and `core.render()`
  — Elementary diffs/reconciles. AI-friendly: emit a graph → render it.
- **AI hook**: the most natural yet — a patch is a graph of modules + typed
  connections, exactly what an LLM can emit/edit. "Make a wobbly dub bass" →
  agent lays modules + cables on the canvas, _visibly_, and you can tweak.

### Data model (shared via agent state, like SongState)

```text
Patch       { modules: PatchModule[], connections: PatchConnection[] }
PatchModule { id, type, x, y, params: { [name]: number|string } }
PatchConnection { id, from:{module,port}, to:{module,port}, strength }
```

### First milestone — DONE 2026-06-20

**One playable subtractive voice**: `keyboard → oscillator → filter → vca → out`,
with `adsr → vca.gain` and `lfo → filter.cutoff`. Verified **playable by hand**
(on-screen piano + computer keyboard A–K/W–U) **and tweakable by chat** (asked
"make it brighter + slow filter wobble" → agent set cutoff 6000 Hz, LFO 0.8 Hz,
depth 0.8; canvas updated live). Module set: Keyboard, Oscillator, Filter (SVF),
VCA, ADSR, LFO, Output.

### Code map (as built)

- `src/modular/types.ts` — Patch / PatchModule / PatchConnection.
- `src/modular/registry.ts` — module defs (ports, params, category/color),
  `defaultVoice()`, `portDef()`.
- `src/modular/compile.ts` — `compilePatch(patch, {freq,gate})` → stereo `el`
  expression. Lazy + memoized from `output` backwards; connection `strength`
  scales each source; cycle-guarded. Cutoff mod is additive (±5 kHz, clamped);
  VCA gain additive then clamped 0..1.
- `src/modular/engine.ts` — `modularEngine`: own AudioContext + WebRenderer,
  monophonic last-note `noteOn/noteOff`, re-renders on patch/note change.
- `src/components/ModularSurface.tsx` — React Flow canvas: custom module nodes
  with port handles + param sliders/selects, strength-editable cables (audio =
  solid orange, CV = dashed grey), piano. Bidirectional sync via a committed
  signature so chat edits resync without clobbering local interaction.
- `src/client.tsx` — `SurfaceTabs` (Chord Lab | Modular); patch lives in
  `SongState.patch`.
- `agents/assistant/agent.ts` — tools: `setSynthParam`, `addSynthModule`,
  `connectSynth`, `removeSynthModule`, `resetSynth`; prompt carries the live
  patch summary + module palette. Pure edit helpers in `src/modular/edit.ts`.

### Debts / next ideas

- Monophonic only — polyphony (voice allocation) is the obvious next step.
- No param smoothing on knob/cable changes — occasional zipper noise possible.
- Add modules: noise, delay/reverb, mixer, sample player; feedback (cycles are
  currently muted). Patch presets / sharing (it's already JSON).

## 19. Roadmap (2026-06-20) — agreed order, dive straight in

Doing all of these, in order. Each unlocks the next.

- **A — Play it for real: Web MIDI + polyphony. ✅ built.** Modular engine is
  polyphonic (fixed 8-voice pool; each voice a const-driven subgraph keyed by
  voice index — `compilePatch(patch, voices)` sums them, scaled by `1/√n` for
  headroom; noteOn/off only change const values, so renders are cheap reconciles).
  Voice allocation: reuse same-note slot → free slot → steal oldest (`age`).
  Web MIDI in `src/midi/webmidi.ts` (singleton + `useWebMidi` hook): routes
  hardware notes to the synth; header shows Enable/“no devices”/device badge;
  incoming notes highlight on the piano. `allNotesOff()` for panic/stop.
- **B — Bridge surfaces. ✅ built.** "Modular Synth" (`MODULAR_VOICE_ID`) is a
  Chord Lab instrument option; when selected, `engine.renderDoc` routes the
  scheduled chord events to `modularEngine` via `Tone.getDraw().schedule(...)`
  (deferred to ~audio time, since Elementary runs on its own clock) instead of a
  soundfont. Patch is mirrored to the modular engine at the client level
  (`useEffect` on `song.patch`), so it plays regardless of the open surface.
  `engine.stop()` calls `modularEngine.allNotesOff()` to kill held gates.
- **C — Build a band (North-Star, was §16). ✅ built.** `SongState` gained
  `bass {enabled,style,octave}` + `drums {enabled,style,busy}`; deterministic
  generators in `song.ts` (`generateBass` — root/octaves/rootFifth/offbeat/
  walking; `generateDrums` — fourOnFloor/rock/funk/lofi/halftime on a 16-step
  grid, `busy` adds ghost hats). Engine builds a lazy synth kit (MembraneSynth
  kick, filtered NoiseSynths for snare/hat/openhat/clap) + a MonoSynth bass, and
  renders separate bass + drum `Tone.Part`s. UI: a **Band** panel (style selects
  - busy slider) and **Bass**/**Drums** lanes (the drum lane is a K/S/H ×16 grid
    preview). Agent tools: `addDrums`/`removeDrums`/`addBassline`/`removeBassline`.
    `client.tsx` `normalizeSong()` backfills bass/drums/patch for older persisted
    state.
- **D — Deepen modular. ✅ built.** New modules: **noise** (white/pink),
  **drive** (tanh saturation), **delay** (per-voice feedback echo), **reverb**
  (4-comb + damping), **mixer** (2-in). Param consts wrapped in `el.sm` for
  zipper-free changes. Stateful FX keyed per-voice (`${id}:dl:${vi}`) so each
  polyphonic voice gets its own delay/reverb line. `compilePatch` now takes the
  context sample rate (for delay-time → samples). UI: an **+ Add module** palette
  and a **Load patch…** menu (factory presets: Init/Acid/Dream pad/Noise perc/
  Dub echo) + Save (localStorage) / Copy / Paste (clipboard JSON) in
  `src/modular/presets.ts`. The agent's `addSynthModule` enum picks up the new
  modules automatically.
- **E — New surface: step-sequencer / drum machine. ✅ built.** Third tab
  **Beats**: a 5-voice × 16-step grid (`SongState.beat`). `beatToHits` renders it
  into looping `drumHits` and **overrides** the style groove when enabled, so it
  drives drums on every surface. "Fill from <style>" seeds the grid via
  `styleToBeat`; rAF playhead via `engine.currentStep(steps)`. The Tone render +
  transport effects were lifted from `Workspace` into `App` (`client.tsx`) so any
  surface drives the engine. Agent tools: `programBeat` (per-voice "x.x." strings)
  - `clearBeat`.
- **F — Guitar/voice in. ✅ built.** `src/audio/pitch.ts`: a `PitchTracker`
  (getUserMedia → AnalyserNode → autocorrelation over a musical lag range, per
  rAF) reports `{freq, rms, clarity}`; `freqToMidi` snaps to a note. The Modular
  surface's **Audio in** button (next to MIDI) starts it and, with a 2-frame
  stability gate + clarity/level thresholds, drives the modular synth
  monophonically (note shown on the button, highlighted on the piano).
  Denied/unsupported mic is handled gracefully. (Live mic can't be verified in
  the automation browser — same as Web MIDI.)

- **G — Melody / lead line. ✅ built.** A fourth voice that sings over the
  chords. `generateMelody(chords, key, scale, style, seed)` in `song.ts` is
  deterministic (seeded mulberry32) so it round-trips and **follows chord/key
  changes automatically** (derived, like bass/drums — not stored). Strong beats
  land on chord tones, weak beats step through the key's scale (singable,
  consonant). Styles: **arp** (8th-note arpeggio), **flowing** (quarter/8th
  stepwise), **pop** (catchy syncopated bars), **ballad** (long held chord
  tones). `SongState.melody = {enabled, style, instrument, seed}`;
  "regenerate" = bump the seed. Engine loads the lead instrument (any GM voice
  or the modular voice) and schedules a `melodyPart`. UI: **Melody** style +
  **Lead sound** selects and a **Regenerate** button in the Band panel, plus a
  mini **piano-roll** lane (`MelodyRoll`) showing the contour. Agent tools:
  `addMelody` (style/instrument), `regenerateMelody`, `removeMelody`.
  `client.tsx` `normalizeSong()` backfills `melody` for older state.

- **H — Euclidean rhythms. ✅ built.** `euclid(pulses, steps, rotate)` in
  `song.ts` distributes pulses as evenly as possible (downbeat-first via the
  `(i*k)%n < k` rule), with rotation — E(3,8) → tresillo, E(5,8) → cinquillo,
  etc. `euclidBeat(beat, voice, pulses, steps, rotate)` tiles that pattern to
  fill the 16-step bar and writes it into one voice's row (composes with the
  rest of the grid, still hand-editable). Beats surface gets a **Euclidean
  fill** strip (voice / pulses / steps / rotate + a live "x.x." preview chip +
  "Apply to <voice>"). Agent tool `euclidBeat` exposes it to chat ("give me a
  3-over-8 kick", "spread 5 hits across the snare"). No new audio plumbing —
  it just fills the existing `SongState.beat`.

### Status: roadmap A–H all shipped. Pizzo now has three surfaces (Chord Lab,

Beats, Modular), a synth band with chords + bass + drums + a generated melody
line, Euclidean rhythm fills, a deep modular voice with FX + presets, Web MIDI,
and audio-in — all controllable by hand and by chat.

## 20. Deferred / backlog (tracked for later)

> Things we deliberately punted, with enough context to pick up cold. Not
> prioritized. Pull from here (and from the wide brainstorm in §6) as we grow.

### Explicitly deferred (came up, chose not to build yet)

- **Euclidean _module_ on the Modular surface (gate/trigger sequencer).** Phase H
  added Euclidean _fills_ to the Beats grid (drum rows). The natural extension is
  a `euclid` **module** in the modular synth that emits **gate triggers** to
  clock/play the synth voice rhythmically. _Why deferred:_ the modular engine is
  currently pitch/CV-oriented (notes come from keyboard/MIDI/mic/Chord-Lab
  bridge), with no internal clock or gate-sequencing concept. Doing it right
  means: a clock/tempo source in the Elementary graph (or bridged from Tone's
  transport), a `gate`/`trigger` signal type, and a module that outputs a pulse
  train from pulses/steps/rotate. Reuse `euclid()` from `song.ts` for the
  pattern; the work is the **gate plumbing**, not the math. (Raised 2026-06-20.)

### Carried-over debts / polish (from per-phase notes)

- **Modular zipper noise** mostly addressed by `el.sm` (Phase D), but knob drags
  on un-smoothed params could still click. Audit remaining raw consts.
- **Feedback / cycles** in the modular graph are still muted (cycle-guarded in
  `compile.ts`). Real feedback paths (with a one-sample delay) would unlock
  Karplus-Strong, comb-feedback patches.
- **Soundfonts are committed** (~19 MB in `public/soundfonts/`). Could fetch at
  build time or preload favorites to trim the repo / hide first-note latency.
- **Tool result cards render raw JSON** in chat — works, but verbose. Prettify.
- **Key detection is still the naive first-chord guess** (`guessKey`). Replace
  with real key inference from the full progression.
- **Mixer shipped** (Phase O: volume/mute/solo per role + master). Still missing:
  **pan**, a **master limiter/compressor**, and the **modular voice** (separate
  `AudioContext`) isn't on the mixer buses yet.

### Big next directions (proposed, not yet chosen)

- **Arrangement v2** — shipped Phase I (sections + per-section voices) and the
  timeline now has a playhead + play-once (Phase L). Next: per-section _style_
  overrides (different drum/melody style per section), per-section
  tempo/instrument, and drag-to-reorder sections.
- **Audio export** — `.mid` (Phase J) and `.wav` (Phase N) shipped. Next:
  **MP3/Ogg** encode (smaller share files) and **including the modular voice** in
  the render (it's on a separate `AudioContext`, so capture currently misses it —
  mix both MediaStreams, or move the modular renderer onto Tone's context).
- **Polish what plays** — mixer + swing/humanize shipped (Phase O). Next:
  per-track **pan**, a master **limiter/compressor**, and routing the **modular
  voice** through the mixer buses.
- **Smarter assistant** — teaching/reharmonize/suggest-next (Phase K), vibe
  presets (Phase M), and mix/groove tools (Phase O) shipped. Next:
  secondary-dominant / borrowed-chord reharms and cadence/voice-leading
  explanations.
- **Melody depth** — call-and-response phrasing/rests, per-note piano-roll
  editing (drag to nudge), target-note resolution.
- **Projects & sharing** — multiple saved songs + a shareable link for a whole
  song (patches already copy/paste as JSON).
- **Jam mode / live bandmate**, **hum-to-MIDI capture**, **VST/DAW bridge** —
  the original long-horizon North-Stars (§7).
