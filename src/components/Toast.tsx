import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Text } from "@cloudflare/kumo";

type ToastKind = "error" | "success" | "info";

type Toast = { id: number; message: string; kind: ToastKind };

type ToastContextValue = {
  toast: (message: string, kind?: ToastKind) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm"
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map((t) => (
          <output
            key={t.id}
            className={`rounded-lg border px-4 py-2.5 shadow-lg text-sm pointer-events-auto ${
              t.kind === "error"
                ? "bg-red-950/95 border-red-800 text-red-100"
                : t.kind === "success"
                  ? "bg-emerald-950/95 border-emerald-800 text-emerald-100"
                  : "bg-kumo-base border-kumo-line text-kumo-default"
            }`}
          >
            <Text size="sm">{t.message}</Text>
          </output>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
