import type { JaulaCollector } from "./database.types";
import { getJaulaGroupState, jaulaGroupKey, jaulaPartKey, saveJaulaStates, type JaulaAccessoryStatus, type JaulaGroupState, type JaulaStateMap } from "./jaulaStorage";
import { supabase } from "./supabase";

export type JaulaRemoteRow = {
  id: string;
  planta: string;
  area: string;
  orden_original: string;
  sh_original: string;
  numero_parte_original: string;
  estado: JaulaAccessoryStatus;
  celda_recoleccion: JaulaCollector | null;
  pedido_at: string | null;
  updated_at: string;
};

export function mapJaulaRows(rows: JaulaRemoteRow[]): JaulaStateMap {
  const states: JaulaStateMap = {};
  rows.forEach((row) => {
    const groupKey = jaulaGroupKey(row.orden_original, row.sh_original);
    const partKey = jaulaPartKey(row.orden_original, row.sh_original, row.numero_parte_original);
    const current = states[groupKey] || { pedidoAt: null, celda: null, parts: {}, updatedAt: 0 };
    const pedidoTime = row.pedido_at ? new Date(row.pedido_at).getTime() : 0;
    const updatedTime = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    states[groupKey] = {
      ...current,
      pedidoAt: Math.max(current.pedidoAt || 0, pedidoTime) || null,
      celda: current.celda || row.celda_recoleccion,
      updatedAt: Math.max(current.updatedAt, updatedTime),
      parts: { ...current.parts, [partKey]: { id: row.id, status: row.estado, updatedAt: updatedTime, celda: row.celda_recoleccion } },
    };
  });
  return states;
}

export function mergeJaulaStates(current: JaulaStateMap, incoming: JaulaStateMap): JaulaStateMap {
  const next: JaulaStateMap = { ...current };
  Object.entries(incoming).forEach(([groupKey, incomingGroup]) => {
    const currentGroup = next[groupKey];
    const parts = { ...(currentGroup?.parts || {}) };
    Object.entries(incomingGroup.parts).forEach(([partKey, incomingPart]) => {
      if (!parts[partKey] || incomingPart.updatedAt >= parts[partKey].updatedAt) parts[partKey] = incomingPart;
    });
    next[groupKey] = {
      pedidoAt: Math.max(currentGroup?.pedidoAt || 0, incomingGroup.pedidoAt || 0) || null,
      celda: incomingGroup.celda || currentGroup?.celda || null,
      updatedAt: Math.max(currentGroup?.updatedAt || 0, incomingGroup.updatedAt),
      parts,
    };
  });
  return next;
}

export async function listJaulaStates(planta: string, area: string): Promise<JaulaStateMap> {
  if (!supabase) return {};
  const { data, error } = await supabase.rpc("jaula_listar_estados", { p_planta: planta, p_area: area });
  if (error) throw new Error(`No fue posible cargar los estados de JAULA: ${error.message}`);
  return mapJaulaRows((data || []) as JaulaRemoteRow[]);
}

export async function markJaulaOrder(
  planta: string,
  area: string,
  order: string,
  sh: string,
  cell: JaulaCollector,
  parts: string[],
): Promise<JaulaStateMap> {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase.rpc("jaula_marcar_pedido", {
    p_planta: planta,
    p_area: area,
    p_orden: order,
    p_sh: sh,
    p_celda: cell,
    p_partes: parts,
  });
  if (error) throw new Error(`No fue posible marcar la orden como pedida: ${error.message}`);
  return mapJaulaRows((data || []) as JaulaRemoteRow[]);
}

export async function updateJaulaPart(id: string, status: Extract<JaulaAccessoryStatus, "liberado" | "recogido">): Promise<JaulaStateMap> {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase.rpc("jaula_actualizar_estado", { p_id: id, p_estado: status });
  if (error) throw new Error(`No fue posible actualizar el accesorio de JAULA: ${error.message}`);
  return mapJaulaRows([data as JaulaRemoteRow]);
}

export function persistJaulaCache(states: JaulaStateMap) {
  saveJaulaStates(states);
}
