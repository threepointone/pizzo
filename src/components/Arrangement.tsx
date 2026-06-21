import { useCallback, useState } from "react";
import { Button, Text } from "@cloudflare/kumo";
import { CaretLeftIcon, CopyIcon, PlusIcon, RowsIcon, TrashIcon } from "@phosphor-icons/react";
import { guessKey, makeSection, type Section, type SongState } from "../music/song";
import { Playhead } from "./Playhead";

const SECTION_COLORS = [
  "bg-orange-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-amber-500",
];

const ARRANGEMENT_TEMPLATES = [
  {
    label: "Pop Song",
    sections: [
      { name: "Verse", repeats: 2, drums: true, bass: true, melody: false, busy: 0.25 },
      { name: "Chorus", repeats: 2, drums: true, bass: true, melody: true, busy: 0.65 },
      { name: "Bridge", repeats: 1, drums: false, bass: true, melody: true, busy: 0.15 },
      { name: "Chorus", repeats: 2, drums: true, bass: true, melody: true, busy: 0.75 },
    ],
  },
  {
    label: "Breakdown Loop",
    sections: [
      { name: "Intro", repeats: 1, drums: false, bass: false, melody: false, busy: 0 },
      { name: "Groove", repeats: 2, drums: true, bass: true, melody: false, busy: 0.45 },
      { name: "Break", repeats: 1, drums: false, bass: true, melody: true, busy: 0.1 },
      { name: "Return", repeats: 2, drums: true, bass: true, melody: true, busy: 0.65 },
    ],
  },
  {
    label: "Cinematic Build",
    sections: [
      { name: "Quiet", repeats: 2, drums: false, bass: false, melody: true, busy: 0 },
      { name: "Lift", repeats: 2, drums: false, bass: true, melody: true, busy: 0.15 },
      { name: "Peak", repeats: 2, drums: true, bass: true, melody: true, busy: 0.55 },
    ],
  },
  {
    label: "Dance Intro/Drop",
    sections: [
      { name: "Intro", repeats: 2, drums: true, bass: false, melody: false, busy: 0.2 },
      { name: "Build", repeats: 1, drums: true, bass: true, melody: false, busy: 0.45 },
      { name: "Drop", repeats: 4, drums: true, bass: true, melody: true, busy: 0.8 },
    ],
  },
] as const;

function sectionBars(s: Section): number {
  return Math.max(1, s.chords.length) * Math.max(1, Math.floor(s.repeats));
}

/** Toggle pill for a per-section voice (Drums / Bass / Melody). */
function VoiceToggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={label}
      className={`w-6 h-6 rounded-md text-[11px] font-bold transition-colors ${
        on
          ? "bg-kumo-contrast text-kumo-inverse"
          : "bg-kumo-elevated text-kumo-inactive hover:text-kumo-subtle"
      }`}
    >
      {label[0]}
    </button>
  );
}

