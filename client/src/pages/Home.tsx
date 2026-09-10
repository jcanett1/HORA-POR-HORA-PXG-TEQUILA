import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock3,
  Download,
  FileCheck2,
  FileSpreadsheet,
  Filter,
  History as HistoryIcon,
  LayoutDashboard,
  PackageCheck,
  Radio,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  UploadCloud,
  UsersRound,
  X,
  ScanLine,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import type { AuthContextValue } from "@/components/AuthGate";
import type { MasterDocument, Profile } from "@/lib/database.types";
import { fetchTraceData, importMasterDocument, mapCaptureRow } from "@/lib/trace-data";
import { supabase } from "@/lib/supabase";
import { ProfileEditorModal, ProfileMenu, UsersAdmin } from "@/components/ProfileAndUsers";

type View =
  | "panel"
  | "captura"
  | "supervision"
  | "documentos"
  | "reportes"
  | "historial"
  | "usuarios"
  | "configuracion";

type MatchState = "Coincide" | "Discrepancia" | "No encontrado" | "Duplicado";
type ReviewState = "Pendiente" | "Confirmado" | "Rechazado" | "Cancelado";

type RecordItem = {
  id: string;
  time: string;
  date: string;
  order: string;
  part: string;
  sh: string;
  operator: string;
  match: MatchState;
  reason?: string;
  review: ReviewState;
  document: string;
};

const knownMaterials = [
  { order: "OP-240981", part: "PN-RA-4102", sh: "SH-MTY-01" },
  { order: "OP-240982", part: "PN-KX-8801", sh: "SH-MTY-01" },
  { order: "OP-240983", part: "PN-FL-2009", sh: "SH-SLT-02" },
  { order: "OP-240984", part: "PN-DX-5140", sh: "SH-MTY-01" },
];

const startingRecords: RecordItem[] = [
  {
    id: "1001",
    time: "09:18",
    date: "10 Sep 2026",
    order: "OP-240981",
    part: "PN-RA-4102",
    sh: "SH-MTY-01",
    operator: "María López",
    match: "Coincide",
    review: "Pendiente",
    document: "Producción · Septiembre v3",
  },
  {
    id: "1002",
    time: "09:11",
    date: "10 Sep 2026",
    order: "OP-240983",
    part: "PN-FL-2009",
    sh: "SH-SLT-02",
    operator: "Carlos Méndez",
    match: "Coincide",
    review: "Confirmado",
    document: "Producción · Septiembre v3",
  },
  {
    id: "1003",
    time: "08:56",
    date: "10 Sep 2026",
    order: "OP-240982",
    part: "PN-KX-8801",
    sh: "SH-MTY-02",
    operator: "María López",
    match: "Discrepancia",
    reason: "SH diferente al documento maestro",
    review: "Pendiente",
    document: "Producción · Septiembre v3",
  },
  {
    id: "1004",
    time: "08:43",
    date: "10 Sep 2026",
    order: "OP-240976",
    part: "PN-DR-1208",
    sh: "SH-MTY-01",
    operator: "Hugo Ríos",
    match: "No encontrado",
    reason: "La orden no existe en la versión activa",
    review: "Pendiente",
    document: "Producción · Septiembre v3",
  },
  {
    id: "1005",
    time: "08:20",
    date: "10 Sep 2026",
    order: "OP-240984",
    part: "PN-DX-5140",
    sh: "SH-MTY-01",
    operator: "Carlos Méndez",
    match: "Coincide",
    review: "Confirmado",
    document: "Producción · Septiembre v3",
  },
  {
    id: "1006",
    time: "08:08",
    date: "10 Sep 2026",
    order: "OP-240979",
    part: "PN-AQ-3020",
    sh: "SH-MTY-01",
    operator: "Hugo Ríos",
    match: "Duplicado",
    reason: "Combinación capturada anteriormente en este turno",
    review: "Cancelado",
    document: "Producción · Septiembre v3",
  },
];

const hourlyData = [
  { hour: "06:00", registros: 26, coincide: 24 },
  { hour: "07:00", registros: 38, coincide: 32 },
  { hour: "08:00", registros: 52, coincide: 43 },
  { hour: "09:00", registros: 21, coincide: 18 },
  { hour: "10:00", registros: 0, coincide: 0 },
  { hour: "11:00", registros: 0, coincide: 0 },
];

const navigation: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "panel", label: "Panel de control", icon: LayoutDashboard },
  { id: "captura", label: "Capturar material", icon: ScanLine },
  { id: "supervision", label: "Supervisión", icon: ShieldCheck },
  { id: "documentos", label: "Documentos maestros", icon: FileSpreadsheet },
  { id: "reportes", label: "Reportes", icon: BarChart3 },
  { id: "historial", label: "Historial", icon: HistoryIcon },
];

