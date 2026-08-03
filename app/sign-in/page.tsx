import Link from "next/link";
import { signInAction } from "@/app/actions";
import { AuthForm } from "@/app/auth-form";
import { LeftoverSweep } from "@/app/pwa/leftover-sweep";
import { safeRedirectPath } from "@/app/safe-redirect";

// `?next=` is how an invite link survives the trip through auth (D2): the invite
// page bounces a signed-out visitor here with the target, and the form carries it
// to the action — and on to sign-up, if they don't have an account yet.
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = safeRedirectPath(next, "");

  return (
    <>
      {/* Where a sign-out lands, so it's where anything the sign-out's own
          clearing raced with is swept up. */}
      <LeftoverSweep />
      <AuthForm
        title="Sign in"
        subtitle="Welcome back to Kanban Task Tracker."
        action={signInAction}
        submitLabel="Sign in"
        next={target || undefined}
        footer={
          <>
            No account?{" "}
            <Link
              href={target ? `/sign-up?next=${encodeURIComponent(target)}` : "/sign-up"}
              className="font-medium underline"
            >
              Create one
            </Link>
          </>
        }
      />
    </>
  );
}
