import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";

// Protected page: gated by the session. Real board UI arrives in ticket 03 —
// for now it just proves the auth gate (redirect out when logged out, render
// when logged in) and gives somewhere to sign out from.
export default async function BoardsPage() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-black/10 p-8 text-center dark:border-white/15">
        <div>
          <h1 className="text-2xl font-semibold">Your boards</h1>
          <p className="mt-1 text-sm opacity-60">
            Signed in as {session.user.email}
          </p>
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
    </main>
  );
}
