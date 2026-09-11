import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import { PART_DESCRIPTIONS } from "./partCatalog";

export const CATEGORIES = ["Pelotas", "Gorras", "Guantes", "Accesorios", "Otros"] as const;
export type ProductCategory = (typeof CATEGORIES)[number];
export type PdfSource = "build" | "shipment";

export type RelationRow = {
  order: string;
  code: string;
  description: string;
  shipment: string;
  category: ProductCategory;
};

export type AppearanceRow = {
  code: string;
  description: string;
  appearances: number;
  category: ProductCategory;
};

export type ShippingSummary = {
  method: string;
  count: number;
};

type ParsedPage = {
  number: number;
  orderId: string | null;
  shipmentId: string | null;
  partNumbers: Record<string, number>;
  text: string;
  pickup: boolean;
  shippingMethod: string | null;
};

type OrderMeta = {
  sources: Set<PdfSource>;
  pickup: boolean;
  partNumbers: Record<string, number>;
  pages: number;
};

export type ParsedPdf = {
  source: PdfSource;
  fileName: string;
  bytes: Uint8Array;
  pageCount: number;
  pages: ParsedPage[];
  relations: RelationRow[];
  twoDayShipments: string[];
  orders: Record<string, OrderMeta>;
  shippingMethods: ShippingSummary[];
  textLength: number;
  warnings: string[];
};

export type PdfAnalysis = {
  build: ParsedPdf;
  shipment: ParsedPdf;
  relations: RelationRow[];
  relationsByCategory: Record<ProductCategory, RelationRow[]>;
  appearancesByCategory: Record<ProductCategory, AppearanceRow[]>;
  twoDayShipments: string[];
  shippingMethods: ShippingSummary[];
  orderSummary: {
    total: number;
    buildOnly: number;
    shipmentOnly: number;
    both: number;
    customerPickup: number;
  };
  warnings: string[];
};

const ORDER_REGEX = /\b(SO-|USS|SOC|AMZ)-?(\d+)\b/i;
const SHIPMENT_REGEX = /\b(SH\d{5,})\b/i;
const PICKUP_REGEX = /Customer\s*Pickup|Cust\s*Pickup|CUSTPICKUP/i;
const SHIPPING_2DAY_REGEX = /Shipping\s*Method\s*:\s*2\s*day/i;
const SHIPPING_METHOD_REGEX = /Shipping\s*Method\s*:\s*([^\r\n]+)/i;
const KNOWN_SHIPPING_METHODS = ["2 day", "GU 9", "PICKUP", "PO BOX", "AK 9", "NO SHIPMENT", "GENERAL DELIVERY", "PR 0", "HAND DELIVER", "RIO BAYAMON", "HI 9", "OVERNIGHT"];

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function classifyItem(code: string, description: string): ProductCategory {
  const upperCode = code.toUpperCase();
  const upperDescription = description.toUpperCase();
  if (upperCode.startsWith("GB-DOZ-") || upperDescription.includes("GOLF BALL")) return "Pelotas";
  if (upperCode.startsWith("H-") || upperDescription.includes("HAT") || upperDescription.includes("CAP")) return "Gorras";
  if (upperCode.startsWith("G4-")) return "Guantes";
  if (upperCode.startsWith("A-") || upperCode.startsWith("HC-")) return "Accesorios";
  return "Otros";
}

function extractIdentifiers(text: string) {
  const orderMatch = text.match(ORDER_REGEX);
  const shipmentMatch = text.match(SHIPMENT_REGEX);
  const orderId = orderMatch ? `${orderMatch[1].replace(/-$/, "")}-${orderMatch[2]}`.toUpperCase() : null;
  const shipmentId = shipmentMatch ? shipmentMatch[1].toUpperCase() : null;
  return { orderId, shipmentId };
}

