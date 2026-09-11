import { useMemo, useState } from "react";
import { Archive, Check, Eye, PackageCheck, X } from "lucide-react";
import { toast } from "sonner";
import type { ReferenceRow } from "@/lib/trace-data";
import {
  getJaulaGroupState,
  getJaulaPartStatus,
  jaulaGroupKey,
  jaulaPartKey,
  loadJaulaStates,
  saveJaulaStates,
  type JaulaAccessoryStatus,
  type JaulaGroupState,
  type JaulaStateMap,
} from "@/lib/jaulaStorage";

type JaulaGroup = {
  order: string;
  sh: string;
  parts: ReferenceRow[];
};

type JaulaFilter = "todos" | "pendientes" | "pedidos" | "recogidos";

function groupReferences(references: ReferenceRow[]) {
  const groups = new Map<string, JaulaGroup>();
  references.forEach((reference) => {
    const key = jaulaGroupKey(reference.orden_original, reference.sh_original);
    const current = groups.get(key) || { order: reference.orden_original, sh: reference.sh_original, parts: [] };
    if (!current.parts.some((part) => part.numero_parte_original === reference.numero_parte_original)) current.parts.push(reference);
    groups.set(key, current);
  });
  return Array.from(groups.values()).sort((a, b) => a.order.localeCompare(b.order) || a.sh.localeCompare(b.sh));
}

function groupStatus(group: JaulaGroup, states: JaulaStateMap): "pendiente" | "pedido" | "recogido" {
  const state = getJaulaGroupState(states, group.order, group.sh);
  const allPicked = group.parts.length > 0 && group.parts.every((part) => getJaulaPartStatus(states, group.order, group.sh, part.numero_parte_original) === "recogido");
  if (allPicked) return "recogido";
  if (state.pedidoAt || group.parts.some((part) => getJaulaPartStatus(states, group.order, group.sh, part.numero_parte_original) !== "pendiente")) return "pedido";
  return "pendiente";
}

function statusLabel(status: ReturnType<typeof groupStatus>) {
  if (status === "recogido") return "Ya recogido";
  if (status === "pedido") return "Ya pedido";
  return "Pendiente";
}

function statusClass(status: ReturnType<typeof groupStatus>) {
  if (status === "recogido") return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200";
  if (status === "pedido") return "bg-cyan-100 text-cyan-800 ring-1 ring-cyan-200";
  return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
}

function partStatusLabel(status: JaulaAccessoryStatus) {
  if (status === "recogido") return "Ya recogido";
  if (status === "liberado") return "Liberado";
  return "Pendiente";
}

function partStatusClass(status: JaulaAccessoryStatus) {
  if (status === "recogido") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "liberado") return "border-cyan-200 bg-cyan-50 text-cyan-800";
  return "border-amber-100 bg-amber-50/60 text-amber-800";
}