function getTime() {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function normalize(value: string) {
  return value.trim().toUpperCase();
}

function logoMarkClass(size = "h-10 w-10") {
  return `${size} rounded-xl bg-gradient-to-br from-cyan-300 to-emerald-300 text-[#062131] flex items-center justify-center shadow-[0_8px_24px_rgba(49,226,190,0.24)]`;
}

function StatusPill({ state }: { state: MatchState | ReviewState }) {
  const config: Record<string, string> = {
    Coincide: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
    Discrepancia: "bg-rose-50 text-rose-700 ring-rose-600/15",
    "No encontrado": "bg-amber-50 text-amber-800 ring-amber-600/15",
    Duplicado: "bg-violet-50 text-violet-700 ring-violet-600/15",
    Pendiente: "bg-amber-50 text-amber-800 ring-amber-600/15",
    Confirmado: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
    Rechazado: "bg-rose-50 text-rose-700 ring-rose-600/15",
    Cancelado: "bg-slate-100 text-slate-600 ring-slate-500/15",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${config[state]}`}>
      {state === "Coincide" || state === "Confirmado" ? <CircleCheck className="h-3.5 w-3.5" /> : null}
      {state === "Discrepancia" || state === "No encontrado" || state === "Rechazado" ? <CircleAlert className="h-3.5 w-3.5" /> : null}
      {state}
    </span>
  );
}

function MetricCard({
  label,
  value,
  hint,
  color,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  color: "cyan" | "emerald" | "amber" | "rose";
  icon: typeof PackageCheck;
}) {
  const tones = {
    cyan: "bg-cyan-50 text-cyan-700 ring-cyan-100",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
  };
  return (
    <div className="soft-card relative overflow-hidden p-5">
      <div className={`absolute -right-6 -top-7 h-24 w-24 rounded-full opacity-40 blur-2xl ${color === "cyan" ? "bg-cyan-200" : color === "emerald" ? "bg-emerald-200" : color === "amber" ? "bg-amber-200" : "bg-rose-200"}`} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
          <p className="mt-3 font-display text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
        </div>
        <div className={`rounded-xl p-2.5 ring-1 ${tones[color]}`}><Icon className="h-5 w-5" /></div>
      </div>
      <p className="relative mt-4 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function SectionHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-6 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
      </div>
      {action}
    </div>
  );
}

function Panel({ records, setView, activeDocument }: { records: RecordItem[]; setView: (view: View) => void; activeDocument?: MasterDocument | null }) {
  const matched = records.filter((r) => r.match === "Coincide").length;
  const pending = records.filter((r) => r.review === "Pendiente").length;
  const confirmed = records.filter((r) => r.review === "Confirmado").length;

  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Operación en tiempo real"
        title="Visión general del turno"
        description="Monitorea la captura de materiales, las discrepancias y las confirmaciones de salida desde un solo lugar."
        action={<button onClick={() => setView("captura")} className="primary-action"><ScanLine className="h-4 w-4" />Nueva captura</button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Capturas de hoy" value={`${137 + records.length}`} hint="+12% frente al turno anterior" color="cyan" icon={PackageCheck} />
        <MetricCard label="Match correcto" value="91.8%" hint={`${matched} de ${records.length} en las últimas capturas`} color="emerald" icon={CircleCheck} />
        <MetricCard label="Por revisar" value={`${pending}`} hint="Requieren decisión de supervisor" color="amber" icon={Clock3} />
        <MetricCard label="Confirmados" value={`${confirmed}`} hint="Materiales con salida validada" color="rose" icon={ShieldCheck} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_0.95fr]">
        <div className="soft-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-slate-800">Ritmo de captura por hora</p>
              <p className="mt-1 text-xs text-slate-500">Registros procesados durante el primer turno.</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-50 px-2.5 py-1 text-[11px] font-bold text-cyan-700"><Radio className="h-3.5 w-3.5" />En vivo</span>
          </div>
          <div className="mt-5 h-[255px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyData} barGap={8} margin={{ top: 10, right: 0, bottom: 0, left: -22 }}>
                <CartesianGrid vertical={false} stroke="#e6edf1" strokeDasharray="3 3" />
                <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fill: "#718096", fontSize: 11 }} dy={8} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: "#718096", fontSize: 11 }} />
                <Tooltip cursor={{ fill: "#f1f7f8" }} contentStyle={{ borderRadius: 12, border: "1px solid #dce9eb", boxShadow: "0 12px 24px rgba(15, 43, 56, .12)", fontSize: 12 }} />
                <Bar dataKey="registros" name="Capturas" fill="#0e7f8d" radius={[5, 5, 0, 0]} />
                <Bar dataKey="coincide" name="Matches" fill="#35c79e" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="soft-card p-5 sm:p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-bold text-slate-800">Documento maestro activo</p>
              <p className="mt-1 text-xs text-slate-500">Fuente de validación vigente</p>
            </div>
            <FileCheck2 className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white p-2 text-emerald-600 shadow-sm"><FileSpreadsheet className="h-5 w-5" /></div>
              <div className="min-w-0"><p className="truncate text-sm font-bold text-emerald-950">{activeDocument?.nombre_archivo || "Producción · Septiembre v3"}</p><p className="mt-0.5 text-xs text-emerald-700">{activeDocument ? `${activeDocument.filas_validas.toLocaleString("es-MX")} relaciones válidas` : "1,284 relaciones válidas · demo"}</p></div>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <div className="flex justify-between text-xs"><span className="text-slate-500">Activado por</span><span className="font-semibold text-slate-700">Ana Torres</span></div>
            <div className="flex justify-between text-xs"><span className="text-slate-500">Última actualización</span><span className="font-semibold text-slate-700">Hoy · 05:48</span></div>
            <button onClick={() => setView("documentos")} className="mt-1 inline-flex items-center gap-1.5 text-xs font-bold text-[#0e7f8d] transition hover:text-[#075660]">Ver documento <ArrowUpRight className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>

      <div className="soft-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div><p className="text-sm font-bold text-slate-800">Actividad reciente</p><p className="mt-1 text-xs text-slate-500">Últimas capturas del turno actual.</p></div>
          <button onClick={() => setView("historial")} className="secondary-action"><HistoryIcon className="h-4 w-4" />Ver historial</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[740px] text-left">
            <thead className="bg-slate-50/80 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-6 py-3">Hora</th><th className="px-5 py-3">Orden / material</th><th className="px-5 py-3">SH</th><th className="px-5 py-3">Operador</th><th className="px-5 py-3">Match</th><th className="px-6 py-3">Revisión</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {records.slice(0, 4).map((record) => <RecordTableRow key={record.id} record={record} />)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RecordTableRow({ record, withActions, onReview, onOpen }: { record: RecordItem; withActions?: boolean; onReview?: (id: string, state: ReviewState) => void; onOpen?: (record: RecordItem) => void }) {
  return (
    <tr className="transition hover:bg-slate-50/70">
      <td className="px-6 py-4 text-sm font-semibold text-slate-700">{record.time}</td>
      <td className="px-5 py-4"><p className="text-sm font-bold text-slate-800">{record.order}</p><p className="mt-0.5 font-mono text-[11px] text-slate-500">{record.part}</p></td>
      <td className="px-5 py-4 font-mono text-xs text-slate-600">{record.sh}</td>
      <td className="px-5 py-4 text-sm text-slate-600">{record.operator}</td>
      <td className="px-5 py-4"><StatusPill state={record.match} /></td>
      <td className="px-6 py-4">
        {withActions && record.review === "Pendiente" ? (
          <div className="flex items-center gap-2">
            <button onClick={() => onReview?.(record.id, "Confirmado")} title="Confirmar salida" className="rounded-lg bg-emerald-50 p-1.5 text-emerald-700 transition hover:bg-emerald-100"><Check className="h-4 w-4" /></button>
            <button onClick={() => onOpen?.(record)} title="Revisar detalle" className="rounded-lg bg-slate-100 p-1.5 text-slate-600 transition hover:bg-slate-200"><Search className="h-4 w-4" /></button>
          </div>
        ) : <StatusPill state={record.review} />}
      </td>
    </tr>
  );
}

function Capture({ onCapture, user, profile, liveMode, operatorName }: { onCapture: (record: RecordItem) => void; user: User; profile: Profile | null; liveMode: boolean; operatorName: string }) {
  const [order, setOrder] = useState("");
  const [part, setPart] = useState("");
  const [sh, setSh] = useState("");
  const [lastCapture, setLastCapture] = useState<RecordItem | null>(null);

  async function submitCapture(event: React.FormEvent) {
    event.preventDefault();
    if (!order || !part || !sh) {
      toast.error("Completa orden, número de parte y SH para continuar.");
      return;
    }
    const normalized = { order: normalize(order), part: normalize(part), sh: normalize(sh) };
    const exact = knownMaterials.find((material) => material.order === normalized.order && material.part === normalized.part && material.sh === normalized.sh);
    const sameOrder = knownMaterials.find((material) => material.order === normalized.order);
    const duplicate = lastCapture && lastCapture.order === normalized.order && lastCapture.part === normalized.part && lastCapture.sh === normalized.sh;
    let match: MatchState = "Coincide";
    let reason: string | undefined;

    if (duplicate) { match = "Duplicado"; reason = "La misma combinación se capturó durante esta sesión."; }
    else if (!exact && sameOrder) { match = "Discrepancia"; reason = sameOrder.part !== normalized.part ? "Número de parte diferente al documento maestro." : "SH diferente al documento maestro."; }
    else if (!exact) { match = "No encontrado"; reason = "La combinación no existe en el documento maestro activo."; }

    if (liveMode && supabase) {
      const { data, error } = await supabase.rpc("registrar_captura", {
        p_orden: order,
        p_numero_parte: part,
        p_sh: sh,
        p_planta: profile?.planta || "Monterrey",
        p_area: profile?.area || "Produccion",
        p_turno_id: null,
        p_observaciones: null,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        toast.error("Supabase no devolvió el registro creado.");
        return;
      }
      const record = mapCaptureRow({ ...row, perfiles_usuarios: { nombre_completo: operatorName } });
      onCapture(record);
      setLastCapture(record);
      setOrder(""); setPart(""); setSh("");
      toast.success(record.match === "Coincide" ? "Match correcto registrado" : "Captura registrada para revisión");
      return;
    }

    const now = new Date();
    const record: RecordItem = {
      id: String(Date.now()),
      time: now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }),
      date: now.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }),
      order: normalized.order,
      part: normalized.part,
      sh: normalized.sh,
      operator: operatorName,
      match,
      reason,
      review: "Pendiente",
      document: "Producción · Septiembre v3",
    };
    onCapture(record);
    setLastCapture(record);
    setOrder(""); setPart(""); setSh("");
    toast.success(match === "Coincide" ? "Match correcto registrado" : "Captura registrada para revisión");
  }

  return (
    <div className="space-y-7">
      <SectionHeader eyebrow="Estación de captura" title="Registrar material" description="Ingresa o escanea la orden, el número de parte y el Shipping Hub. La hora y el usuario se registran automáticamente." />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_.8fr]">
        <form onSubmit={submitCapture} className="soft-card overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4 sm:px-7"><div className="flex items-center gap-3"><div className="rounded-xl bg-[#0e7f8d] p-2 text-white"><ScanLine className="h-5 w-5" /></div><div><p className="text-sm font-bold text-slate-800">Lectura de material</p><p className="mt-0.5 text-xs text-slate-500">Todos los campos son requeridos para validar.</p></div></div></div>
          <div className="space-y-5 p-5 sm:p-7">
            <div><label className="field-label" htmlFor="order">Orden de producción</label><input id="order" value={order} onChange={(e) => setOrder(e.target.value)} placeholder="Ej. OP-240981" autoFocus className="field-input font-mono" /><p className="mt-1.5 text-xs text-slate-400">Escanea o escribe el identificador de la orden.</p></div>
            <div><label className="field-label" htmlFor="part">Código / número de parte</label><input id="part" value={part} onChange={(e) => setPart(e.target.value)} placeholder="Ej. PN-RA-4102" className="field-input font-mono" /></div>
            <div><label className="field-label" htmlFor="sh">SH · Shipping Hub</label><input id="sh" value={sh} onChange={(e) => setSh(e.target.value)} placeholder="Ej. SH-MTY-01" className="field-input font-mono" /></div>
            <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end"><button type="button" onClick={() => { setOrder(""); setPart(""); setSh(""); }} className="secondary-action justify-center">Limpiar</button><button type="submit" className="primary-action justify-center"><ScanLine className="h-4 w-4" />Validar y registrar</button></div>
          </div>
        </form>

        <aside className="space-y-5">
          <div className="soft-card p-5 sm:p-6"><p className="eyebrow">Contexto de validación</p><div className="mt-5 space-y-4"><div className="flex gap-3"><div className="rounded-xl bg-emerald-50 p-2 text-emerald-600"><FileCheck2 className="h-5 w-5" /></div><div><p className="text-sm font-bold text-slate-800">Versión activa</p><p className="mt-1 text-xs text-slate-500">Producción · Septiembre v3</p></div></div><div className="grid grid-cols-2 gap-3 border-y border-slate-100 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">Usuario</p><p className="mt-1 text-sm font-semibold text-slate-700">María López</p></div><div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">Turno</p><p className="mt-1 text-sm font-semibold text-slate-700">Primer turno</p></div></div><p className="text-xs leading-5 text-slate-500">La hora se toma desde el navegador en este prototipo. En producción debe provenir del servidor.</p></div></div>
          {lastCapture ? <ResultCard record={lastCapture} /> : <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center"><PackageCheck className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-bold text-slate-600">Esperando lectura</p><p className="mx-auto mt-1 max-w-[220px] text-xs leading-5 text-slate-400">El resultado del match aparecerá aquí después de registrar el material.</p></div>}
        </aside>
      </div>
    </div>
  );
}

function ResultCard({ record }: { record: RecordItem }) {
  const success = record.match === "Coincide";
  return <div className={`overflow-hidden rounded-2xl border ${success ? "border-emerald-200 bg-emerald-50/70" : "border-rose-200 bg-rose-50/60"}`}><div className="p-5"><div className="flex items-start gap-3">{success ? <div className="rounded-xl bg-emerald-500 p-2 text-white"><CircleCheck className="h-5 w-5" /></div> : <div className="rounded-xl bg-rose-500 p-2 text-white"><CircleAlert className="h-5 w-5" /></div>}<div><p className={`text-sm font-bold ${success ? "text-emerald-900" : "text-rose-900"}`}>{success ? "Match correcto" : record.match}</p><p className={`mt-1 text-xs leading-5 ${success ? "text-emerald-700" : "text-rose-700"}`}>{success ? "La combinación coincide con el documento maestro activo." : record.reason}</p></div></div><div className={`mt-5 grid grid-cols-3 gap-2 border-t pt-4 text-center ${success ? "border-emerald-200" : "border-rose-200"}`}><div><p className="text-[10px] font-bold uppercase tracking-[.1em] opacity-60">Orden</p><p className="mt-1 truncate font-mono text-[10px] font-bold">{record.order}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[.1em] opacity-60">Parte</p><p className="mt-1 truncate font-mono text-[10px] font-bold">{record.part}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[.1em] opacity-60">SH</p><p className="mt-1 truncate font-mono text-[10px] font-bold">{record.sh}</p></div></div></div></div>;
}

function Supervision({ records, onReview }: { records: RecordItem[]; onReview: (id: string, state: ReviewState) => void }) {
  const [filter, setFilter] = useState<"Todos" | "Pendiente" | "Discrepancia">("Todos");
  const [selected, setSelected] = useState<RecordItem | null>(null);
  const displayed = records.filter((record) => filter === "Todos" || (filter === "Pendiente" ? record.review === "Pendiente" : record.match !== "Coincide"));
  const pending = records.filter((record) => record.review === "Pendiente").length;

  return <div className="space-y-7"><SectionHeader eyebrow="Validación operativa" title="Bandeja de supervisión" description="Confirma la salida de material, atiende discrepancias y conserva un historial de cada decisión." action={<div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{pending} pendientes de revisar</div>} />
    <div className="soft-card overflow-hidden"><div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between"><div className="flex flex-wrap gap-2">{(["Todos", "Pendiente", "Discrepancia"] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${filter === item ? "bg-[#0b5362] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{item === "Discrepancia" ? "Con discrepancia" : item}</button>)}</div><div className="relative w-full lg:w-72"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input placeholder="Buscar orden o parte" className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none transition focus:border-cyan-500 focus:ring-3 focus:ring-cyan-100" /></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left"><thead className="bg-slate-50/80 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-6 py-3">Hora</th><th className="px-5 py-3">Orden / material</th><th className="px-5 py-3">SH</th><th className="px-5 py-3">Operador</th><th className="px-5 py-3">Match</th><th className="px-6 py-3">Revisión / acción</th></tr></thead><tbody className="divide-y divide-slate-100">{displayed.map((record) => <RecordTableRow key={record.id} record={record} withActions onReview={onReview} onOpen={setSelected} />)}</tbody></table></div></div>
    {selected ? <ReviewModal record={selected} onClose={() => setSelected(null)} onReview={(state) => { onReview(selected.id, state); setSelected(null); }} /> : null}
  </div>;
}

function ReviewModal({ record, onClose, onReview }: { record: RecordItem; onClose: () => void; onReview: (state: ReviewState) => void }) {
  const [note, setNote] = useState("");
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"><div className="modal-enter w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 p-5"><div><p className="eyebrow">Detalle de captura</p><h2 className="mt-1 font-display text-xl font-semibold text-slate-900">Revisar registro #{String(record.id).slice(-4)}</h2></div><button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button></div><div className="space-y-5 p-5"><div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center"><div><p className="text-[10px] font-bold uppercase text-slate-400">Orden</p><p className="mt-1 font-mono text-xs font-bold text-slate-700">{record.order}</p></div><div><p className="text-[10px] font-bold uppercase text-slate-400">Parte</p><p className="mt-1 font-mono text-xs font-bold text-slate-700">{record.part}</p></div><div><p className="text-[10px] font-bold uppercase text-slate-400">SH</p><p className="mt-1 font-mono text-xs font-bold text-slate-700">{record.sh}</p></div></div><div className="rounded-xl border border-amber-100 bg-amber-50 p-3"><p className="text-xs font-bold text-amber-900">Resultado automático: {record.match}</p><p className="mt-1 text-xs leading-5 text-amber-800">{record.reason || "La combinación coincide con el documento maestro activo."}</p></div><div><label className="field-label">Motivo u observación</label><textarea value={note} onChange={(e) => setNote(e.target.value)} className="field-input min-h-24 resize-none font-sans" placeholder="Obligatorio para rechazo o excepción…" /></div></div><div className="flex flex-col-reverse gap-3 border-t border-slate-100 p-5 sm:flex-row sm:justify-end"><button onClick={() => { if (!note.trim()) { toast.error("Agrega un motivo antes de rechazar."); return; } onReview("Rechazado"); toast.success("Registro rechazado y enviado al historial."); }} className="secondary-action justify-center border-rose-200 text-rose-700 hover:bg-rose-50"><ShieldAlert className="h-4 w-4" />Rechazar</button><button onClick={() => { onReview("Confirmado"); toast.success("Salida de material confirmada."); }} className="primary-action justify-center"><Check className="h-4 w-4" />Confirmar salida</button></div></div></div>;
}

function Documents({ documents, user, profile, liveMode, onDocumentsChange }: { documents: MasterDocument[]; user: User; profile: Profile | null; liveMode: boolean; onDocumentsChange: (documents: MasterDocument[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("Producción · Septiembre v3.xlsx");
  const [isNew, setIsNew] = useState(false);
  async function handleFile(file?: File) {
    if (!file) return;
    if (!liveMode || !supabase || !profile) { setFileName(file.name); setIsNew(true); toast.success("Archivo seleccionado. Conecta Supabase para guardar la versión."); return; }
    try {
      const result = await importMasterDocument(file, user, profile);
      setFileName(result.document.nombre_archivo);
      setIsNew(true);
      onDocumentsChange([result.document, ...documents.filter((item) => item.id !== result.document.id)]);
      toast.success(result.storageWarning ? "Documento validado; crea el bucket para guardar el archivo original." : "Documento validado y activado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible importar el documento.");
    }
  }
  const activeDocument = documents.find((document) => document.estatus_importacion === "activo") || documents[0];
  return <div className="space-y-7"><SectionHeader eyebrow="Fuente de validación" title="Documentos maestros" description="Carga y revisa las versiones que definen las combinaciones válidas de orden, número de parte y SH." action={<button onClick={() => fileRef.current?.click()} className="primary-action"><UploadCloud className="h-4 w-4" />Cargar archivo</button>} />
    <input ref={fileRef} onChange={(e) => handleFile(e.target.files?.[0])} type="file" accept=".xlsx,.xls,.csv" className="hidden" />
    <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]"><div className="soft-card p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="text-sm font-bold text-slate-800">Versión activa</p><p className="mt-1 text-xs text-slate-500">La fuente usada por cada match del turno.</p></div><span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-600/15"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{activeDocument?.estatus_importacion === "activo" ? "Activa" : "Sin activar"}</span></div><div className="mt-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5 sm:flex-row sm:items-center"><div className="rounded-2xl bg-[#e8f7f2] p-3 text-[#0d7d6c]"><FileSpreadsheet className="h-7 w-7" /></div><div className="min-w-0 flex-1"><p className="truncate text-base font-bold text-slate-800">{activeDocument?.nombre_archivo || fileName}</p><p className="mt-1 text-xs text-slate-500">{activeDocument ? `${activeDocument.filas_validas.toLocaleString("es-MX")} filas válidas · ${activeDocument.filas_con_error} errores` : "1,284 filas válidas · demo"}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-slate-500"><span>{activeDocument ? `Subido · ${new Date(activeDocument.fecha_carga).toLocaleDateString("es-MX")}` : "Subido por Ana Torres"}</span><span>{activeDocument?.estatus_importacion || "activo"}</span></div></div><button onClick={() => toast.info("La descarga requiere un bucket privado y una URL firmada.")} className="secondary-action shrink-0"><Download className="h-4 w-4" />Descargar</button></div><div className="mt-5 grid grid-cols-3 gap-3"><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">Filas</p><p className="mt-1 font-display text-xl font-semibold text-slate-800">{activeDocument?.filas_validas?.toLocaleString("es-MX") || "1,284"}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">Errores</p><p className="mt-1 font-display text-xl font-semibold text-slate-800">{activeDocument?.filas_con_error || 0}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">Versiones</p><p className="mt-1 font-display text-xl font-semibold text-slate-800">{documents.length || 1}</p></div></div></div>
      <div onClick={() => fileRef.current?.click()} className="flex min-h-[310px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-cyan-200 bg-cyan-50/30 p-8 text-center transition hover:border-cyan-400 hover:bg-cyan-50"><div className="rounded-2xl bg-white p-4 text-[#0e7f8d] shadow-sm"><UploadCloud className="h-7 w-7" /></div><p className="mt-5 text-sm font-bold text-slate-700">Cargar una nueva versión</p><p className="mt-2 max-w-xs text-xs leading-5 text-slate-500">Arrastra un archivo CSV o Excel, o haz clic para seleccionarlo. Las filas serán validadas antes de activar la versión.</p><span className="mt-5 rounded-lg bg-[#0e7f8d] px-3 py-2 text-xs font-bold text-white">Seleccionar archivo</span></div></div>
    <div className="soft-card overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-5 sm:px-6"><div><p className="text-sm font-bold text-slate-800">Vista previa de referencia</p><p className="mt-1 text-xs text-slate-500">Ejemplo de las columnas que usaría el match automático.</p></div><span className="text-xs font-semibold text-slate-500">Mostrando 4 de 1,284 filas</span></div><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left"><thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-[.12em] text-slate-500"><tr><th className="px-6 py-3">Fila</th><th className="px-5 py-3">Orden</th><th className="px-5 py-3">Número de parte</th><th className="px-5 py-3">SH</th><th className="px-6 py-3">Estado</th></tr></thead><tbody className="divide-y divide-slate-100">{knownMaterials.map((item, index) => <tr key={item.order}><td className="px-6 py-4 text-xs text-slate-500">{index + 2}</td><td className="px-5 py-4 font-mono text-xs font-bold text-slate-700">{item.order}</td><td className="px-5 py-4 font-mono text-xs text-slate-600">{item.part}</td><td className="px-5 py-4 font-mono text-xs text-slate-600">{item.sh}</td><td className="px-6 py-4"><StatusPill state="Confirmado" /></td></tr>)}</tbody></table></div></div>
    {isNew ? <p className="rounded-xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-xs text-cyan-800"><strong>Simulación activa:</strong> el archivo seleccionado se muestra en la interfaz, pero no se guarda ni se procesa en un servidor.</p> : null}</div>;
}

function Reports({ records }: { records: RecordItem[] }) {
  const [range, setRange] = useState("Turno actual");
  const matches = records.filter((r) => r.match === "Coincide").length;
  const rate = Math.round((matches / records.length) * 100);
  function exportCsv() { const content = ["Hora,Orden,Numero de parte,SH,Operador,Match,Revision", ...records.map((r) => [r.time, r.order, r.part, r.sh, r.operator, r.match, r.review].join(","))].join("\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8;" })); link.download = "reporte-trazabilidad.csv"; link.click(); URL.revokeObjectURL(link.href); toast.success("Reporte CSV descargado."); }
  return <div className="space-y-7"><SectionHeader eyebrow="Indicadores operativos" title="Reportes y productividad" description="Consulta el desempeño hora por hora y exporta la información visible del prototipo." action={<div className="flex gap-2"><select value={range} onChange={(e) => setRange(e.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 outline-none focus:border-cyan-500"><option>Turno actual</option><option>Hoy</option><option>Esta semana</option></select><button onClick={exportCsv} className="primary-action"><Download className="h-4 w-4" />Exportar CSV</button></div>} />
    <div className="grid gap-4 sm:grid-cols-3"><MetricCard label="Tasa de match" value={`${rate}%`} hint="Combinaciones correctas en la muestra" color="emerald" icon={CircleCheck} /><MetricCard label="Discrepancias" value={`${records.filter((r) => r.match === "Discrepancia" || r.match === "No encontrado").length}`} hint="Registros que requieren atención" color="rose" icon={CircleAlert} /><MetricCard label="Productividad" value="17.4/h" hint="Promedio de capturas por operador" color="cyan" icon={UsersRound} /></div>
    <div className="soft-card p-5 sm:p-6"><div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-bold text-slate-800">Volumen y calidad de captura</p><p className="mt-1 text-xs text-slate-500">Comparativo de registros totales y coincidencias por bloque horario.</p></div><div className="mt-3 flex gap-4 text-[11px] font-semibold text-slate-500"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#0e7f8d]" />Capturas</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#35c79e]" />Matches</span></div></div><div className="mt-6 h-[330px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={hourlyData} margin={{ top: 10, right: 12, bottom: 0, left: -18 }}><CartesianGrid vertical={false} stroke="#e6edf1" strokeDasharray="3 3" /><XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fill: "#718096", fontSize: 11 }} dy={8} /><YAxis tickLine={false} axisLine={false} tick={{ fill: "#718096", fontSize: 11 }} /><Tooltip cursor={{ fill: "#f1f7f8" }} contentStyle={{ borderRadius: 12, border: "1px solid #dce9eb", boxShadow: "0 12px 24px rgba(15, 43, 56, .12)", fontSize: 12 }} /><Bar dataKey="registros" name="Capturas" fill="#0e7f8d" radius={[6, 6, 0, 0]} /><Bar dataKey="coincide" name="Matches" fill="#35c79e" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
    <div className="grid gap-5 xl:grid-cols-2"><div className="soft-card p-5 sm:p-6"><p className="text-sm font-bold text-slate-800">Desempeño por operador</p><div className="mt-5 space-y-4">{[{ name: "María López", total: 48, match: 95 }, { name: "Carlos Méndez", total: 44, match: 91 }, { name: "Hugo Ríos", total: 39, match: 87 }].map((person) => <div key={person.name}><div className="flex justify-between text-xs"><span className="font-semibold text-slate-700">{person.name}</span><span className="text-slate-500">{person.total} capturas · {person.match}% match</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-[#0e7f8d] to-[#35c79e]" style={{ width: `${person.match}%` }} /></div></div>)}</div></div><div className="soft-card p-5 sm:p-6"><p className="text-sm font-bold text-slate-800">Lectura del turno</p><div className="mt-5 space-y-4"><div className="flex gap-3 rounded-xl bg-emerald-50 p-3"><CircleCheck className="h-5 w-5 shrink-0 text-emerald-600" /><div><p className="text-xs font-bold text-emerald-900">Calidad dentro de objetivo</p><p className="mt-1 text-xs leading-5 text-emerald-700">La tasa de match se mantiene por encima del objetivo operativo de 90%.</p></div></div><div className="flex gap-3 rounded-xl bg-amber-50 p-3"><Clock3 className="h-5 w-5 shrink-0 text-amber-700" /><div><p className="text-xs font-bold text-amber-900">Revisión pendiente</p><p className="mt-1 text-xs leading-5 text-amber-700">Prioriza la confirmación de capturas pendientes para cerrar la trazabilidad de salida.</p></div></div></div></div></div></div>;
}

function HistoryView({ records }: { records: RecordItem[] }) {
  return <div className="space-y-7"><SectionHeader eyebrow="Auditoría operativa" title="Historial de registros" description="Consulta la trazabilidad de cada captura, incluyendo el resultado automático y la decisión de supervisión." action={<button onClick={() => toast.info("Filtros avanzados disponibles al conectar la base de datos.")} className="secondary-action"><Filter className="h-4 w-4" />Filtros avanzados</button>} />
    <div className="soft-card overflow-hidden"><div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><p className="text-sm font-bold text-slate-800">Registros del 10 de septiembre</p><p className="mt-1 text-xs text-slate-500">{records.length} movimientos mostrados · datos de demostración.</p></div><div className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input placeholder="Buscar en historial" className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none transition focus:border-cyan-500 focus:ring-3 focus:ring-cyan-100" /></div></div><div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left"><thead className="bg-slate-50/80 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-6 py-3">Fecha / hora</th><th className="px-5 py-3">Orden / material</th><th className="px-5 py-3">SH</th><th className="px-5 py-3">Usuario</th><th className="px-5 py-3">Match</th><th className="px-6 py-3">Revisado</th></tr></thead><tbody className="divide-y divide-slate-100">{records.map((record) => <tr key={record.id} className="transition hover:bg-slate-50/70"><td className="px-6 py-4"><p className="text-xs font-semibold text-slate-700">{record.date}</p><p className="mt-0.5 text-xs text-slate-500">{record.time}</p></td><td className="px-5 py-4"><p className="text-sm font-bold text-slate-800">{record.order}</p><p className="mt-0.5 font-mono text-[11px] text-slate-500">{record.part}</p></td><td className="px-5 py-4 font-mono text-xs text-slate-600">{record.sh}</td><td className="px-5 py-4 text-sm text-slate-600">{record.operator}</td><td className="px-5 py-4"><StatusPill state={record.match} /></td><td className="px-6 py-4"><StatusPill state={record.review} /></td></tr>)}</tbody></table></div></div></div>;
}

function SettingsView() {
  return <div className="space-y-7"><SectionHeader eyebrow="Parámetros del sistema" title="Configuración operativa" description="Vista de referencia para las reglas, roles y parámetros que podrán administrarse al conectar la base de datos." /><div className="grid gap-5 lg:grid-cols-2"><div className="soft-card p-5 sm:p-6"><div className="flex items-center gap-3"><div className="rounded-xl bg-violet-50 p-2 text-violet-700"><UsersRound className="h-5 w-5" /></div><div><p className="text-sm font-bold text-slate-800">Roles y permisos</p><p className="mt-0.5 text-xs text-slate-500">Perfiles previstos para el sistema.</p></div></div><div className="mt-5 space-y-3">{[["Operador", "Captura materiales y consulta sus registros."], ["Supervisor", "Revisa, confirma y rechaza salidas."], ["Administrador", "Gestiona usuarios, turnos y documentos maestros."]].map(([role, description]) => <div key={role} className="rounded-xl border border-slate-100 p-3"><p className="text-xs font-bold text-slate-800">{role}</p><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>)}</div></div><div className="soft-card p-5 sm:p-6"><div className="flex items-center gap-3"><div className="rounded-xl bg-cyan-50 p-2 text-cyan-700"><Settings className="h-5 w-5" /></div><div><p className="text-sm font-bold text-slate-800">Reglas de validación</p><p className="mt-0.5 text-xs text-slate-500">Comportamiento propuesto del match automático.</p></div></div><div className="mt-5 space-y-3">{[["Normalización", "Convertir a mayúsculas y eliminar espacios al comparar."], ["Duplicados", "Alertar si la misma combinación se captura nuevamente en el turno."], ["Excepciones", "Exigir comentario al rechazar o aprobar una discrepancia."]].map(([role, description]) => <div key={role} className="flex items-start gap-3 rounded-xl border border-slate-100 p-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><div><p className="text-xs font-bold text-slate-800">{role}</p><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div></div>)}</div></div></div><div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-xs leading-5 text-slate-500"><strong className="text-slate-700">Próxima etapa:</strong> al integrar autenticación y base de datos, estas opciones se conectarán a usuarios reales, reglas por planta, documentos versionados y bitácora persistente.</div></div>;
}

export default function Home({ user, profile, liveMode, signOut }: AuthContextValue) {
  const [view, setView] = useState<View>("panel");
  const [records, setRecords] = useState<RecordItem[]>(startingRecords);
  const [documents, setDocuments] = useState<MasterDocument[]>([]);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(profile);
  const [dataLoading, setDataLoading] = useState(liveMode);
  const [clock, setClock] = useState(getTime());
  const [mobileMenu, setMobileMenu] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const operatorName = currentProfile?.nombre_completo || user.email?.split("@")[0] || "María López";
  const isAdmin = currentProfile?.rol === "administrador";

  useEffect(() => { const timer = window.setInterval(() => setClock(getTime()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { setCurrentProfile(profile); }, [profile]);
  useEffect(() => {
    if (!liveMode || !profile) {
      setDataLoading(false);
      return;
    }
    let active = true;
    setDataLoading(true);
    void fetchTraceData(user, profile)
      .then((data) => {
        if (!active) return;
        setRecords(data.records);
        setDocuments(data.documents);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "No fue posible cargar los datos de Supabase."))
      .finally(() => { if (active) setDataLoading(false); });
    return () => { active = false; };
  }, [liveMode, profile, user]);
  const pendingCount = useMemo(() => records.filter((record) => record.review === "Pendiente").length, [records]);

  function addRecord(record: RecordItem) { setRecords((current) => [record, ...current]); }
  async function reviewRecord(id: string, review: ReviewState) {
    if (liveMode && supabase) {
      const nextStatus = review === "Confirmado" ? "confirmado" : review === "Rechazado" ? "rechazado" : "cancelado";
      const { data, error } = await supabase.rpc("confirmar_revision", { p_registro_id: id, p_nuevo_estatus: nextStatus, p_motivo: review === "Confirmado" ? null : "Revisión operativa desde TRAZA", p_observaciones: null });
      if (error) { toast.error(error.message); return; }
      const reviewed = Array.isArray(data) ? data[0] : data;
      if (reviewed) setRecords((current) => current.map((record) => record.id === id ? mapCaptureRow(reviewed) : record));
      if (review === "Confirmado") toast.success("Material marcado como enviado / salido de producción.");
      return;
    }
    setRecords((current) => current.map((record) => record.id === id ? { ...record, review } : record));
    if (review === "Confirmado") toast.success("Material marcado como enviado / salido de producción.");
  }
  const activeTitle = view === "usuarios" ? "Usuarios y permisos" : navigation.find((item) => item.id === view)?.label ?? "Configuración";

  return <div className="min-h-screen bg-[#f4f7f8] text-slate-800"><div className="industrial-grid fixed inset-0 pointer-events-none opacity-40" />
    <aside className={`sidebar-panel fixed inset-y-0 left-0 z-40 flex w-[278px] flex-col transition-transform duration-200 lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="border-b border-white/10 px-6 py-6"><div className="flex items-center gap-3"><div className={logoMarkClass()}><PackageCheck className="h-5 w-5" /></div><div><p className="font-display text-lg font-semibold tracking-tight text-white">TRAZA</p><p className="text-[10px] font-bold uppercase tracking-[.18em] text-cyan-200/70">Control de materiales</p></div></div></div>
      <nav className="flex-1 px-4 py-5"><p className="px-3 pb-3 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Operación</p><div className="space-y-1">{navigation.map((item) => { const Icon = item.icon; const isActive = view === item.id; return <button key={item.id} onClick={() => { setView(item.id); setMobileMenu(false); }} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${isActive ? "bg-white/12 text-white shadow-sm" : "text-slate-300 hover:bg-white/7 hover:text-white"}`}><Icon className={`h-4.5 w-4.5 ${isActive ? "text-cyan-200" : "text-slate-400 group-hover:text-cyan-200"}`} /><span className="flex-1">{item.label}</span>{item.id === "supervision" && pendingCount > 0 ? <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-300 px-1 text-[10px] font-extrabold text-amber-950">{pendingCount}</span> : null}</button>; })}</div><p className="mt-7 px-3 pb-3 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Sistema</p><button onClick={() => { setView("configuracion"); setMobileMenu(false); }} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${view === "configuracion" ? "bg-white/12 text-white" : "text-slate-300 hover:bg-white/7 hover:text-white"}`}><Settings className="h-4.5 w-4.5 text-slate-400 group-hover:text-cyan-200" />Configuración</button></nav>
      <ProfileMenu name={operatorName} role={currentProfile?.rol || "Operador"} isAdmin={isAdmin} open={profileMenuOpen} onToggle={() => setProfileMenuOpen((open) => !open)} onEditProfile={() => { setProfileMenuOpen(false); if (currentProfile) setProfileEditorOpen(true); else toast.info("El modo demo no tiene un perfil persistente."); }} onManageUsers={() => { setProfileMenuOpen(false); setView("usuarios"); }} onSignOut={() => { setProfileMenuOpen(false); void signOut(); }} />
    </aside>
    {mobileMenu ? <button aria-label="Cerrar menú" onClick={() => setMobileMenu(false)} className="fixed inset-0 z-30 bg-slate-950/35 lg:hidden" /> : null}
    <main className="relative min-h-screen lg:pl-[278px]"><header className="sticky top-0 z-20 flex h-[74px] items-center justify-between border-b border-slate-200/80 bg-[#f9fbfb]/85 px-4 backdrop-blur-xl sm:px-7 lg:px-9"><div className="flex items-center gap-3"><button onClick={() => setMobileMenu(true)} aria-label="Abrir menú" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"><LayoutDashboard className="h-5 w-5" /></button><div><p className="text-xs font-bold text-slate-700 sm:text-sm">{activeTitle}</p><p className="mt-0.5 hidden text-[11px] text-slate-400 sm:block">Planta Monterrey · Primer turno</p></div></div><div className="flex items-center gap-3"><div className="hidden text-right sm:block"><p className="text-xs font-semibold capitalize text-slate-700">{clock}</p><p className="mt-0.5 text-[10px] text-slate-400">Hora de estación</p></div><button onClick={() => toast.info("No hay notificaciones nuevas en esta demostración.")} className="relative rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 shadow-sm transition hover:border-cyan-200 hover:text-[#0e7f8d]"><Bell className="h-4 w-4" /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-amber-400 ring-2 ring-white" /></button></div></header>
      <div className="mx-auto max-w-[1550px] px-4 py-7 sm:px-7 lg:px-9 lg:py-9">{dataLoading ? <div className="mb-5 flex items-center gap-2 rounded-xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-xs font-semibold text-cyan-800"><div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-600 border-t-transparent" />Sincronizando con Supabase…</div> : null}{!liveMode ? <div className="mb-5 flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800"><CircleAlert className="h-4 w-4" />Modo demo: agrega las variables de Supabase para usar datos reales.</div> : null}{view === "panel" && <Panel records={records} setView={setView} activeDocument={documents.find((document) => document.estatus_importacion === "activo")} />}{view === "captura" && <Capture onCapture={addRecord} user={user} profile={currentProfile} liveMode={liveMode} operatorName={operatorName} />}{view === "supervision" && <Supervision records={records} onReview={reviewRecord} />}{view === "documentos" && <Documents documents={documents} user={user} profile={currentProfile} liveMode={liveMode} onDocumentsChange={setDocuments} />}{view === "reportes" && <Reports records={records} />}{view === "historial" && <HistoryView records={records} />}{view === "usuarios" && <UsersAdmin liveMode={liveMode && isAdmin} currentUserId={user.id} onBack={() => setView("panel")} />}{view === "configuracion" && <SettingsView />}</div>
      {profileEditorOpen && currentProfile ? <ProfileEditorModal userId={user.id} profile={currentProfile} onClose={() => setProfileEditorOpen(false)} onSaved={(updated) => setCurrentProfile(updated)} /> : null}
      <footer className="mx-4 border-t border-slate-200/80 py-5 text-center text-[11px] text-slate-400 sm:mx-7 lg:mx-9">TRAZA · Prototipo frontend con datos simulados · Sin base de datos ni almacenamiento persistente.</footer>
    </main>
  </div>;
}
