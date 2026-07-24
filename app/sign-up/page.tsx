import Link from "next/link";
import { signUpAction } from "@/app/actions";
import { AuthForm } from "@/app/auth-form";
import { safeRedirectPath } from "@/app/safe-redirect";

// Mirrors the sign-in page: `?next=` carries an invite link across account
// creation, so a brand-new user lands straight back on the accept screen (D2).
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = safeRedirectPath(next, "");

  return (
    <AuthForm
      title="Create account"
      subtitle="Start tracking work on shared boards."
      action={signUpAction}
      submitLabel="Create account"
      showName
      next={target || undefined}
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={target ? `/sign-in?next=${encodeURIComponent(target)}` : "/sign-in"}
            className="font-medium underline"
          >
            Sign in
          </Link>
        </>
      }
    />
  );
}
