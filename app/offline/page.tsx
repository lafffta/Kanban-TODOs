import Link from "next/link";

/**
 * The last-resort offline page: what the service worker serves when a page load
 * fails and it has never cached that page (D8).
 *
 * It is the only page in the app that must render with no server, no session and
 * no database, so it is deliberately static and says nothing user-specific.
 */
export const metadata = { title: "Offline — Kanban Task Tracker" };

export default function OfflinePage() {
  return (
    <main className="flex flex-1 items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-md rounded-2xl border border-black/10 p-8 text-center dark:border-white/15">
        <h1 className="text-2xl font-semibold">You&rsquo;re offline</h1>
        <p className="mt-2 text-sm opacity-70">
          This page hasn&rsquo;t been opened on this device yet, so there&rsquo;s no copy to
          show. Boards you&rsquo;ve already visited still open.
        </p>
        <Link
          href="/boards"
          className="mt-6 inline-block rounded-lg border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
        >
          Your boards
        </Link>
      </div>
    </main>
  );
}
