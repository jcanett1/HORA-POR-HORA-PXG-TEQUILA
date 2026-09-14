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
  FileScan,
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
import type { MasterDocument, Profile, ProductionCell } from "@/lib/database.types";
import { fetchTraceData, findAccessoryReferences, findExistingShRecords, importMasterDocument, mapCaptureRow, type AccessoryReference, type ReferenceRow } from "@/lib/trace-data";
import { listJaulaStates } from "@/lib/jaula-data";
import { getJaulaPartStatus, type JaulaStateMap } from "@/lib/jaulaStorage";
import { supabase } from "@/lib/supabase";
import { ProfileEditorModal, ProfileMenu, UsersAdmin } from "@/components/ProfileAndUsers";
import StreamlitePdfView from "@/pages/StreamlitePdfView";
import JaulaView from "@/pages/JaulaView";

type View =
  | "panel"
  | "captura"
  | "supervision"
  | "documentos"
  | "jaula"
  | "reportes"
  | "streamlite"
  | "historial"
  | "usuarios"
  | "configuracion";

type MatchState = "Coincide" | "Discrepancia" | "No encontrado" | "Duplicado";
type ReviewState = "Pendiente" | "Confirmado" | "Rechazado" | "Cancelado";

type RecordItem = {
  id: string;
  capturedAt: string;
  time: string;
  date: string;
  order: string;
  part: string;
  sh: string;
  quantity: number;
  cell: string | null;
  operator: string;
  match: MatchState;
  reason?: string;
  review: ReviewState;
  document: string;
};

type MasterGroup = {
  order: string;
  sh: string;
  parts: ReferenceRow[];
};


const navigation: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "panel", label: "Panel de control", icon: LayoutDashboard },
  { id: "captura", label: "Registro hora por hora", icon: Clock3 },
  { id: "supervision", label: "Supervisión", icon: ShieldCheck },
  { id: "documentos", label: "Documentos maestros", icon: FileSpreadsheet },
  { id: "jaula", label: "JAULA", icon: Archive },
  { id: "reportes", label: "Reportes", icon: BarChart3 },
  { id: "streamlite", label: "Streamlite · PDFs", icon: FileScan },
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

function registrationKey(order: string, sh: string, part: string) {
  return [order, sh, part].map((value) => value.trim().replace(/\s+/g, " ").toUpperCase()).join("|||");
}

function buildHourlyData(records: RecordItem[]) {
  return Array.from({ length: 12 }, (_, index) => {
    const hour = index + 6;
    const hourRecords = records.filter((record) => new Date(record.capturedAt).getHours() === hour);
    const orders = new Set(hourRecords.map((record) => `${record.cell || "Sin celda"}|||${record.order}`));
    return {
      hour: `${String(hour).padStart(2, "0")}:00`,
      registros: hourRecords.length,
      coincide: hourRecords.filter((record) => record.match === "Coincide").length,
      ordenes: orders.size,
      piezas: hourRecords.reduce((sum, record) => sum + record.quantity, 0),
    };
  });
}

