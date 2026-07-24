import { redirect } from "next/navigation";
import { auth } from "@/auth";

// Where a signed-out visitor goes, decided in exactly one place. Pages and server
// actions alike gate on these, so nothing has to re-derive the sign-in route — or
// forget that some entry points (an invite link, D2) need bringing back afterwards.

/** The signed-in user as pages and actions identify them. */
export type SessionUser = { id: string; email: string | null | undefined };

/**
 * The signed-in user, or a redirect to sign-in. `next` is where they should land
 * once they're through: pass it for an entry point worth returning to, so the
 * round trip — including a brand-new sign-up — comes back here rather than
 * dumping them on their boards list.
 */
export async function requireUser(next?: string): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  }
  return { id: session.user.id, email: session.user.email };
}

/** The signed-in user's id, or a redirect to sign-in — the common case. */
export async function requireUserId(next?: string): Promise<string> {
  return (await requireUser(next)).id;
}
