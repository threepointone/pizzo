import { MODULES, makeModule, portDef } from "./registry";
import type { ModuleType, Patch, PatchModule } from "./types";

/** Resolve a module by exact id, else by type, else by label (case-insensitive). */
export function resolveModule(patch: Patch, ref: string): PatchModule | null {
  const q = ref.trim().toLowerCase();
  return (
    patch.modules.find((m) => m.id.toLowerCase() === q) ??
    patch.modules.find((m) => m.type.toLowerCase() === q) ??
    patch.modules.find((m) => MODULES[m.type].label.toLowerCase() === q) ??
    null
  );
}

function resolveParamId(type: ModuleType, ref: string): string | null {
  const q = ref.trim().toLowerCase();
  const def = MODULES[type];
  const byId = def.params.find((p) => p.id.toLowerCase() === q);
  if (byId) return byId.id;
  const byLabel = def.params.find((p) => p.label.toLowerCase() === q);
  return byLabel?.id ?? null;
}

/** Set a parameter on a module, validating/clamping against the registry. */
export function setModuleParam(
  patch: Patch,
  moduleRef: string,
  paramRef: string,
  value: number | string,
): {
  patch: Patch;
  error?: string;
  applied?: { module: string; param: string; value: number | string };
} {
  const mod = resolveModule(patch, moduleRef);
  if (!mod) return { patch, error: `No module "${moduleRef}".` };
  const paramId = resolveParamId(mod.type, paramRef);
  if (!paramId) return { patch, error: `Module ${mod.type} has no param "${paramRef}".` };
  const def = MODULES[mod.type].params.find((p) => p.id === paramId)!;

  let v: number | string;
  if (def.kind === "enum") {
    const match = def.options.find((o) => o.toLowerCase() === String(value).toLowerCase());
    if (!match) return { patch, error: `${paramId} must be one of: ${def.options.join(", ")}.` };
    v = match;
  } else {
    const n = Number(value);
    if (Number.isNaN(n)) return { patch, error: `${paramId} expects a number.` };
    v = Math.min(def.max, Math.max(def.min, n));
  }

  const modules = patch.modules.map((m) =>
    m.id === mod.id ? { ...m, params: { ...m.params, [paramId]: v } } : m,
  );
  return { patch: { ...patch, modules }, applied: { module: mod.id, param: paramId, value: v } };
}

/** Add a module of `type`, returning the new patch + assigned id. */
export function addModule(
  patch: Patch,
  type: ModuleType,
  x?: number,
  y?: number,
): { patch: Patch; id?: string; error?: string } {
  if (!MODULES[type]) return { patch, error: `Unknown module type "${type}".` };
  let n = 1;
  let id = `${type}${n}`;
  while (patch.modules.some((m) => m.id === id)) id = `${type}${++n}`;
  const mod = makeModule(type, id, x ?? 200 + patch.modules.length * 40, y ?? 200);
  return { patch: { ...patch, modules: [...patch.modules, mod] }, id };
}

export function removeModule(patch: Patch, moduleRef: string): { patch: Patch; error?: string } {
  const mod = resolveModule(patch, moduleRef);
  if (!mod) return { patch, error: `No module "${moduleRef}".` };
  return {
    patch: {
      modules: patch.modules.filter((m) => m.id !== mod.id),
      connections: patch.connections.filter(
        (c) => c.from.module !== mod.id && c.to.module !== mod.id,
      ),
    },
  };
}

/** Wire one module's output port to another's input port. */
export function connect(
  patch: Patch,
  from: string,
  fromPort: string,
  to: string,
  toPort: string,
  strength = 1,
): { patch: Patch; error?: string } {
  const src = resolveModule(patch, from);
  const dst = resolveModule(patch, to);
  if (!src) return { patch, error: `No module "${from}".` };
  if (!dst) return { patch, error: `No module "${to}".` };
  const srcPort = portDef(src.type, fromPort);
  const dstPort = portDef(dst.type, toPort);
  if (!srcPort || srcPort.dir !== "out")
    return { patch, error: `${src.type} has no output "${fromPort}".` };
  if (!dstPort || dstPort.dir !== "in")
    return { patch, error: `${dst.type} has no input "${toPort}".` };
  if (srcPort.kind !== dstPort.kind)
    return { patch, error: `Can't connect ${srcPort.kind} to ${dstPort.kind}.` };

  let n = 1;
  let id = `c${n}`;
  while (patch.connections.some((c) => c.id === id)) id = `c${++n}`;
  const conn = {
    id,
    from: { module: src.id, port: fromPort },
    to: { module: dst.id, port: toPort },
    strength,
  };
  // Replace any existing identical edge rather than duplicate it.
  const connections = patch.connections.filter(
    (c) =>
      !(
        c.from.module === src.id &&
        c.from.port === fromPort &&
        c.to.module === dst.id &&
        c.to.port === toPort
      ),
  );
  return { patch: { ...patch, connections: [...connections, conn] } };
}

/** A compact, model-readable summary of the current patch. */
export function summarizePatch(patch: Patch): string {
  const mods = patch.modules
    .map((m) => {
      const params = Object.entries(m.params)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return `${m.id} (${m.type})${params ? ` [${params}]` : ""}`;
    })
    .join("; ");
  const conns = patch.connections
    .map(
      (c) =>
        `${c.from.module}.${c.from.port} → ${c.to.module}.${c.to.port} @${Math.round(c.strength * 100)}%`,
    )
    .join("; ");
  return `Modules: ${mods || "(none)"}.\nConnections: ${conns || "(none)"}.`;
}

/** Palette description for the system prompt: module types, ports, params. */
export function describeModulePalette(): string {
  return Object.values(MODULES)
    .map((d) => {
      const ins = d.inputs.map((p) => `${p.id}:${p.kind}`).join(",") || "—";
      const outs = d.outputs.map((p) => `${p.id}:${p.kind}`).join(",") || "—";
      const params =
        d.params
          .map((p) =>
            p.kind === "enum" ? `${p.id}{${p.options.join("|")}}` : `${p.id}(${p.min}..${p.max})`,
          )
          .join(",") || "—";
      return `${d.type}: in[${ins}] out[${outs}] params[${params}]`;
    })
    .join("\n");
}