function isRecordInRange(record: RecordItem, range: string) {
  const capturedAt = new Date(record.capturedAt);
  const now = new Date();
  if (range === "Hoy") {
    return capturedAt.toDateString() === now.toDateString();
  }
  if (range === "Esta semana") {
    const startOfWeek = new Date(now);
    const day = startOfWeek.getDay();
    startOfWeek.setDate(startOfWeek.getDate() - (day === 0 ? 6 : day - 1));
    startOfWeek.setHours(0, 0, 0, 0);
    return capturedAt >= startOfWeek;
  }
  const isToday = capturedAt.toDateString() === now.toDateString();
  const hour = capturedAt.getHours();
  return isToday && hour >= 6 && hour < 18;
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

function RegistrationPill({ registered }: { registered: boolean }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${registered ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15" : "bg-amber-50 text-amber-800 ring-amber-600/15"}`}><span className={`h-1.5 w-1.5 rounded-full ${registered ? "bg-emerald-500" : "bg-amber-500"}`} />{registered ? "Registrado" : "Pendiente"}</span>;
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
  const hourlyData = buildHourlyData(records);
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
        <MetricCard label="Capturas de hoy" value={`${records.length}`} hint="Registros sincronizados desde Supabase" color="cyan" icon={PackageCheck} />
        <MetricCard label="Match correcto" value={`${records.length ? ((matched / records.length) * 100).toFixed(1) : "0.0"}%`} hint={`${matched} de ${records.length} registros cargados`} color="emerald" icon={CircleCheck} />
        <MetricCard label="Por revisar" value={`${pending}`} hint="Requieren decisión de supervisor" color="amber" icon={Clock3} />
        <MetricCard label="Confirmados" value={`${confirmed}`} hint="Materiales con salida validada" color="rose" icon={ShieldCheck} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_0.95fr]">
        <div className="soft-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-slate-800">Ritmo de captura por hora</p>
              <p className="mt-1 text-xs text-slate-500">Registros procesados durante el turno PXG TEQUILA.</p>
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
              <div className="min-w-0"><p className="truncate text-sm font-bold text-emerald-950">{activeDocument?.nombre_archivo || "Sin documento activo"}</p><p className="mt-0.5 text-xs text-emerald-700">{activeDocument ? `${activeDocument.filas_validas.toLocaleString("es-MX")} relaciones válidas` : "Carga un documento maestro para activar el match"}</p></div>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <div className="flex justify-between text-xs"><span className="text-slate-500">Activado por</span><span className="font-semibold text-slate-700">—</span></div>
            <div className="flex justify-between text-xs"><span className="text-slate-500">Última actualización</span><span className="font-semibold text-slate-700">—</span></div>
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
          <table className="w-full min-w-[820px] text-left">
            <thead className="bg-slate-50/80 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-6 py-3">Hora</th><th className="px-5 py-3">Celda</th><th className="px-5 py-3">Orden / material</th><th className="px-5 py-3">SH</th><th className="px-5 py-3">Operador</th><th className="px-5 py-3">Match</th><th className="px-6 py-3">Revisión</th></tr></thead>
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
      <td className="px-5 py-4"><span className="rounded-full bg-cyan-50 px-2.5 py-1 text-[11px] font-bold text-cyan-800">{record.cell || "Sin celda"}</span></td>
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

function Capture({ onCapture, records, user, profile, liveMode, operatorName, onProfileChange }: { onCapture: (record: RecordItem) => void; records: RecordItem[]; user: User; profile: Profile | null; liveMode: boolean; operatorName: string; onProfileChange: (profile: Profile) => void }) {
  const [order, setOrder] = useState("");
  const [part, setPart] = useState("");
  const [sh, setSh] = useState("");
  const [quantity, setQuantity] = useState("");
  const [withoutAccessory, setWithoutAccessory] = useState(false);
  const [accessoryRows, setAccessoryRows] = useState<Array<{ reference: AccessoryReference; code: string; quantity: string }>>([]);
  const [existingShRecords, setExistingShRecords] = useState<Array<{ id: string; fecha_hora_captura: string; celda: string | null; numero_parte_original: string }>>([]);
  const [jaulaStates, setJaulaStates] = useState<JaulaStateMap>({});
  const [jaulaBusy, setJaulaBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lastCapture, setLastCapture] = useState<RecordItem | null>(null);
  const [cellSaving, setCellSaving] = useState(false);
  const [currentHour] = useState(() => new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }));
  const previousSh = useRef("");
  const registeredParts = useMemo(() => new Set([...records.map((record) => registrationKey(record.order, record.sh, record.part)), ...existingShRecords.map((record) => registrationKey(order, sh, record.numero_parte_original))]), [records, existingShRecords, order, sh]);

  function isAccessoryRegistered(row: { reference: AccessoryReference; code: string }) {
    return registeredParts.has(registrationKey(row.reference.order, sh, row.reference.code));
  }

  function getAccessoryJaulaStatus(row: { reference: AccessoryReference; code: string }) {
    return getJaulaPartStatus(jaulaStates, row.reference.order, sh, row.reference.code);
  }

  function isAccessoryReleased(row: { reference: AccessoryReference; code: string }) {
    const status = getAccessoryJaulaStatus(row);
    return status === "liberado" || status === "recogido";
  }

  useEffect(() => {
    const normalizedSh = sh.trim().toUpperCase();
    if (!normalizedSh) {
      previousSh.current = "";
      setOrder("");
      setWithoutAccessory(false);
      setAccessoryRows([]);
      setExistingShRecords([]);
      setLookupError("");
      return;
    }
    if (normalizedSh !== previousSh.current) {
      previousSh.current = normalizedSh;
      setWithoutAccessory(false);
      if (order) {
        setOrder("");
        setAccessoryRows([]);
        setExistingShRecords([]);
        return;
      }
    }
    if (!liveMode || !profile) {
      setAccessoryRows([]);
      setExistingShRecords([]);
      setLookupError("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLookupBusy(true);
      setJaulaBusy(true);
      void Promise.allSettled([findAccessoryReferences(sh, order, profile), findExistingShRecords(sh, order), listJaulaStates(profile.planta, profile.area)])
        .then(([accessoryResult, existingResult, jaulaResult]) => {
          if (cancelled) return;
          const errors: string[] = [];
          if (accessoryResult.status === "fulfilled") {
            const linkedOrders = Array.from(new Set(accessoryResult.value.map((reference) => reference.order).filter(Boolean)));
            if (!order.trim() && linkedOrders.length === 1) setOrder(linkedOrders[0]);
            setAccessoryRows(accessoryResult.value.length ? accessoryResult.value.map((reference) => ({ reference, code: reference.code, quantity: reference.expectedQuantity === null ? "" : String(reference.expectedQuantity) })) : []);
          } else {
            errors.push(accessoryResult.reason instanceof Error ? accessoryResult.reason.message : "No fue posible consultar los accesorios del SH.");
          }
          if (existingResult.status === "fulfilled") setExistingShRecords(existingResult.value);
          else errors.push(existingResult.reason instanceof Error ? existingResult.reason.message : "No fue posible revisar si el SH ya fue ingresado.");
          if (jaulaResult.status === "fulfilled") setJaulaStates(jaulaResult.value);
          else errors.push(jaulaResult.reason instanceof Error ? jaulaResult.reason.message : "No fue posible revisar si los accesorios fueron liberados por JAULA.");
          setLookupError(errors.join(" | "));
        })
        .finally(() => { if (!cancelled) { setLookupBusy(false); setJaulaBusy(false); } });
    }, 450);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [liveMode, profile, order, sh]);

  async function selectCell(cell: ProductionCell) {
    if (!supabase || !profile || profile.celda) return;
    setCellSaving(true);
    const { data, error } = await supabase.rpc("seleccionar_celda", { p_celda: cell });
    setCellSaving(false);
    if (error) { toast.error(error.message); return; }
    const updated = Array.isArray(data) ? data[0] : data;
    if (updated) { onProfileChange(updated as Profile); toast.success(`Usuario asignado a ${cell}.`); }
  }

  async function submitCapture(event: React.FormEvent) {
    event.preventDefault();
    if (!order || !sh) { toast.error("Completa la Orden y el SH para continuar."); return; }
    if (!liveMode || !supabase) { toast.error("Supabase no está conectado. Configura las variables del despliegue para comenzar a registrar datos reales."); return; }
    if (!profile?.celda) { toast.error("Selecciona una celda antes de registrar materiales."); return; }
    const generalEntry = withoutAccessory || accessoryRows.length === 0 && !part.trim();
    const pendingAccessoryRows = generalEntry ? [] : accessoryRows.filter((row) => !isAccessoryRegistered(row));
    if (!generalEntry && accessoryRows.length > 0 && pendingAccessoryRows.length === 0) { toast.info("Todos los accesorios de este SO y SH ya fueron registrados."); return; }
    if (generalEntry && Number(quantity) !== 0) { toast.error("Un registro sin accesorio debe llevar cantidad 0."); return; }
    const blockedByJaula = pendingAccessoryRows.filter((row) => !isAccessoryReleased(row));
    if (blockedByJaula.length > 0) {
      toast.error(`JAULA debe liberar primero: ${blockedByJaula.map((row) => row.code).join(", ")}.`);
      return;
    }
    if (pendingAccessoryRows.length === 0 && (quantity.trim() === "" || Number.isNaN(Number(quantity)) || Number(quantity) < 0)) { toast.error("Captura una cantidad válida; puede ser 0 si la celda no lleva accesorio."); return; }
    const items = pendingAccessoryRows.length > 0
      ? pendingAccessoryRows.map((row) => ({ code: row.code.trim(), quantity: row.quantity }))
      : [{ code: part.trim(), quantity }];
    if (items.some((item) => Number.isNaN(Number(item.quantity)) || Number(item.quantity) < 0 || (pendingAccessoryRows.length > 0 && !item.code))) { toast.error("Cada accesorio debe tener código y cantidad válida."); return; }

    const created: RecordItem[] = [];
    for (const item of items) {
      const { data, error } = await supabase.rpc("registrar_captura", {
        p_orden: order,
        p_numero_parte: item.code,
        p_sh: sh,
        p_planta: profile.planta || "Monterrey",
        p_area: profile.area || "Produccion",
        p_turno_id: null,
        p_observaciones: !generalEntry && accessoryRows.length > 0 ? `Accesorio del SH ${sh}` : item.code ? null : `Registro general por hora sin accesorio para SH ${sh}`,
        p_idempotency_key: crypto.randomUUID(),
        p_cantidad: Number(item.quantity),
      });
      if (error) { toast.error(`No se pudo registrar ${item.code}: ${error.message}`); return; }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) { toast.error(`Supabase no devolvió el registro de ${item.code}.`); return; }
      const record = mapCaptureRow({ ...row, perfiles_usuarios: { nombre_completo: operatorName } });
      created.push(record);
      onCapture(record);
    }
    const last = created[created.length - 1];
    if (last) setLastCapture(last);
    setOrder(""); setPart(""); setSh(""); setQuantity(""); setWithoutAccessory(false); setAccessoryRows([]);
    toast.success(created.length > 1 ? `${created.length} accesorios registrados; match guardado por separado.` : last?.match === "Coincide" ? "Match correcto registrado" : "Registro hora por hora guardado para revisión");
  }

  function updateAccessory(index: number, field: "code" | "quantity", value: string) {
    setAccessoryRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  return <div className="space-y-7">
    <SectionHeader eyebrow="Bitácora operativa" title="Registro hora por hora" description="Escribe el SH para consultar automáticamente los accesorios que lleva. Después confirma la Orden y la cantidad; los reportes calcularán automáticamente la producción por hora y celda." />
    <div className="grid gap-5 xl:grid-cols-[1.4fr_.8fr]">
      <form onSubmit={submitCapture} className="soft-card overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4 sm:px-7"><div className="flex items-center gap-3"><div className="rounded-xl bg-[#0e7f8d] p-2 text-white"><Clock3 className="h-5 w-5" /></div><div><p className="text-sm font-bold text-slate-800">Captura de producción</p><p className="mt-0.5 text-xs text-slate-500">La consulta inicia con el SH y puede mostrar accesorios de uno o varios SO. La Orden confirma cuál grupo vas a registrar.</p></div></div></div>
        <div className="space-y-5 p-5 sm:p-7">
          <div className="grid gap-4 sm:grid-cols-2"><div><label className="field-label" htmlFor="hour">Hora registrada</label><input id="hour" value={currentHour} readOnly className="field-input bg-slate-50 font-mono" /></div><div><label className="field-label">Celda de trabajo</label><div className="flex h-[42px] items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-700">{profile?.celda || "Sin asignar"}</div></div></div>
          {!profile?.celda ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-bold text-amber-900">Selecciona tu celda de trabajo</p><p className="mt-1 text-xs leading-5 text-amber-800">Esta selección se guarda una sola vez. Después solo un administrador podrá cambiarla.</p><div className="mt-3 grid grid-cols-2 gap-2">{(["CELDA 16", "CELDA 15", "CELDA 11", "CELDA 10"] as ProductionCell[]).map((cell) => <button key={cell} type="button" disabled={cellSaving} onClick={() => void selectCell(cell)} className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 transition hover:border-amber-500 hover:bg-amber-100">{cell}</button>)}</div></div> : <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Celda asignada por sistema: <strong>{profile.celda}</strong>. Solo un administrador puede cambiarla.</div>}
          <div className="grid gap-4 sm:grid-cols-2"><div><label className="field-label" htmlFor="sh">SH</label><input id="sh" value={sh} onChange={(e) => setSh(e.target.value)} placeholder="Ej. SH2830416" className="field-input font-mono" /></div><div><label className="field-label" htmlFor="quantity">Cantidad total / cantidad del accesorio</label><input id="quantity" type="number" min="0" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={accessoryRows.length > 0 && !withoutAccessory ? "Captúrala en cada accesorio" : "Ej. 0"} disabled={accessoryRows.length > 0 && !withoutAccessory} className="field-input font-mono disabled:bg-slate-50" /></div></div>
          {accessoryRows.length > 0 ? <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-cyan-100 bg-cyan-50/60 px-3 py-3 text-xs text-cyan-900"><input type="checkbox" checked={withoutAccessory} onChange={(event) => { setWithoutAccessory(event.target.checked); if (event.target.checked) { setQuantity("0"); setPart(""); } }} className="mt-0.5 h-4 w-4 accent-cyan-700" /><span><strong>Registrar sin accesorio</strong><br /><span className="text-cyan-800">Guarda únicamente el SH y la Orden con cantidad 0; este registro no hará match ni solicitará liberación de JAULA.</span></span></label> : null}
          <div className="grid gap-4 sm:grid-cols-2"><div><label className="field-label" htmlFor="order">Orden de producción · se llena con el SH</label><input id="order" value={order} onChange={(e) => setOrder(e.target.value)} placeholder="Se asigna automáticamente" autoFocus className="field-input font-mono" /><p className="mt-1 text-[11px] text-slate-500">Si el SH pertenece a una sola Orden, se completa automáticamente. Si pertenece a varias, selecciona la correcta.</p></div>{accessoryRows.length === 0 || withoutAccessory ? <div><label className="field-label" htmlFor="part">Fulbag o accesorio · opcional</label><input id="part" value={part} onChange={(e) => setPart(e.target.value)} placeholder="Déjalo vacío si no lleva accesorio" className="field-input font-mono" /><p className="mt-1 text-[11px] text-slate-500">Sin accesorio se guarda como registro horario sin match.</p></div> : <div className="flex items-end rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-800">Se encontraron {accessoryRows.length} accesorios para este SH{order ? " + orden" : ""}. {order ? "Orden ligada cargada automáticamente." : "Selecciona la Orden antes de registrar."}</div>}</div>
          {lookupBusy ? <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">Consultando accesorios del documento maestro…</div> : null}
          {lookupError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">Detalle de consulta: {lookupError}</div> : null}
          {existingShRecords.length > 0 ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-bold text-amber-900">Este SH ya fue ingresado</p><p className="mt-1 text-xs leading-5 text-amber-800">Se encontraron {existingShRecords.length} registro(s) para <strong>{sh}</strong>. Puedes revisar el historial antes de registrar otro accesorio; si repites el mismo SH + accesorio, el sistema lo marcará como duplicado.</p></div> : null}
          {accessoryRows.length > 0 && !withoutAccessory ? <div className="rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-cyan-950">Accesorios que debes capturar</p><p className="mt-1 text-xs text-cyan-800">Primero solicita cada accesorio en JAULA. Solo los accesorios con estado <strong>Liberado</strong> o <strong>Ya recogido</strong> permiten capturar cantidad y validar el registro.</p></div><span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-cyan-800">{accessoryRows.length} encontrados</span></div>{jaulaBusy ? <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500">Consultando autorización de JAULA…</div> : null}{accessoryRows.some((row) => !isAccessoryRegistered(row) && !isAccessoryReleased(row)) ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">Registro bloqueado: hay accesorios que todavía no han sido liberados por JAULA.</div> : null}<div className="mt-4 grid gap-3 md:grid-cols-2">{accessoryRows.map((row, index) => { const registered = isAccessoryRegistered(row); const jaulaStatus = getAccessoryJaulaStatus(row); const released = isAccessoryReleased(row); return <div key={`${row.reference.id}-${row.reference.order}`} className={`rounded-xl border p-3 ${registered || jaulaStatus === "recogido" ? "border-emerald-200 bg-emerald-50/75" : released ? "border-cyan-200 bg-cyan-50/75" : "border-amber-200 bg-amber-50/70"}`}><div className="mb-2 flex items-center justify-between gap-2"><span className={`text-[10px] font-bold uppercase tracking-[.1em] ${registered || released ? "text-emerald-700" : "text-amber-700"}`}>Accesorio {index + 1} · SO {row.reference.order}</span>{registered ? <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-bold text-emerald-700"><Check className="h-3 w-3" />Ya registrado</span> : released ? <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-bold text-cyan-800"><Check className="h-3 w-3" />JAULA: {jaulaStatus === "recogido" ? "Ya recogido" : "Liberado"}</span> : <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-amber-800">JAULA: Pendiente</span>}</div><div className="grid gap-2 sm:grid-cols-2"><input aria-label={`Código accesorio ${index + 1}`} value={row.code} onChange={(e) => updateAccessory(index, "code", e.target.value)} disabled={registered || !released} className={`field-input font-mono text-xs disabled:cursor-not-allowed disabled:border-amber-200 disabled:bg-amber-100 disabled:text-amber-800 ${registered || released ? "border-emerald-200 bg-white text-slate-800" : ""}`} placeholder={released ? "Código" : "Bloqueado por JAULA"} /><input aria-label={`Cantidad accesorio ${index + 1}`} type="number" min="0" step="0.001" value={row.quantity} onChange={(e) => updateAccessory(index, "quantity", e.target.value)} disabled={registered || !released} className={`field-input font-mono text-xs disabled:cursor-not-allowed disabled:border-amber-200 disabled:bg-amber-100 disabled:text-amber-800 ${registered || released ? "border-emerald-200 bg-white text-slate-800" : ""}`} placeholder={released ? "Cantidad" : "Solicita en JAULA"} /></div></div>; })}</div></div> : null}
          <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end"><button type="button" onClick={() => { setOrder(""); setPart(""); setSh(""); setQuantity(""); setWithoutAccessory(false); setAccessoryRows([]); setJaulaStates({}); }} className="secondary-action justify-center">Limpiar</button><button type="submit" disabled={jaulaBusy && !withoutAccessory || (accessoryRows.length > 0 && !withoutAccessory && accessoryRows.some((row) => !isAccessoryRegistered(row) && !isAccessoryReleased(row)))} className="primary-action justify-center disabled:cursor-not-allowed disabled:opacity-50"><ScanLine className="h-4 w-4" />Validar y registrar</button></div>
        </div>
      </form>
      <aside className="space-y-5"><div className="soft-card p-5 sm:p-6"><p className="eyebrow">Contexto de validación</p><div className="mt-5 space-y-4"><div className="flex gap-3"><div className="rounded-xl bg-emerald-50 p-2 text-emerald-600"><FileCheck2 className="h-5 w-5" /></div><div><p className="text-sm font-bold text-slate-800">Match de material</p><p className="mt-1 text-xs text-slate-500">SH + Fulbag/accesorio</p></div></div><div className="grid grid-cols-2 gap-3 border-y border-slate-100 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">Usuario</p><p className="mt-1 text-sm font-semibold text-slate-700">{operatorName}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">Celda</p><p className="mt-1 text-sm font-semibold text-slate-700">{profile?.celda || "Sin asignar"}</p></div></div><p className="text-xs leading-5 text-slate-500">La orden se conserva para trazabilidad, pero no cambia el resultado del match.</p></div></div>{lastCapture ? <ResultCard record={lastCapture} /> : <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center"><PackageCheck className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-bold text-slate-600">Esperando lectura</p><p className="mx-auto mt-1 max-w-[220px] text-xs leading-5 text-slate-400">El resultado del match aparecerá aquí después de registrar el material.</p></div>}</aside>
    </div>
  </div>;
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
      <div className="overflow-x-auto"><table className="w-full min-w-[930px] text-left"><thead className="bg-slate-50/80 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-6 py-3">Hora</th><th className="px-5 py-3">Celda</th><th className="px-5 py-3">Orden / material</th><th className="px-5 py-3">SH</th><th className="px-5 py-3">Operador</th><th className="px-5 py-3">Match</th><th className="px-6 py-3">Revisión / acción</th></tr></thead><tbody className="divide-y divide-slate-100">{displayed.map((record) => <RecordTableRow key={record.id} record={record} withActions onReview={onReview} onOpen={setSelected} />)}</tbody></table></div></div>
    {selected ? <ReviewModal record={selected} onClose={() => setSelected(null)} onReview={(state) => { onReview(selected.id, state); setSelected(null); }} /> : null}
  </div>;
}