export function Arrangement({
  song,
  onChange,
  playing,
}: {
  song: SongState;
  onChange: (next: SongState) => void;
  playing: boolean;
}) {
  const arr = song.arrangement;
  const on = arr.enabled && arr.sections.length > 0;
  const currentId = arr.current ?? arr.sections[0]?.id ?? null;
  const [editingSections, setEditingSections] = useState(false);

  const setSections = useCallback(
    (sections: Section[], current?: string | null) => {
      // Keep the global key in sync with the first section so analysis/labels
      // stay meaningful as sections change.
      const first = sections[0];
      const keyInfo = first ? guessKey(first.chords) : null;
      onChange({
        ...song,
        key: keyInfo?.key ?? song.key,
        scale: keyInfo?.scale ?? song.scale,
        arrangement: {
          ...arr,
          sections,
          current: current !== undefined ? current : arr.current,
        },
      });
    },
    [arr, onChange, song],
  );

  const enable = useCallback(() => {
    // Seed the timeline from the current single progression.
    const seed = makeSection(song.arrangement.sections[0]?.name ?? "Verse", song.chords, {
      drums: song.drums.enabled,
      bass: song.bass.enabled,
      melody: song.melody.enabled,
      busy: song.drums.busy,
    });
    onChange({
      ...song,
      arrangement: { enabled: true, sections: [seed], current: seed.id },
    });
  }, [onChange, song]);

  const disable = useCallback(() => {
    // Drop back to a single loop using the selected section's chords.
    const sel = arr.sections.find((s) => s.id === currentId) ?? arr.sections[0];
    onChange({
      ...song,
      chords: sel?.chords ?? song.chords,
      arrangement: { ...arr, enabled: false },
    });
  }, [arr, currentId, onChange, song]);

  const addSection = useCallback(() => {
    const sel = arr.sections.find((s) => s.id === currentId);
    const next = makeSection(`Section ${arr.sections.length + 1}`, sel?.chords ?? song.chords, {
      drums: sel?.drums ?? true,
      bass: sel?.bass ?? true,
      melody: sel?.melody ?? false,
      busy: sel?.busy ?? 0,
    });
    setSections([...arr.sections, next], next.id);
  }, [arr.sections, currentId, setSections, song.chords]);

  const applyTemplate = useCallback(
    (template: (typeof ARRANGEMENT_TEMPLATES)[number]) => {
      const source = arr.sections.find((s) => s.id === currentId) ?? arr.sections[0];
      const chords = source?.chords.length ? source.chords : song.chords;
      const sections = template.sections.map((section) =>
        makeSection(section.name, chords, {
          repeats: section.repeats,
          drums: section.drums,
          bass: section.bass,
          melody: section.melody,
          busy: section.busy,
        }),
      );
      onChange({
        ...song,
        arrangement: { enabled: true, sections, current: sections[0]?.id ?? null },
      });
    },
    [arr.sections, currentId, onChange, song],
  );

  const applyTransition = useCallback(
    (kind: "build" | "drop" | "finish") => {
      const source = arr.sections.find((s) => s.id === currentId) ?? arr.sections[0];
      const chords = source?.chords.length ? source.chords : song.chords;
      const transition =
        kind === "build"
          ? makeSection("Build", chords, {
              repeats: 1,
              drums: true,
              bass: true,
              melody: false,
              busy: 0.5,
            })
          : kind === "drop"
            ? makeSection("Drop-out", chords, {
                repeats: 1,
                drums: false,
                bass: false,
                melody: true,
                busy: 0,
              })
            : makeSection("Big Finish", chords, {
                repeats: 2,
                drums: true,
                bass: true,
                melody: true,
                busy: 0.8,
              });
      setSections([...arr.sections, transition], transition.id);
    },
    [arr.sections, currentId, setSections, song.chords],
  );

  const duplicate = useCallback(
    (id: string) => {
      const idx = arr.sections.findIndex((s) => s.id === id);
      if (idx < 0) return;
      const src = arr.sections[idx];
      const copy = makeSection(`${src.name} copy`, [...src.chords], {
        repeats: src.repeats,
        drums: src.drums,
        bass: src.bass,
        melody: src.melody,
        busy: src.busy,
      });
      const sections = [...arr.sections];
      sections.splice(idx + 1, 0, copy);
      setSections(sections, copy.id);
    },
    [arr.sections, setSections],
  );

  const remove = useCallback(
    (id: string) => {
      const sections = arr.sections.filter((s) => s.id !== id);
      const current = id === currentId ? (sections[0]?.id ?? null) : arr.current;
      if (sections.length === 0) {
        onChange({ ...song, arrangement: { ...arr, enabled: false, sections: [], current: null } });
        return;
      }
      setSections(sections, current);
    },
    [arr, currentId, onChange, setSections, song],
  );

  const move = useCallback(
    (id: string, dir: -1 | 1) => {
      const idx = arr.sections.findIndex((s) => s.id === id);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= arr.sections.length) return;
      const sections = [...arr.sections];
      [sections[idx], sections[swap]] = [sections[swap], sections[idx]];
      setSections(sections);
    },
    [arr.sections, setSections],
  );

  const update = useCallback(
    (id: string, patch: Partial<Section>) => {
      setSections(arr.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    },
    [arr.sections, setSections],
  );

  const totalBars = arr.sections.reduce((sum, s) => sum + sectionBars(s), 0);

  return (
    <div className="px-5 py-4 border-t border-kumo-line space-y-3">
      <div className="flex items-center gap-2">
        <RowsIcon size={15} className="text-kumo-accent" />
        <Text size="xs" variant="secondary" bold>
          Arrangement
        </Text>
        <div className="flex-1" />
        {on ? (
          <>
            <Text size="xs" variant="secondary">
              {totalBars} bars
            </Text>
            <Button variant="ghost" size="sm" icon={<PlusIcon size={14} />} onClick={addSection}>
              Section
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditingSections((next) => !next)}>
              {editingSections ? "Hide details" : "Edit sections"}
            </Button>
            <Button variant="ghost" size="sm" onClick={disable}>
              Off
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" icon={<RowsIcon size={14} />} onClick={enable}>
            Arrange into sections
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 rounded-lg border border-kumo-line bg-kumo-base px-3 py-2">
        <Text size="xs" variant="secondary" bold>
          Structure
        </Text>
        {ARRANGEMENT_TEMPLATES.map((template) => (
          <button
            key={template.label}
            type="button"
            onClick={() => applyTemplate(template)}
            className="rounded-full border border-kumo-line bg-kumo-elevated px-2.5 py-1 text-xs text-kumo-default hover:border-kumo-accent hover:text-kumo-accent"
          >
            {template.label}
          </button>
        ))}
        {on && (
          <>
            <span className="mx-1 h-6 w-px bg-kumo-line" aria-hidden="true" />
            <button
              type="button"
              onClick={() => applyTransition("build")}
              className="rounded-full border border-kumo-line bg-kumo-elevated px-2.5 py-1 text-xs text-kumo-default hover:border-kumo-accent hover:text-kumo-accent"
            >
              Add build
            </button>
            <button
              type="button"
              onClick={() => applyTransition("drop")}
              className="rounded-full border border-kumo-line bg-kumo-elevated px-2.5 py-1 text-xs text-kumo-default hover:border-kumo-accent hover:text-kumo-accent"
            >
              Add drop-out
            </button>
            <button
              type="button"
              onClick={() => applyTransition("finish")}
              className="rounded-full border border-kumo-line bg-kumo-elevated px-2.5 py-1 text-xs text-kumo-default hover:border-kumo-accent hover:text-kumo-accent"
            >
              Add finish
            </button>
          </>
        )}
      </div>

      {on && (
        <>
          {/* Timeline: blocks proportional to each section's bar count. */}
          <div className="flex gap-1 h-9 relative">
            <Playhead bars={totalBars} playing={playing} />
            {arr.sections.map((s, i) => {
              const selected = s.id === currentId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSections(arr.sections, s.id)}
                  style={{ flexGrow: sectionBars(s) }}
                  className={`min-w-0 rounded-md px-2 flex items-center justify-center text-xs font-semibold text-white truncate ${
                    SECTION_COLORS[i % SECTION_COLORS.length]
                  } ${selected ? "ring-2 ring-kumo-accent" : "opacity-80 hover:opacity-100"}`}
                >
                  {s.name}
                  {s.repeats > 1 ? ` ×${s.repeats}` : ""}
                </button>
              );
            })}
          </div>

          {editingSections && (
            <div className="space-y-1.5">
              {arr.sections.map((s, i) => {
                const selected = s.id === currentId;
                return (
                  <div
                    key={s.id}
                    className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2 ${
                      selected ? "border-kumo-accent bg-kumo-base" : "border-kumo-line"
                    }`}
                  >
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        SECTION_COLORS[i % SECTION_COLORS.length]
                      }`}
                    />
                    <input
                      value={s.name}
                      onClick={() => setSections(arr.sections, s.id)}
                      onChange={(e) => update(s.id, { name: e.target.value })}
                      className="w-24 px-2 py-1 rounded-md border border-kumo-line bg-kumo-elevated text-kumo-default text-xs outline-none focus:ring-2 focus:ring-kumo-ring"
                    />
                    <span className="text-xs text-kumo-inactive truncate max-w-40">
                      {s.chords.join(" ") || "—"}
                    </span>
                    <label className="flex min-w-32 items-center gap-1.5">
                      <Text size="xs" variant="secondary">
                        Energy
                      </Text>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={s.busy}
                        onChange={(e) => update(s.id, { busy: Number(e.target.value) })}
                        className="w-20 accent-kumo-accent"
                      />
                    </label>
                    <div className="flex-1" />
                    <label className="flex items-center gap-1">
                      <Text size="xs" variant="secondary">
                        ×
                      </Text>
                      <input
                        type="number"
                        min={1}
                        max={16}
                        value={s.repeats}
                        onChange={(e) =>
                          update(s.id, {
                            repeats: Math.max(1, Math.min(16, Number(e.target.value) || 1)),
                          })
                        }
                        className="w-12 px-1.5 py-1 rounded-md border border-kumo-line bg-kumo-elevated text-kumo-default text-xs text-center outline-none focus:ring-2 focus:ring-kumo-ring"
                      />
                    </label>
                    <div className="flex items-center gap-1">
                      <VoiceToggle
                        label="Drums"
                        on={s.drums}
                        onClick={() => update(s.id, { drums: !s.drums })}
                      />
                      <VoiceToggle
                        label="Bass"
                        on={s.bass}
                        onClick={() => update(s.id, { bass: !s.bass })}
                      />
                      <VoiceToggle
                        label="Melody"
                        on={s.melody}
                        onClick={() => update(s.id, { melody: !s.melody })}
                      />
                    </div>
                    <button
                      type="button"
                      aria-label="Move left"
                      onClick={() => move(s.id, -1)}
                      disabled={i === 0}
                      className="p-1 text-kumo-subtle hover:text-kumo-default disabled:opacity-30"
                    >
                      <CaretLeftIcon size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label="Move right"
                      onClick={() => move(s.id, 1)}
                      disabled={i === arr.sections.length - 1}
                      className="p-1 text-kumo-subtle hover:text-kumo-default disabled:opacity-30 rotate-180"
                    >
                      <CaretLeftIcon size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label="Duplicate section"
                      onClick={() => duplicate(s.id)}
                      className="p-1 text-kumo-subtle hover:text-kumo-default"
                    >
                      <CopyIcon size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete section"
                      onClick={() => remove(s.id)}
                      className="p-1 text-kumo-subtle hover:text-rose-400"
                    >
                      <TrashIcon size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