function extractPartNumbers(text: string) {
  const partCounts: Record<string, number> = {};
  const upperText = text.toUpperCase();
  const codes = Object.keys(PART_DESCRIPTIONS).sort((a, b) => b.length - a.length);
  for (const code of codes) {
    const pattern = new RegExp(`(?<![A-Z0-9])${escapeRegExp(code)}(?![A-Z0-9])`, "g");
    const count = upperText.match(pattern)?.length || 0;
    if (count > 0) partCounts[code] = count;
  }
  return partCounts;
}

function getShippingMethod(text: string) {
  const normalizedText = text.toUpperCase().replace(/\s+/g, " ").trim();
  const markerIndex = normalizedText.indexOf("SHIPPING METHOD:");
  const methodText = markerIndex >= 0 ? normalizedText.slice(markerIndex + "SHIPPING METHOD:".length).trim() : "";
  const knownMethod = KNOWN_SHIPPING_METHODS.find((method) => methodText.startsWith(method.toUpperCase()));
  if (knownMethod) return knownMethod;
  const match = text.match(SHIPPING_METHOD_REGEX);
  if (!match) return null;
  const method = match[1].replace(/[|•]+$/, "").trim();
  return method.length > 0 && method.length < 90 ? method : null;
}

function addCount(target: Record<string, number>, source: Record<string, number>) {
  for (const [code, count] of Object.entries(source)) target[code] = (target[code] || 0) + count;
}

function addShippingCount(target: Map<string, number>, method: string) {
  const normalized = method.trim().replace(/\s+/g, " ");
  if (normalized) target.set(normalized, (target.get(normalized) || 0) + 1);
}

export async function parsePdfFile(file: File, source: PdfSource): Promise<ParsedPdf> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const document = await loadingTask.promise;
  const pages: ParsedPage[] = [];
  const relations: RelationRow[] = [];
  const twoDayShipments = new Set<string>();
  const orders: Record<string, OrderMeta> = {};
  const shippingCounts = new Map<string, number>();
  let textLength = 0;

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    textLength += text.length;
    const { orderId, shipmentId } = extractIdentifiers(text);
    const partNumbers = extractPartNumbers(text);
    const pickup = PICKUP_REGEX.test(text);
    const shippingMethod = getShippingMethod(text);
    if (shipmentId && SHIPPING_2DAY_REGEX.test(text)) twoDayShipments.add(shipmentId);
    if (shippingMethod) addShippingCount(shippingCounts, shippingMethod);

    pages.push({ number: pageNumber - 1, orderId, shipmentId, partNumbers, text, pickup, shippingMethod });

    if (orderId) {
      const order = orders[orderId] || { sources: new Set<PdfSource>(), pickup: false, partNumbers: {}, pages: 0 };
      order.sources.add(source);
      order.pickup = order.pickup || pickup;
      order.pages += 1;
      addCount(order.partNumbers, partNumbers);
      orders[orderId] = order;
    }

    if (orderId && shipmentId) {
      for (const code of Object.keys(partNumbers)) {
        relations.push({
          order: orderId,
          code,
          description: PART_DESCRIPTIONS[code as keyof typeof PART_DESCRIPTIONS],
          shipment: shipmentId,
          category: classifyItem(code, PART_DESCRIPTIONS[code as keyof typeof PART_DESCRIPTIONS]),
        });
      }
    }
  }

  const warnings: string[] = [];
  if (document.numPages > 0 && textLength === 0) warnings.push(`${file.name}: no se encontró texto seleccionable; si es un escaneo de imagen, el PDF necesita OCR antes de procesarlo.`);
  if (relations.length === 0) warnings.push(`${file.name}: no se encontraron relaciones con código y SH reconocibles.`);

  return {
    source,
    fileName: file.name,
    bytes,
    pageCount: document.numPages,
    pages,
    relations,
    twoDayShipments: Array.from(twoDayShipments).sort(),
    orders,
    shippingMethods: Array.from(shippingCounts.entries()).map(([method, count]) => ({ method, count })).sort((a, b) => b.count - a.count),
    textLength,
    warnings,
  };
}

