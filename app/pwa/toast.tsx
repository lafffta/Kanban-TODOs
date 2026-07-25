"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * A one-line transient message.
 *
 * It exists for the case the ticket names: a mutation refused because the device
 * is offline. Those refusals happen far from any one form — a drag, an assignee
 * change, a comment — so they need somewhere to be said that every board control
 * can reach.
 *
 * Deliberately one message at a time: a second toast replaces the first rather
 * than stacking, because two refusals in a row are the same news twice.
 */
type ToastControls = { show: (message: string) => void };

const ToastContext = createContext<ToastControls | null>(null);

const TOAST_MS = 4_000;

export function useToast(): ToastControls {
  const controls = useContext(ToastContext);
  if (!controls) throw new Error("useToast must be used inside <ToastProvider>.");
  return controls;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: string) => {
    setMessage(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), TOAST_MS);
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {/* Live region rather than an alert: a paused change is news, not an
          emergency, and it shouldn't interrupt what's being read. */}
      <div
        role="status"
        aria-live="polite"
        // Above everything, the card sheet included: a refusal has to be readable
        // from wherever the refused control was, and on a phone that control is
        // usually inside the sheet.
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        {message && (
          <p className="max-w-sm rounded-xl bg-slate-900 px-4 py-2 text-center text-sm text-white shadow-lg dark:bg-white dark:text-slate-900">
            {message}
          </p>
        )}
      </div>
    </ToastContext.Provider>
  );
}
