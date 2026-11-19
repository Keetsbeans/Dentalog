/** Turning rows of an old patient spreadsheet into Dentalog patients. Used by the import screen and its tests. */

export type ImportField = "name" | "phone" | "code" | "fileNo" | "age" | "dob" | "gender" | "email" | "alerts" | "registered" | "notes";

export const FIELD_LABEL: Record<ImportField, string> = {
  name: "Name", phone: "Mobile", code: "Patient ID (e.g. CJ412)", fileNo: "File number", age: "Age", dob: "Date of birth",
  gender: "Gender", email: "Email", alerts: "Medical history / alerts", registered: "First visit or registered on", notes: "Notes",
};
export const FIELDS = Object.keys(FIELD_LABEL) as ImportField[];

/** Header words that usually mean each field, checked in this order. */
const GUESS: [ImportField, RegExp][] = [
  ["fileNo", /file/i],
  ["code", /patient\s*(id|no|code)|^(id|code|op\s*no\.?|reg(istration)?\s*(no|number|id)\.?)$|\bcj\b/i],
  ["email", /e-?mail/i],
  ["phone", /mobile|phone|contact|cell|whats\s*app|^ph\.?$|^mob\.?$/i],
  ["dob", /dob|date\s*of\s*birth|birth/i],
  ["age", /^age\b|\bage$/i],
  ["gender", /gender|^sex$/i],
  ["alerts", /medical|alert|allerg|history|systemic|condition/i],
  ["registered", /regist|\breg\b|first\s*visit|since|joined|created|date/i],
  ["name", /name/i],
  ["notes", /note|remark|address|comment|complaint/i],
];

/** Best guess of which column holds each field. Each column is used once; notes may take several. */
export function guessColumns(headers: string[]): Partial<Record<ImportField, number>> {
  const out: Partial<Record<ImportField, number>> = {};
  const used = new Set<number>();
  for (const [field, re] of GUESS) {
    const i = headers.findIndex((h, n) => !used.has(n) && re.test(h.trim()) && !(field === "name" && /father|guardian|husband|doctor|dr\.?\s|ref/i.test(h)));
    if (i >= 0 && out[field] === undefined) { out[field] = i; used.add(i); }
  }
  return out;
}

export type Cell = string | number | boolean | null;
export type ImportRow = {
  name: string; phone: string; phoneCc: string; code: string | null; fileNo: string | null; birthYear: number | null;
  gender: "F" | "M" | "O" | null; email: string | null; alerts: string[]; createdAt: string | null; notes: string | null;
};
export type Checked = { row: ImportRow; problems: string[]; skip: boolean };

const text = (v: Cell | undefined) => (v === null || v === undefined ? "" : String(v)).replace(/\s+/g, " ").trim();

/** Excel stores dates as days since 1899-12-30. Also reads 15/03/2023, 15-03-23 and 2023-03-15. */
export function readDate(v: Cell | undefined): string | null {
  if (typeof v === "number" && v > 1000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = text(v);
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) { const y = +m[3]!; return iso(y < 100 ? 2000 + y : y, +m[2]!, +m[1]!); } // Indian order: day first
  return null;
}
const iso = (y: number, mo: number, d: number) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 1900 && y < 2100 ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null);

/** The first usable mobile in a cell like "+91 98400-12345 / 044 2626 1234". */
export function readPhone(v: Cell | undefined): { cc: string; phone: string } | null {
  const raw = typeof v === "number" ? String(Math.round(v)) : text(v);
  for (const part of raw.split(/[/,;|&]|\bor\b/i)) {
    let d = part.replace(/\D/g, "");
    if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
    else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
    if (/^[6-9]\d{9}$/.test(d)) return { cc: "91", phone: d };
  }
  return null;
}

function readGender(v: Cell | undefined): ImportRow["gender"] {
  const s = text(v).toLowerCase();
  if (/^(f|female|woman|girl|mrs|ms|miss)\b/.test(s)) return "F";
  if (/^(m|male|man|boy|mr)\b/.test(s)) return "M";
  return s ? "O" : null;
}

const NONE = /^(nil|none|no|na|n\/a|nad|-|–|—|normal|no relevant|not significant|nothing)\.?$/i;

/**
 * One spreadsheet row → a patient, with anything that needs a look.
 * `extra` columns (not mapped to a field) go into notes as "Header: value" so nothing is lost.
 */
export function checkRow(cells: Cell[], map: Partial<Record<ImportField, number>>, headers: string[], extra: number[], today = new Date()): Checked {
  const get = (f: ImportField) => (map[f] === undefined ? undefined : cells[map[f]!]);
  const problems: string[] = [];
  const name = text(get("name")).slice(0, 120);
  const ph = readPhone(get("phone"));
  if (!name) problems.push("No name");
  if (map.phone !== undefined && text(get("phone")) && !ph) problems.push(`Mobile “${text(get("phone"))}” isn’t a 10-digit mobile`);
  if (map.phone !== undefined && !text(get("phone"))) problems.push("No mobile");

  const registered = readDate(get("registered"));
  const dob = readDate(get("dob"));
  let birthYear: number | null = dob ? +dob.slice(0, 4) : null;
  const ageText = text(get("age"));
  if (!birthYear && ageText) {
    const age = parseInt(ageText, 10);
    // An age written down when they registered: count from then.
    const from = registered ? +registered.slice(0, 4) : today.getFullYear();
    if (age >= 0 && age <= 110) birthYear = from - age;
  }

  const email = text(get("email")).toLowerCase();
  const alertsText = text(get("alerts"));
  const alerts = NONE.test(alertsText) ? [] : alertsText.split(/[,;/\n]+/).map((a) => a.trim()).filter((a) => a && !NONE.test(a));
  const code = text(get("code")).toUpperCase().replace(/\s+/g, "");
  const notes = [text(get("notes")), ...extra.map((i) => (text(cells[i]) ? `${headers[i] || "Column " + (i + 1)}: ${text(cells[i])}` : ""))].filter(Boolean).join("\n");

  const row: ImportRow = {
    name, phone: ph?.phone ?? "", phoneCc: ph?.cc ?? "91",
    code: code || null, fileNo: text(get("fileNo")) || null,
    birthYear, gender: readGender(get("gender")),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null,
    alerts, createdAt: registered, notes: notes ? notes.slice(0, 2000) : null,
  };
  const blank = cells.every((c) => !text(c));
  return { row, problems, skip: blank || !name };
}
