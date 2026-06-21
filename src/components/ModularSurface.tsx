import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge, Button, Text } from "@cloudflare/kumo";
import {
  ArrowCounterClockwiseIcon,
  ClipboardIcon,
  CopyIcon,
  FloppyDiskIcon,
  MicrophoneIcon,
  PianoKeysIcon,
} from "@phosphor-icons/react";
import { modularEngine } from "../modular/engine";
import { PitchTracker, freqToMidi } from "../audio/pitch";
import { useWebMidi, webMidi } from "../midi/webmidi";
import { MODULE_TYPES, MODULES, defaultVoice, portDef } from "../modular/registry";
import type { ParamDef } from "../modular/registry";
import { addModule as addModuleToPatch } from "../modular/edit";
import { useToast } from "./Toast";
import { PRESETS, isPatch, loadPatch, savePatch, savedPatchNames } from "../modular/presets";
import type { PresetCategory } from "../modular/presets";
import type { ModuleType, Patch, PatchConnection, PatchModule } from "../modular/types";

type ModuleNodeData = { module: PatchModule };

type Actions = {
  setParam: (moduleId: string, paramId: string, value: number | string) => void;
};
const ActionsContext = createContext<Actions>({ setParam: () => {} });

const PRESET_CATEGORIES: PresetCategory[] = [
  "Starter",
  "Bass",
  "Keys",
  "Pads",
  "Leads",
  "Textures",
  "Percussion",
];

// ---- patch <-> react-flow translation -------------------------------------

function patchSignature(patch: Patch): string {
  return JSON.stringify(patch);
}

function patchToNodes(patch: Patch): Node<ModuleNodeData>[] {
  return patch.modules.map((m) => ({
    id: m.id,
    type: "module",
    position: { x: m.x, y: m.y },
    data: { module: m },
  }));
}

function edgeKind(patch: Patch, c: PatchConnection): "audio" | "cv" {
  const mod = patch.modules.find((m) => m.id === c.from.module);
  if (!mod) return "cv";
  return portDef(mod.type, c.from.port)?.kind ?? "cv";
}

function patchToEdges(patch: Patch): Edge[] {
  return patch.connections.map((c) => {
    const kind = edgeKind(patch, c);
    const audio = kind === "audio";
    return {
      id: c.id,
      source: c.from.module,
      sourceHandle: c.from.port,
      target: c.to.module,
      targetHandle: c.to.port,
      label: audio ? undefined : `${Math.round(c.strength * 100)}%`,
      data: { strength: c.strength },
      style: {
        stroke: audio ? "#f97316" : "#64748b",
        strokeWidth: audio ? 2.5 : 1.5,
        strokeDasharray: audio ? undefined : "5 4",
      },
    } satisfies Edge;
  });
}

// ---- param control --------------------------------------------------------

