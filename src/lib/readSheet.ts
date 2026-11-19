import { strFromU8, unzipSync } from "fflate";
import type { Cell } from "../../shared/importPatients";

/** The sheets of an .xlsx workbook, or one sheet from a .csv, as rows of cells. */
export type Sheet = { name: string; rows: Cell[][] };

export async function readSheets(file: File): Promise<Sheet[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") return [{ name: file.name, rows: parseCsv(new TextDecoder().decode(buf)) }];
  if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new Error("This is an older .xls file. Open it in Excel and use File → Save As → Excel Workbook (.xlsx), then choose that.");
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("Choose an Excel file (.xlsx) or a CSV.");
  const zip = unzipSync(buf, { filter: (f) => f.name.startsWith("xl/") && f.name.endsWith(".xml") || f.name.endsWith(".rels") });
  const xml = (path: string) => (zip[path] ? new DOMParser().parseFromString(strFromU8(zip[path]!), "application/xml") : null);
  const shared = [...(xml("xl/sharedStrings.xml")?.getElementsByTagName("si") ?? [])].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent ?? "").join(""));
  const book = xml("xl/workbook.xml");
  const rels = xml("xl/_rels/workbook.xml.rels");
  const target = (rid: string | null) => {
    const r = [...(rels?.getElementsByTagName("Relationship") ?? [])].find((x) => x.getAttribute("Id") === rid);
    const t = r?.getAttribute("Target") ?? "";
    return t.startsWith("/") ? t.slice(1) : `xl/${t.replace(/^\.\//, "")}`;
  };
  const sheets = [...(book?.getElementsByTagName("sheet") ?? [])];
  const out: Sheet[] = [];
  for (const s of sheets) {
    const doc = xml(target(s.getAttribute("r:id") ?? s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")));
    if (doc) out.push({ name: s.getAttribute("name") ?? "Sheet", rows: sheetRows(doc, shared) });
  }
  if (!out.length) throw new Error("Couldn’t find a sheet in that file.");
  return out;
}

const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

function sheetRows(doc: Document, shared: string[]): Cell[][] {
  const rows: Cell[][] = [];
  for (const r of doc.getElementsByTagName("row")) {
    const row: Cell[] = [];
    let next = 0;
    for (const c of r.getElementsByTagName("c")) {
      const ref = c.getAttribute("r");
      const i = ref ? colIndex(ref) : next;
      next = i + 1;
      const t = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? null;
      let val: Cell = null;
      if (t === "s") val = v === null ? null : shared[Number(v)] ?? null;
      else if (t === "inlineStr") val = [...c.getElementsByTagName("t")].map((x) => x.textContent ?? "").join("");
      else if (t === "b") val = v === "1";
      else if (t === "str" || t === "e") val = v;
      else val = v === null ? null : Number(v);
      row[i] = val;
    }
    rows.push(Array.from(row, (x) => x ?? null));
  }
  return rows;
}

/** CSV with quotes, commas inside quotes and Windows line endings. */
export function parseCsv(text: string): Cell[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.replace(/^\uFEFF/, "")));
}