function emptyCategoryRecord<T>(): Record<ProductCategory, T[]> {
  return { Pelotas: [], Gorras: [], Guantes: [], Accesorios: [], Otros: [] };
}

export function buildAnalysis(build: ParsedPdf, shipment: ParsedPdf): PdfAnalysis {
  const relations = [...build.relations, ...shipment.relations];
  const relationsByCategory = emptyCategoryRecord<RelationRow>();
  for (const relation of relations) relationsByCategory[relation.category].push(relation);

  const appearances = new Map<string, number>();
  for (const parsed of [build, shipment]) {
    for (const page of parsed.pages) {
      for (const [code, count] of Object.entries(page.partNumbers)) appearances.set(code, (appearances.get(code) || 0) + count);
    }
  }
  const appearancesByCategory = emptyCategoryRecord<AppearanceRow>();
  for (const [code, appearancesCount] of Array.from(appearances.entries())) {
    const description = PART_DESCRIPTIONS[code as keyof typeof PART_DESCRIPTIONS];
    const category = classifyItem(code, description);
    appearancesByCategory[category].push({ code, description, appearances: appearancesCount, category });
  }
  for (const category of CATEGORIES) {
    appearancesByCategory[category].sort((a, b) => a.code.localeCompare(b.code));
    relationsByCategory[category].sort((a, b) => a.order.localeCompare(b.order) || a.code.localeCompare(b.code));
  }

  const orders = new Map<string, OrderMeta>();
  for (const parsed of [build, shipment]) {
    for (const [orderId, incoming] of Object.entries(parsed.orders)) {
      const current = orders.get(orderId) || { sources: new Set<PdfSource>(), pickup: false, partNumbers: {}, pages: 0 };
      for (const source of Array.from(incoming.sources)) current.sources.add(source);
      current.pickup = current.pickup || incoming.pickup;
      current.pages += incoming.pages;
      addCount(current.partNumbers, incoming.partNumbers);
      orders.set(orderId, current);
    }
  }
  let buildOnly = 0;
  let shipmentOnly = 0;
  let both = 0;
  let customerPickup = 0;
  for (const order of Array.from(orders.values())) {
    const hasBuild = order.sources.has("build");
    const hasShipment = order.sources.has("shipment");
    if (hasBuild && hasShipment) both += 1;
    else if (hasBuild) buildOnly += 1;
    else if (hasShipment) shipmentOnly += 1;
    if (order.pickup) customerPickup += 1;
  }
  const shippingCountMap = new Map<string, number>();
  for (const parsed of [build, shipment]) for (const item of parsed.shippingMethods) shippingCountMap.set(item.method, (shippingCountMap.get(item.method) || 0) + item.count);

  return {
    build,
    shipment,
    relations,
    relationsByCategory,
    appearancesByCategory,
    twoDayShipments: Array.from(new Set([...build.twoDayShipments, ...shipment.twoDayShipments])).sort(),
    shippingMethods: Array.from(shippingCountMap.entries()).map(([method, count]) => ({ method, count })).sort((a, b) => b.count - a.count),
    orderSummary: { total: orders.size, buildOnly, shipmentOnly, both, customerPickup },
    warnings: [...build.warnings, ...shipment.warnings],
  };
}

function wrapText(text: string, maxCharacters: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + (current ? " " : "") + word).length > maxCharacters && current) {
      lines.push(current);
      current = word;
    } else current += `${current ? " " : ""}${word}`;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function drawPageHeading(page: PDFPage, title: string, subtitle: string, font: PDFFont, boldFont: PDFFont) {
  page.drawText(title, { x: 42, y: 742, size: 18, font: boldFont, color: rgb(0.05, 0.32, 0.37) });
  page.drawText(subtitle, { x: 42, y: 720, size: 9, font, color: rgb(0.35, 0.42, 0.45) });
  page.drawLine({ start: { x: 42, y: 708 }, end: { x: 570, y: 708 }, thickness: 1, color: rgb(0.78, 0.85, 0.86) });
}

