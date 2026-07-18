"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type ToastKind = "success" | "error";
interface ToastState {
  id: number;
  message: string;
  kind: ToastKind;
}

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

/** App-wide toast host. Wrap the Home experience once. */
export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const show = useCallback((message: string, kind: ToastKind = "success") => {
    if (timer.current) clearTimeout(timer.current);
    const id = ++idRef.current;
    setToast({ id, message, kind });
    timer.current = setTimeout(() => {
      setToast((cur) => (cur?.id === id ? null : cur));
    }, 2800);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-[200] flex justify-center px-4"
      >
        {toast && (
          <div
            className="pointer-events-auto rounded-full px-5 py-2.5 text-sm font-medium text-white shadow-lg"
            style={{ background: toast.kind === "error" ? "#DC2626" : "#111827" }}
            role="status"
          >
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
