export type JaulaAccessoryStatus = "pendiente" | "liberado" | "recogido";

export type JaulaPartState = {
  status: JaulaAccessoryStatus;
  updatedAt: number;
};

export type JaulaGroupState = {
  pedidoAt: number | null;
  parts: Record<string, JaulaPartState>;
  updatedAt: number;
};

export type JaulaStateMap = Record<string, JaulaGroupState>;

const STORAGE_KEY = "pxg-tequila-jaula-states-v1";

export function jaulaGroupKey(order: string, sh: string) {
  return [order, sh].map((value) => value.trim().replace(/\s+/g, " ").toUpperCase()).join("|||");
}

export function jaulaPartKey(order: string, sh: string, part: string) {
  return [order, sh, part].map((value) => value.trim().replace(/\s+/g, " ").toUpperCase()).join("|||");
}

export function loadJaulaStates(): JaulaStateMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as JaulaStateMap;
  } catch {
    return {};
  }
}

export function saveJaulaStates(states: JaulaStateMap) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
}

export function getJaulaGroupState(states: JaulaStateMap, order: string, sh: string): JaulaGroupState {
  return states[jaulaGroupKey(order, sh)] || { pedidoAt: null, parts: {}, updatedAt: 0 };
}

export function getJaulaPartStatus(states: JaulaStateMap, order: string, sh: string, part: string): JaulaAccessoryStatus {
  return getJaulaGroupState(states, order, sh).parts[jaulaPartKey(order, sh, part)]?.status || "pendiente";
}
