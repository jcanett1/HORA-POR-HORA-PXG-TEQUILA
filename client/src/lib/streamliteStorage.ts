import type { ProductCategory } from "./pdfProcessor";

export type ActiveStreamliteTable = "relations" | ProductCategory;

export type StoredStreamliteRun = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  buildFileName: string | null;
  shipmentFileName: string | null;
  buildBytes: ArrayBuffer | null;
  shipmentBytes: ArrayBuffer | null;
  mergedBytes: ArrayBuffer | null;
  summarizePickup: boolean;
  activeTable: ActiveStreamliteTable;
  processedAt: number | null;
};

const DATABASE_NAME = "pxg-tequila-streamlite";
const DATABASE_VERSION = 1;
const STORE_NAME = "runs";

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("El navegador no permite almacenamiento local para las corridas."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("No fue posible abrir el almacenamiento local."));
  });
}

export async function listStreamliteRuns(): Promise<StoredStreamliteRun[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      database.close();
      resolve((request.result as StoredStreamliteRun[]).sort((a, b) => b.updatedAt - a.updatedAt));
    };
    request.onerror = () => {
      database.close();
      reject(request.error || new Error("No fue posible leer las corridas guardadas."));
    };
  });
}

export async function saveStreamliteRun(run: StoredStreamliteRun): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).put(run);
    request.onsuccess = () => {
      database.close();
      resolve();
    };
    request.onerror = () => {
      database.close();
      reject(request.error || new Error("No fue posible guardar la corrida."));
    };
  });
}

export async function deleteStreamliteRun(id: string): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).delete(id);
    request.onsuccess = () => {
      database.close();
      resolve();
    };
    request.onerror = () => {
      database.close();
      reject(request.error || new Error("No fue posible eliminar la corrida."));
    };
  });
}

export function createStreamliteRun(name: string): StoredStreamliteRun {
  const now = Date.now();
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `run-${now}-${Math.random().toString(36).slice(2)}`,
    name,
    createdAt: now,
    updatedAt: now,
    buildFileName: null,
    shipmentFileName: null,
    buildBytes: null,
    shipmentBytes: null,
    mergedBytes: null,
    summarizePickup: true,
    activeTable: "relations",
    processedAt: null,
  };
}