function ReviewModal({ record, onClose, onReview }: { record: RecordItem; onClose: () => void; onReview: (state: ReviewState) => void }) {
  const [note, setNote] = useState("");
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"><div className="modal-enter w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 p-5"><div><p className="eyebrow">Detalle de captura</p><h2 className="mt-1 font-display text-xl font-semibold text-slate-900">Revisar registro #{String(record.id).slice(-4)}</h2></div><button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button></div><div className="space-y-5 p-5"><div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center"><div><p className="text-[10px] font-bold uppercase text-slate-400">Orden</p><p className="mt-1 font-mono text-xs font-bold text-slate-700">{record.order}</p></div><div><p className="text-[10px] font-bold uppercase text-slate-400">Parte</p><p className="mt-1 font-mono text-xs font-bold text-slate-700">{record.part}</p></div><div><p className="text-[10px] font-bold uppercase text-slate-400">SH</p><p className="mt-1 font-mono text-xs font-bold text-slate-700">{record.sh}</p></div></div><div className="rounded-xl border border-amber-100 bg-amber-50 p-3"><p className="text-xs font-bold text-amber-900">Resultado automático: {record.match}</p><p className="mt-1 text-xs leading-5 text-amber-800">{record.reason || "La combinación coincide con el documento maestro activo."}</p></div><div><label className="field-label">Motivo u observación</label><textarea value={note} onChange={(e) => setNote(e.target.value)} className="field-input min-h-24 resize-none font-sans" placeholder="Obligatorio para rechazo o excepción…" /></div></div><div className="flex flex-col-reverse gap-3 border-t border-slate-100 p-5 sm:flex-row sm:justify-end"><button onClick={() => { if (!note.trim()) { toast.error("Agrega un motivo antes de rechazar."); return; } onReview("Rechazado"); toast.success("Registro rechazado y enviado al historial."); }} className="secondary-action justify-center border-rose-200 text-rose-700 hover:bg-rose-50"><ShieldAlert className="h-4 w-4" />Rechazar</button><button onClick={() => { onReview("Confirmado"); toast.success("Salida de material confirmada."); }} className="primary-action justify-center"><Check className="h-4 w-4" />Confirmar salida</button></div></div></div>;
}