function drawTableReport(
  doc: PDFDocument,
  title: string,
  subtitle: string,
  headers: string[],
  rows: string[][],
  font: PDFFont,
  boldFont: PDFFont,
  columnWidths: number[],
) {
  let page = doc.addPage([612, 792]);
  drawPageHeading(page, title, subtitle, font, boldFont);
  let y = 684;
  const xStart = 42;
  const rowHeight = 22;
  const drawHeader = () => {
    let x = xStart;
    page.drawRectangle({ x: xStart, y: y - 5, width: columnWidths.reduce((sum, width) => sum + width, 0), height: 21, color: rgb(0.91, 0.96, 0.96) });
    headers.forEach((header, index) => {
      page.drawText(header, { x, y, size: 8, font: boldFont, color: rgb(0.08, 0.25, 0.29) });
      x += columnWidths[index];
    });
    y -= 25;
  };
  drawHeader();

  if (!rows.length) {
    page.drawText("No se encontraron datos para esta sección.", { x: xStart, y, size: 10, font, color: rgb(0.35, 0.42, 0.45) });
    return;
  }

  for (const row of rows) {
    const wrappedCells = row.map((cell, index) => wrapText(cell, Math.max(12, Math.floor(columnWidths[index] / 5.2))));
    const lines = Math.max(...wrappedCells.map((cell) => cell.length));
    const height = Math.max(rowHeight, lines * 11 + 9);
    if (y - height < 46) {
      page = doc.addPage([612, 792]);
      drawPageHeading(page, title, `${subtitle} · continuación`, font, boldFont);
      y = 684;
      drawHeader();
    }
    if (Math.floor((684 - y) / rowHeight) % 2 === 1) page.drawRectangle({ x: xStart, y: y - height + 5, width: columnWidths.reduce((sum, width) => sum + width, 0), height, color: rgb(0.975, 0.985, 0.985) });
    let x = xStart;
    wrappedCells.forEach((cellLines, index) => {
      cellLines.forEach((line, lineIndex) => page.drawText(line, { x, y: y - lineIndex * 11, size: 7.5, font, color: rgb(0.14, 0.2, 0.22) }));
      x += columnWidths[index];
    });
    y -= height;
    page.drawLine({ start: { x: xStart, y: y + 5 }, end: { x: xStart + columnWidths.reduce((sum, width) => sum + width, 0), y: y + 5 }, thickness: 0.35, color: rgb(0.87, 0.91, 0.91) });
  }
}

