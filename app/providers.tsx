"use client";

import { useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { PersisterProvider } from "./pwa/offline-data";
import {
  PERSIST_BUSTER,
  PERSIST_MAX_AGE_MS,
  createPersister,
  indexedDbCacheStore,
  shouldPersistQuery,
} from "./pwa/query-persistence";
import { SignedOutGate } from "./pwa/signed-out-gate";
import { ToastProvider } from "./pwa/toast";

/**
 * The app's TanStack Query client (D4). Reads that need to stay fresh — the open
 * board and the open card's thread — declare their own `refetchInterval`; nothing
 * else polls.
 *
 * The client is created in state, not at module scope, so each browser session
 * gets exactly one and a server render never shares a cache between two users.
 *
 * It is also persisted to IndexedDB (D8): the cache is restored before the first
 * query runs and written back after every change, so an installed app launched
 * with no network opens on the board it last saw. `shouldPersistQuery` decides
 * what's eligible; nothing else is written to the device.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // A poll that fails (a dropped connection, a sleeping laptop) shouldn't
            // hammer the server; the next interval tick is a retry anyway.
            retry: 1,
            // Polling is driven by the interval and the version guard. Coming back
            // to the tab should still re-check immediately — that's the one extra
            // trigger worth having.
            refetchOnWindowFocus: true,
            // Matched to how long a persisted cache stays usable: a board dropped
            // from memory five minutes after its card was closed would never be
            // written back, and the offline copy would rot while the app was open.
            gcTime: PERSIST_MAX_AGE_MS,
          },
        },
      }),
  );

  // Kept as its own value, not just handed to the provider: signing out has to be
  // able to switch it off before it empties the device, or a query settling
  // mid-clear would write the boards straight back (ticket 19).
  const [persister] = useState(() => createPersister(indexedDbCacheStore()));

  const [persistOptions] = useState(() => ({
    persister,
    maxAge: PERSIST_MAX_AGE_MS,
    buster: PERSIST_BUSTER,
    dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
  }));

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <PersisterProvider value={persister}>
        <ToastProvider>
          {/* Signing out in one tab has to empty the others too — including the
              board still on their screens. */}
          <SignedOutGate>{children}</SignedOutGate>
        </ToastProvider>
      </PersisterProvider>
    </PersistQueryClientProvider>
  );
}
