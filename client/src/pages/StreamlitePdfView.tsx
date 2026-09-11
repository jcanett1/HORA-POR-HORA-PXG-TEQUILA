import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileArchive,
  FileText,
  PackageSearch,
  RefreshCw,
  TableProperties,
  UploadCloud,
  WandSparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  buildAnalysis,
  CATEGORIES,
  generateMergedPdf,
  parsePdfFile,
  type PdfAnalysis,
  type ProductCategory,
  type RelationRow,
  type AppearanceRow,
} from "@/lib/pdfProcessor";

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatNumber(value: number) {
  return value.toLocaleString("es-MX");
}

function UploadCard({
  label,
  hint,
  file,
  onChange,
  onClear,
}: {
  label: string;
  hint: string;
  file: File | null;
  onChange: (file: File | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_22px_rgba(20,58,70,.035)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-800">{label}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{hint}</p>
        </div>
        <FileText className="h-5 w-5 shrink-0 text-cyan-700" />
      </div>
      {file ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
          <div className="rounded-lg bg-white p-2 text-emerald-700 shadow-sm"><FileArchive className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-emerald-950">{file.name}</p><p className="mt-0.5 text-[11px] text-emerald-700">{formatBytes(file.size)}</p></div>
          <button type="button" aria-label={`Quitar ${file.name}`} onClick={onClear} className="rounded-lg p-1.5 text-emerald-700 transition hover:bg-emerald-100"><X className="h-4 w-4" /></button>
        </div>
      ) : (
        <label className="mt-4 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-cyan-200 bg-cyan-50/40 px-4 text-center transition hover:border-cyan-400 hover:bg-cyan-50">
          <UploadCloud className="h-6 w-6 text-cyan-700" />
          <span className="mt-2 text-xs font-bold text-cyan-800">Seleccionar PDF</span>
          <span className="mt-1 text-[11px] text-slate-500">También puedes arrastrarlo aquí</span>
          <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => onChange(event.target.files?.[0] || null)} />
        </label>
      )}
    </div>
  );
}

function Metric({ label, value, tone = "cyan" }: { label: string; value: string; tone?: "cyan" | "emerald" | "amber" | "violet" }) {
  const styles = {
    cyan: "border-cyan-100 bg-cyan-50/60 text-cyan-800",
    emerald: "border-emerald-100 bg-emerald-50/60 text-emerald-800",
    amber: "border-amber-100 bg-amber-50/60 text-amber-800",
    violet: "border-violet-100 bg-violet-50/60 text-violet-800",
  };
  return <div className={`rounded-2xl border p-4 ${styles[tone]}`}><p className="text-[10px] font-extrabold uppercase tracking-[.13em] opacity-70">{label}</p><p className="mt-2 font-display text-2xl font-semibold">{value}</p></div>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-xs text-slate-500">{message}</div>;
}

function RelationTable({ rows, title, description }: { rows: RelationRow[]; title: string; description: string }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) => [row.order, row.code, row.description, row.shipment, String(row.quantity)].some((value) => value.toLowerCase().includes(normalized)));
  }, [query, rows]);
  return (
    <div className="soft-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div><p className="text-sm font-bold text-slate-800">{title}</p><p className="mt-1 text-xs text-slate-500">{description} · {formatNumber(rows.length)} filas agrupadas por orden y código</p></div>
        <div className="flex items-center gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar tabla" className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none transition focus:border-cyan-500 focus:ring-3 focus:ring-cyan-100 sm:w-56" /><TableProperties className="hidden h-4 w-4 text-cyan-700 sm:block" /></div>
      </div>
      {filtered.length ? <div className="max-h-[450px] overflow-auto"><table className="w-full min-w-[900px] text-left"><thead className="sticky top-0 z-10 bg-slate-50/95 text-[10px] font-bold uppercase tracking-[.12em] text-slate-500 backdrop-blur"><tr><th className="px-5 py-3">Orden</th><th className="px-5 py-3">Código</th><th className="px-5 py-3">Cantidad</th><th className="px-5 py-3">Descripción</th><th className="px-5 py-3">SH</th></tr></thead><tbody className="divide-y divide-slate-100">{filtered.slice(0, 500).map((row, index) => <tr key={`${row.order}-${row.code}-${row.shipment}-${index}`} className="transition hover:bg-cyan-50/35"><td className="whitespace-nowrap px-5 py-3 text-xs font-semibold text-slate-700">{row.order}</td><td className="whitespace-nowrap px-5 py-3 font-mono text-[11px] text-cyan-800">{row.code}</td><td className="whitespace-nowrap px-5 py-3 text-sm font-bold text-slate-800">{formatNumber(row.quantity)}</td><td className="px-5 py-3 text-xs text-slate-600">{row.description}</td><td className="px-5 py-3 font-mono text-[11px] text-slate-600">{row.shipment || "—"}</td></tr>)}</tbody></table></div> : <div className="p-5"><EmptyState message="No hay filas que coincidan con la búsqueda." /></div>}
      {filtered.length > 500 ? <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-500">Mostrando las primeras 500 filas; usa la búsqueda para encontrar una relación específica.</p> : null}
    </div>
  );
}

