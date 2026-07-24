import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { BoardAccessError } from "@/db/boards";

// Shared board-access plumbing for the board detail page and its server actions,
// so "where a signed-out user goes" and "where a denied member lands" each live
// in exactly one place.

/** The signed-in user's id, or a redirect to sign-in. */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  return session.user.id;
}

/**
 * Run board-scoped work, sending a denied member back to their boards list.
 * Membership is enforced in the db layer via `requireBoardMember`; this only
 * translates the thrown `BoardAccessError` into navigation.
 */
export async function redirectOnBoardDenial<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof BoardAccessError) redirect("/boards");
    throw err;
  }
}
