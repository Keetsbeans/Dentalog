import { useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { readSheets, type Sheet } from "../lib/readSheet";
import { checkRow, FIELD_LABEL, FIELDS, guessColumns, type Cell, type ImportField, type ImportRow } from "../../shared/importPatients";
import { formatPhone } from "../../shared/phone";

const BATCH = 500;
type Result = { added: number; skipped: { name: string; reason: string }[] };

/** The header row is the first row with at least two filled cells; patients are the rows under it. */
function split(rows: Cell[][]) {
  const filled = (r: Cell[]) => r.filter((c) => c !== null && String(c).trim() !== "").length;
  const h = rows.findIndex((r) => filled(r) >= 2);
  if (h < 0) return { headers: [] as string[], body: [] as Cell[][] };
  const width = Math.max(...rows.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => String(rows[h]![i] ?? "").trim());
  return { headers, body: rows.slice(h + 1).filter((r) => filled(r) > 0) };
}

/** Owner only: bring in patients from the old Excel sheet. Nothing is saved until "Add patients". */
export function ImportPatients({ onClose, onDone }: { onClose: () => void; onDone: (added: number) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [sheetNo, setSheetNo] = useState(0);
  const [map, setMap] = useState<Partial<Record<ImportField, number>>>({});
  const [keepRest, setKeepRest] = useState(true);
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const { headers, body } = useMemo(() => split(sheets?.[sheetNo]?.rows ?? []), [sheets, sheetNo]);
  const checked = useMemo(() => {
    const used = new Set(Object.values(map));
    const extra = keepRest ? headers.map((_, i) => i).filter((i) => !used.has(i) && headers[i]) : [];
    return body.map((r) => checkRow(r, map, headers, extra));
  }, [body, headers, map, keepRest]);
  const ready = checked.filter((c) => !c.skip);
  const noName = checked.length - ready.length;
  const noPhone = ready.filter((c) => !c.row.phone).length;
  const flagged = ready.filter((c) => c.problems.length);

  async function pick(f: File | undefined) {
    if (!f) return;
    setErr(""); setResult(null);
    try {
      const all = (await readSheets(f)).filter((s) => s.rows.length);
      if (!all.length) throw new Error("That file has no rows.");
      // Start on the sheet with the most rows; most clinics keep one big list.
      const best = all.reduce((b, s, i) => (s.rows.length > all[b]!.rows.length ? i : b), 0);
      setSheets(all); setSheetNo(best); setFileName(f.name);
      setMap(guessColumns(split(all[best]!.rows).headers));
    } catch (e) { setErr((e as Error).message); }
    if (input.current) input.current.value = "";
  }
  function chooseSheet(i: number) { setSheetNo(i); setMap(guessColumns(split(sheets![i]!.rows).headers)); }

  async function run() {
    setErr(""); setProgress(0);
    // Rows that bring their own patient ID go first, so new numbers never take an old one.
    const rows: ImportRow[] = ready.map((c) => c.row).sort((a, b) => Number(!a.code) - Number(!b.code));
    const out: Result = { added: 0, skipped: [] };
    try {
      for (let i = 0; i < rows.length; i += BATCH) {
        const r = await api<Result>("/patients/import", { method: "POST", body: JSON.stringify({ rows: rows.slice(i, i + BATCH) }) });
        out.added += r.added; out.skipped.push(...r.skipped);
        setProgress(Math.min(rows.length, i + BATCH));
      }
      setResult(out);
    } catch (e) {
      setErr(`${(e as Error).message} ${out.added ? `${out.added} patients were added before this. Choosing the same file again skips them.` : ""}`);
      if (out.added) setResult(out);
    } finally { setProgress(null); }
  }

  const colSelect = (f: ImportField) => (
    <select className="input" value={map[f] ?? ""} onChange={(e) => setMap({ ...map, [f]: e.target.value === "" ? undefined : Number(e.target.value) })}>
      <option value="">Not in my sheet</option>
      {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
    </select>
  );
  const sample = ready.slice(0, 5).map((c) => c.row);

  return (
    <div className="overlay scroll" onClick={(e) => e.target === e.currentTarget && progress === null && onClose()}>
      <div className="dialog open import-dialog" role="dialog" aria-labelledby="imp-title">
        <h2 id="imp-title">Import patients from Excel</h2>

        {result ? (
          <>
            <p className="ok-text"><b>{result.added.toLocaleString("en-IN")} patients added.</b></p>
            {result.skipped.length > 0 && <>
              <p>{result.skipped.length.toLocaleString("en-IN")} skipped:</p>
              <ul className="imp-skips">{result.skipped.slice(0, 50).map((s, i) => <li key={i}><b>{s.name}</b> <span className="muted">{s.reason}</span></li>)}</ul>
              {result.skipped.length > 50 && <p className="muted small">…and {result.skipped.length - 50} more.</p>}
            </>}
            <div className="dialog-actions"><button type="button" className="btn primary" onClick={() => onDone(result.added)}>Done</button></div>
          </>
        ) : !sheets ? (
          <>
            <p className="muted">Choose your Excel sheet (.xlsx) or a CSV. The first row should have the column names, like Name, Mobile, Age. Nothing is added until you check it and tap <b>Add patients</b>.</p>
            <input ref={input} id="imp-file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
            <label htmlFor="imp-file" className="file-drop">Tap to choose the file</label>
            {err && <p className="error" role="alert">{err}</p>}
            <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
          </>
        ) : (
          <>
            <p className="muted"><b>{fileName}</b>{sheets.length > 1 ? "" : ` · ${body.length.toLocaleString("en-IN")} rows`} · <button type="button" className="link-btn inline" onClick={() => { setSheets(null); setFileName(""); }}>Choose another file</button></p>
            {sheets.length > 1 && (
              <label className="field">Sheet
                <select className="input" value={sheetNo} onChange={(e) => chooseSheet(Number(e.target.value))}>
                  {sheets.map((s, i) => <option key={i} value={i}>{s.name} ({Math.max(0, s.rows.length - 1)} rows)</option>)}
                </select>
              </label>
            )}
            <fieldset className="field"><legend>Match your columns</legend>
              <span className="muted small">I’ve guessed from the column names. Change any that are wrong.</span>
              <div className="imp-map">
                {FIELDS.map((f) => <label key={f} className="field">{FIELD_LABEL[f]}{colSelect(f)}</label>)}
              </div>
              <label className="check"><input type="checkbox" checked={keepRest} onChange={(e) => setKeepRest(e.target.checked)} /> Put every other column into the patient’s notes, so nothing is lost</label>
            </fieldset>

            <div className="imp-summary">
              <b>{ready.length.toLocaleString("en-IN")} patients ready to add.</b>
              {noName > 0 && <span className="muted"> {noName} {noName === 1 ? "row" : "rows"} without a name will be left out.</span>}
              {noPhone > 0 && <span className="muted"> {noPhone} have no usable mobile number; they’re added, but can’t get WhatsApp messages until you add one.</span>}
              <span className="muted"> Anyone already in Dentalog with the same name and mobile, or the same patient ID, is skipped.</span>
            </div>
            {map.name === undefined && <p className="error">Choose which column has the patient’s name.</p>}

            {sample.length > 0 && (
              <div className="table-wrap">
                <table className="imp-preview">
                  <thead><tr><th>Name</th><th>Mobile</th><th>ID / file</th><th>Born</th><th>Alerts</th><th>Since</th></tr></thead>
                  <tbody>{sample.map((r, i) => (
                    <tr key={i}>
                      <td><b>{r.name}</b>{r.gender ? ` · ${r.gender}` : ""}</td>
                      <td className="nums">{r.phone ? formatPhone(r.phoneCc, r.phone) : <span className="muted">none</span>}</td>
                      <td>{r.code ?? <span className="muted">new</span>}{r.fileNo ? ` · ${r.fileNo}` : ""}</td>
                      <td className="nums">{r.birthYear ?? ""}</td>
                      <td>{r.alerts.join(", ")}</td>
                      <td className="nums">{r.createdAt ?? <span className="muted">today</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {flagged.length > 0 && (
              <details className="imp-flags"><summary>{flagged.length} rows to look at later</summary>
                <ul>{flagged.slice(0, 30).map((c, i) => <li key={i}><b>{c.row.name}</b> <span className="muted">{c.problems.join(" · ")}</span></li>)}</ul>
              </details>
            )}

            {err && <p className="error" role="alert">{err}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn" disabled={progress !== null} onClick={onClose}>Cancel</button>
              <button type="button" className="btn primary" disabled={progress !== null || !ready.length || map.name === undefined} onClick={run}>
                {progress !== null ? `Adding ${progress.toLocaleString("en-IN")} of ${ready.length.toLocaleString("en-IN")}…` : `Add ${ready.length.toLocaleString("en-IN")} patients`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
