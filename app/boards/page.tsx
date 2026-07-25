import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { listBoardsForUser } from "@/db/boards";
import { InstallButton } from "@/app/pwa/install-button";
import { LastBoardLaunch } from "@/app/pwa/last-board-launch";
import { OfflineCopyWarmer } from "@/app/pwa/service-worker";
import { CreateBoardForm } from "./create-board-form";
import { SignOutButton } from "./sign-out-button";

// Protected page: gated by the session. Lists the boards the signed-in user is a
// member of and lets them create one. Membership scoping (listBoardsForUser)
// means two accounts each see only their own boards — the ticket 03 demo.
export default async function BoardsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const boards = await listBoardsForUser(session.user.id);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-8 overflow-y-auto p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Your boards</h1>
          <p className="mt-1 text-sm opacity-60">Signed in as {session.user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Only rendered once the browser says the app is installable (D8). */}
          <InstallButton />
          <SignOutButton
            signOut={async () => {
              "use server";
              await signOut({ redirectTo: "/sign-in" });
            }}
          />
        </div>
      </div>

      {/* A launch with no network can't list boards, so it hands over to the last
          one seen instead. Online this renders nothing. */}
      <LastBoardLaunch />
      {/* Where that launch lands, so it has to be openable offline. */}
      <OfflineCopyWarmer />

      <CreateBoardForm />

      {boards.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/15 p-8 text-center text-sm opacity-60 dark:border-white/20">
          No boards yet. Create your first one above.
        </p>
      ) : (
        <ul className="space-y-2">
          {boards.map((board) => (
            <li key={board.id}>
              <Link
                href={`/boards/${board.id}`}
                className="block rounded-xl border border-black/10 px-4 py-3 text-sm font-medium hover:border-black/25 dark:border-white/15 dark:hover:border-white/30"
              >
                {board.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