function AppearanceTable({ rows, category }: { rows: AppearanceRow[]; category: ProductCategory }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? rows.filter((row) => `${row.code} ${row.description} ${row.shipment}`.toLowerCase().includes(normalized)) : rows;
  }, [query, rows]);
  return (
    <div className="soft-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6"><div><p className="text-sm font-bold text-slate-800">Resumen de apariciones · {category}</p><p className="mt-1 text-xs text-slate-500">Código, descripción, cantidad total y todos los SH relacionados.</p></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar código, descripción o SH" className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none transition focus:border-cyan-500 focus:ring-3 focus:ring-cyan-100 sm:w-72" /></div>
      {filtered.length ? <div className="max-h-[390px] overflow-auto"><table className="w-full min-w-[820px] text-left"><thead className="sticky top-0 z-10 bg-slate-50/95 text-[10px] font-bold uppercase tracking-[.12em] text-slate-500 backdrop-blur"><tr><th className="px-5 py-3">Código</th><th className="px-5 py-3">Descripción</th><th className="px-5 py-3">Cantidad</th><th className="px-5 py-3">SH</th></tr></thead><tbody className="divide-y divide-slate-100">{filtered.map((row) => <tr key={row.code} className="hover:bg-cyan-50/35"><td className="whitespace-nowrap px-5 py-3 font-mono text-[11px] text-cyan-800">{row.code}</td><td className="px-5 py-3 text-xs text-slate-600">{row.description}</td><td className="whitespace-nowrap px-5 py-3 text-sm font-bold text-slate-800">{formatNumber(row.appearances)}</td><td className="px-5 py-3 font-mono text-[11px] text-slate-600">{row.shipment || "—"}</td></tr>)}</tbody></table></div> : <div className="p-5"><EmptyState message="No se encontraron apariciones para esta categoría." /></div>}
    </div>
  );
}