function MasterGroupCard({ group, registeredParts }: { group: MasterGroup; registeredParts: Set<string> }) {
  const registeredCount = group.parts.filter((part) => registeredParts.has(registrationKey(group.order, group.sh, part.numero_parte_original))).length;
  const complete = registeredCount === group.parts.length;
  return <div className={`rounded-2xl border p-4 transition ${complete ? "border-emerald-200 bg-emerald-50/70 shadow-[0_8px_20px_rgba(16,185,129,.08)]" : registeredCount > 0 ? "border-cyan-200 bg-cyan-50/45" : "border-amber-100 bg-amber-50/50"}`}><div className="flex items-start justify-between gap-3"><div><p className={`text-[10px] font-bold uppercase tracking-[.12em] ${complete ? "text-emerald-700" : "text-amber-700"}`}>Orden ligada</p><p className="mt-1 font-mono text-sm font-bold text-slate-800">{group.order}</p></div><div className="flex flex-col items-end gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${complete ? "bg-white text-emerald-800" : "bg-white text-amber-800"}`}>{registeredCount}/{group.parts.length} registrados</span><RegistrationPill registered={complete} /></div></div><p className="mt-3 font-mono text-xs font-bold text-slate-700">SH · {group.sh}</p><div className="mt-3 flex flex-wrap gap-1.5">{group.parts.map((part) => { const registered = registeredParts.has(registrationKey(group.order, group.sh, part.numero_parte_original)); return <span key={part.id} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-mono text-[10px] font-semibold ${registered ? "border-emerald-200 bg-emerald-100 text-emerald-800" : "border-amber-100 bg-white text-slate-600"}`}>{part.numero_parte_original}{registered ? <Check className="h-3 w-3" /> : null}</span>; })}</div></div>;
}

