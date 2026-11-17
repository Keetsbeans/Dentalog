import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Toast = { id: number; title: string; sub?: string; onUndo?: () => void | Promise<void> };
const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

/** The bar at the bottom: "“Kavya Raman (CJ962)” deleted · Undo", gone after 6 seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((t: Omit<Toast, "id">) => {
    window.clearTimeout(timer.current);
    const id = Date.now();
    setToast({ ...t, id });
    timer.current = window.setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), t.onUndo ? 6000 : 3500);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        <div className="toast" role="status" aria-live="polite" key={toast.id}>
          <div className="toast-body">
            <div className="toast-text">
              <strong>{toast.title}</strong>
              {toast.sub && <span>{toast.sub}</span>}
            </div>
            {toast.onUndo && (
              <button type="button" className="toast-undo" onClick={async () => { const u = toast.onUndo; setToast(null); await u?.(); }}>
                Undo
              </button>
            )}
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => setToast(null)}>×</button>
          </div>
          {toast.onUndo && <div className="toast-bar"><div /></div>}
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
