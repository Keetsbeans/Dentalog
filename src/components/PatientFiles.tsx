import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "./Toast";
import { ConfirmDialog } from "./ConfirmDialog";
import { dayLabel } from "./Appointments";
import { utcToIst } from "../../shared/time";
import { useMe } from "./AuthGate";

export type FileKind = "xray" | "photo" | "consent" | "document" | "other";
export type PatientFile = { id: string; kind: FileKind; tooth: string | null; note: string | null; filename: string; contentType: string; bytes: number; createdAt: string; visitId: string | null };

const KINDS: [FileKind, string, string][] = [
  ["xray", "X-ray", "X-rays"], ["photo", "Photo", "Photos"], ["document", "Report / document", "Reports"],
  ["consent", "Consent form", "Consent forms"], ["other", "Other", "Other"],
];
const LABEL = Object.fromEntries(KINDS.map(([k, l]) => [k, l])) as Record<FileKind, string>;
const MAX = 25 * 1024 * 1024;

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const ext = (n: string) => (n.includes(".") ? n.split(".").pop()!.slice(0, 4).toUpperCase() : "FILE");
const isImage = (t: string) => /^image\/(png|jpe?g|webp|gif|bmp|avif)$/i.test(t);

/** A sensible first guess from the name and type; the doctor can change it before uploading. */
function guess(f: File): FileKind {
  if (/x-?ray|opg|iopa|rvg|cbct|bitewing|ceph|pano/i.test(f.name)) return "xray";
  if (/consent/i.test(f.name)) return "consent";
  if (f.type.startsWith("image/")) return "photo";
  if (/pdf|word|document|sheet|excel|text/i.test(f.type) || /\.(pdf|docx?|xlsx?|txt|rtf)$/i.test(f.name)) return "document";
  return "other";
}

type Pending = { file: File; kind: FileKind; tooth: string; note: string };