function ParamControl({ module, param }: { module: PatchModule; param: ParamDef }) {
  const { setParam } = useContext(ActionsContext);
  const value = module.params[param.id] ?? param.default;

  if (param.kind === "enum") {
    return (
      <label className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-kumo-subtle">{param.label}</span>
        <select
          className="nodrag px-1.5 py-0.5 rounded border border-kumo-line bg-kumo-elevated text-kumo-default text-[11px] outline-none"
          value={String(value)}
          onChange={(e) => setParam(module.id, param.id, e.target.value)}
        >
          {param.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const exp = param.curve === "exp";
  const toSlider = (v: number) =>
    exp
      ? Math.log(v / param.min) / Math.log(param.max / param.min)
      : (v - param.min) / (param.max - param.min);
  const fromSlider = (t: number) =>
    exp ? param.min * (param.max / param.min) ** t : param.min + t * (param.max - param.min);
  const num = Number(value);
  const display =
    num >= 100 ? Math.round(num) : num >= 10 ? num.toFixed(1) : num.toFixed(num < 1 ? 3 : 2);

  return (
    <label className="flex flex-col gap-0.5 text-[11px]" aria-label={param.label}>
      <span className="flex items-center justify-between text-kumo-subtle">
        <span>{param.label}</span>
        <span className="tabular-nums text-kumo-default">
          {display}
          {param.unit ? ` ${param.unit}` : ""}
        </span>
      </span>
      <input
        type="range"
        className="nodrag w-full accent-kumo-accent"
        min={0}
        max={1}
        step={0.001}
        value={toSlider(num)}
        onChange={(e) => {
          const raw = fromSlider(Number(e.target.value));
          const snapped = Math.round(raw / param.step) * param.step;
          setParam(module.id, param.id, Math.min(param.max, Math.max(param.min, snapped)));
        }}
      />
    </label>
  );
}

// ---- module node ----------------------------------------------------------

const PORT_GAP = 22;

function ModuleNode({ data }: NodeProps<Node<ModuleNodeData>>) {
  const { module } = data;
  const def = MODULES[module.type];

  return (
    <div
      className="rounded-xl border border-kumo-line bg-kumo-base shadow-md w-[180px] overflow-hidden"
      style={{ borderTopColor: def.color, borderTopWidth: 3 }}
    >
      <div className="px-3 py-1.5 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: def.color }} />
        <span className="text-xs font-semibold text-kumo-default">{def.label}</span>
      </div>

      {def.inputs.map((p, i) => (
        <Handle
          key={`in-${p.id}`}
          id={p.id}
          type="target"
          position={Position.Left}
          style={{
            top: 44 + i * PORT_GAP,
            background: p.kind === "audio" ? "#f97316" : "#64748b",
            width: 9,
            height: 9,
          }}
        />
      ))}
      {def.outputs.map((p, i) => (
        <Handle
          key={`out-${p.id}`}
          id={p.id}
          type="source"
          position={Position.Right}
          style={{
            top: 44 + i * PORT_GAP,
            background: p.kind === "audio" ? "#f97316" : "#64748b",
            width: 9,
            height: 9,
          }}
        />
      ))}

      <div className="px-3 pb-1 flex justify-between text-[10px] text-kumo-inactive">
        <div className="flex flex-col gap-[10px]">
          {def.inputs.map((p) => (
            <span key={p.id}>{p.label}</span>
          ))}
        </div>
        <div className="flex flex-col gap-[10px] items-end">
          {def.outputs.map((p) => (
            <span key={p.id}>{p.label}</span>
          ))}
        </div>
      </div>

      {def.params.length > 0 && (
        <div className="px-3 py-2 border-t border-kumo-line space-y-1.5 bg-kumo-elevated/40">
          {def.params.map((p) => (
            <ParamControl key={p.id} module={module} param={p} />
          ))}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { module: ModuleNode };

// ---- piano ----------------------------------------------------------------

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const isBlack = (midi: number) => NOTE_NAMES[midi % 12].includes("#");

const COMPUTER_KEYS: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
};

function Piano({
  active,
  onDown,
  onUp,
}: {
  active: Set<number>;
  onDown: (midi: number) => void;
  onUp: (midi: number) => void;
}) {
  const start = 48;
  const end = 72;
  const all = useMemo(() => Array.from({ length: end - start + 1 }, (_, i) => start + i), []);
  const whites = all.filter((m) => !isBlack(m));
  const whiteW = 30;

  return (
    <div className="relative h-24 select-none" style={{ width: whites.length * whiteW }}>
      {whites.map((m, i) => (
        <button
          key={m}
          type="button"
          aria-label={`Play ${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`}
          onPointerDown={(e) => {
            e.preventDefault();
            onDown(m);
          }}
          onPointerUp={() => onUp(m)}
          onPointerLeave={(e) => {
            if (e.buttons > 0) onUp(m);
          }}
          className={`absolute top-0 h-24 rounded-b border border-kumo-line transition-colors ${
            active.has(m) ? "bg-kumo-accent" : "bg-white hover:bg-kumo-elevated"
          }`}
          style={{ left: i * whiteW, width: whiteW - 1 }}
        />
      ))}
      {all.filter(isBlack).map((m) => {
        const whitesBefore = all.filter((n) => n < m && !isBlack(n)).length;
        return (
          <button
            key={m}
            type="button"
            aria-label={`Play ${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`}
            onPointerDown={(e) => {
              e.preventDefault();
              onDown(m);
            }}
            onPointerUp={() => onUp(m)}
            onPointerLeave={(e) => {
              if (e.buttons > 0) onUp(m);
            }}
            className={`absolute top-0 h-14 w-4 rounded-b z-10 transition-colors ${
              active.has(m) ? "bg-kumo-accent" : "bg-neutral-800 hover:bg-neutral-700"
            }`}
            style={{ left: whitesBefore * whiteW - 8 }}
          />
        );
      })}
    </div>
  );
}

// ---- midi control ---------------------------------------------------------

function MidiControl() {
  const { status, inputs, enable } = useWebMidi();
  if (status === "unsupported") return null;
  if (status === "ready") {
    const label =
      inputs.length === 0
        ? "MIDI: no devices"
        : `${inputs[0].name}${inputs.length > 1 ? ` +${inputs.length - 1}` : ""}`;
    return (
      <Badge variant={inputs.length ? "primary" : "secondary"}>
        <span className="flex items-center gap-1">
          <PianoKeysIcon size={12} weight="bold" />
          {label}
        </span>
      </Badge>
    );
  }
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={<PianoKeysIcon size={14} />}
      onClick={enable}
      disabled={status === "requesting"}
    >
      {status === "requesting" ? "Enabling…" : "Enable MIDI"}
    </Button>
  );
}

// ---- audio in (mic → pitch → synth) ---------------------------------------

function AudioInControl({
  noteOn,
  noteOff,
}: {
  noteOn: (midi: number) => void;
  noteOff: (midi: number) => void;
}) {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<"idle" | "requesting" | "denied">("idle");
  const [note, setNote] = useState<number | null>(null);

  const trackerRef = useRef<PitchTracker | null>(null);
  const current = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  const stable = useRef(0);

  const stop = useCallback(() => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    if (current.current != null) noteOff(current.current);
    current.current = null;
    pending.current = null;
    stable.current = 0;
    setActive(false);
    setNote(null);
  }, [noteOff]);

  const start = useCallback(async () => {
    setStatus("requesting");
    const tracker = new PitchTracker();
    tracker.onResult = (r) => {
      // Confident, loud-enough pitch → (re)trigger after it stabilises.
      if (r.freq > 0 && r.clarity > 0.9 && r.rms > 0.02) {
        const midi = freqToMidi(r.freq);
        if (midi === pending.current) stable.current += 1;
        else {
          pending.current = midi;
          stable.current = 0;
        }
        if (stable.current >= 2 && midi !== current.current) {
          if (current.current != null) noteOff(current.current);
          noteOn(midi);
          current.current = midi;
          setNote(midi);
        }
      } else if (r.rms < 0.012 && current.current != null) {
        noteOff(current.current);
        current.current = null;
        setNote(null);
      }
    };
    try {
      await tracker.start();
      trackerRef.current = tracker;
      setActive(true);
      setStatus("idle");
    } catch {
      setStatus("denied");
    }
  }, [noteOn, noteOff]);

  useEffect(() => () => trackerRef.current?.stop(), []);

  if (typeof navigator !== "undefined" && !navigator.mediaDevices) return null;

  if (active) {
    const name =
      note != null ? `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}` : "listening";
    return (
      <Button
        variant="primary"
        size="sm"
        icon={<MicrophoneIcon size={14} weight="fill" />}
        onClick={stop}
      >
        {name}
      </Button>
    );
  }
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={<MicrophoneIcon size={14} />}
      onClick={() => void start()}
      disabled={status === "requesting"}
    >
      {status === "requesting" ? "Enabling…" : status === "denied" ? "Mic blocked" : "Audio in"}
    </Button>
  );
}

// ---- surface --------------------------------------------------------------

export function ModularSurface({
  patch,
  onChange,
  isUsedInChordLab,
  onUseInChordLab,
}: {
  patch: Patch;
  onChange: (next: Patch) => void;
  isUsedInChordLab: boolean;
  onUseInChordLab: () => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ModuleNodeData>>(patchToNodes(patch));
  const [edges, setEdges, onEdgesChange] = useEdgesState(patchToEdges(patch));
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [active, setActive] = useState<Set<number>>(new Set());

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  // Mirror the patch to the audio engine.
  useEffect(() => {
    modularEngine.setPatch(patch);
  }, [patch]);

  // Release any held notes when the surface unmounts (tab or song switch) so a
  // voice left gated isn't re-triggered the next time the patch is rendered.
  useEffect(() => () => modularEngine.allNotesOff(), []);

  // Resync the canvas when the patch changes from the outside (e.g. chat).
  const committedSig = useRef(patchSignature(patch));
  const incomingSig = patchSignature(patch);
  useEffect(() => {
    if (incomingSig !== committedSig.current) {
      setNodes(patchToNodes(patch));
      setEdges(patchToEdges(patch));
      committedSig.current = incomingSig;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingSig]);

  const commit = useCallback(
    (ns: Node<ModuleNodeData>[], es: Edge[]) => {
      const modules: PatchModule[] = ns.map((n) => ({
        ...n.data.module,
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
      }));
      const connections: PatchConnection[] = es.map((e) => ({
        id: e.id,
        from: { module: e.source, port: e.sourceHandle ?? "out" },
        to: { module: e.target, port: e.targetHandle ?? "in" },
        strength: (e.data?.strength as number) ?? 1,
      }));
      const next = { modules, connections };
      committedSig.current = patchSignature(next);
      onChange(next);
    },
    [onChange],
  );

  const setParam = useCallback(
    (moduleId: string, paramId: string, value: number | string) => {
      const next = nodesRef.current.map((n) =>
        n.id === moduleId
          ? {
              ...n,
              data: {
                module: {
                  ...n.data.module,
                  params: { ...n.data.module.params, [paramId]: value },
                },
              },
            }
          : n,
      );
      nodesRef.current = next;
      setNodes(next);
      commit(next, edgesRef.current);
    },
    [commit, setNodes],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      const src = nodesRef.current.find((n) => n.id === conn.source);
      const dst = nodesRef.current.find((n) => n.id === conn.target);
      if (!src || !dst || !conn.sourceHandle || !conn.targetHandle) return;
      const srcKind = portDef(src.data.module.type, conn.sourceHandle)?.kind;
      const dstKind = portDef(dst.data.module.type, conn.targetHandle)?.kind;
      if (srcKind !== dstKind) return; // don't mix audio and CV
      const next = addEdge(
        {
          ...conn,
          id: `e${Date.now()}`,
          data: { strength: 1 },
          label: srcKind === "audio" ? undefined : "100%",
          style: {
            stroke: srcKind === "audio" ? "#f97316" : "#64748b",
            strokeWidth: srcKind === "audio" ? 2.5 : 1.5,
            strokeDasharray: srcKind === "audio" ? undefined : "5 4",
          },
        },
        edgesRef.current,
      );
      edgesRef.current = next;
      setEdges(next);
      commit(nodesRef.current, next);
    },
    [commit, setEdges],
  );

  const setStrength = useCallback(
    (edgeId: string, strength: number) => {
      const next = edgesRef.current.map((e) =>
        e.id === edgeId
          ? {
              ...e,
              data: { ...e.data, strength },
              label: e.style?.strokeDasharray ? `${Math.round(strength * 100)}%` : e.label,
            }
          : e,
      );
      edgesRef.current = next;
      setEdges(next);
      commit(nodesRef.current, next);
    },
    [commit, setEdges],
  );

  /** Current canvas state as a Patch (same mapping as commit). */
  const refsToPatch = useCallback((): Patch => {
    const modules: PatchModule[] = nodesRef.current.map((n) => ({
      ...n.data.module,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
    }));
    const connections: PatchConnection[] = edgesRef.current.map((e) => ({
      id: e.id,
      from: { module: e.source, port: e.sourceHandle ?? "out" },
      to: { module: e.target, port: e.targetHandle ?? "in" },
      strength: (e.data?.strength as number) ?? 1,
    }));
    return { modules, connections };
  }, []);

  /** Replace the whole patch (presets, paste, reset, add-module). */
  const applyPatch = useCallback(
    (next: Patch) => {
      const ns = patchToNodes(next);
      const es = patchToEdges(next);
      nodesRef.current = ns;
      edgesRef.current = es;
      setNodes(ns);
      setEdges(es);
      committedSig.current = patchSignature(next);
      onChange(next);
    },
    [onChange, setEdges, setNodes],
  );

  const reset = useCallback(() => applyPatch(defaultVoice()), [applyPatch]);

  const addModule = useCallback(
    (type: ModuleType) => {
      const res = addModuleToPatch(refsToPatch(), type);
      if (!res.error) applyPatch(res.patch);
    },
    [applyPatch, refsToPatch],
  );

  const [savedNames, setSavedNames] = useState<string[]>(() => savedPatchNames());
  const { toast } = useToast();

  const loadNamed = useCallback(
    (value: string) => {
      const preset = PRESETS.find((p) => `preset:${p.id}` === value);
      if (preset) return applyPatch(preset.make());
      if (value.startsWith("saved:")) {
        const next = loadPatch(value.slice("saved:".length));
        if (next) applyPatch(next);
      }
    },
    [applyPatch],
  );

  const saveCurrent = useCallback(() => {
    const name = window.prompt("Save patch as:");
    if (!name) return;
    savePatch(name, refsToPatch());
    setSavedNames(savedPatchNames());
  }, [refsToPatch]);

  const copyPatch = useCallback(() => {
    void navigator.clipboard
      .writeText(JSON.stringify(refsToPatch(), null, 2))
      .then(() => toast("Copied patch JSON.", "success"))
      .catch(() => toast("Couldn't copy patch JSON.", "error"));
  }, [refsToPatch, toast]);

  const pastePatch = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed: unknown = JSON.parse(text);
      if (!isPatch(parsed)) {
        toast("Clipboard doesn't contain a valid patch.", "error");
        return;
      }
      applyPatch(parsed);
      toast("Pasted patch JSON.", "success");
    } catch {
      toast("Couldn't paste patch JSON.", "error");
    }
  }, [applyPatch, toast]);

  const noteOn = useCallback((midi: number) => {
    modularEngine.noteOn(midi);
    setActive((prev) => {
      if (prev.has(midi)) return prev;
      const next = new Set(prev);
      next.add(midi);
      return next;
    });
  }, []);
  const noteOff = useCallback((midi: number) => {
    modularEngine.noteOff(midi);
    setActive((prev) => {
      if (!prev.has(midi)) return prev;
      const next = new Set(prev);
      next.delete(midi);
      return next;
    });
  }, []);

  // Web MIDI playing.
  useEffect(
    () =>
      webMidi.subscribeNotes((e) => {
        if (e.type === "on") noteOn(e.note);
        else noteOff(e.note);
      }),
    [noteOn, noteOff],
  );

  // Computer-keyboard playing.
  useEffect(() => {
    const held = new Set<string>();
    const isTyping = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat || isTyping()) return;
      const semi = COMPUTER_KEYS[e.key.toLowerCase()];
      if (semi === undefined) return;
      held.add(e.key.toLowerCase());
      noteOn(60 + semi);
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const semi = COMPUTER_KEYS[k];
      if (semi === undefined || !held.has(k)) return;
      held.delete(k);
      noteOff(60 + semi);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [noteOn, noteOff]);

  const selected = edges.find((e) => e.id === selectedEdge);
  const presetsByCategory = useMemo(
    () =>
      PRESET_CATEGORIES.map((category) => ({
        category,
        presets: PRESETS.filter((preset) => preset.category === category),
      })).filter((group) => group.presets.length > 0),
    [],
  );
  const templatePresets = useMemo(
    () =>
      (["Bass", "Pads", "Leads", "Textures"] as PresetCategory[])
        .map((category) => PRESETS.find((preset) => preset.category === category))
        .filter((preset): preset is (typeof PRESETS)[number] => Boolean(preset)),
    [],
  );

  return (
    <ActionsContext.Provider value={{ setParam }}>
      <main className="flex-1 flex flex-col min-w-0 bg-kumo-elevated">
        <div className="flex items-center justify-between px-5 py-3 bg-kumo-base border-b border-kumo-line">
          <div className="flex items-center gap-2">
            <Text size="sm" bold>
              Modular
            </Text>
            <Text size="xs" variant="secondary">
              patch a synth from modules — drag from a port to wire it up
            </Text>
            <Badge variant={isUsedInChordLab ? "primary" : "secondary"}>
              {isUsedInChordLab ? "Used by Chord Lab" : "Patch ready"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {!isUsedInChordLab && (
              <Button variant="primary" size="sm" onClick={onUseInChordLab}>
                Use in Chord Lab
              </Button>
            )}
            <select
              aria-label="Add module"
              value=""
              onChange={(e) => {
                if (e.target.value) addModule(e.target.value as ModuleType);
                e.currentTarget.value = "";
              }}
              className="px-2 py-1 rounded-md border border-kumo-line bg-kumo-elevated text-kumo-default text-xs outline-none focus:ring-2 focus:ring-kumo-ring"
            >
              <option value="">+ Add module</option>
              {MODULE_TYPES.filter((t) => t !== "keyboard" && t !== "output").map((t) => (
                <option key={t} value={t}>
                  {MODULES[t].label}
                </option>
              ))}
            </select>
            <select
              aria-label="Load patch"
              value=""
              onChange={(e) => {
                if (e.target.value) loadNamed(e.target.value);
                e.currentTarget.value = "";
              }}
              className="px-2 py-1 rounded-md border border-kumo-line bg-kumo-elevated text-kumo-default text-xs outline-none focus:ring-2 focus:ring-kumo-ring"
            >
              <option value="">Use patch in Modular…</option>
              {presetsByCategory.map(({ category, presets }) => (
                <optgroup key={category} label={category}>
                  {presets.map((p) => (
                    <option key={p.id} value={`preset:${p.id}`}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              ))}
              {savedNames.length > 0 && (
                <optgroup label="Saved">
                  {savedNames.map((n) => (
                    <option key={n} value={`saved:${n}`}>
                      {n}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Save patch"
              icon={<FloppyDiskIcon size={14} />}
              onClick={saveCurrent}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label="Copy patch JSON"
              icon={<CopyIcon size={14} />}
              onClick={copyPatch}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label="Paste patch JSON"
              icon={<ClipboardIcon size={14} />}
              onClick={() => void pastePatch()}
            />
            <AudioInControl noteOn={noteOn} noteOff={noteOff} />
            <MidiControl />
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowCounterClockwiseIcon size={14} />}
              onClick={reset}
            >
              Reset
            </Button>
          </div>
        </div>

        <div className="border-b border-kumo-line bg-kumo-elevated px-5 py-3">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
            <div className="rounded-lg border border-kumo-line bg-kumo-base px-4 py-3">
              <Text size="xs" variant="secondary" bold>
                What this controls
              </Text>
              <p className="mt-1 text-xs text-kumo-inactive">
                This designs one playable synth voice. Load a patch here to edit it, then choose
                “Modular Synth” in Chord Lab, or use the button above, to make this exact voice the
                chord sound.
              </p>
            </div>
            <div className="rounded-lg border border-kumo-line bg-kumo-base px-4 py-3">
              <Text size="xs" variant="secondary" bold>
                Patch Templates
              </Text>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {templatePresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPatch(preset.make())}
                    className="rounded-full border border-kumo-line bg-kumo-elevated px-2.5 py-1 text-xs text-kumo-default hover:border-kumo-accent"
                  >
                    {preset.category}: {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={() => commit(nodesRef.current, edgesRef.current)}
            onNodesDelete={() => queueMicrotask(() => commit(nodesRef.current, edgesRef.current))}
            onEdgesDelete={() => queueMicrotask(() => commit(nodesRef.current, edgesRef.current))}
            onEdgeClick={(_, edge) => setSelectedEdge(edge.id)}
            onPaneClick={() => setSelectedEdge(null)}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} color="var(--kumo-line, #2a2a2a)" />
            <Controls showInteractive={false} />

            {selected && selected.style?.strokeDasharray && (
              <Panel position="top-right">
                <div className="rounded-lg border border-kumo-line bg-kumo-base shadow-md px-3 py-2 w-52">
                  <Text size="xs" variant="secondary" bold>
                    Connection strength
                  </Text>
                  <input
                    type="range"
                    className="w-full accent-kumo-accent mt-1"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={(selected.data?.strength as number) ?? 1}
                    onChange={(e) => setStrength(selected.id, Number(e.target.value))}
                  />
                  <Text size="xs" variant="secondary">
                    {Math.round(((selected.data?.strength as number) ?? 1) * 100)}%
                  </Text>
                </div>
              </Panel>
            )}

            <Panel position="bottom-center">
              <div className="rounded-xl border border-kumo-line bg-kumo-base/95 backdrop-blur shadow-lg p-3">
                <Piano active={active} onDown={noteOn} onUp={noteOff} />
                <Text size="xs" variant="secondary">
                  Play with the mouse or your keyboard (A–K = white keys, W/E/T/Y/U = sharps)
                </Text>
              </div>
            </Panel>
          </ReactFlow>
        </div>
      </main>
    </ActionsContext.Provider>
  );
}