export default function StreamlitePdfView() {
  const [buildFile, setBuildFile] = useState<File | null>(null);
  const [shipmentFile, setShipmentFile] = useState<File | null>(null);
  const [summarizePickup, setSummarizePickup] = useState(true);
  const [analysis, setAnalysis] = useState<PdfAnalysis | null>(null);
  const [processing, setProcessing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [mergedUrl, setMergedUrl] = useState("");
  const [activeTable, setActiveTable] = useState<"relations" | ProductCategory>("relations");

  useEffect(() => () => { if (mergedUrl) URL.revokeObjectURL(mergedUrl); }, [mergedUrl]);

  function resetAnalysis() {
    setAnalysis(null);
    setError("");
    if (mergedUrl) {
      URL.revokeObjectURL(mergedUrl);
      setMergedUrl("");
    }
  }

  function updateBuildFile(file: File | null) { setBuildFile(file); resetAnalysis(); }
  function updateShipmentFile(file: File | null) { setShipmentFile(file); resetAnalysis(); }

  async function processFiles() {
    if (!buildFile || !shipmentFile) {
      setError("Selecciona ambos PDFs: Build Sheets y Shipment Pick Lists.");
      return;
    }
    setProcessing(true);
    setError("");
    if (mergedUrl) {
      URL.revokeObjectURL(mergedUrl);
      setMergedUrl("");
    }
    try {
      const [build, shipment] = await Promise.all([parsePdfFile(buildFile, "build"), parsePdfFile(shipmentFile, "shipment")]);
      setAnalysis(buildAnalysis(build, shipment));
      setActiveTable("relations");
      toast.success("Los dos PDFs fueron procesados correctamente.");
    } catch (processingError) {
      const message = processingError instanceof Error ? processingError.message : "No fue posible leer los PDFs.";
      setError(`No se pudo procesar la información: ${message}`);
      toast.error("No se pudo procesar uno de los PDFs.");
    } finally {
      setProcessing(false);
    }
  }

  async function createMergedOutput() {
    if (!analysis) return;
    setGenerating(true);
    try {
      const bytes = await generateMergedPdf(analysis, summarizePickup);
      const blob = new Blob([bytes], { type: "application/pdf" });
      if (mergedUrl) URL.revokeObjectURL(mergedUrl);
      setMergedUrl(URL.createObjectURL(blob));
      toast.success("PDF combinado generado. Ya puedes descargarlo.");
    } catch (generationError) {
      const message = generationError instanceof Error ? generationError.message : "No fue posible generar el PDF combinado.";
      setError(`No se pudo generar el PDF combinado: ${message}`);
      toast.error("No se pudo generar el PDF combinado.");
    } finally {
      setGenerating(false);
    }
  }

  const activeRelations = analysis && activeTable === "relations" ? analysis.relations : null;
  const activeCategory = activeTable !== "relations" ? activeTable : null;

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="eyebrow">Procesador local de PDFs</p><h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-slate-950">Streamlite · Build / Shipment</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">Carga tus dos PDFs para obtener las relaciones de órdenes, códigos y SH; los resúmenes por categoría; los envíos 2 day; y un PDF consolidado. Todo se procesa en este navegador y los archivos no se suben a GitHub ni a Supabase.</p></div>
        <div className="flex items-center gap-2 rounded-xl border border-cyan-100 bg-cyan-50/70 px-3 py-2 text-xs font-bold text-cyan-800"><WandSparkles className="h-4 w-4" />Equivalente web de tu flujo Streamlit</div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <UploadCard label="Upload Build Sheets PDF" hint="Archivo de builds / órdenes de producción." file={buildFile} onChange={updateBuildFile} onClear={() => updateBuildFile(null)} />
        <UploadCard label="Upload Shipment Pick Lists PDF" hint="Archivo de listas de surtido y embarque." file={shipmentFile} onChange={updateShipmentFile} onClear={() => updateShipmentFile(null)} />
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_22px_rgba(20,58,70,.035)] sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={summarizePickup} onChange={(event) => setSummarizePickup(event.target.checked)} className="h-4 w-4 accent-[#0e7f8d]" />Resumir órdenes Customer Pickup</label>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={processFiles} disabled={processing || !buildFile || !shipmentFile} className="primary-action disabled:cursor-not-allowed disabled:opacity-50"><PackageSearch className={`h-4 w-4 ${processing ? "animate-pulse" : ""}`} />{processing ? "Procesando PDFs…" : "Procesar ambos PDFs"}</button>{analysis ? <button type="button" onClick={resetAnalysis} className="secondary-action"><RefreshCw className="h-4 w-4" />Limpiar resultado</button> : null}</div>
      </div>

      {error ? <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p>{error}</p></div> : null}
      {!analysis ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-5 py-12 text-center"><FileText className="mx-auto h-9 w-9 text-slate-400" /><p className="mt-3 text-sm font-bold text-slate-700">Sube los dos PDFs para comenzar</p><p className="mt-1 text-xs text-slate-500">La pantalla mostrará las tablas interactivas después de pulsar “Procesar ambos PDFs”.</p></div> : null}

      {analysis ? <>
        {analysis.warnings.length ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"><div className="flex items-center gap-2 font-bold"><AlertCircle className="h-4 w-4" />Avisos del procesamiento</div><ul className="mt-2 list-disc space-y-1 pl-5">{analysis.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Órdenes únicas" value={formatNumber(analysis.orderSummary.total)} /><Metric label="Relaciones" value={formatNumber(analysis.relations.length)} tone="emerald" /><Metric label="Órdenes 2 day" value={formatNumber(analysis.twoDayShipments.length)} tone="amber" /><Metric label="Customer Pickup" value={summarizePickup ? formatNumber(analysis.orderSummary.customerPickup) : "Desactivado"} tone="violet" /><Metric label="Categorías" value={formatNumber(CATEGORIES.filter((category) => analysis.appearancesByCategory[category].length > 0).length)} /></div>

        <div className="space-y-4"><div><p className="eyebrow">Tablas interactivas de datos</p><h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-slate-950">Relaciones y resúmenes por categoría</h2><p className="mt-1 text-sm text-slate-500">Busca por orden, código, descripción o SH. Las tablas se pueden desplazar en pantallas pequeñas.</p></div>
          <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_8px_22px_rgba(20,58,70,.035)]"><button type="button" onClick={() => setActiveTable("relations")} className={`rounded-xl px-3 py-2 text-xs font-bold transition ${activeTable === "relations" ? "bg-[#0e7f8d] text-white shadow-sm" : "text-slate-600 hover:bg-cyan-50 hover:text-cyan-800"}`}>Relaciones (Órdenes, Códigos, SH)</button>{CATEGORIES.map((category) => <button type="button" key={category} onClick={() => setActiveTable(category)} className={`rounded-xl px-3 py-2 text-xs font-bold transition ${activeTable === category ? "bg-[#0e7f8d] text-white shadow-sm" : "text-slate-600 hover:bg-cyan-50 hover:text-cyan-800"}`}>{category} · {formatNumber(analysis.appearancesByCategory[category].length)}</button>)}</div>
          {activeRelations ? <RelationTable rows={activeRelations} title="Tabla Interactiva de Relaciones (Órdenes, Códigos, SH)" description="Todos los códigos reconocidos en ambos PDFs" /> : null}
          {activeCategory ? <AppearanceTable rows={analysis.appearancesByCategory[activeCategory]} category={activeCategory} /> : null}
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
          <div className="soft-card p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-800">Resumen de Órdenes y Envíos</p><p className="mt-1 text-xs text-slate-500">Órdenes con Shipping Method: 2 day</p></div><CheckCircle2 className="h-5 w-5 text-emerald-600" /></div><div className="mt-5 rounded-xl border border-cyan-100 bg-cyan-50/60 p-4"><p className="text-[10px] font-extrabold uppercase tracking-[.13em] text-cyan-800">SH detectados</p>{analysis.twoDayShipments.length ? <p className="mt-2 break-words font-mono text-xs leading-6 text-cyan-950">{analysis.twoDayShipments.join(", ")}</p> : <p className="mt-2 text-xs text-cyan-900">No se encontraron órdenes con Shipping Method: 2 day.</p>}</div></div>
          <div className="soft-card p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-800">Métodos de envío</p><p className="mt-1 text-xs text-slate-500">Frecuencias reconocidas en los PDFs.</p></div><TableProperties className="h-5 w-5 text-cyan-700" /></div>{analysis.shippingMethods.length ? <div className="mt-4 space-y-2">{analysis.shippingMethods.map((item) => <div key={item.method} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"><span className="font-semibold text-slate-600">{item.method}</span><span className="font-bold text-slate-900">{formatNumber(item.count)}</span></div>)}</div> : <p className="mt-5 text-xs text-slate-500">No se encontraron datos de métodos de envío.</p>}</div>
        </div>

        <div className="soft-card flex flex-col gap-4 border-cyan-100 bg-gradient-to-br from-white to-cyan-50/40 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"><div><p className="text-sm font-bold text-slate-800">Generate Merged Output</p><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Crea un solo PDF con el resumen inicial, apariciones por categoría, tablas de relaciones, listados de pelotas/gorras/guantes/accesorios y los dos PDFs originales.</p></div><div className="flex shrink-0 flex-wrap gap-2">{mergedUrl ? <a href={mergedUrl} download="Tequila_Merged_Output.pdf" className="primary-action"><Download className="h-4 w-4" />Download Merged Output PDF</a> : <button type="button" onClick={createMergedOutput} disabled={generating} className="primary-action disabled:cursor-not-allowed disabled:opacity-50"><WandSparkles className="h-4 w-4" />{generating ? "Generando…" : "Generate Merged Output"}</button>}</div></div>
      </> : null}
    </div>
  );
}
