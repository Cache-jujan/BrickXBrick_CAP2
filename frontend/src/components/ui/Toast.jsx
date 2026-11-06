import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../../i18n/LocaleProvider";
import "./Toast.css";

// App-wide confirmation pop-ups ("toasts"): a short message in the top-right
// corner after an action finishes, so the user knows it worked even when the
// item they acted on leaves the list. Success and info close by themselves;
// an error stays until it is dismissed.
//
// Errors the user has to fix belong next to the field or card they are about,
// not in a toast. Use a toast for "it worked" and for failures that have no
// better place on screen.
//
// Usage:
//   const toast = useToast();
//   toast.success(tr("tq.toast_saved"));
//
// Wording: short, past tense, says what happened and to what —
// "“Gutter” assigned to Ana Cruz.", "Changes saved." — not "Success!".

const ToastContext = createContext(null);
const AUTO_CLOSE_MS = { success: 4500, info: 4500, error: 0 }; // 0 = stays until dismissed
const MAX_ON_SCREEN = 3;
const NOOP = { success() {}, info() {}, error() {} };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const nextId = useRef(0);

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((tone, message) => {
    if (!message) return;
    nextId.current += 1;
    const id = nextId.current;
    setToasts((list) => [...list.slice(-(MAX_ON_SCREEN - 1)), { id, tone, message }]);
    const ms = AUTO_CLOSE_MS[tone];
    if (ms) timers.current.set(id, setTimeout(() => dismiss(id), ms));
  }, [dismiss]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, []);

  const api = useMemo(() => ({
    success: (message) => show("success", message),
    info: (message) => show("info", message),
    error: (message) => show("error", message),
  }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// Outside a ToastProvider (an isolated render) toasts quietly do nothing.
export function useToast() {
  return useContext(ToastContext) ?? NOOP;
}

const ICONS = { success: "✓", error: "!", info: "i" };

function ToastStack({ toasts, onDismiss }) {
  const { t } = useLocale();
  // The container is always on the page so screen readers announce new toasts.
  return (
    <div className="app-toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <div key={toast.id} className={`app-toast app-toast-${toast.tone}`}>
          <span className="app-toast-icon" aria-hidden="true">{ICONS[toast.tone]}</span>
          <p className="app-toast-text">{toast.message}</p>
          <button type="button" className="app-toast-close" onClick={() => onDismiss(toast.id)} aria-label={t("toast.dismiss")}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
