import { useEffect, useState } from "react";
import { X } from "lucide-react";

interface Toast {
  id: number;
  message: string;
  status?: number;
}

// Auto-dismiss after this long. Generous so users can read the error.
const TOAST_TTL_MS = 8000;
// Never stack more than this many at once — keep the newest.
const MAX_TOASTS = 4;

let toastSeq = 0;

/**
 * Listens on the global `ut:error` bus and renders stacked, dismissible toast
 * cards bottom-right. This is the single place site-wide errors surface — every
 * API helper in `lib/api.ts` calls `broadcastError`, which dispatches `ut:error`.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { message, status } = (e as CustomEvent).detail as {
        message: string;
        status?: number;
      };
      if (!message) return;
      setToasts((prev) => {
        // Dedup an identical error that's still on screen.
        if (prev.some((t) => t.message === message && t.status === status)) {
          return prev;
        }
        const next = [...prev, { id: ++toastSeq, message, status }];
        return next.slice(-MAX_TOASTS);
      });
    };
    window.addEventListener("ut:error", handler);
    return () => window.removeEventListener("ut:error", handler);
  }, []);

  const dismiss = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
      aria-live="assertive"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_TTL_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      role="alert"
      className="animate-toast-in flex items-start gap-2 rounded-lg border border-red-200 bg-white px-3 py-2.5 shadow-lg"
    >
      {toast.status ? (
        <span className="mt-0.5 shrink-0 rounded bg-red-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-red-600">
          {toast.status}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 break-words text-sm text-stone-800">
        {toast.message}
      </span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="-mr-1 shrink-0 rounded p-0.5 text-stone-400 hover:text-stone-600 cursor-pointer"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
