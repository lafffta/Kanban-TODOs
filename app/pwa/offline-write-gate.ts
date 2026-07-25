"use client";

import { useCallback } from "react";
import { OFFLINE_WRITE_MESSAGE, useOnline } from "./connection";
import { useToast } from "./toast";

/**
 * The one gate every write passes through while the device is offline (D8).
 *
 * Offline the app is read-only: there is no write queue, so a mutation has to be
 * refused *before* it is sent, rather than shown as saved and lost. Refusing at
 * the surface rather than letting the request fail also means the user is told
 * why — a server action whose fetch simply rejects surfaces as nothing at all, or
 * as an error boundary.
 *
 * The toast is because most writes here have no form of their own to report into:
 * a drag, a menu pick, a role change. Callers that *do* have somewhere to put an
 * error get the message back to show there as well.
 *
 * @returns a check to run first: the message when the write must be refused (and
 * the toast is already showing it), or null when it may go ahead.
 */
export function useOfflineWriteGate(): () => string | null {
  const online = useOnline();
  const { show } = useToast();

  return useCallback(() => {
    if (online) return null;
    show(OFFLINE_WRITE_MESSAGE);
    return OFFLINE_WRITE_MESSAGE;
  }, [online, show]);
}
