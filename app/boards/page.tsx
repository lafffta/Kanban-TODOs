import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { listBoardsForUser } from "@/db/boards";
import { CreateBoardForm } from "./create-board-form";

// Protected page: gated by the session. Lists the boards the signed-in user is a
// member of and lets them create one. Membership scoping (listBoardsForUser)
// means two accounts each see only their own boards — the ticket 03 demo.
export default async function BoardsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const boards = await listBoardsForUser(session.user.id);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-8 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Your boards</h1>
          <p className="mt-1 text-sm opacity-60">Signed in as {session.user.email}</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/sign-in" });
          }}
        >
          <button
            type="submit"
            className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
          >
            Sign out
          </button>
        </form>
      </div>

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