function UploadDialog({ files, defaultTooth, onClose, onUpload }: { files: File[]; defaultTooth: string; onClose: () => void; onUpload: (p: Pending[]) => Promise<void> }) {
  const [list, setList] = useState<Pending[]>(() => files.map((f) => ({ file: f, kind: guess(f), tooth: defaultTooth, note: "" })));
  const [busy, setBusy] = useState(false);
  const tooBig = list.filter((p) => p.file.size > MAX);
  const set = (i: number, patch: Partial<Pending>) => setList(list.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog open wide" role="dialog" aria-labelledby="up-title">
        <h2 id="up-title">Add {list.length === 1 ? "a file" : `${list.length} files`}</h2>
        <ul className="list up-list">
          {list.map((p, i) => (
            <li key={i}>
              <div className="up-name"><b>{p.file.name}</b> <span className="muted">{size(p.file.size)}</span>{p.file.size > MAX && <span className="field-error"> Over 25 MB, can’t upload</span>}</div>
              <div className="up-fields">
                <label className="field"><span className="sr-only">Type</span>
                  <select className="input" value={p.kind} onChange={(e) => set(i, { kind: e.target.value as FileKind })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                </label>
                <label className="field tooth"><span className="sr-only">Tooth</span><input className="input nums" value={p.tooth} onChange={(e) => set(i, { tooth: e.target.value.replace(/[^\d, ]/g, "") })} placeholder="Tooth" /></label>
                <label className="field grow"><span className="sr-only">Note</span><input className="input" value={p.note} maxLength={200} onChange={(e) => set(i, { note: e.target.value })} placeholder="Note (optional)" /></label>
                {list.length > 1 && <button type="button" className="icon-btn" aria-label={`Leave out ${p.file.name}`} onClick={() => setList(list.filter((_, n) => n !== i))}>×</button>}
              </div>
            </li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || list.length === tooBig.length}
            onClick={async () => { setBusy(true); try { await onUpload(list.filter((p) => p.file.size <= MAX)); } finally { setBusy(false); } }}>
            {busy ? "Uploading…" : `Upload ${list.length - tooBig.length === 1 ? "" : `${list.length - tooBig.length} `}${list.length - tooBig.length === 1 ? "file" : "files"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function FileCard({ f, onEdit, onDelete }: { f: PatientFile; onEdit: () => void; onDelete: () => void }) {
  const { can } = useMe();
  const t = utcToIst(f.createdAt);
  const url = `/api/files/${f.id}`;
  return (
    <li className="file-card">
      <a className="file-thumb" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${f.filename}`}>
        {isImage(f.contentType) ? <img src={url} alt="" loading="lazy" /> : <span className="file-ext">{ext(f.filename)}</span>}
      </a>
      <div className="file-meta">
        <a href={url} target="_blank" rel="noopener noreferrer" className="file-name">{f.filename}</a>
        <span className="muted">{LABEL[f.kind]}{f.tooth ? ` · tooth ${f.tooth}` : ""} · {dayLabel(t.day, { day: "numeric", month: "short", year: "numeric" })} · {size(f.bytes)}</span>
        {f.note && <span className="file-note">{f.note}</span>}
        <span className="file-actions">
          {can("files.edit") && <button type="button" className="link-btn inline" onClick={onEdit}>Edit</button>}
          <a className="link-btn inline" href={`${url}?download=1`}>Download</a>
          {can("delete") && <button type="button" className="link-btn inline danger-text" onClick={onDelete}>Delete</button>}
        </span>
      </div>
    </li>
  );
}

function EditFile({ f, onClose, onSaved }: { f: PatientFile; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState(f.kind);
  const [tooth, setTooth] = useState(f.tooth ?? "");
  const [note, setNote] = useState(f.note ?? "");
  const [err, setErr] = useState("");
  async function save() {
    try { await api(`/files/${f.id}`, { method: "PATCH", body: JSON.stringify({ kind, tooth, note }) }); onSaved(); }
    catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog open" role="dialog" aria-labelledby="ef-title">
        <h2 id="ef-title">{f.filename}</h2>
        <label className="field">Type<select className="input" value={kind} onChange={(e) => setKind(e.target.value as FileKind)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field">Tooth<input className="input nums" value={tooth} onChange={(e) => setTooth(e.target.value.replace(/[^\d, ]/g, ""))} placeholder="e.g. 16, or 36, 46" /></label>
        <label className="field">Note<input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></label>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

/** X-rays, photos, consent forms, reports and any other file, on the patient's record. */
export function PatientFiles({ patientId, patientName }: { patientId: string; patientName: string }) {
  const toast = useToast();
  const [files, setFiles] = useState<PatientFile[] | null>(null);
  const [err, setErr] = useState("");
  const [kind, setKind] = useState<FileKind | "all">("all");
  const [tooth, setTooth] = useState("");
  const [picked, setPicked] = useState<File[] | null>(null);
  const [editing, setEditing] = useState<PatientFile | null>(null);
  const [toDelete, setToDelete] = useState<PatientFile | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = () => api<PatientFile[]>(`/patients/${patientId}/files`).then(setFiles).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(list: Pending[]) {
    setErr("");
    let done = 0;
    for (const p of list) {
      const fd = new FormData();
      fd.append("file", p.file); fd.append("kind", p.kind); fd.append("tooth", p.tooth.trim()); fd.append("note", p.note.trim());
      const res = await fetch(`/api/patients/${patientId}/files`, { method: "POST", body: fd });
      if (!res.ok) {
        const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Couldn’t upload ${p.file.name}.`;
        setErr(done ? `${done} uploaded. ${msg}` : msg);
        break;
      }
      done++;
    }
    setPicked(null);
    await load();
    if (done) toast({ title: done === 1 ? `${list[0]!.file.name} added` : `${done} files added`, sub: `To ${patientName}’s record` });
  }

  async function confirmDelete() {
    const f = toDelete!;
    setToDelete(null);
    try {
      await api(`/files/${f.id}`, { method: "DELETE" });
      setFiles((xs) => xs?.filter((x) => x.id !== f.id) ?? null);
      toast({
        title: `“${f.filename}” deleted`, sub: "File · moving to Recently deleted",
        onUndo: async () => { await api(`/trash/file/${f.id}/restore`, { method: "POST" }); toast({ title: `${f.filename} is back.` }); load(); },
      });
    } catch (e) { setErr((e as Error).message); }
  }

  const teeth = [...new Set((files ?? []).flatMap((f) => (f.tooth ?? "").split(/[,\s]+/).filter(Boolean)))].sort((a, b) => Number(a) - Number(b));
  const shown = (files ?? []).filter((f) => (kind === "all" || f.kind === kind) && (!tooth || (f.tooth ?? "").split(/[,\s]+/).includes(tooth)));
  const count = (k: FileKind) => (files ?? []).filter((f) => f.kind === k).length;
  const choose = (list: FileList | null) => { if (list?.length) setPicked([...list]); if (input.current) input.current.value = ""; };

  return (
    <section className={"card files" + (drag ? " drag" : "")}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files); }}>
      <div className="card-head">
        <div><h2>Files and X-rays</h2><span className="muted">Any type: X-rays, photos, PDFs, reports, consent forms. Up to 25 MB each.</span></div>
        <input ref={input} id="pf-files" type="file" multiple className="sr-only" onChange={(e) => choose(e.target.files)} />
        <label htmlFor="pf-files" className="btn primary">Add files</label>
      </div>
      {files && files.length > 0 && (
        <div className="files-filter">
          <div className="chips" role="group" aria-label="Show">
            <button type="button" className={"chip" + (kind === "all" ? " on" : "")} aria-pressed={kind === "all"} onClick={() => setKind("all")}>All {files.length}</button>
            {KINDS.filter(([k]) => count(k)).map(([k, , plural]) => <button key={k} type="button" className={"chip" + (kind === k ? " on" : "")} aria-pressed={kind === k} onClick={() => setKind(k)}>{plural} {count(k)}</button>)}
          </div>
          {teeth.length > 0 && (
            <label className="field inline">Tooth
              <select className="input" value={tooth} onChange={(e) => setTooth(e.target.value)}><option value="">Any</option>{teeth.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            </label>
          )}
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
      {!files ? <p className="muted">Loading…</p> : files.length === 0 ? (
        <label htmlFor="pf-files" className="file-drop">Drop files here, or tap <b>Add files</b>. On a phone you can take a photo straight away.</label>
      ) : shown.length === 0 ? <p className="muted">Nothing matches.</p> : (
        <ul className="file-grid">{shown.map((f) => <FileCard key={f.id} f={f} onEdit={() => setEditing(f)} onDelete={() => setToDelete(f)} />)}</ul>
      )}
      {picked && <UploadDialog files={picked} defaultTooth={tooth} onClose={() => setPicked(null)} onUpload={upload} />}
      {editing && <EditFile f={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); toast({ title: "File details saved" }); }} />}
      <ConfirmDialog open={!!toDelete} title={`Delete ${toDelete?.filename ?? "this file"}?`} confirmLabel="Delete file" onConfirm={confirmDelete} onCancel={() => setToDelete(null)}>
        <p>{toDelete ? `${LABEL[toDelete.kind]}${toDelete.tooth ? ` · tooth ${toDelete.tooth}` : ""} on ${patientName}’s record.` : ""}</p>
      </ConfirmDialog>
    </section>
  );
}
