import { redirect } from "next/navigation";
import { BoardAccessError } from "@/db/boards";

// Board-access plumbing for the board detail page and its server actions, so
// "where a denied member lands" lives in exactly one place. Who the signed-in user
// is — and where a signed-out one goes — is `@/app/session`.

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
