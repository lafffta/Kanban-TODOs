"use client";

import { useEffect } from "react";
import { clearDevice } from "./device-clearing";
import { deviceAreas } from "./offline-data";

/**
 * A second sweep of the device, on the page a sign-out lands on (ticket 19).
 *
 * The sign-out's own clearing has one gap it cannot close from where it stands:
 * a request that was already on the wire. A poll issued by another tab moments
 * before it was told to stop still resolves, and the service worker still files
 * the response — into the data cache that was swept a moment earlier. The retries
 * cover most of a second, which is most but not all of that window.
 *
 * So the sign-in page sweeps again on arrival. Nobody is signed in here, which
 * makes clearing unconditionally safe, and by now every request from the session
 * that just ended has long since landed.
 *
 * Unlike the sign-out's clearing this one reports to nobody: it is a backstop, not
 * the guarantee. The guarantee is made where there is still a session to hold on
 * to if it can't be kept.
 */
export function LeftoverSweep(): null {
  useEffect(() => {
    void clearDevice(deviceAreas());
  }, []);

  return null;
}
