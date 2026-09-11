import * as XLSX from "xlsx";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { CaptureRow, MasterDocument, Profile, ProductionCell, Shift } from "./database.types";

export type TraceRecord = {
  id: string;
  time: string;
  date: string;
  order: string;
  part: string;
  sh: string;
  quantity: number;
  ordersPerHour: number;
  piecesPerHour: number;
  cell: string | null;
  operator: string;
  match: "Coincide" | "Discrepancia" | "No encontrado" | "Duplicado";
  reason?: string;
  review: "Pendiente" | "Confirmado" | "Rechazado" | "Cancelado";
  document: string;
};

export type ReferenceRow = {
  id: string;
  documento_id: string;
  numero_fila_origen: number | null;
  orden_original: string;
  numero_parte_original: string;
  sh_original: string;
  activo: boolean;
};

export type AccessoryReference = {
  id: string;
  code: string;
  expectedQuantity: number | null;
  sourceRow: number | null;
};

const matchLabels: Record<string, TraceRecord["match"]> = {
  coincide: "Coincide",
  discrepancia: "Discrepancia",
  no_encontrado: "No encontrado",
  duplicado: "Duplicado",
};

const reviewLabels: Record<string, TraceRecord["review"]> = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  rechazado: "Rechazado",
  cancelado: "Cancelado",
};

export function mapCaptureRow(row: CaptureRow): TraceRecord {
  const capturedAt = new Date(row.fecha_hora_captura);
  return {
    id: row.id,
    time: capturedAt.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }),
    date: capturedAt.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }),
    order: row.orden_original,
    part: row.numero_parte_original,
    sh: row.sh_original,
    quantity: Number(row.cantidad || 0),
    ordersPerHour: Number(row.orden_x_hora || 0),
    piecesPerHour: Number(row.piezas_x_hora || 0),
    cell: row.celda || null,
    operator: row.perfiles_usuarios?.nombre_completo || "Usuario autenticado",
    match: matchLabels[row.resultado_match] || "No encontrado",
    reason: row.motivo_discrepancia || undefined,
    review: reviewLabels[row.estatus_supervisor] || "Pendiente",
    document: row.documento_id_validacion ? "Documento maestro versionado" : "Sin documento activo",
  };
}

export async function fetchTraceData(user: User, profile: Profile | null) {
  if (!supabase) return { records: [] as TraceRecord[], documents: [] as MasterDocument[], references: [] as ReferenceRow[], shifts: [] as Shift[], warnings: [] as string[] };

  const [recordsResult, documentsResult, shiftsResult] = await Promise.all([
    supabase
      .from("registros_captura")
      .select("*, perfiles_usuarios:perfiles_usuarios!registros_captura_usuario_id_fkey(nombre_completo)")
      .order("fecha_hora_captura", { ascending: false })
      .limit(250),
    supabase
      .from("documentos_maestros")
      .select("*")
      .order("fecha_carga", { ascending: false }),
    supabase.from("turnos").select("*").eq("activo", true).order("hora_inicio"),
  ]);

  const warnings: string[] = [];
  if (recordsResult.error) warnings.push(`registros_captura: ${recordsResult.error.message}`);
  if (documentsResult.error) warnings.push(`documentos_maestros: ${documentsResult.error.message}`);
  if (shiftsResult.error) warnings.push(`turnos: ${shiftsResult.error.message}`);

  const documents = documentsResult.error ? [] : (documentsResult.data || []) as MasterDocument[];
  const documentIds = documents.map((document) => document.id);
  const referencesResult = documentIds.length
    ? await supabase
        .from("datos_referencia")
        .select("id, documento_id, numero_fila_origen, orden_original, numero_parte_original, sh_original, activo")
        .in("documento_id", documentIds)
        .order("numero_fila_origen", { ascending: true })
        .limit(5000)
    : { data: [], error: null };
  if (referencesResult.error) warnings.push(`datos_referencia: ${referencesResult.error.message}`);

  return {
    records: recordsResult.error ? [] : ((recordsResult.data || []) as CaptureRow[]).map(mapCaptureRow),
    documents,
    references: referencesResult.error ? [] : (referencesResult.data || []) as ReferenceRow[],
    shifts: shiftsResult.error ? [] : (shiftsResult.data || []) as Shift[],
    warnings,
  };
}

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeValue(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function supabaseErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message || fallback);
  return fallback;
}

