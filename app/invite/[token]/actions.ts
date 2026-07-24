"use server";

import { redirect } from "next/navigation";
import { requireUserId } from "@/app/session";
import { INVITE_REJECTION_MESSAGE, InviteError, acceptInvite } from "@/db/invites";

export type AcceptInviteState = { error: string } | undefined;

/**
 * Accept the invite and land on the board. The signed-in user — never client
 * input — is the one joined, and every rule (email match, expiry, single use) is
 * enforced in `acceptInvite`; this only turns a rejection into a message the
 * accept screen can show. Accepting an invite already accepted is a no-op that
 * still lands on the board (D2's idempotency).
 */
export async function acceptInviteAction(token: string): Promise<AcceptInviteState> {
  const userId = await requireUserId(`/invite/${token}`);

  let boardId: string;
  try {
    ({ boardId } = await acceptInvite({ token, userId }));
  } catch (error) {
    if (error instanceof InviteError) {
      return { error: INVITE_REJECTION_MESSAGE[error.reason] };
    }
    throw error;
  }
  redirect(`/boards/${boardId}`);
}