function JaulaDetail({ group, states, onStateChange, onClose }: { group: JaulaGroup; states: JaulaStateMap; onStateChange: (group: JaulaGroup, updater: (state: JaulaGroupState) => JaulaGroupState) => void; onClose: () => void }) {
  const state = getJaulaGroupState(states, group.order, group.sh);
  const currentStatus = groupStatus(group, states);
  const pickedCount = group.parts.filter((part) => getJaulaPartStatus(states, group.order, group.sh, part.numero_parte_original) === "recogido").length;

  function markOrdered() {
    onStateChange(group, (current) => ({ ...current, pedidoAt: Date.now(), updatedAt: Date.now() }));
    toast.success(`Orden ${group.order} marcada como ya pedida.`);
  }

  function advancePart(part: ReferenceRow) {
    const partKey = jaulaPartKey(group.order, group.sh, part.numero_parte_original);
    const currentStatus = getJaulaPartStatus(states, group.order, group.sh, part.numero_parte_original);
    if (currentStatus === "recogido") return;
    const nextStatus: JaulaAccessoryStatus = currentStatus === "pendiente" ? "liberado" : "recogido";
    onStateChange(group, (current) => ({
      ...current,
      pedidoAt: current.pedidoAt || Date.now(),
      updatedAt: Date.now(),
      parts: { ...current.parts, [partKey]: { status: nextStatus, updatedAt: Date.now() } },
    }));
    toast.success(nextStatus === "liberado" ? `${part.numero_parte_original} liberado para recolección.` : `${part.numero_parte_original} marcado como ya recogido.`);
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"><div className="modal-enter max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 p-5 sm:p-6"><div><p className="eyebrow">Detalle de jaula</p><h2 className="mt-1 font-display text-xl font-semibold text-slate-900">{group.order} · {group.sh}</h2><p className="mt-1 text-xs text-slate-500">{pickedCount}/{group.parts.length} accesorios ya recogidos.</p></div><button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button></div><div className="max-h-[68vh] space-y-4 overflow-y-auto p-5 sm:p-6"><div className="flex flex-col gap-3 rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-bold text-cyan-950">Estado de la orden</p><p className="mt-1 text-xs text-cyan-800">Primero marca <strong>Ya pedido</strong>. Después libera cada accesorio y márcalo como <strong>Ya recogido</strong> cuando salga de la jaula.</p></div>{state.pedidoAt ? <span className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${statusClass(currentStatus)}`}>{statusLabel(currentStatus)}</span> : <button onClick={markOrdered} className="primary-action shrink-0"><PackageCheck className="h-4 w-4" />Ya pedido</button>}</div><div className="grid gap-3 sm:grid-cols-2">{group.parts.map((part) => { const partStatus = getJaulaPartStatus(states, group.order, group.sh, part.numero_parte_original); return <div key={part.id} className={`rounded-2xl border p-4 transition ${partStatusClass(partStatus)}`}><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.12em] opacity-70">Accesorio</p><p className="mt-1 font-mono text-sm font-bold">{part.numero_parte_original}</p></div><span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-bold">{partStatusLabel(partStatus)}</span></div><p className="mt-3 text-xs opacity-80">Fila {part.numero_fila_origen || "—"} · {part.orden_original} · {part.sh_original}</p>{partStatus === "pendiente" ? <button disabled={!state.pedidoAt} onClick={() => advancePart(part)} className="secondary-action mt-4 w-full justify-center disabled:cursor-not-allowed disabled:opacity-50">Liberar accesorio</button> : partStatus === "liberado" ? <button onClick={() => advancePart(part)} className="primary-action mt-4 w-full justify-center"><Check className="h-4 w-4" />Ya recogido</button> : <div className="mt-4 flex items-center justify-center gap-1.5 rounded-lg bg-white/80 px-3 py-2 text-xs font-bold text-emerald-700"><Check className="h-4 w-4" />Accesorio recogido</div>}</div>; })}</div></div><div className="flex justify-end border-t border-slate-100 p-5 sm:p-6"><button onClick={onClose} className="secondary-action">Cerrar</button></div></div></div>;
}

export default function JaulaView({ references }: { references: ReferenceRow[] }) {
  const [states, setStates] = useState<JaulaStateMap>(() => loadJaulaStates());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<JaulaFilter>("todos");
  const [selectedGroup, setSelectedGroup] = useState<JaulaGroup | null>(null);
  const groups = useMemo(() => groupReferences(references), [references]);
  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    return groups.filter((group) => {
      const matchesSearch = !query || [group.order, group.sh, ...group.parts.map((part) => part.numero_parte_original)].some((value) => value.toLowerCase().includes(query));
      const status = groupStatus(group, states);
      const matchesFilter = filter === "todos" || (filter === "pendientes" && status === "pendiente") || (filter === "pedidos" && status === "pedido") || (filter === "recogidos" && status === "recogido");
      return matchesSearch && matchesFilter;
    });
  }, [filter, groups, search, states]);

  function updateGroup(group: JaulaGroup, updater: (state: JaulaGroupState) => JaulaGroupState) {
    setStates((current) => {
      const key = jaulaGroupKey(group.order, group.sh);
      const next = { ...current, [key]: updater(getJaulaGroupState(current, group.order, group.sh)) };
      saveJaulaStates(next);
      return next;
    });
  }

  function markGroupOrdered(group: JaulaGroup) {
    updateGroup(group, (current) => ({ ...current, pedidoAt: current.pedidoAt || Date.now(), updatedAt: Date.now() }));
    toast.success(`Orden ${group.order} marcada como ya pedida.`);
  }

  return <div className="space-y-7"><div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="eyebrow">Control de jaula</p><h1 className="font-display text-3xl font-semibold tracking-tight text-slate-900">JAULA</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">Consulta las órdenes y SH ligados a sus accesorios. Marca cuándo una orden ya fue pedida, libera cada accesorio y confirma cuándo ya fue recogido.</p></div><div className="flex items-center gap-2 rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-xs font-bold text-cyan-800"><Archive className="h-5 w-5" />{groups.length} órdenes / SH</div></div><div className="soft-card overflow-hidden"><div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-sm font-bold text-slate-800">Listado de órdenes para jaula</p><p className="mt-1 text-xs text-slate-500">{filteredGroups.length} grupos visibles · Los estados se guardan en este navegador.</p></div><div className="flex flex-col gap-2 sm:flex-row"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar Orden, SH o accesorio" className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-cyan-500 focus:ring-3 focus:ring-cyan-100 sm:w-72" /><select value={filter} onChange={(event) => setFilter(event.target.value as JaulaFilter)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600"><option value="todos">Todos</option><option value="pendientes">Pendientes</option><option value="pedidos">Ya pedidos</option><option value="recogidos">Ya recogidos</option></select></div></div>{filteredGroups.length === 0 ? <div className="px-6 py-14 text-center text-sm text-slate-500">No hay órdenes o SH que coincidan con la búsqueda.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left"><thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-[.12em] text-slate-500"><tr><th className="px-6 py-3">Fila</th><th className="px-5 py-3">Orden</th><th className="px-5 py-3">Número de parte</th><th className="px-5 py-3">SH</th><th className="px-5 py-3">Accesorios del SH</th><th className="px-5 py-3">Estado</th><th className="px-6 py-3">Acciones</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredGroups.flatMap((group) => group.parts.map((part, index) => { const status = groupStatus(group, states); return <tr key={part.id} className={`transition hover:bg-slate-50/80 ${status === "recogido" ? "bg-emerald-50/35" : ""}`}><td className="px-6 py-4 text-xs text-slate-500">{part.numero_fila_origen || index + 1}</td><td className="px-5 py-4 font-mono text-xs font-bold text-slate-700">{group.order}</td><td className="px-5 py-4 font-mono text-xs text-slate-600">{part.numero_parte_original}</td><td className="px-5 py-4 font-mono text-xs text-slate-600">{group.sh}</td><td className="px-5 py-4"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${status === "recogido" ? "bg-emerald-100 text-emerald-800" : "bg-cyan-50 text-cyan-800"}`}>{group.parts.length} accesorios</span></td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass(status)}`}>{statusLabel(status)}</span></td><td className="px-6 py-4"><div className="flex items-center gap-2"><button onClick={() => setSelectedGroup(group)} className="secondary-action px-3 py-2"><Eye className="h-3.5 w-3.5" />Ver</button>{status === "pendiente" ? <button onClick={() => markGroupOrdered(group)} className="primary-action px-3 py-2"><PackageCheck className="h-3.5 w-3.5" />Ya pedido</button> : null}</div></td></tr>; }))}</tbody></table></div>}</div>{selectedGroup ? <JaulaDetail group={selectedGroup} states={states} onStateChange={updateGroup} onClose={() => setSelectedGroup(null)} /> : null}</div>;
}
