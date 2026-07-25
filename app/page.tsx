import { getLatestGreeting } from "@/db/queries";

// The hello page proves the DB round-trip at request time, so it must never be
// statically prerendered at build (when no DB is reachable).
export const dynamic = "force-dynamic";

export default async function Home() {
  let greeting: string | null = null;
  let error: string | null = null;

  try {
    greeting = await getLatestGreeting();
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown database error";
  }

  return (
    <main className="flex flex-1 items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-md rounded-2xl border border-black/10 p-8 text-center dark:border-white/15">
        <h1 className="text-2xl font-semibold">Kanban Task Tracker</h1>
        <p className="mt-1 text-sm opacity-60">Walking skeleton</p>

        <div className="mt-6 rounded-xl bg-black/5 p-5 dark:bg-white/10">
          {greeting ? (
            <>
              <p className="text-lg font-medium">{greeting}</p>
              <p className="mt-2 text-xs opacity-60">
                ✅ Fetched from Postgres — the pipe works end to end.
              </p>
            </>
          ) : error ? (
            <>
              <p className="text-lg font-medium text-red-600 dark:text-red-400">
                Database not reachable
              </p>
              <p className="mt-2 break-words text-xs opacity-60">{error}</p>
            </>
          ) : (
            <>
              <p className="text-lg font-medium">No greeting yet</p>
              <p className="mt-2 text-xs opacity-60">
                Run <code>npm run db:seed</code> to insert one.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