export async function findAccessoryReferences(sh: string, order: string, profile: Profile) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const normalizedSh = normalizeValue(sh);
  const normalizedOrder = normalizeValue(order);
  if (!normalizedSh || !normalizedOrder) return [] as AccessoryReference[];

  const { data: documents, error: documentError } = await supabase
    .from("documentos_maestros")
    .select("id")
    .eq("planta", profile.planta)
    .eq("area", profile.area)
    .eq("estatus_importacion", "activo")
    .order("fecha_activacion", { ascending: false, nullsFirst: false })
    .order("fecha_carga", { ascending: false })
    .limit(1);
  if (documentError) throw new Error(`documentos_maestros: ${supabaseErrorMessage(documentError, "no fue posible leer el documento activo")}`);
  const documentId = documents?.[0]?.id;
  if (!documentId) return [] as AccessoryReference[];

  const { data, error } = await supabase
    .from("datos_referencia")
    .select("id, numero_parte_original, cantidad_esperada, numero_fila_origen")
    .eq("documento_id", documentId)
    .eq("orden_normalizado", normalizedOrder)
    .eq("sh_normalizado", normalizedSh)
    .eq("activo", true)
    .order("numero_fila_origen", { ascending: true });
  if (error) throw new Error(`datos_referencia: ${supabaseErrorMessage(error, "no fue posible leer las referencias")}`);

  const seen = new Set<string>();
  return ((data || []) as Array<{ id: string; numero_parte_original: string; cantidad_esperada: number | null; numero_fila_origen: number | null }>)
    .filter((row) => {
      const key = normalizeValue(row.numero_parte_original);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row) => ({
      id: row.id,
      code: row.numero_parte_original,
      expectedQuantity: row.cantidad_esperada === null ? null : Number(row.cantidad_esperada),
      sourceRow: row.numero_fila_origen,
    }));
}

export async function findExistingShRecords(sh: string, order: string) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const normalizedSh = normalizeValue(sh);
  const normalizedOrder = normalizeValue(order);
  if (!normalizedSh || !normalizedOrder) return [] as Array<{ id: string; fecha_hora_captura: string; celda: string | null }>;
  const { data, error } = await supabase
    .from("registros_captura")
    .select("id, fecha_hora_captura, celda")
    .eq("orden_normalizada", normalizedOrder)
    .eq("sh_normalizado", normalizedSh)
    .order("fecha_hora_captura", { ascending: false })
    .limit(20);
  if (error) throw new Error(`registros_captura: ${supabaseErrorMessage(error, "no fue posible revisar el SH")}`);
  return (data || []) as Array<{ id: string; fecha_hora_captura: string; celda: string | null }>;
}

function findColumn(headers: string[], candidates: string[]) {
  const normalizedCandidates = candidates.map(normalizeHeader);
  return headers.findIndex((header) => normalizedCandidates.includes(normalizeHeader(header)));
}