function drawOverviewPage(doc: PDFDocument, analysis: PdfAnalysis, font: PDFFont, boldFont: PDFFont, includePickup: boolean) {
  const page = doc.addPage([612, 792]);
  drawPageHeading(page, "RESUMEN DE ÓRDENES Y ENVÍOS", "Tequila Build / Shipment PDF Processor · generado en el navegador", font, boldFont);
  const metrics = [
    ["Órdenes únicas", String(analysis.orderSummary.total)],
    ["Con Build Sheets y Shipment", String(analysis.orderSummary.both)],
    ["Solo Build Sheets", String(analysis.orderSummary.buildOnly)],
    ["Solo Shipment Pick Lists", String(analysis.orderSummary.shipmentOnly)],
    ["Customer Pickup", includePickup ? String(analysis.orderSummary.customerPickup) : "Desactivado"],
    ["Relaciones detectadas", String(analysis.relations.length)],
  ];
  let y = 660;
  for (const [label, value] of metrics) {
    page.drawRectangle({ x: 42, y: y - 10, width: 528, height: 38, color: rgb(0.95, 0.98, 0.98), borderColor: rgb(0.83, 0.9, 0.9), borderWidth: 0.7 });
    page.drawText(label, { x: 56, y, size: 10, font, color: rgb(0.22, 0.3, 0.32) });
    page.drawText(value, { x: 500, y, size: 13, font: boldFont, color: rgb(0.05, 0.45, 0.47) });
    y -= 48;
  }
  y -= 8;
  page.drawText("Órdenes con Shipping Method: 2 day", { x: 42, y, size: 14, font: boldFont, color: rgb(0.05, 0.32, 0.37) });
  y -= 24;
  const twoDayText = analysis.twoDayShipments.length ? analysis.twoDayShipments.join(", ") : "No se encontraron órdenes con Shipping Method: 2 day.";
  for (const line of wrapText(twoDayText, 82)) {
    page.drawText(line, { x: 42, y, size: 9, font, color: rgb(0.25, 0.32, 0.34) });
    y -= 14;
  }
  y -= 12;
  page.drawText("Métodos de envío reconocidos", { x: 42, y, size: 12, font: boldFont, color: rgb(0.05, 0.32, 0.37) });
  y -= 22;
  if (analysis.shippingMethods.length) {
    for (const item of analysis.shippingMethods) {
      page.drawText(`${item.method}: ${item.count}`, { x: 54, y, size: 9, font, color: rgb(0.25, 0.32, 0.34) });
      y -= 15;
    }
  } else page.drawText("No se encontraron datos de métodos de envío adicionales.", { x: 54, y, size: 9, font, color: rgb(0.35, 0.42, 0.45) });
}

export async function generateMergedPdf(analysis: PdfAnalysis, includePickup = true): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  const font = await merged.embedFont(StandardFonts.Helvetica);
  const boldFont = await merged.embedFont(StandardFonts.HelveticaBold);
  merged.setTitle("Tequila Merged Output");
  merged.setSubject("Resumen de apariciones por categoría, relaciones y PDFs originales");

  drawOverviewPage(merged, analysis, font, boldFont, includePickup);
  drawTableReport(
    merged,
    "RESUMEN DE APARICIONES POR CATEGORÍA",
    "Relaciones, códigos y SH reconocidos en ambos archivos",
    ["Categoría", "Códigos", "Apariciones"],
    CATEGORIES.map((category) => [category, String(analysis.appearancesByCategory[category].length), String(analysis.appearancesByCategory[category].reduce((sum, row) => sum + row.appearances, 0))]),
    font,
    boldFont,
    [170, 170, 188],
  );
  drawTableReport(merged, "TABLA DE RELACIONES", "Órdenes, códigos, descripción y SH", ["Orden", "Código", "Descripción", "SH"], analysis.relations.map((row) => [row.order, row.code, row.description, row.shipment]), font, boldFont, [90, 130, 240, 68]);
  for (const category of CATEGORIES) {
    drawTableReport(merged, `RESUMEN DE APARICIONES: ${category.toUpperCase()}`, `${analysis.appearancesByCategory[category].length} códigos reconocidos`, ["Código", "Descripción", "Apariciones"], analysis.appearancesByCategory[category].map((row) => [row.code, row.description, String(row.appearances)]), font, boldFont, [145, 315, 68]);
  }
  for (const category of ["Pelotas", "Gorras", "Guantes", "Accesorios"] as const) {
    drawTableReport(merged, `LISTADO DE ${category.toUpperCase()}`, "Relaciones únicas encontradas por categoría", ["Orden", "Código", "Descripción", "SH"], analysis.relationsByCategory[category].map((row) => [row.order, row.code, row.description, row.shipment]), font, boldFont, [90, 130, 240, 68]);
  }

  for (const input of [analysis.build, analysis.shipment]) {
    const original = await PDFDocument.load(input.bytes, { ignoreEncryption: true });
    const copiedPages = await merged.copyPages(original, original.getPageIndices());
    copiedPages.forEach((page) => merged.addPage(page));
  }
  return merged.save();
}
