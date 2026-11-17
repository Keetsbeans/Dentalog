import { useEffect, useRef, type ReactNode } from "react";

/** Asks before anything is deleted. Uses the browser's <dialog> so Esc and focus work properly. */
export function ConfirmDialog(props: {
  open: boolean; title: string; children: ReactNode; warning?: string;
  confirmLabel: string; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); props.onCancel(); }} aria-labelledby="cf-title">
      <h2 id="cf-title">{props.title}</h2>
      <div className="dialog-body">{props.children}</div>
      {props.warning && <p className="warn"><b>Check first:</b> {props.warning}</p>}
      <p className="note">It moves to Recently deleted. You can restore it for 30 days; after that it is removed for good.</p>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={props.onCancel} autoFocus>Keep it</button>
        <button type="button" className="btn danger" onClick={props.onConfirm}>{props.confirmLabel}</button>
      </div>
    </dialog>
  );
}
