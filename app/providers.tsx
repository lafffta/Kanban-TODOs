"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The app's TanStack Query client (D4). Reads that need to stay fresh — the open
 * board and the open card's thread — declare their own `refetchInterval`; nothing
 * else polls.
 *
 * The client is created in state, not at module scope, so each browser session
 * gets exactly one and a server render never shares a cache between two users.
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
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