export async function importMasterDocument(file: File, user: User, profile: Profile) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  if (!['supervisor', 'administrador'].includes(profile.rol)) {
    throw new Error("Solo un supervisor o administrador puede cargar documentos maestros.");
  }

  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("El archivo no contiene una hoja de cálculo.");

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  if (matrix.length < 2) throw new Error("El archivo debe incluir encabezados y al menos una fila.");

  const headers = (matrix[0] || []).map((header) => String(header));
  const orderIndex = findColumn(headers, ["orden", "order", "production order", "work order"]);
  const partIndex = findColumn(headers, ["numero de parte", "part number", "part", "codigo", "code", "material"]);
  const shIndex = findColumn(headers, ["sh", "shipping hub", "shippinghub"]);

  if (orderIndex < 0 || partIndex < 0 || shIndex < 0) {
    throw new Error("No se encontraron las columnas requeridas. Usa encabezados como Orden, Número de Parte y SH.");
  }

  const rows = matrix.slice(1);
  const referenceRows = rows
    .map((row, index) => {
      const order = String(row[orderIndex] ?? "").trim();
      const part = String(row[partIndex] ?? "").trim();
      const sh = String(row[shIndex] ?? "").trim();
      if (!order || !part || !sh) return null;
      return {
        numero_fila_origen: index + 2,
        orden_original: order,
        numero_parte_original: part,
        sh_original: sh,
        orden_normalizada: normalizeValue(order),
        numero_parte_normalizada: normalizeValue(part),
        sh_normalizado: normalizeValue(sh),
        activo: true,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (referenceRows.length === 0) throw new Error("No hay filas válidas con Orden, Número de Parte y SH.");

  let storagePath: string | null = null;
  const storageName = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const storageResult = await supabase.storage.from("documentos-maestros").upload(storageName, file, { upsert: false });
  if (!storageResult.error) storagePath = storageName;

  const { data: document, error: documentError } = await supabase
    .from("documentos_maestros")
    .insert({
      nombre_archivo: file.name,
      tipo_archivo: file.name.split(".").pop()?.toLowerCase() || "xlsx",
      usuario_carga_id: user.id,
      planta: profile.planta,
      area: profile.area,
      estatus_importacion: "procesando",
      total_filas: rows.length,
      filas_validas: referenceRows.length,
      filas_con_error: rows.length - referenceRows.length,
      ruta_storage: storagePath,
      notas: storageResult.error ? "Archivo procesado en navegador; Storage no disponible o bucket no creado." : null,
    })
    .select("*")
    .single();

  if (documentError || !document) throw documentError || new Error("No fue posible crear el documento maestro.");

  const chunks: typeof referenceRows[] = [];
  for (let index = 0; index < referenceRows.length; index += 500) chunks.push(referenceRows.slice(index, index + 500));

  for (const chunk of chunks) {
    const { error } = await supabase.from("datos_referencia").insert(chunk.map((row) => ({ ...row, documento_id: document.id })));
    if (error) {
      await supabase.from("documentos_maestros").update({ estatus_importacion: "error", notas: error.message }).eq("id", document.id);
      throw error;
    }
  }

  const { data: validated, error: validateError } = await supabase
    .from("documentos_maestros")
    .update({ estatus_importacion: "validado" })
    .eq("id", document.id)
    .select("*")
    .single();
  if (validateError || !validated) throw validateError || new Error("No fue posible validar el documento.");

  let activated: MasterDocument = validated as MasterDocument;
  const activation = await supabase.rpc("activar_documento", { p_documento_id: document.id });
  if (!activation.error && activation.data) activated = activation.data as MasterDocument;

  return { document: activated, storageWarning: Boolean(storageResult.error) };
}

export type AdminUser = Profile & {
  email: string;
  last_sign_in_at: string | null;
};

export type UserFormPayload = {
  user_id?: string;
  email: string;
  password?: string;
  nombre_completo: string;
  numero_empleado: string;
  rol: "operador" | "supervisor" | "administrador";
  planta: string;
  area: string;
  celda?: ProductionCell | null;
  activo: boolean;
};

export async function listAdminUsers() {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase.functions.invoke("admin-users", { body: { action: "list" } });
  if (error) {
    const fallback = await supabase.from("perfiles_usuarios").select("*").order("nombre_completo", { ascending: true });
    if (!fallback.error) {
      return ((fallback.data || []) as Profile[]).map((profile) => ({
        ...profile,
        email: "Correo disponible al desplegar la función admin-users",
        last_sign_in_at: null,
      })) as AdminUser[];
    }
    throw new Error(`No fue posible cargar usuarios. Despliega la Edge Function admin-users y verifica RLS. Detalle: ${error.message}`);
  }
  if (data?.error) throw new Error(data.error);
  return (data?.users || []) as AdminUser[];
}

export async function saveAdminUser(action: "create" | "update", payload: UserFormPayload) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase.functions.invoke("admin-users", { body: { action, ...payload } });
  if (error) throw new Error(`La Edge Function admin-users no está disponible. Despliégala en Supabase antes de crear o editar usuarios. Detalle: ${error.message}`);
  if (data?.error) throw new Error(data.error);
  return data as { user: { id: string; email?: string }; profile: Profile };
}

export async function updateOwnProfile(userId: string, payload: Pick<UserFormPayload, "nombre_completo" | "numero_empleado" | "planta" | "area">) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase
    .from("perfiles_usuarios")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Profile;
}