function Documents({ documents, references, records, user, profile, liveMode, onDocumentsChange, onReferencesChange }: { documents: MasterDocument[]; references: ReferenceRow[]; records: RecordItem[]; user: User; profile: Profile | null; liveMode: boolean; onDocumentsChange: (documents: MasterDocument[]) => void; onReferencesChange: (references: ReferenceRow[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("Sin archivo seleccionado");
  const [isNew, setIsNew] = useState(false);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState<10 | 20>(10);
  const [page, setPage] = useState(1);

  async function handleFile(file?: File) {
    if (!file) return;
    if (!liveMode || !supabase || !profile) { setFileName(file.name); setIsNew(true); toast.success("Archivo seleccionado. Conecta Supabase para guardar la versión."); return; }
    try {
      const result = await importMasterDocument(file, user, profile);
      setFileName(result.document.nombre_archivo);
      setIsNew(true);
      onDocumentsChange([result.document, ...documents.filter((item) => item.id !== result.document.id)]);
      const knownReferenceIds = new Set(references.map((item) => item.id));
      onReferencesChange([...references, ...result.references.filter((item) => !knownReferenceIds.has(item.id))]);
      toast.success(result.storageWarning ? `Archivo agregado: ${result.references.length} referencias nuevas. Crea el bucket para guardar el original.` : `Archivo agregado: ${result.references.length} referencias nuevas. Los SH anteriores se conservaron.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible importar el documento.");
    }
  }

  const activeDocument = documents.find((document) => document.estatus_importacion === "activo") || documents[0];
  const normalizedSearch = search.trim().toLowerCase();
  const filteredReferences = useMemo(() => {
    if (!normalizedSearch) return references;
    return references.filter((item) => [item.orden_original, item.numero_parte_original, item.sh_original].some((value) => value.toLowerCase().includes(normalizedSearch)));
  }, [references, normalizedSearch]);
  const multiPartGroups = useMemo(() => {
    const groups = new Map<string, MasterGroup>();
    references.forEach((item) => {
      const key = `${item.orden_original}|||${item.sh_original}`;
      const current = groups.get(key) || { order: item.orden_original, sh: item.sh_original, parts: [] };
      if (!current.parts.some((part) => part.numero_parte_original === item.numero_parte_original)) current.parts.push(item);
      groups.set(key, current);
    });
    return Array.from(groups.values()).filter((group) => group.parts.length > 1).sort((a, b) => b.parts.length - a.parts.length);
  }, [references]);
  const registeredParts = useMemo(() => new Set(records.map((record) => registrationKey(record.order, record.sh, record.part))), [records]);
  const totalPages = Math.max(1, Math.ceil(filteredReferences.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleReferences = filteredReferences.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [normalizedSearch, pageSize]);

  return <div className="space-y-7"><SectionHeader eyebrow="Fuente de validación" title="Documentos maestros" description="Carga varios archivos de forma acumulativa. Cada archivo agrega sus nuevos SO, SH y accesorios sin borrar las referencias anteriores." action={<button onClick={() => fileRef.current?.click()} className="primary-action"><UploadCloud className="h-4 w-4" />Agregar archivo</button>} />
    <input ref={fileRef} onChange={(e) => handleFile(e.target.files?.[0])} type="file" accept=".xlsx,.xls,.csv" className="hidden" />
    <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]"><div className="soft-card p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="text-sm font-bold text-slate-800">Versión activa</p><p className="mt-1 text-xs text-slate-500">La fuente usada por cada match del turno.</p></div><span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-600/15"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{activeDocument?.estatus_importacion === "activo" ? "Activa" : "Sin activar"}</span></div><div className="mt-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5 sm:flex-row sm:items-center"><div className="rounded-2xl bg-[#e8f7f2] p-3 text-[#0d7d6c]"><FileSpreadsheet className="h-7 w-7" /></div><div className="min-w-0 flex-1"><p className="truncate text-base font-bold text-slate-800">{activeDocument?.nombre_archivo || fileName}</p><p className="mt-1 text-xs text-slate-500">{activeDocument ? `${activeDocument.filas_validas.toLocaleString("es-MX")} filas válidas · ${activeDocument.filas_con_error} errores` : "Sin filas importadas"}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-slate-500"><span>{activeDocument ? `Subido · ${new Date(activeDocument.fecha_carga).toLocaleDateString("es-MX")}` : "Sin documento cargado"}</span><span>{activeDocument?.estatus_importacion || "sin activar"}</span></div></div><button onClick={() => toast.info("La descarga requiere un bucket privado y una URL firmada.")} className="secondary-action shrink-0"><Download className="h-4 w-4" />Descargar</button></div><div className="mt-5 grid grid-cols-3 gap-3"><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">Filas</p><p className="mt-1 font-display text-xl font-semibold text-slate-800">{activeDocument?.filas_validas?.toLocaleString("es-MX") || "0"}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">Errores</p><p className="mt-1 font-display text-xl font-semibold text-slate-800">{activeDocument?.filas_con_error || 0}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">Versiones</p><p className="mt-1 font-display text-xl font-semibold text-slate-800">{documents.length}</p></div></div></div>
      <div onClick={() => fileRef.current?.click()} className="flex min-h-[310px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-cyan-200 bg-cyan-50/30 p-8 text-center transition hover:border-cyan-400 hover:bg-cyan-50"><div className="rounded-2xl bg-white p-4 text-[#0e7f8d] shadow-sm"><UploadCloud className="h-7 w-7" /></div><p className="mt-5 text-sm font-bold text-slate-700">Agregar otro archivo</p><p className="mt-2 max-w-xs text-xs leading-5 text-slate-500">Selecciona otro CSV o Excel para sumar sus SO, SH y accesorios. Los archivos y referencias anteriores se conservan.</p><span className="mt-5 rounded-lg bg-[#0e7f8d] px-3 py-2 text-xs font-bold text-white">Seleccionar archivo</span></div></div>
    <div className="soft-card overflow-hidden"><div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-bold text-slate-800">SH con múltiples números de parte</p><p className="mt-1 text-xs text-slate-500">Agrupados por la combinación exacta de Orden + SH para preparar el registro de accesorios.</p></div><span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">{multiPartGroups.length} grupos encontrados</span></div>{multiPartGroups.length === 0 ? <div className="px-6 py-8 text-center text-xs text-slate-500">No se encontraron SH con más de un número de parte en el documento.</div> : <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">{multiPartGroups.map((group) => <MasterGroupCard key={`${group.order}-${group.sh}`} group={group} registeredParts={registeredParts} />)}</div>}</div>
    <div className="soft-card overflow-hidden"><div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-bold text-slate-800">Vista previa de referencia</p><p className="mt-1 text-xs text-slate-500">{filteredReferences.length.toLocaleString("es-MX")} filas filtradas de {references.length.toLocaleString("es-MX")} · muestra {pageSize} por página.</p></div><div className="flex flex-col gap-2 sm:flex-row"><div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar SH, orden o parte" className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-cyan-500 focus:ring-3 focus:ring-cyan-100 sm:w-64" /></div><select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) as 10 | 20)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600"><option value={10}>10 filas</option><option value={20}>20 filas</option></select></div></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left"><thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-[.12em] text-slate-500"><tr><th className="px-6 py-3">Fila</th><th className="px-5 py-3">Orden</th><th className="px-5 py-3">Número de parte</th><th className="px-5 py-3">SH</th><th className="px-5 py-3">Accesorios del SH</th><th className="px-6 py-3">Estado</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleReferences.map((item, index) => { const group = multiPartGroups.find((candidate) => candidate.order === item.orden_original && candidate.sh === item.sh_original); return <tr key={item.id} className="transition hover:bg-slate-50/70"><td className="px-6 py-4 text-xs text-slate-500">{item.numero_fila_origen || (currentPage - 1) * pageSize + index + 1}</td><td className="px-5 py-4 font-mono text-xs font-bold text-slate-700">{item.orden_original}</td><td className="px-5 py-4 font-mono text-xs text-slate-600">{item.numero_parte_original}</td><td className="px-5 py-4 font-mono text-xs text-slate-600">{item.sh_original}</td><td className="px-5 py-4">{group ? <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${registeredParts.has(registrationKey(item.orden_original, item.sh_original, item.numero_parte_original)) ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{group.parts.length} ligados a esta orden</span> : <span className="text-xs text-slate-400">Único</span>}</td><td className="px-6 py-4"><RegistrationPill registered={registeredParts.has(registrationKey(item.orden_original, item.sh_original, item.numero_parte_original))} /></td></tr>; })}{visibleReferences.length === 0 ? <tr><td colSpan={6} className="px-6 py-10 text-center text-xs text-slate-500">Aún no hay filas que coincidan con el filtro.</td></tr> : null}</tbody></table></div><div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-500">Página {currentPage} de {totalPages}</p><div className="flex items-center gap-2"><button disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="secondary-action disabled:cursor-not-allowed disabled:opacity-40">Anterior</button><button disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="secondary-action disabled:cursor-not-allowed disabled:opacity-40">Siguiente</button></div></div></div>
    {isNew ? <p className="rounded-xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-xs text-cyan-800"><strong>Importación completada:</strong> el documento fue procesado y enviado a Supabase.</p> : null}</div>;
}

function Reports({ records }: { records: RecordItem[] }) {
  const [range, setRange] = useState("Turno actual");
  const reportRecords = records.filter((record) => isRecordInRange(record, range));
  const matches = reportRecords.filter((record) => record.match === "Coincide").length;
  const rate = reportRecords.length ? Math.round((matches / reportRecords.length) * 100) : 0;
  const hourlyData = buildHourlyData(reportRecords);
  const totalQuantity = reportRecords.reduce((sum, record) => sum + record.quantity, 0);
  const totalOrders = new Set(reportRecords.map((record) => `${record.cell || "Sin celda"}|||${record.order}`)).size;
  const hourlyCellStats = Array.from(reportRecords.reduce((map, record) => {
    const capturedAt = new Date(record.capturedAt);
    const cell = record.cell || "Sin celda";
    const hourNumber = capturedAt.getHours();
    const key = `${capturedAt.toISOString().slice(0, 10)}|${cell}|${hourNumber}`;
    const current = map.get(key) || {
      sortKey: key,
      date: capturedAt.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }),
      hour: `${String(hourNumber).padStart(2, "0")}:00`,
      cell,
      orders: new Set<string>(),
      pieces: 0,
      captures: 0,
      matches: 0,
    };
    current.orders.add(record.order);
    current.pieces += record.quantity;
    current.captures += 1;
    if (record.match === "Coincide") current.matches += 1;
    map.set(key, current);
    return map;
  }, new Map<string, { sortKey: string; date: string; hour: string; cell: string; orders: Set<string>; pieces: number; captures: number; matches: number }>()).values()).map((row) => ({
    ...row,
    orders: row.orders.size,
  })).sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.cell.localeCompare(b.cell));
  const cellStats = Array.from(reportRecords.reduce((map, record) => {
    const name = record.cell || "Sin celda";
    const current = map.get(name) || { name, quantity: 0, matches: 0, records: 0 };
    current.quantity += record.quantity;
    current.records += 1;
    if (record.match === "Coincide") current.matches += 1;
    map.set(name, current);
    return map;
  }, new Map<string, { name: string; quantity: number; matches: number; records: number }>()).values());
  const operatorStats = Array.from(reportRecords.reduce((map, record) => {
    const current = map.get(record.operator) || { name: record.operator, total: 0, quantity: 0, pieces: 0, matchCount: 0 };
    current.total += 1;
    current.quantity += record.quantity;
    current.pieces += record.quantity;
    if (record.match === "Coincide") current.matchCount += 1;
    map.set(record.operator, current);
    return map;
  }, new Map<string, { name: string; total: number; quantity: number; pieces: number; matchCount: number }>()).values()).map((person) => ({ ...person, match: person.total ? Math.round((person.matchCount / person.total) * 100) : 0 }));
  function exportCsv() {
    const escapeCsv = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const content = [
      ["Fecha", "Hora", "Celda", "Órdenes capturadas", "Piezas capturadas", "Capturas", "Matches"].map(escapeCsv).join(","),
      ...hourlyCellStats.map((row) => [row.date, row.hour, row.cell, row.orders, row.pieces, row.captures, row.matches].map(escapeCsv).join(",")),
    ].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8;" }));
    link.download = "reporte-automatico-por-celda-y-hora.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success("Reporte automático CSV descargado.");
  }
  return <div className="space-y-7"><SectionHeader eyebrow="Indicadores operativos" title="Reportes y productividad" description="Los indicadores se calculan automáticamente con lo capturado por celda y hora; no necesitas ingresar órdenes o piezas manualmente." action={<div className="flex gap-2"><select value={range} onChange={(e) => setRange(e.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 outline-none focus:border-cyan-500"><option>Turno actual</option><option>Hoy</option><option>Esta semana</option></select><button onClick={exportCsv} className="primary-action"><Download className="h-4 w-4" />Exportar CSV</button></div>} />
    <div className="grid gap-4 sm:grid-cols-4"><MetricCard label="Tasa de match" value={`${rate}%`} hint={`${matches} de ${reportRecords.length} capturas`} color="emerald" icon={CircleCheck} /><MetricCard label="Discrepancias" value={`${reportRecords.filter((r) => r.match === "Discrepancia" || r.match === "No encontrado").length}`} hint="Requieren atención" color="rose" icon={CircleAlert} /><MetricCard label="Órdenes capturadas" value={`${totalOrders}`} hint="Órdenes distintas por celda" color="cyan" icon={PackageCheck} /><MetricCard label="Piezas capturadas" value={totalQuantity.toLocaleString("es-MX", { maximumFractionDigits: 3 })} hint="Suma automática de cantidades" color="amber" icon={BarChart3} /></div>
    <div className="soft-card overflow-hidden"><div className="border-b border-slate-100 px-5 py-5 sm:px-6"><p className="text-sm font-bold text-slate-800">Resumen automático por celda y hora</p><p className="mt-1 text-xs text-slate-500">Cada fila se genera agrupando las capturas de la base de datos por hora y celda. Las órdenes se cuentan sin duplicar la misma orden dentro del bloque.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-slate-50/80 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-5 py-3">Fecha</th><th className="px-5 py-3">Hora</th><th className="px-5 py-3">Celda</th><th className="px-5 py-3">Órdenes</th><th className="px-5 py-3">Piezas</th><th className="px-5 py-3">Capturas</th><th className="px-5 py-3">Matches</th></tr></thead><tbody className="divide-y divide-slate-100">{hourlyCellStats.map((row) => <tr key={`${row.sortKey}-${row.cell}`} className="transition hover:bg-slate-50/70"><td className="px-5 py-3 text-xs text-slate-600">{row.date}</td><td className="px-5 py-3 text-xs font-semibold text-slate-700">{row.hour}</td><td className="px-5 py-3"><span className="rounded-full bg-cyan-50 px-2.5 py-1 text-[11px] font-bold text-cyan-800">{row.cell}</span></td><td className="px-5 py-3 text-sm font-bold text-slate-800">{row.orders}</td><td className="px-5 py-3 text-sm text-slate-600">{row.pieces.toLocaleString("es-MX", { maximumFractionDigits: 3 })}</td><td className="px-5 py-3 text-sm text-slate-600">{row.captures}</td><td className="px-5 py-3 text-sm font-semibold text-emerald-700">{row.matches}</td></tr>)}{hourlyCellStats.length === 0 ? <tr><td colSpan={7} className="px-5 py-10 text-center text-xs text-slate-500">No hay capturas para el rango seleccionado.</td></tr> : null}</tbody></table></div></div>
    <div className="soft-card p-5 sm:p-6"><div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-bold text-slate-800">Volumen y calidad de captura</p><p className="mt-1 text-xs text-slate-500">Comparativo automático de registros totales y coincidencias por bloque horario.</p></div><div className="mt-3 flex gap-4 text-[11px] font-semibold text-slate-500"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#0e7f8d]" />Capturas</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#35c79e]" />Matches</span></div></div><div className="mt-6 h-[330px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={hourlyData} margin={{ top: 10, right: 12, bottom: 0, left: -18 }}><CartesianGrid vertical={false} stroke="#e6edf1" strokeDasharray="3 3" /><XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fill: "#718096", fontSize: 11 }} dy={8} /><YAxis tickLine={false} axisLine={false} tick={{ fill: "#718096", fontSize: 11 }} /><Tooltip cursor={{ fill: "#f1f7f8" }} contentStyle={{ borderRadius: 12, border: "1px solid #dce9eb", boxShadow: "0 12px 24px rgba(15, 43, 56, .12)", fontSize: 12 }} /><Bar dataKey="registros" name="Capturas" fill="#0e7f8d" radius={[6, 6, 0, 0]} /><Bar dataKey="coincide" name="Matches" fill="#35c79e" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
    <div className="grid gap-5 xl:grid-cols-2"><div className="soft-card p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="text-sm font-bold text-slate-800">Producción por celda</p><p className="mt-1 text-xs text-slate-500">Cantidad capturada y matches calculados por celda.</p></div><span className="rounded-full bg-cyan-50 px-2.5 py-1 text-[11px] font-bold text-cyan-800">{cellStats.length} celdas con actividad</span></div><div className="mt-5 h-[285px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={cellStats} margin={{ top: 10, right: 8, bottom: 0, left: -12 }}><CartesianGrid vertical={false} stroke="#e6edf1" strokeDasharray="3 3" /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "#718096", fontSize: 10 }} /><YAxis tickLine={false} axisLine={false} tick={{ fill: "#718096", fontSize: 10 }} /><Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #dce9eb", fontSize: 12 }} /><Bar dataKey="quantity" name="Piezas capturadas" fill="#0e7f8d" radius={[5, 5, 0, 0]} /><Bar dataKey="matches" name="Matches" fill="#35c79e" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></div><div className="soft-card p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="text-sm font-bold text-slate-800">Ingresado por operador</p><p className="mt-1 text-xs text-slate-500">Piezas calculadas directamente desde sus capturas.</p></div><UsersRound className="h-5 w-5 text-cyan-700" /></div><div className="mt-5 h-[285px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={operatorStats} layout="vertical" margin={{ top: 8, right: 12, bottom: 0, left: 10 }}><CartesianGrid horizontal={false} stroke="#e6edf1" strokeDasharray="3 3" /><XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: "#718096", fontSize: 10 }} /><YAxis type="category" dataKey="name" width={90} tickLine={false} axisLine={false} tick={{ fill: "#718096", fontSize: 10 }} /><Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #dce9eb", fontSize: 12 }} /><Bar dataKey="quantity" name="Piezas" fill="#0e7f8d" radius={[0, 5, 5, 0]} /><Bar dataKey="matchCount" name="Matches" fill="#35c79e" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div></div></div>
    <div className="soft-card p-5 sm:p-6"><p className="text-sm font-bold text-slate-800">Detalle por operador</p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left"><thead className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-[.12em] text-slate-500"><tr><th className="px-3 py-3">Operador</th><th className="px-3 py-3">Capturas</th><th className="px-3 py-3">Piezas</th><th className="px-3 py-3">Matches</th><th className="px-3 py-3">Tasa</th></tr></thead><tbody className="divide-y divide-slate-100">{operatorStats.map((person) => <tr key={person.name}><td className="px-3 py-3 text-sm font-bold text-slate-800">{person.name}</td><td className="px-3 py-3 text-sm text-slate-600">{person.total}</td><td className="px-3 py-3 text-sm text-slate-600">{person.pieces.toLocaleString("es-MX", { maximumFractionDigits: 3 })}</td><td className="px-3 py-3 text-sm font-semibold text-emerald-700">{person.matchCount}</td><td className="px-3 py-3 text-sm font-semibold text-cyan-700">{person.match}%</td></tr>)}{operatorStats.length === 0 ? <tr><td colSpan={5} className="px-3 py-8 text-center text-xs text-slate-500">Aún no hay registros para mostrar.</td></tr> : null}</tbody></table></div></div>
  </div>;
}
function HistoryView({ records }: { records: RecordItem[] }) {
  return <div className="space-y-7"><SectionHeader eyebrow="Auditoría operativa" title="Historial de registros" description="Consulta la trazabilidad de cada captura, incluyendo el resultado automático y la decisión de supervisión." action={<button onClick={() => toast.info("Filtros avanzados disponibles al conectar la base de datos.")} className="secondary-action"><Filter className="h-4 w-4" />Filtros avanzados</button>} />
    <div className="soft-card overflow-hidden"><div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><p className="text-sm font-bold text-slate-800">Registros cargados</p><p className="mt-1 text-xs text-slate-500">{records.length} movimientos sincronizados desde Supabase.</p></div><div className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input placeholder="Buscar en historial" className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none transition focus:border-cyan-500 focus:ring-3 focus:ring-cyan-100" /></div></div><div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left"><thead className="bg-slate-50/80 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-6 py-3">Fecha / hora</th><th className="px-5 py-3">Orden / material</th><th className="px-5 py-3">SH</th><th className="px-5 py-3">Usuario</th><th className="px-5 py-3">Match</th><th className="px-6 py-3">Revisado</th></tr></thead><tbody className="divide-y divide-slate-100">{records.map((record) => <tr key={record.id} className="transition hover:bg-slate-50/70"><td className="px-6 py-4"><p className="text-xs font-semibold text-slate-700">{record.date}</p><p className="mt-0.5 text-xs text-slate-500">{record.time}</p></td><td className="px-5 py-4"><p className="text-sm font-bold text-slate-800">{record.order}</p><p className="mt-0.5 font-mono text-[11px] text-slate-500">{record.part}</p></td><td className="px-5 py-4 font-mono text-xs text-slate-600">{record.sh}</td><td className="px-5 py-4 text-sm text-slate-600">{record.operator}</td><td className="px-5 py-4"><StatusPill state={record.match} /></td><td className="px-6 py-4"><StatusPill state={record.review} /></td></tr>)}</tbody></table></div></div></div>;
}

function SettingsView() {
  return <div className="space-y-7"><SectionHeader eyebrow="Parámetros del sistema" title="Configuración operativa" description="Vista de referencia para las reglas, roles y parámetros que podrán administrarse al conectar la base de datos." /><div className="grid gap-5 lg:grid-cols-2"><div className="soft-card p-5 sm:p-6"><div className="flex items-center gap-3"><div className="rounded-xl bg-violet-50 p-2 text-violet-700"><UsersRound className="h-5 w-5" /></div><div><p className="text-sm font-bold text-slate-800">Roles y permisos</p><p className="mt-0.5 text-xs text-slate-500">Perfiles previstos para el sistema.</p></div></div><div className="mt-5 space-y-3">{[["Operador", "Captura materiales y consulta sus registros."], ["Supervisor", "Revisa, confirma y rechaza salidas."], ["Administrador", "Gestiona usuarios, turnos y documentos maestros."]].map(([role, description]) => <div key={role} className="rounded-xl border border-slate-100 p-3"><p className="text-xs font-bold text-slate-800">{role}</p><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>)}</div></div><div className="soft-card p-5 sm:p-6"><div className="flex items-center gap-3"><div className="rounded-xl bg-cyan-50 p-2 text-cyan-700"><Settings className="h-5 w-5" /></div><div><p className="text-sm font-bold text-slate-800">Reglas de validación</p><p className="mt-0.5 text-xs text-slate-500">Comportamiento propuesto del match automático.</p></div></div><div className="mt-5 space-y-3">{[["Normalización", "Convertir a mayúsculas y eliminar espacios al comparar."], ["Duplicados", "Alertar si la misma combinación se captura nuevamente en el turno."], ["Excepciones", "Exigir comentario al rechazar o aprobar una discrepancia."]].map(([role, description]) => <div key={role} className="flex items-start gap-3 rounded-xl border border-slate-100 p-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><div><p className="text-xs font-bold text-slate-800">{role}</p><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div></div>)}</div></div></div><div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-xs leading-5 text-slate-500"><strong className="text-slate-700">Próxima etapa:</strong> al integrar autenticación y base de datos, estas opciones se conectarán a usuarios reales, reglas por planta, documentos versionados y bitácora persistente.</div></div>;
}

export default function Home({ user, profile, liveMode, signOut }: AuthContextValue) {
  const [view, setView] = useState<View>("panel");
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [documents, setDocuments] = useState<MasterDocument[]>([]);
  const [references, setReferences] = useState<ReferenceRow[]>([]);
  const [dataWarnings, setDataWarnings] = useState<string[]>([]);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(profile);
  const [dataLoading, setDataLoading] = useState(liveMode);
  const [clock, setClock] = useState(getTime());
  const [mobileMenu, setMobileMenu] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const operatorName = currentProfile?.nombre_completo || user.email?.split("@")[0] || "Usuario";
  const isAdmin = currentProfile?.rol === "administrador";

  useEffect(() => { const timer = window.setInterval(() => setClock(getTime()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { setCurrentProfile(profile); }, [profile]);
  useEffect(() => {
    if (!liveMode || !profile) {
      setDataLoading(false);
      return;
    }
    let active = true;
    const syncData = (showLoading: boolean) => {
      if (showLoading) setDataLoading(true);
      void fetchTraceData(user, profile)
        .then((data) => {
          if (!active) return;
          setRecords(data.records);
          setDocuments(data.documents);
          setReferences(data.references);
          setDataWarnings(data.warnings || []);
        })
        .catch((error) => {
          if (!active) return;
          const message = error instanceof Error ? error.message : "No fue posible cargar los datos de Supabase.";
          setDataWarnings([message]);
          if (showLoading) toast.error(`No fue posible cargar los datos de Supabase: ${message}`);
        })
        .finally(() => { if (active && showLoading) setDataLoading(false); });
    };
    syncData(true);
    const refreshTimer = view === "reportes" ? window.setInterval(() => syncData(false), 60_000) : undefined;
    return () => { active = false; if (refreshTimer) window.clearInterval(refreshTimer); };
  }, [liveMode, profile, user, view]);
  const pendingCount = useMemo(() => records.filter((record) => record.review === "Pendiente").length, [records]);

  function addRecord(record: RecordItem) { setRecords((current) => [record, ...current]); }
  async function reviewRecord(id: string, review: ReviewState) {
    if (liveMode && supabase) {
      const nextStatus = review === "Confirmado" ? "confirmado" : review === "Rechazado" ? "rechazado" : "cancelado";
      const { data, error } = await supabase.rpc("confirmar_revision", { p_registro_id: id, p_nuevo_estatus: nextStatus, p_motivo: review === "Confirmado" ? null : "Revisión operativa desde PXG TEQUILA", p_observaciones: null });
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
      <div className="border-b border-white/10 px-6 py-6"><div className="flex items-center gap-3"><div className={logoMarkClass()}><PackageCheck className="h-5 w-5" /></div><div><p className="font-display text-lg font-semibold tracking-tight text-white">PXG TEQUILA</p><p className="text-[10px] font-bold uppercase tracking-[.18em] text-cyan-200/70">Registro de accesorios</p></div></div></div>
      <nav className="flex-1 px-4 py-5"><p className="px-3 pb-3 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Operación</p><div className="space-y-1">{navigation.map((item) => { const Icon = item.icon; const isActive = view === item.id; return <button key={item.id} onClick={() => { setView(item.id); setMobileMenu(false); }} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${isActive ? "bg-white/12 text-white shadow-sm" : "text-slate-300 hover:bg-white/7 hover:text-white"}`}><Icon className={`h-4.5 w-4.5 ${isActive ? "text-cyan-200" : "text-slate-400 group-hover:text-cyan-200"}`} /><span className="flex-1">{item.label}</span>{item.id === "supervision" && pendingCount > 0 ? <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-300 px-1 text-[10px] font-extrabold text-amber-950">{pendingCount}</span> : null}</button>; })}</div><p className="mt-7 px-3 pb-3 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Sistema</p><button onClick={() => { setView("configuracion"); setMobileMenu(false); }} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${view === "configuracion" ? "bg-white/12 text-white" : "text-slate-300 hover:bg-white/7 hover:text-white"}`}><Settings className="h-4.5 w-4.5 text-slate-400 group-hover:text-cyan-200" />Configuración</button></nav>
      <ProfileMenu name={operatorName} role={currentProfile?.rol || "Operador"} isAdmin={isAdmin} open={profileMenuOpen} onToggle={() => setProfileMenuOpen((open) => !open)} onEditProfile={() => { setProfileMenuOpen(false); if (currentProfile) setProfileEditorOpen(true); else toast.info("El modo demo no tiene un perfil persistente."); }} onManageUsers={() => { setProfileMenuOpen(false); setView("usuarios"); }} onSignOut={() => { setProfileMenuOpen(false); void signOut(); }} />
    </aside>
    {mobileMenu ? <button aria-label="Cerrar menú" onClick={() => setMobileMenu(false)} className="fixed inset-0 z-30 bg-slate-950/35 lg:hidden" /> : null}
    <main className="relative min-h-screen lg:pl-[278px]"><header className="sticky top-0 z-20 flex h-[74px] items-center justify-between border-b border-slate-200/80 bg-[#f9fbfb]/85 px-4 backdrop-blur-xl sm:px-7 lg:px-9"><div className="flex items-center gap-3"><button onClick={() => setMobileMenu(true)} aria-label="Abrir menú" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"><LayoutDashboard className="h-5 w-5" /></button><div><p className="text-xs font-bold text-slate-700 sm:text-sm">{activeTitle}</p><p className="mt-0.5 hidden text-[11px] text-slate-400 sm:block">PXG TEQUILA</p></div></div><div className="flex items-center gap-3"><div className="hidden text-right sm:block"><p className="text-xs font-semibold capitalize text-slate-700">{clock}</p><p className="mt-0.5 text-[10px] text-slate-400">Hora de estación</p></div><button onClick={() => toast.info("No hay notificaciones nuevas.")} className="relative rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 shadow-sm transition hover:border-cyan-200 hover:text-[#0e7f8d]"><Bell className="h-4 w-4" /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-amber-400 ring-2 ring-white" /></button></div></header>
      <div className="mx-auto max-w-[1550px] px-4 py-7 sm:px-7 lg:px-9 lg:py-9">{dataLoading ? <div className="mb-5 flex items-center gap-2 rounded-xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-xs font-semibold text-cyan-800"><div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-600 border-t-transparent" />Sincronizando con Supabase…</div> : null}{!liveMode ? <div className="mb-5 flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800"><CircleAlert className="h-4 w-4" />Supabase no está configurado: conecta las variables para usar datos reales.</div> : null}{dataWarnings.length > 0 ? <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"><div className="flex items-center gap-2 font-bold"><CircleAlert className="h-4 w-4" />Algunas fuentes no pudieron cargarse</div><ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-[11px]">{dataWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}{view === "panel" && <Panel records={records} setView={setView} activeDocument={documents.find((document) => document.estatus_importacion === "activo") || documents[0]} />}{view === "captura" && <Capture onCapture={addRecord} records={records} user={user} profile={currentProfile} liveMode={liveMode} operatorName={operatorName} onProfileChange={setCurrentProfile} />}{view === "supervision" && <Supervision records={records} onReview={reviewRecord} />}{view === "documentos" && <Documents documents={documents} references={references} records={records} user={user} profile={currentProfile} liveMode={liveMode} onDocumentsChange={setDocuments} onReferencesChange={setReferences} />}{view === "jaula" && <JaulaView references={references} liveMode={liveMode} planta={currentProfile?.planta || profile?.planta || "Monterrey"} area={currentProfile?.area || profile?.area || "Produccion"} />}{view === "reportes" && <Reports records={records} />}{view === "streamlite" && <StreamlitePdfView />}{view === "historial" && <HistoryView records={records} />}{view === "usuarios" && <UsersAdmin liveMode={liveMode && isAdmin} currentUserId={user.id} onBack={() => setView("panel")} />}{view === "configuracion" && <SettingsView />}</div>
      {profileEditorOpen && currentProfile ? <ProfileEditorModal userId={user.id} profile={currentProfile} onClose={() => setProfileEditorOpen(false)} onSaved={(updated) => setCurrentProfile(updated)} /> : null}
      <footer className="mx-4 border-t border-slate-200/80 py-5 text-center text-[11px] text-slate-400 sm:mx-7 lg:mx-9">PXG TEQUILA · {liveMode ? "Datos sincronizados con Supabase" : "Modo local sin persistencia"}.</footer>
    </main>
  </div>;
}
