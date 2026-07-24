import Link from "next/link";
import { requireUser } from "@/app/session";
import { INVITE_REJECTION_MESSAGE, reviewInvite } from "@/db/invites";
import { AcceptInviteButton } from "./accept-invite-button";

// The accept screen for an invite link (D2). A signed-out visitor is sent through
// sign-in — with the link carried in `?next=`, so sign-in or a brand-new sign-up
// lands them right back here. A signed-in visitor sees which board they've been
// invited to and accepts, or is told why they can't: `reviewInvite` decides, so the
// screen never offers an accept the mutation would refuse.

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await requireUser(`/invite/${token}`);
  const review = await reviewInvite(token, user.id);

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-black/10 p-8 dark:border-white/15">
        {review.state === "rejected" ? (
          <>
            <h1 className="text-2xl font-semibold">Invite unavailable</h1>
            <p className="text-sm opacity-70">{INVITE_REJECTION_MESSAGE[review.reason]}</p>
            <p className="text-sm opacity-70">
              Signed in as {user.email}.{" "}
              <Link href="/boards" className="font-medium underline">
                Your boards
              </Link>
            </p>
          </>
        ) : review.state === "already-member" ? (
          <>
            <h1 className="text-2xl font-semibold">You&apos;re already in</h1>
            <p className="text-sm opacity-70">
              You&apos;re a member of <strong>{review.invite.boardName}</strong>.
            </p>
            <Link
              href={`/boards/${review.invite.boardId}`}
              className="block w-full rounded-lg bg-black px-3 py-2 text-center text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              Open board
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">You&apos;re invited</h1>
            <p className="text-sm opacity-70">
              Join <strong>{review.invite.boardName}</strong> as{" "}
              {review.invite.role === "owner" ? "an owner" : "a member"}, as{" "}
              {user.email}.
            </p>
            <AcceptInviteButton token={token} />
          </>
        )}
      </div>
    </main>
  );
}
